-- Independent memberships, workspace-scoped invitations and explicit mutation targets.
BEGIN;
ALTER TABLE public.portal_members ADD COLUMN IF NOT EXISTS invite_pending boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS reporter_accounts_email ON core.users(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS reporter_roles_identity ON public.portal_roles(portal_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS reporter_roles_name ON public.portal_roles(portal_id,name)
  WHERE name IN ('editor','approver','creative_reviewer','admin');
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_constraint WHERE conname='reporter_user_role_workspace' AND conrelid='public.portal_user_roles'::regclass) THEN
    ALTER TABLE public.portal_user_roles ADD CONSTRAINT reporter_user_role_workspace
      FOREIGN KEY(portal_id,portal_role_id) REFERENCES public.portal_roles(portal_id,id) ON DELETE RESTRICT;
    ALTER TABLE public.portal_user_roles ADD CONSTRAINT reporter_user_role_membership
      FOREIGN KEY(portal_id,user_id) REFERENCES public.portal_members(portal_id,user_id) ON DELETE RESTRICT;
  END IF;
END $$;
DROP INDEX IF EXISTS core.uq_access_invites_open;
CREATE UNIQUE INDEX IF NOT EXISTS reporter_membership_invite_open ON core.access_invites(user_id,portal_id) WHERE state='open';

CREATE OR REPLACE FUNCTION core.reporter_membership_value(p_user uuid,p_portal uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id',m.id,'personId',m.user_id,'revision',m.revision,
    'workspace',jsonb_build_object('id',p.id,'name',p.name,'slug',p.slug,'status',w.lifecycle),
    'roles',core.platform_roles(m.user_id,m.portal_id),
    'status',CASE WHEN m.status='disabled' OR tm.status='disabled' THEN 'suspended'
      WHEN m.invite_pending OR m.status='invited' OR u.auth_subject IS NULL THEN 'invited' ELSE 'active' END,
    'inviteExpiresAt',(SELECT expires_at FROM core.access_invites WHERE user_id=m.user_id AND portal_id=m.portal_id AND state='open')))
  FROM public.portal_members m JOIN core.users u ON u.id=m.user_id
  JOIN core.tenant_members tm ON tm.tenant_id=m.tenant_id AND tm.user_id=m.user_id
  JOIN public.portals p ON p.id=m.portal_id JOIN public.reporter_workspaces w ON w.portal_id=p.id
  WHERE m.user_id=p_user AND m.portal_id=p_portal
$$;

CREATE OR REPLACE FUNCTION core.platform_person(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'title',u.title,'avatarUrl',u.image,
    'accountStatus',CASE WHEN u.banned THEN 'suspended' WHEN u.auth_subject IS NULL THEN 'invited' ELSE 'active' END,
    'status',CASE WHEN u.banned OR (jsonb_array_length(memberships)>0 AND NOT EXISTS(
      SELECT FROM jsonb_array_elements(memberships) m WHERE m->>'status'<>'suspended')) THEN 'suspended' WHEN u.auth_subject IS NULL THEN 'invited'
      WHEN EXISTS(SELECT FROM jsonb_array_elements(memberships) m WHERE m->>'status'='active') THEN 'active'
      WHEN EXISTS(SELECT FROM jsonb_array_elements(memberships) m WHERE m->>'status'='invited') THEN 'invited' ELSE 'suspended' END,
    'memberships',memberships,
    -- Compatibility fields have one unambiguous meaning only while there is one membership.
    'workspace',CASE WHEN jsonb_array_length(memberships)=1 THEN memberships->0->'workspace' END,
    'roles',CASE WHEN jsonb_array_length(memberships)=1 THEN memberships->0->'roles' ELSE '[]'::jsonb END,
    'operator',EXISTS(SELECT FROM public.user_roles WHERE user_id=u.id AND role='platform_admin'),
    'createdAt',u.created_at,'lastSeenAt',core.platform_last_seen(u.id,u.auth_subject),
    'inviteExpiresAt',CASE WHEN jsonb_array_length(memberships)=1 THEN memberships->0->'inviteExpiresAt' END))
  FROM core.users u CROSS JOIN LATERAL (SELECT coalesce(jsonb_agg(core.reporter_membership_value(u.id,m.portal_id) ORDER BY p.name,p.id),'[]') AS memberships
    FROM public.portal_members m JOIN public.portals p ON p.id=m.portal_id WHERE m.user_id=u.id) links
  WHERE u.id=p_user
