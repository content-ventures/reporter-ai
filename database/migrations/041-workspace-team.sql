-- Team management exposes only the addressed client's relationship.
BEGIN;
CREATE OR REPLACE FUNCTION core.reporter_membership_manager(p_portal uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.context_user_id(); state text;
BEGIN
  IF current_setting('app.access_mode',true)='platform' THEN actor:=core.platform_operator();
  ELSE
    IF core.context_portal_id() IS DISTINCT FROM p_portal THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
    PERFORM core.reporter_require('reporter.edit');
    IF current_setting('app.access_mode',true)='platform_workspace' THEN
      IF NOT core.reporter_is_operator(actor) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
    ELSE
      PERFORM 1 FROM public.portal_members WHERE portal_id=p_portal AND user_id=actor FOR SHARE;
      IF NOT EXISTS(SELECT FROM public.portal_user_roles ur JOIN public.portal_roles r ON (r.portal_id,r.id)=(ur.portal_id,ur.portal_role_id)
        WHERE ur.portal_id=p_portal AND ur.user_id=actor AND r.name='admin') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
    END IF;
  END IF;
  SELECT lifecycle INTO state FROM public.reporter_workspaces WHERE portal_id=p_portal FOR SHARE;
  IF NOT FOUND THEN PERFORM core.platform_refuse('NOT_FOUND'); END IF;
  IF state NOT IN ('draft','active') THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  RETURN actor;
END $$;

CREATE OR REPLACE FUNCTION core.reporter_team_person(p_user uuid,p_portal uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'avatarUrl',u.image,
    'status',CASE WHEN u.banned THEN 'suspended' ELSE m->>'status' END,
    'accountStatus',CASE WHEN u.banned THEN 'suspended' WHEN u.auth_subject IS NULL THEN 'invited' ELSE 'active' END,
    'memberships',jsonb_build_array(m),'workspace',m->'workspace','roles',m->'roles','operator',false,
    'createdAt',u.created_at,'inviteExpiresAt',m->'inviteExpiresAt'))
  FROM core.users u CROSS JOIN LATERAL (SELECT core.reporter_membership_value(u.id,p_portal) AS m) link
  WHERE u.id=p_user AND m IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION core.reporter_invited_person(p_user uuid,p_portal uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT CASE WHEN current_setting('app.access_mode',true)='platform' THEN core.platform_person(p_user)
    ELSE core.reporter_team_person(p_user,p_portal) END
$$;

CREATE OR REPLACE FUNCTION public.reporter_team_page(p_portal uuid,p_search text,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE items jsonb; total bigint; search text:=left(coalesce(p_search,''),100);
BEGIN
  IF current_setting('app.access_mode',true)='platform' THEN PERFORM core.platform_operator();
  ELSE PERFORM core.reporter_membership_manager(p_portal); END IF;
  SELECT count(*) INTO total FROM public.portal_members m JOIN core.users u ON u.id=m.user_id
    WHERE m.portal_id=p_portal AND (u.name ILIKE '%'||search||'%' OR u.email ILIKE '%'||search||'%');
  SELECT coalesce(jsonb_agg(value ORDER BY name,id),'[]') INTO items FROM (
    SELECT u.name,u.id,core.reporter_membership_value(u.id,p_portal)||jsonb_strip_nulls(jsonb_build_object(
      'name',u.name,'email',u.email,'avatarUrl',u.image,'accountSuspended',u.banned)) AS value
    FROM public.portal_members m JOIN core.users u ON u.id=m.user_id WHERE m.portal_id=p_portal
      AND (u.name ILIKE '%'||search||'%' OR u.email ILIKE '%'||search||'%')
    ORDER BY u.name,u.id LIMIT least(greatest(coalesce(p_limit,20),1),100) OFFSET greatest(coalesce(p_offset,0),0)) page;
  RETURN jsonb_build_object('items',items,'total',total,'offset',greatest(coalesce(p_offset,0),0));
END $$;

CREATE OR REPLACE FUNCTION public.reporter_workspace_get(p_portal uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE value jsonb;
BEGIN
  IF current_setting('app.access_mode',true)='platform' THEN PERFORM core.platform_operator();
  ELSE PERFORM core.reporter_membership_manager(p_portal); END IF;
  value:=core.reporter_workspace_value(p_portal);
  IF value IS NULL THEN PERFORM core.platform_refuse('NOT_FOUND'); END IF;
  RETURN value;
END $$;

-- The invitation/renewal bodies below retain the existing atomic implementation, but their
-- person projection is restricted to the managed membership outside the global console.

CREATE OR REPLACE FUNCTION public.reporter_platform_invite(p_name text,p_email text,p_role text,p_portal uuid,p_token_hash text,p_ttl_days integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.reporter_membership_manager(p_portal); target uuid; tenant uuid; expires timestamptz;
  v_name text:=btrim(regexp_replace(coalesce(p_name,''),'\s+',' ','g')); v_email text:=lower(btrim(coalesce(p_email,'')));
BEGIN
  IF length(v_name) NOT BETWEEN 2 AND 80 THEN PERFORM core.platform_refuse('INVALID_NAME'); END IF;
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email)>254 THEN PERFORM core.platform_refuse('INVALID_EMAIL'); END IF;
  IF p_role IS NULL OR p_role NOT IN ('editor','approver','creative_reviewer','admin') THEN PERFORM core.platform_refuse('INVALID_ROLE'); END IF;
  SELECT tenant_id INTO tenant FROM public.portals WHERE id=p_portal;
  INSERT INTO core.users(name,email) VALUES(v_name,v_email)
    ON CONFLICT(lower(email)) DO UPDATE SET email=core.users.email RETURNING id INTO target;
  IF EXISTS(SELECT FROM core.users WHERE id=target AND banned) THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  IF EXISTS(SELECT FROM public.portal_members WHERE user_id=target AND portal_id=p_portal) THEN PERFORM core.platform_refuse('EMAIL_TAKEN'); END IF;
  INSERT INTO core.tenant_members(tenant_id,user_id,role,status) VALUES(tenant,target,'member','active') ON CONFLICT DO NOTHING;
  INSERT INTO public.portal_members(tenant_id,portal_id,user_id,status,invite_pending) VALUES(tenant,p_portal,target,'invited',true);
  PERFORM core.platform_set_roles(target,tenant,p_portal,ARRAY[p_role]);
  expires:=core.platform_issue(target,tenant,p_portal,p_token_hash,p_ttl_days,actor);
  PERFORM core.platform_log('invite.created',p_portal,target,actor,jsonb_build_object('roles',jsonb_build_array(p_role),'workspaceId',p_portal));
  RETURN jsonb_build_object('person',core.reporter_invited_person(target,p_portal),'expiresAt',expires);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_membership_renew(p_portal uuid,p_user uuid,p_revision bigint,p_token_hash text,p_ttl_days integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.reporter_membership_manager(p_portal); member public.portal_members; expires timestamptz;
BEGIN
  SELECT * INTO member FROM public.portal_members WHERE portal_id=p_portal AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN PERFORM core.platform_refuse('NOT_FOUND'); END IF;
  IF p_revision IS NULL OR member.revision<>p_revision THEN PERFORM core.platform_refuse('CONFLICT'); END IF;
  IF NOT member.invite_pending AND EXISTS(SELECT FROM core.users WHERE id=p_user AND auth_subject IS NOT NULL)
    OR EXISTS(SELECT FROM core.users WHERE id=p_user AND banned) THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  UPDATE public.portal_members SET status='invited',invite_pending=true,revision=revision+1 WHERE id=member.id;
  expires:=core.platform_issue(p_user,member.tenant_id,p_portal,p_token_hash,p_ttl_days,actor);
  PERFORM core.platform_log('invite.renewed',p_portal,p_user,actor,jsonb_build_object('workspaceId',p_portal));
  RETURN jsonb_build_object('person',core.reporter_invited_person(p_user,p_portal),'expiresAt',expires);
END $$;

DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY['core.reporter_team_person(uuid,uuid)','core.reporter_invited_person(uuid,uuid)',
    'public.reporter_team_page(uuid,text,integer,integer)','public.reporter_workspace_get(uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.reporter_team_page(uuid,text,integer,integer),public.reporter_workspace_get(uuid) TO reporter_runtime;
END $$;
COMMIT;
