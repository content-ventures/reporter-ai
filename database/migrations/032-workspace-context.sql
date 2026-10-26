-- Explicit workspace context. Global administration retains the authenticated actor.
BEGIN;
CREATE OR REPLACE FUNCTION core.reporter_bound_identity(p_subject text,p_email text,p_name text,p_image text,p_verified boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE person core.users;
BEGIN
  IF p_verified IS NOT TRUE OR p_subject IS NULL OR btrim(p_subject)='' OR length(p_subject)>255
    OR p_email IS NULL OR length(p_email)>320 OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 255 THEN RETURN NULL; END IF;
  SELECT * INTO person FROM core.users WHERE lower(email)=lower(p_email) AND (auth_subject=p_subject OR auth_subject IS NULL) FOR UPDATE;
  IF person.id IS NULL OR person.banned THEN RETURN NULL; END IF;
  UPDATE core.users SET auth_subject=p_subject,email_verified=true,
    name=CASE WHEN profile_updated_at IS NULL THEN p_name ELSE name END,
    image=CASE WHEN profile_updated_at IS NULL THEN p_image ELSE image END,updated_at=clock_timestamp()
    WHERE id=person.id AND (auth_subject IS DISTINCT FROM p_subject OR NOT email_verified
      OR profile_updated_at IS NULL AND (name IS DISTINCT FROM p_name OR image IS DISTINCT FROM p_image));
  RETURN person.id;
END $$;

CREATE OR REPLACE FUNCTION core.reporter_is_operator(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(SELECT FROM core.users u JOIN public.user_roles r ON r.user_id=u.id
    WHERE u.id=p_user AND NOT u.banned AND r.role='platform_admin')
$$;

CREATE OR REPLACE FUNCTION core.reporter_workspace_context(p_user uuid,p_slug text)
RETURNS TABLE(tenant_id uuid,portal_id uuid,user_id uuid,workspace_name text,workspace_slug text,user_name text,user_email text,user_image text,
  roles text[],administrative boolean,workspace_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT p.tenant_id,p.id,u.id,p.name,p.slug,u.name,u.email,u.image,
    CASE WHEN operator THEN ARRAY['admin']::text[] ELSE ARRAY(SELECT jsonb_array_elements_text(core.platform_roles(u.id,p.id))) END,
    operator,w.lifecycle
  FROM public.portals p JOIN core.tenants t ON t.id=p.tenant_id JOIN public.reporter_workspaces w ON w.portal_id=p.id
  JOIN core.tenant_modules tm ON tm.tenant_id=p.tenant_id AND tm.module_key='reporter_ai' AND tm.enabled
  JOIN core.portal_modules pm ON pm.portal_id=p.id AND pm.module_key='reporter_ai' AND pm.enabled
  JOIN core.users u ON u.id=p_user CROSS JOIN LATERAL (SELECT core.reporter_is_operator(u.id) AS operator) access
  WHERE p.slug=p_slug AND p.status IN ('active','draft') AND p.deleted_at IS NULL AND t.status='active' AND NOT u.banned
    AND (operator OR EXISTS(SELECT FROM public.portal_members m JOIN core.tenant_members membership ON membership.tenant_id=m.tenant_id AND membership.user_id=m.user_id
      WHERE m.portal_id=p.id AND m.user_id=u.id AND m.status='active' AND NOT m.invite_pending AND membership.status='active'
        AND (p.status='active' OR core.platform_roles(u.id,p.id) ? 'admin')))
$$;

CREATE OR REPLACE FUNCTION public.reporter_workspace_context(p_subject text,p_email text,p_name text,p_image text,p_verified boolean,p_slug text)
RETURNS TABLE(tenant_id uuid,portal_id uuid,user_id uuid,workspace_name text,workspace_slug text,user_name text,user_email text,user_image text,
  roles text[],administrative boolean,workspace_status text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT * FROM core.reporter_workspace_context(core.reporter_bound_identity(p_subject,p_email,p_name,p_image,p_verified),p_slug)
$$;

CREATE OR REPLACE FUNCTION public.reporter_local_workspace_context(p_slug text)
RETURNS TABLE(tenant_id uuid,portal_id uuid,user_id uuid,workspace_name text,workspace_slug text,user_name text,user_email text,user_image text,
  roles text[],administrative boolean,workspace_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.platform_operator();
BEGIN
  IF actor<>'00000000-0000-0000-0000-000000000031'::uuid OR NOT EXISTS(
    SELECT FROM core.users WHERE id=actor AND email='operator@reporter.local.invalid') THEN RAISE EXCEPTION 'LOCAL_ONLY' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT * FROM core.reporter_workspace_context(actor,p_slug);
END $$;

CREATE OR REPLACE FUNCTION core.reporter_workspace_directory(p_user uuid,p_search text,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE operator boolean:=core.reporter_is_operator(p_user); entries jsonb; total bigint; search text:=left(coalesce(btrim(p_search),''),100);
BEGIN
  WITH available AS (SELECT p.id FROM public.portals p JOIN public.reporter_workspaces w ON w.portal_id=p.id JOIN core.tenants t ON t.id=p.tenant_id
    WHERE p.deleted_at IS NULL AND t.status='active' AND (p.name ILIKE '%'||search||'%' OR p.slug ILIKE '%'||search||'%')
      AND (operator OR EXISTS(SELECT FROM public.portal_members m JOIN core.tenant_members tm ON tm.tenant_id=m.tenant_id AND tm.user_id=m.user_id
        WHERE m.portal_id=p.id AND m.user_id=p_user AND m.status='active' AND NOT m.invite_pending AND tm.status='active' AND p.status IN ('draft','active'))))
    SELECT count(*) INTO total FROM available;
  SELECT coalesce(jsonb_agg(value ORDER BY name,id),'[]') INTO entries FROM (
    SELECT p.name,p.id,jsonb_build_object('workspace',core.reporter_workspace_value(p.id),'administrative',operator,
      'roles',CASE WHEN operator THEN '["admin"]'::jsonb ELSE core.platform_roles(p_user,p.id) END) AS value
    FROM public.portals p JOIN public.reporter_workspaces w ON w.portal_id=p.id JOIN core.tenants t ON t.id=p.tenant_id
    WHERE p.deleted_at IS NULL AND t.status='active' AND (p.name ILIKE '%'||search||'%' OR p.slug ILIKE '%'||search||'%')
      AND (operator OR EXISTS(SELECT FROM public.portal_members m JOIN core.tenant_members tm ON tm.tenant_id=m.tenant_id AND tm.user_id=m.user_id
        WHERE m.portal_id=p.id AND m.user_id=p_user AND m.status='active' AND NOT m.invite_pending AND tm.status='active' AND p.status IN ('draft','active')))
    ORDER BY p.name,p.id LIMIT least(greatest(coalesce(p_limit,50),1),100) OFFSET greatest(coalesce(p_offset,0),0)) page;
  RETURN jsonb_build_object('items',entries,'total',total,'offset',greatest(coalesce(p_offset,0),0),'administrative',operator);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_workspace_directory(p_subject text,p_email text,p_name text,p_image text,p_verified boolean,p_search text,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT core.reporter_workspace_directory(core.reporter_bound_identity(p_subject,p_email,p_name,p_image,p_verified),p_search,p_limit,p_offset)
$$;
CREATE OR REPLACE FUNCTION public.reporter_local_workspace_directory(p_search text,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.platform_operator();
BEGIN
  IF actor<>'00000000-0000-0000-0000-000000000031'::uuid OR NOT EXISTS(
    SELECT FROM core.users WHERE id=actor AND email='operator@reporter.local.invalid') THEN RAISE EXCEPTION 'LOCAL_ONLY' USING ERRCODE='42501'; END IF;
  RETURN core.reporter_workspace_directory(actor,p_search,p_limit,p_offset);
END $$;

CREATE OR REPLACE FUNCTION core.reporter_context_member(p_portal uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(SELECT FROM public.portals p JOIN core.tenants t ON t.id=p.tenant_id
    JOIN core.tenant_members tm ON tm.tenant_id=t.id AND tm.user_id=core.context_user_id() AND tm.status='active'
    JOIN public.portal_members m ON m.portal_id=p.id AND m.user_id=tm.user_id AND m.status='active' AND NOT m.invite_pending
    JOIN core.users u ON u.id=m.user_id AND NOT u.banned
    JOIN core.tenant_modules module ON module.tenant_id=t.id AND module.module_key='reporter_ai' AND module.enabled
    JOIN core.portal_modules feature ON feature.portal_id=p.id AND feature.module_key='reporter_ai' AND feature.enabled
    WHERE p.id=p_portal AND p.tenant_id=core.context_tenant_id() AND t.status='active' AND p.deleted_at IS NULL
      AND (p.status='active' OR p.status='draft' AND core.platform_roles(u.id,p.id) ? 'admin'))
$$;

CREATE OR REPLACE FUNCTION core.reporter_allowed(p_portal uuid,p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT coalesce(current_setting('app.module_key',true)='reporter_ai' AND p_portal=core.context_portal_id()
    AND (current_setting('app.access_mode',true)='user'
      AND core.reporter_context_member(p_portal)
      AND EXISTS(SELECT FROM public.portal_user_roles ur JOIN public.portal_roles r ON (r.portal_id,r.id)=(ur.portal_id,ur.portal_role_id)
        JOIN public.portal_role_permissions rp ON rp.portal_role_id=r.id WHERE ur.portal_id=p_portal AND ur.user_id=core.context_user_id() AND rp.permission=p_permission)
    OR current_setting('app.access_mode',true)='platform_workspace' AND core.reporter_is_operator(core.context_user_id())
      AND p_permission IN ('reporter.read','reporter.edit','reporter.submit','reporter.review','reporter.retry')
      AND EXISTS(SELECT FROM public.portals p JOIN core.tenants t ON t.id=p.tenant_id
        JOIN core.tenant_modules tm ON tm.tenant_id=t.id AND tm.module_key='reporter_ai' AND tm.enabled
        JOIN core.portal_modules pm ON pm.portal_id=p.id AND pm.module_key='reporter_ai' AND pm.enabled
        WHERE p.id=p_portal AND p.tenant_id=core.context_tenant_id() AND p.status IN ('draft','active') AND p.deleted_at IS NULL AND t.status='active')),false)
$$;

CREATE OR REPLACE FUNCTION core.reporter_audit(p_portal uuid,p_action text,p_entity text,p_id uuid,p_data jsonb)
RETURNS void LANGUAGE sql SET search_path=pg_catalog,core,public,pg_temp AS $$
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,entity_id,after_data,source,request_id,correlation_id)
  VALUES(p_portal,CASE WHEN current_setting('app.access_mode',true) IN ('user','platform_workspace') THEN core.context_user_id() END,
    p_action,p_entity,p_id,p_data,'reporter_ai',nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid)
$$;

DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY['core.reporter_bound_identity(text,text,text,text,boolean)','core.reporter_is_operator(uuid)',
    'core.reporter_workspace_context(uuid,text)','core.reporter_workspace_directory(uuid,text,integer,integer)','core.reporter_context_member(uuid)',
    'public.reporter_workspace_context(text,text,text,text,boolean,text)','public.reporter_local_workspace_context(text)',
    'public.reporter_workspace_directory(text,text,text,text,boolean,text,integer,integer)','public.reporter_local_workspace_directory(text,integer,integer)',
    'core.reporter_allowed(uuid,text)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['public.reporter_workspace_context(text,text,text,text,boolean,text)','public.reporter_local_workspace_context(text)',
    'public.reporter_workspace_directory(text,text,text,text,boolean,text,integer,integer)','public.reporter_local_workspace_directory(text,integer,integer)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporter_runtime',fn);
  END LOOP;
  GRANT EXECUTE ON FUNCTION core.reporter_allowed(uuid,text),core.reporter_is_operator(uuid) TO reporter_executor;
END $$;
COMMIT;