$$;

CREATE OR REPLACE FUNCTION core.reporter_membership_manager(p_portal uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.context_user_id(); state text;
BEGIN
  IF current_setting('app.access_mode',true)='platform' THEN actor:=core.platform_operator();
  ELSE
    IF core.context_portal_id() IS DISTINCT FROM p_portal THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
    PERFORM core.reporter_require('reporter.edit');
    PERFORM 1 FROM public.portal_members WHERE portal_id=p_portal AND user_id=actor FOR SHARE;
    IF NOT EXISTS(SELECT FROM public.portal_user_roles ur JOIN public.portal_roles r ON (r.portal_id,r.id)=(ur.portal_id,ur.portal_role_id)
      WHERE ur.portal_id=p_portal AND ur.user_id=actor AND r.name='admin') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  END IF;
  SELECT lifecycle INTO state FROM public.reporter_workspaces WHERE portal_id=p_portal FOR SHARE;
  IF NOT FOUND THEN PERFORM core.platform_refuse('NOT_FOUND'); END IF;
  IF state NOT IN ('draft','active') THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  RETURN actor;
END $$;

CREATE OR REPLACE FUNCTION core.platform_issue(p_user uuid,p_tenant uuid,p_portal uuid,p_token_hash text,p_ttl_days integer,p_operator uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE expires timestamptz:=clock_timestamp()+make_interval(days=>p_ttl_days);
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_ttl_days IS NULL OR p_ttl_days NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Invalid invite' USING ERRCODE='22023';
  END IF;
  UPDATE core.access_invites SET state='revoked' WHERE user_id=p_user AND portal_id=p_portal AND state='open';
  INSERT INTO core.access_invites(user_id,tenant_id,portal_id,token_hash,created_by,expires_at)
    VALUES(p_user,p_tenant,p_portal,p_token_hash,p_operator,expires);
  RETURN expires;
END $$;

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
  RETURN jsonb_build_object('person',core.platform_person(target),'expiresAt',expires);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_workspace_members(p_portal uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  -- Listing is also available for an archived workspace in the global console.
  IF current_setting('app.access_mode',true)='platform' THEN PERFORM core.platform_operator();
  ELSE PERFORM core.reporter_membership_manager(p_portal); END IF;
  RETURN (SELECT coalesce(jsonb_agg(core.reporter_membership_value(m.user_id,m.portal_id) ORDER BY u.name,u.id),'[]')
    FROM public.portal_members m JOIN core.users u ON u.id=m.user_id WHERE m.portal_id=p_portal);
END $$;

CREATE OR REPLACE FUNCTION core.platform_set_roles(p_user uuid,p_tenant uuid,p_portal uuid,p_roles text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF p_roles IS NULL OR cardinality(p_roles)=0 THEN PERFORM core.platform_refuse('NO_ROLES'); END IF;
  IF cardinality(p_roles)>8 OR array_position(p_roles,NULL) IS NOT NULL
    OR EXISTS(SELECT FROM unnest(p_roles) role WHERE role NOT IN ('editor','approver','creative_reviewer','admin')) THEN
    PERFORM core.platform_refuse('INVALID_ROLE');
  END IF;
  IF NOT EXISTS(SELECT FROM public.portal_members WHERE portal_id=p_portal AND user_id=p_user AND tenant_id=p_tenant) THEN
    PERFORM core.platform_refuse('NOT_FOUND');
  END IF;
  DELETE FROM public.portal_user_roles ur USING public.portal_roles r WHERE ur.portal_id=p_portal AND ur.user_id=p_user
    AND r.id=ur.portal_role_id AND r.name IN ('editor','approver','creative_reviewer','admin');
  INSERT INTO public.portal_user_roles(portal_id,user_id,portal_role_id)
    SELECT p_portal,p_user,id FROM public.portal_roles WHERE portal_id=p_portal AND name=ANY(p_roles);
  -- Tenant membership is internal plumbing, not the source of workspace privileges.
  UPDATE core.tenant_members tm SET role=CASE WHEN EXISTS(SELECT FROM public.portal_members m
    JOIN public.portal_user_roles ur ON ur.portal_id=m.portal_id AND ur.user_id=m.user_id
    JOIN public.portal_roles r ON (r.portal_id,r.id)=(ur.portal_id,ur.portal_role_id)
    WHERE m.user_id=p_user AND m.tenant_id=p_tenant AND m.status='active' AND r.name='admin') THEN 'admin' ELSE 'member' END
    WHERE tm.tenant_id=p_tenant AND tm.user_id=p_user;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_account_status(p_user uuid,p_suspended boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.platform_operator(); before_value jsonb;
BEGIN
  IF actor=p_user THEN PERFORM core.platform_refuse('SELF'); END IF;
  PERFORM 1 FROM core.users WHERE id=p_user FOR UPDATE;
  IF NOT FOUND THEN PERFORM core.platform_refuse('NOT_FOUND'); END IF;
  IF p_suspended IS NULL THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  before_value:=core.platform_person(p_user);
  UPDATE core.users SET banned=p_suspended,ban_expires=NULL,ban_reason=CASE WHEN p_suspended THEN 'Suspended by platform administrator' END WHERE id=p_user;
  IF p_suspended THEN UPDATE core.access_invites SET state='revoked' WHERE user_id=p_user AND state='open'; END IF;
  PERFORM core.platform_log(CASE WHEN p_suspended THEN 'account.suspended' ELSE 'account.restored' END,NULL,p_user,actor,
    jsonb_build_object('before',before_value,'after',core.platform_person(p_user)));
  RETURN core.platform_person(p_user);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_membership_change(p_portal uuid,p_user uuid,p_revision bigint,p_roles text[],p_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.reporter_membership_manager(p_portal); member public.portal_members; before_value jsonb; value jsonb;
BEGIN
  IF p_user=actor THEN PERFORM core.platform_refuse('SELF'); END IF;
  SELECT * INTO member FROM public.portal_members WHERE user_id=p_user AND portal_id=p_portal FOR UPDATE;
  IF NOT FOUND THEN PERFORM core.platform_refuse('NOT_FOUND'); END IF;
  IF p_revision IS NULL OR member.revision<>p_revision THEN PERFORM core.platform_refuse('CONFLICT'); END IF;
  IF (p_roles IS NULL)=(p_status IS NULL) THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  before_value:=core.reporter_membership_value(p_user,p_portal);
  IF p_roles IS NOT NULL THEN
    PERFORM core.platform_set_roles(p_user,member.tenant_id,p_portal,p_roles);
  ELSE
    IF p_status NOT IN ('active','suspended')
      OR (p_status='active' AND (member.invite_pending OR EXISTS(SELECT FROM core.users WHERE id=p_user AND (banned OR auth_subject IS NULL)))) THEN
      PERFORM core.platform_refuse('INVALID_STATE');
    END IF;
    UPDATE public.portal_members SET status=CASE WHEN p_status='suspended' THEN 'disabled' ELSE 'active' END WHERE id=member.id;
    IF p_status='suspended' THEN UPDATE core.access_invites SET state='revoked' WHERE user_id=p_user AND portal_id=p_portal AND state='open'; END IF;
  END IF;
  UPDATE public.portal_members SET revision=revision+1 WHERE id=member.id;
  value:=core.reporter_membership_value(p_user,p_portal);
  PERFORM core.reporter_workspace_log(CASE WHEN p_roles IS NOT NULL THEN 'membership.roles'
    WHEN p_status='active' THEN 'membership.restored' ELSE 'membership.suspended' END,p_portal,p_user,before_value,value);
  RETURN value;
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
  RETURN jsonb_build_object('person',core.platform_person(p_user),'expiresAt',expires);
END $$;

-- Old person-only mutations refuse an ambiguous account instead of choosing an arbitrary client.
CREATE OR REPLACE FUNCTION core.platform_target(p_user uuid,p_operator uuid,OUT tenant uuid,OUT portal uuid,OUT subject text,OUT suspended boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF p_user=p_operator THEN PERFORM core.platform_refuse('SELF'); END IF;
  IF (SELECT count(*) FROM public.portal_members WHERE user_id=p_user)>1 THEN PERFORM core.platform_refuse('AMBIGUOUS_MEMBERSHIP'); END IF;
  SELECT tm.tenant_id,pm.portal_id,u.auth_subject,(tm.status='disabled' OR pm.status='disabled') INTO tenant,portal,subject,suspended
    FROM core.users u JOIN core.tenant_members tm ON tm.user_id=u.id JOIN public.portal_members pm ON pm.user_id=u.id AND pm.tenant_id=tm.tenant_id
    WHERE u.id=p_user FOR UPDATE OF tm,pm;
  IF tenant IS NULL THEN PERFORM core.platform_refuse('NOT_FOUND'); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_invite_local_subject(p_token_hash text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT coalesce(u.auth_subject,'local:'||u.id::text) FROM core.access_invites i JOIN core.users u ON u.id=i.user_id
  WHERE to_regclass('neon_auth."user"') IS NULL AND current_setting('app.access_mode',true)='invite'
    AND i.token_hash=p_token_hash AND i.state IN ('open','used') AND i.expires_at>clock_timestamp()
$$;

CREATE OR REPLACE FUNCTION public.reporter_invite_accept(p_token_hash text,p_subject text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE invite core.access_invites; v_email text; account text;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_subject IS NULL OR btrim(p_subject)='' OR length(p_subject)>255 THEN
    PERFORM core.platform_refuse('INVALID_LINK');
  END IF;
  SELECT * INTO invite FROM core.access_invites WHERE token_hash=p_token_hash FOR UPDATE;
  IF invite.id IS NULL OR invite.state='revoked' THEN PERFORM core.platform_refuse('INVALID_LINK'); END IF;
  IF invite.expires_at<=clock_timestamp() THEN PERFORM core.platform_refuse('EXPIRED'); END IF;
  IF NOT EXISTS(SELECT FROM public.portals WHERE id=invite.portal_id AND status IN ('draft','active') AND deleted_at IS NULL) THEN
    PERFORM core.platform_refuse('INVALID_LINK');
  END IF;
  SELECT lower(email) INTO v_email FROM core.users WHERE id=invite.user_id AND NOT banned FOR UPDATE;
  IF v_email IS NULL THEN PERFORM core.platform_refuse('INVALID_LINK'); END IF;
  IF to_regclass('neon_auth."user"') IS NOT NULL THEN
    account:=core.platform_auth_account(v_email);
    IF account IS DISTINCT FROM p_subject THEN PERFORM core.platform_refuse('INVALID_LINK'); END IF;
  END IF;
  IF EXISTS(SELECT FROM core.users WHERE auth_subject=p_subject AND id<>invite.user_id) THEN PERFORM core.platform_refuse('INVALID_LINK'); END IF;
  IF EXISTS(SELECT FROM core.users WHERE id=invite.user_id AND auth_subject IS NOT NULL AND auth_subject<>p_subject) THEN PERFORM core.platform_refuse('INVALID_LINK'); END IF;
  IF invite.state='used' THEN RETURN jsonb_build_object('email',v_email); END IF;
  IF to_regclass('neon_auth."user"') IS NOT NULL THEN
    EXECUTE 'UPDATE neon_auth."user" SET "emailVerified"=true WHERE id::text=$1' USING p_subject;
  END IF;
  UPDATE core.users SET auth_subject=p_subject,email_verified=true,updated_at=clock_timestamp()
    WHERE id=invite.user_id AND (auth_subject IS NULL OR auth_subject=p_subject);
  IF NOT FOUND THEN PERFORM core.platform_refuse('INVALID_LINK'); END IF;
  UPDATE public.portal_members SET status='active',invite_pending=false,revision=revision+1 WHERE portal_id=invite.portal_id AND user_id=invite.user_id;
  UPDATE core.access_invites SET state='used',used_at=clock_timestamp() WHERE id=invite.id;
  PERFORM core.platform_log('invite.accepted',invite.portal_id,invite.user_id,NULL,jsonb_build_object('workspaceId',invite.portal_id));
  RETURN jsonb_build_object('email',v_email);
END $$;

DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY['core.reporter_membership_value(uuid,uuid)','core.reporter_membership_manager(uuid)',
    'public.reporter_workspace_members(uuid)','public.reporter_membership_change(uuid,uuid,bigint,text[],text)',
    'public.reporter_invite_local_subject(text)','public.reporter_account_status(uuid,boolean)',
    'public.reporter_membership_renew(uuid,uuid,bigint,text,integer)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['public.reporter_workspace_members(uuid)','public.reporter_membership_change(uuid,uuid,bigint,text[],text)',
    'public.reporter_invite_local_subject(text)','public.reporter_account_status(uuid,boolean)',
    'public.reporter_membership_renew(uuid,uuid,bigint,text,integer)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporter_runtime',fn);
  END LOOP;
END $$;
COMMIT;
