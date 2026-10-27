-- Short-lived support views preserve the actual operator and cannot acquire write authority.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS reporter_member_view_identity ON public.portal_members(portal_id,id,user_id);
CREATE TABLE IF NOT EXISTS core.reporter_member_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES core.users(id),
  portal_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  person_id uuid NOT NULL,
  membership_revision bigint NOT NULL CHECK(membership_revision>0),
  roles jsonb NOT NULL CHECK(jsonb_typeof(roles)='array' AND jsonb_array_length(roles) BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
  ended_at timestamptz,
  end_reason text CHECK(end_reason IN ('exit','workspace_changed','logout','account_changed','expired','operator_revoked','membership_changed','workspace_unavailable')),
  FOREIGN KEY(portal_id,membership_id,person_id) REFERENCES public.portal_members(portal_id,id,user_id),
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes 1 second'),
  CHECK((ended_at IS NULL)=(end_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS reporter_member_views_open ON core.reporter_member_views(operator_id,expires_at) WHERE ended_at IS NULL;
ALTER TABLE core.reporter_member_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON core.reporter_member_views FROM PUBLIC,reporter_runtime,reporter_worker,reporter_executor;

CREATE OR REPLACE FUNCTION core.reporter_member_view_actor(p_subject text,p_email text,p_verified boolean) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF p_subject IS NULL AND current_setting('app.access_mode',true)='platform'
    AND core.context_user_id()='00000000-0000-0000-0000-000000000031'::uuid
    AND EXISTS(SELECT FROM core.users WHERE id=core.context_user_id() AND email='operator@reporter.local.invalid') THEN
    RETURN core.context_user_id();
  END IF;
  IF p_verified IS NOT TRUE THEN RETURN NULL; END IF;
  -- A revoked operator can still end their own view. Starting and reading recheck the role.
  RETURN (SELECT id FROM core.users WHERE auth_subject=p_subject AND lower(email)=lower(p_email));
END $$;

CREATE OR REPLACE FUNCTION core.reporter_member_view_reason(p_view uuid,p_operator uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE v core.reporter_member_views; p public.portals; w public.reporter_workspaces;
BEGIN
  SELECT * INTO v FROM core.reporter_member_views WHERE id=p_view AND operator_id=p_operator;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  IF v.ended_at IS NOT NULL THEN RETURN v.end_reason; END IF;
  IF v.expires_at<=clock_timestamp() THEN RETURN 'expired'; END IF;
  IF NOT core.reporter_is_operator(p_operator) THEN RETURN 'operator_revoked'; END IF;
  SELECT * INTO p FROM public.portals WHERE id=v.portal_id;
  SELECT * INTO w FROM public.reporter_workspaces WHERE portal_id=v.portal_id;
  IF p.id IS NULL OR w.portal_id IS NULL OR p.deleted_at IS NOT NULL OR p.status NOT IN ('active','draft') OR w.lifecycle NOT IN ('active','draft')
    OR NOT EXISTS(SELECT FROM core.tenants WHERE id=p.tenant_id AND status='active')
    OR NOT EXISTS(SELECT FROM core.tenant_modules WHERE tenant_id=p.tenant_id AND module_key='reporter_ai' AND enabled)
    OR NOT EXISTS(SELECT FROM core.portal_modules WHERE portal_id=p.id AND module_key='reporter_ai' AND enabled) THEN RETURN 'workspace_unavailable'; END IF;
  IF NOT EXISTS(SELECT FROM public.portal_members m JOIN core.tenant_members tm ON tm.tenant_id=m.tenant_id AND tm.user_id=m.user_id
    JOIN core.users u ON u.id=m.user_id WHERE m.id=v.membership_id AND m.portal_id=v.portal_id AND m.user_id=v.person_id
      AND m.revision=v.membership_revision AND m.status='active' AND NOT m.invite_pending AND tm.status='active'
      AND NOT u.banned AND u.email_verified AND u.auth_subject IS NOT NULL
      AND core.platform_roles(m.user_id,m.portal_id)=v.roles
      AND (p.status='active' OR v.roles ? 'admin')
      AND EXISTS(SELECT FROM public.portal_user_roles ur JOIN public.portal_roles r ON r.id=ur.portal_role_id AND r.portal_id=ur.portal_id
        JOIN public.portal_role_permissions rp ON rp.portal_role_id=r.id
        WHERE ur.portal_id=m.portal_id AND ur.user_id=m.user_id AND rp.permission='reporter.read')) THEN RETURN 'membership_changed'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION core.reporter_member_view_audit(p_view uuid,p_action text,p_reason text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,entity_id,before_data,after_data,source,request_id,correlation_id)
  SELECT v.portal_id,v.operator_id,'platform.member_view.'||p_action,'member_view',v.id,
    CASE WHEN p_action='ended' THEN jsonb_build_object('status','active') END,
    jsonb_strip_nulls(jsonb_build_object('status',CASE WHEN p_action='started' THEN 'active' ELSE 'ended' END,
      'membershipId',v.membership_id,'personId',v.person_id,'expiresAt',v.expires_at,'reason',p_reason)),
    'platform',nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid
  FROM core.reporter_member_views v WHERE v.id=p_view
$$;

CREATE OR REPLACE FUNCTION core.reporter_member_view_value(p_view uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_build_object('id',v.id,'readOnly',true,'workspace',jsonb_build_object('id',p.id,'name',p.name,'slug',p.slug),
    'person',jsonb_strip_nulls(jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'avatarUrl',u.image,'roles',v.roles)),
    'operator',jsonb_strip_nulls(jsonb_build_object('id',a.id,'name',a.name,'email',a.email,'avatarUrl',a.image)),
    'expiresAt',v.expires_at,'remainingMs',greatest(0,floor(extract(epoch FROM (v.expires_at-clock_timestamp()))*1000)))
  FROM core.reporter_member_views v JOIN public.portals p ON p.id=v.portal_id
    JOIN core.users u ON u.id=v.person_id JOIN core.users a ON a.id=v.operator_id WHERE v.id=p_view
$$;

CREATE OR REPLACE FUNCTION public.reporter_member_view_start(p_portal uuid,p_person uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.platform_operator(); member public.portal_members; view_id uuid; reason text;
BEGIN
  SELECT * INTO member FROM public.portal_members WHERE portal_id=p_portal AND user_id=p_person FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO core.reporter_member_views(operator_id,portal_id,membership_id,person_id,membership_revision,roles)
    VALUES(actor,p_portal,member.id,p_person,member.revision,core.platform_roles(p_person,p_portal)) RETURNING id INTO view_id;
  reason:=core.reporter_member_view_reason(view_id,actor);
  IF reason IS NOT NULL THEN RAISE EXCEPTION 'Member unavailable' USING ERRCODE='42501'; END IF;
  -- Snapshot reads need no lazy database writes once the support view becomes read-only.
  INSERT INTO public.reporter_ed_sync(portal_id) VALUES(p_portal) ON CONFLICT DO NOTHING;
  PERFORM core.reporter_member_view_audit(view_id,'started',NULL);
  RETURN core.reporter_member_view_value(view_id);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_member_view_context(p_subject text,p_email text,p_verified boolean,p_view uuid,p_slug text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.reporter_member_view_actor(p_subject,p_email,p_verified); v core.reporter_member_views; reason text; context jsonb;
BEGIN
  SELECT * INTO v FROM core.reporter_member_views WHERE id=p_view AND operator_id=actor FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','MEMBER_VIEW_UNAVAILABLE'); END IF;
  IF p_slug IS NOT NULL AND NOT EXISTS(SELECT FROM public.portals WHERE id=v.portal_id AND slug=p_slug) THEN
    RETURN jsonb_build_object('error','MEMBER_VIEW_UNAVAILABLE');
  END IF;
  reason:=core.reporter_member_view_reason(p_view,actor);
  IF reason IS NOT NULL THEN
    IF v.ended_at IS NULL THEN
      UPDATE core.reporter_member_views SET ended_at=clock_timestamp(),end_reason=reason WHERE id=p_view;
      PERFORM core.reporter_member_view_audit(p_view,'ended',reason);
    END IF;
    -- Return, do not raise: the expired/revoked view and its audit must commit.
    RETURN jsonb_build_object('error','MEMBER_VIEW_ENDED');
  END IF;
  SELECT jsonb_build_object('tenant',p.tenant_id,'portal',p.id,'actor',u.id,'workspaceName',p.name,'workspaceSlug',p.slug,
    'name',u.name,'email',u.email,'image',u.image,'roles',v.roles,'addressed',true,'administrative',false,'workspaceStatus',w.lifecycle)
    INTO context FROM public.portals p JOIN public.reporter_workspaces w ON w.portal_id=p.id JOIN core.users u ON u.id=v.person_id WHERE p.id=v.portal_id;
  RETURN jsonb_build_object('context',context,'view',core.reporter_member_view_value(p_view));
END $$;

CREATE OR REPLACE FUNCTION public.reporter_member_view_end(p_subject text,p_email text,p_verified boolean,p_view uuid,p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.reporter_member_view_actor(p_subject,p_email,p_verified); v core.reporter_member_views; reason text;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('exit','workspace_changed','logout','account_changed') THEN RAISE EXCEPTION 'Invalid exit' USING ERRCODE='22023'; END IF;
  SELECT * INTO v FROM core.reporter_member_views WHERE id=p_view AND operator_id=actor FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v.ended_at IS NOT NULL THEN RETURN true; END IF;
  reason:=coalesce(core.reporter_member_view_reason(p_view,actor),p_reason);
  UPDATE core.reporter_member_views SET ended_at=clock_timestamp(),end_reason=reason WHERE id=p_view;
  PERFORM core.reporter_member_view_audit(p_view,'ended',reason);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_member_view_valid(p_view uuid,p_operator uuid,p_portal uuid,p_person uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT nullif(current_setting('app.member_view',true),'')=p_view::text
    AND nullif(current_setting('app.real_user_id',true),'')=p_operator::text
    AND core.context_portal_id()=p_portal AND core.context_user_id()=p_person
    AND EXISTS(SELECT FROM core.reporter_member_views WHERE id=p_view AND operator_id=p_operator AND portal_id=p_portal AND person_id=p_person)
    AND core.reporter_member_view_reason(p_view,p_operator) IS NULL
$$;

CREATE OR REPLACE FUNCTION core.reporter_allowed(p_portal uuid,p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT coalesce((nullif(current_setting('app.member_view',true),'') IS NULL OR p_permission='reporter.read'
      AND public.reporter_member_view_valid(nullif(current_setting('app.member_view',true),'')::uuid,
        nullif(current_setting('app.real_user_id',true),'')::uuid,p_portal,core.context_user_id()))
    AND current_setting('app.module_key',true)='reporter_ai' AND p_portal=core.context_portal_id()
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

-- Retain function identity/permissions and the normal lazy initialization contract on replay.
DO $migration$ DECLARE definition text; needle text:='INSERT INTO public.reporter_ed_sync(portal_id) VALUES(portal) ON CONFLICT DO NOTHING;'; BEGIN
  definition:=pg_get_functiondef('public.reporter_ed_load(jsonb)'::regprocedure);
  IF strpos(definition,'member_view_read_only')=0 THEN
    IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unknown editorial load initialization'; END IF;
    definition:=replace(definition,needle,'IF nullif(current_setting(''app.member_view'',true),'''') IS NULL THEN /* member_view_read_only */ '||needle||' END IF;');
    EXECUTE definition;
  END IF;
END $migration$;

DO $$ DECLARE signature text; BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'core.reporter_member_view_actor(text,text,boolean)','core.reporter_member_view_reason(uuid,uuid)',
    'core.reporter_member_view_audit(uuid,text,text)','core.reporter_member_view_value(uuid)',
    'public.reporter_member_view_start(uuid,uuid)','public.reporter_member_view_context(text,text,boolean,uuid,text)',
    'public.reporter_member_view_end(text,text,boolean,uuid,text)','public.reporter_member_view_valid(uuid,uuid,uuid,uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.reporter_member_view_start(uuid,uuid),public.reporter_member_view_context(text,text,boolean,uuid,text),
    public.reporter_member_view_end(text,text,boolean,uuid,text),public.reporter_member_view_valid(uuid,uuid,uuid,uuid) TO reporter_runtime;
END $$;
COMMIT;
