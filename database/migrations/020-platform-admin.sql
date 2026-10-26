-- Console da plataforma: the platform operator, access links and the console's reads and writes.
-- Safe to replay. The runtime only EXECUTEs these functions; each one checks the platform role of
-- `app.user_id` itself (`app.access_mode='platform'`), and every write lands in public.audit_log
-- with source 'platform'. The platform role is never granted here, except to the synthetic local
-- operator: production grants it from the terminal (`pnpm db:cloud:grant --platform-admin`).
BEGIN;

-- Cloud adds these in 005; the local database gets them here so both run the same functions.
ALTER TABLE core.users ADD COLUMN IF NOT EXISTS auth_subject text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_core_users_auth_subject ON core.users(auth_subject) WHERE auth_subject IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON public.audit_log(user_id,created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_platform ON public.audit_log(created_at DESC) WHERE source='platform';

-- Every active portal offers the four product roles (cloud already has them since 005).
INSERT INTO public.portal_roles(portal_id,name,description)
  SELECT p.id,r.name,r.description FROM public.portals p
  CROSS JOIN (VALUES ('admin','Administração do Reporter AI'),('editor','Criação e edição editorial'),
    ('approver','Aprovação editorial'),('creative_reviewer','Revisão de criativos')) r(name,description)
  WHERE p.deleted_at IS NULL AND NOT EXISTS(SELECT FROM public.portal_roles pr WHERE pr.portal_id=p.id AND pr.name=r.name);
INSERT INTO public.portal_role_permissions(portal_role_id,permission)
  SELECT pr.id,perm FROM public.portal_roles pr
  CROSS JOIN LATERAL unnest(CASE pr.name
    WHEN 'admin' THEN ARRAY['reporter.read','reporter.edit','reporter.submit','reporter.review','reporter.retry']
    WHEN 'editor' THEN ARRAY['reporter.read','reporter.edit','reporter.submit','reporter.retry']
    WHEN 'approver' THEN ARRAY['reporter.read','reporter.review']
    ELSE ARRAY['reporter.read','reporter.review'] END) perm
  WHERE pr.name IN ('admin','editor','approver','creative_reviewer')
  ON CONFLICT(portal_role_id,permission) DO NOTHING;

-- One open link per person and workspace; only the SHA-256 of the token is kept.
CREATE TABLE IF NOT EXISTS core.access_invites(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL,
  portal_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','used','revoked')),
  created_by uuid REFERENCES core.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  FOREIGN KEY(tenant_id,portal_id) REFERENCES public.portals(tenant_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_access_invites_open ON core.access_invites(user_id,portal_id) WHERE state='open';
ALTER TABLE core.access_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON core.access_invites FROM PUBLIC;

-- The synthetic local operator opens the console on a developer's machine; nobody else is granted.
INSERT INTO public.user_roles(user_id,role)
  SELECT id,'platform_admin' FROM core.users
  WHERE id='00000000-0000-0000-0000-000000000031' AND email='operator@reporter.local.invalid'
  ON CONFLICT(user_id,role) DO NOTHING;

CREATE OR REPLACE FUNCTION core.platform_operator() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid := core.context_user_id();
BEGIN
  IF current_setting('app.access_mode',true) IS DISTINCT FROM 'platform' OR actor IS NULL
    OR NOT EXISTS(SELECT FROM public.user_roles r JOIN core.users u ON u.id=r.user_id
      WHERE r.user_id=actor AND r.role='platform_admin' AND NOT u.banned) THEN
    RAISE EXCEPTION 'PLATFORM_RESTRICTED' USING ERRCODE='42501';
  END IF;
  RETURN actor;
END $$;

CREATE OR REPLACE FUNCTION core.platform_log(p_action text,p_portal uuid,p_target uuid,p_actor uuid,p_data jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,entity_id,after_data,source,request_id,correlation_id)
  VALUES(p_portal,p_actor,'platform.'||p_action,'user',p_target,p_data,'platform',
    nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid)
$$;

-- Last sign-in (Neon Auth sessions, when that schema exists) or last logged action.
CREATE OR REPLACE FUNCTION core.platform_last_seen(p_user uuid,p_subject text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE acted timestamptz; signed timestamptz;
BEGIN
  SELECT max(created_at) INTO acted FROM public.audit_log WHERE user_id=p_user;
  IF p_subject IS NOT NULL AND to_regclass('neon_auth.session') IS NOT NULL THEN
    EXECUTE 'SELECT max("updatedAt") FROM neon_auth.session WHERE "userId"::text=$1' INTO signed USING p_subject;
  END IF;
  RETURN greatest(acted,signed);
END $$;

-- A Neon Auth account with this e-mail exists (the invite page asks for the existing password).
CREATE OR REPLACE FUNCTION core.platform_auth_account(p_email text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE subject text;
BEGIN
  IF to_regclass('neon_auth."user"') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT id::text FROM neon_auth."user" WHERE lower(email)=lower($1) LIMIT 1' INTO subject USING p_email;
  RETURN subject;
END $$;

-- The four product roles of a person in their portal, in the product's order.
CREATE OR REPLACE FUNCTION core.platform_roles(p_user uuid,p_portal uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT coalesce(jsonb_agg(pr.name ORDER BY array_position(ARRAY['editor','approver','creative_reviewer','admin'],pr.name)),'[]'::jsonb)
  FROM public.portal_user_roles pur JOIN public.portal_roles pr ON pr.id=pur.portal_role_id
  WHERE pur.user_id=p_user AND pur.portal_id=p_portal AND pr.name IN ('editor','approver','creative_reviewer','admin')
$$;

-- One person as the console shows them (PlatformPerson). `invited`: never signed in.
CREATE OR REPLACE FUNCTION core.platform_person(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'id',u.id,'name',u.name,'email',u.email,'title',u.title,'avatarUrl',u.image,
    'status',CASE WHEN tm.status='disabled' OR pm.status='disabled' THEN 'suspended'
      WHEN u.auth_subject IS NULL THEN 'invited' ELSE 'active' END,
    'workspace',CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('id',p.id,'name',p.name,'slug',p.slug) END,
    'roles',CASE WHEN p.id IS NULL THEN '[]'::jsonb ELSE core.platform_roles(u.id,p.id) END,
    'operator',EXISTS(SELECT FROM public.user_roles r WHERE r.user_id=u.id AND r.role='platform_admin'),
    'createdAt',u.created_at,
    'lastSeenAt',core.platform_last_seen(u.id,u.auth_subject),
    'inviteExpiresAt',(SELECT i.expires_at FROM core.access_invites i WHERE i.user_id=u.id AND i.state='open')))
  FROM core.users u
  JOIN core.tenant_members tm ON tm.user_id=u.id
  LEFT JOIN LATERAL (SELECT m.portal_id,m.status FROM public.portal_members m WHERE m.user_id=u.id AND m.tenant_id=tm.tenant_id
    ORDER BY (m.status='active') DESC LIMIT 1) pm ON true
  LEFT JOIN public.portals p ON p.id=pm.portal_id AND p.deleted_at IS NULL
  WHERE u.id=p_user
  ORDER BY (tm.status='active') DESC
  LIMIT 1
$$;

-- Server-side session for the console: the signed-in person, only when they hold the platform role.
CREATE OR REPLACE FUNCTION public.reporter_platform_context(p_subject text,p_email text)
RETURNS TABLE(user_id uuid,user_name text,user_email text,user_image text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT u.id,u.name,u.email,u.image FROM core.users u
  JOIN public.user_roles r ON r.user_id=u.id AND r.role='platform_admin'
  WHERE u.auth_subject=p_subject AND lower(u.email)=lower(p_email) AND u.email_verified AND NOT u.banned
$$;

CREATE OR REPLACE FUNCTION public.reporter_platform_operator() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'avatarUrl',u.image))
  FROM core.users u WHERE u.id=core.platform_operator()
$$;

CREATE OR REPLACE FUNCTION public.reporter_platform_directory() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE people jsonb; pending jsonb := '[]'::jsonb; workspaces jsonb;
BEGIN
  PERFORM core.platform_operator();
  SELECT coalesce(jsonb_agg(core.platform_person(u.id) ORDER BY u.created_at DESC),'[]'::jsonb) INTO people
    FROM core.users u WHERE EXISTS(SELECT FROM core.tenant_members tm WHERE tm.user_id=u.id);
  -- Accounts that signed up on the sign-in page and are in no workspace yet.
  IF to_regclass('neon_auth."user"') IS NOT NULL THEN
    EXECUTE $q$
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id','auth:'||a.id::text,'name',a.name,'email',lower(a.email),
        'avatarUrl',a.image,'status','pending','roles','[]'::jsonb,'operator',false,'createdAt',a."createdAt",
        'lastSeenAt',(SELECT max(s."updatedAt") FROM neon_auth.session s WHERE s."userId"=a.id))) ORDER BY a."createdAt" DESC),'[]'::jsonb)
      FROM neon_auth."user" a
      WHERE lower(a.email) NOT LIKE '%.invalid'
        AND NOT EXISTS(SELECT FROM core.users u WHERE u.auth_subject=a.id::text OR lower(u.email)=lower(a.email))$q$ INTO pending;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'slug',slug) ORDER BY name),'[]'::jsonb) INTO workspaces
    FROM public.portals WHERE deleted_at IS NULL AND status='active';
  RETURN jsonb_build_object('people',people||pending,'workspaces',workspaces);
END $$;

CREATE OR REPLACE FUNCTION core.platform_refuse(p_code text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION '%',p_code USING ERRCODE='P0001'; END $$;

-- Replaces the open link of a person who never signed in; answers the new expiry.
CREATE OR REPLACE FUNCTION core.platform_issue(p_user uuid,p_tenant uuid,p_portal uuid,p_token_hash text,p_ttl_days integer,p_operator uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE expires timestamptz := clock_timestamp()+make_interval(days => p_ttl_days);
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_ttl_days NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Invalid invite' USING ERRCODE='22023';
  END IF;
  UPDATE core.access_invites SET state='revoked' WHERE user_id=p_user AND state='open';
  INSERT INTO core.access_invites(user_id,tenant_id,portal_id,token_hash,created_by,expires_at)
    VALUES(p_user,p_tenant,p_portal,p_token_hash,p_operator,expires);
  RETURN expires;
END $$;

-- Replaces the person's product roles in a portal; the tenant role follows "admin".
CREATE OR REPLACE FUNCTION core.platform_set_roles(p_user uuid,p_tenant uuid,p_portal uuid,p_roles text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF p_roles IS NULL OR cardinality(p_roles)=0 THEN PERFORM core.platform_refuse('NO_ROLES'); END IF;
  IF EXISTS(SELECT FROM unnest(p_roles) role WHERE role NOT IN ('editor','approver','creative_reviewer','admin')) THEN
    PERFORM core.platform_refuse('INVALID_ROLE');
  END IF;
  DELETE FROM public.portal_user_roles pur USING public.portal_roles pr
    WHERE pur.portal_role_id=pr.id AND pur.user_id=p_user AND pur.portal_id=p_portal
      AND pr.name IN ('editor','approver','creative_reviewer','admin');
  INSERT INTO public.portal_user_roles(portal_id,user_id,portal_role_id)
    SELECT p_portal,p_user,pr.id FROM public.portal_roles pr WHERE pr.portal_id=p_portal AND pr.name=ANY(p_roles)
    ON CONFLICT DO NOTHING;
  UPDATE core.tenant_members SET role=CASE WHEN 'admin'=ANY(p_roles) THEN 'admin' ELSE 'member' END
    WHERE tenant_id=p_tenant AND user_id=p_user;
END $$;

-- The person's current portal membership, never the operator themself.
CREATE OR REPLACE FUNCTION core.platform_target(p_user uuid,p_operator uuid,OUT tenant uuid,OUT portal uuid,OUT subject text,OUT suspended boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF p_user=p_operator THEN PERFORM core.platform_refuse('SELF'); END IF;
  SELECT tm.tenant_id,pm.portal_id,u.auth_subject,(tm.status='disabled' OR pm.status='disabled')
    INTO tenant,portal,subject,suspended
    FROM core.users u JOIN core.tenant_members tm ON tm.user_id=u.id
    JOIN public.portal_members pm ON pm.user_id=u.id AND pm.tenant_id=tm.tenant_id
    WHERE u.id=p_user ORDER BY (pm.status='active') DESC LIMIT 1 FOR UPDATE OF tm,pm;
  IF tenant IS NULL THEN PERFORM core.platform_refuse('NOT_FOUND'); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_platform_invite(p_name text,p_email text,p_role text,p_portal uuid,p_token_hash text,p_ttl_days integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE operator uuid := core.platform_operator(); target uuid; tenant uuid; expires timestamptz;
  v_name text := btrim(regexp_replace(coalesce(p_name,''),'\s+',' ','g')); v_email text := lower(btrim(coalesce(p_email,'')));
BEGIN
  IF length(v_name) NOT BETWEEN 2 AND 80 THEN PERFORM core.platform_refuse('INVALID_NAME'); END IF;
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(v_email)>254 THEN PERFORM core.platform_refuse('INVALID_EMAIL'); END IF;
  IF p_role IS NULL OR p_role NOT IN ('editor','approver','creative_reviewer','admin') THEN PERFORM core.platform_refuse('INVALID_ROLE'); END IF;
  SELECT tenant_id INTO tenant FROM public.portals WHERE id=p_portal AND deleted_at IS NULL AND status='active';
  IF tenant IS NULL THEN PERFORM core.platform_refuse('INVALID_WORKSPACE'); END IF;
  SELECT id INTO target FROM core.users WHERE lower(email)=v_email FOR UPDATE;
  IF target IS NOT NULL AND EXISTS(SELECT FROM core.tenant_members WHERE user_id=target) THEN PERFORM core.platform_refuse('EMAIL_TAKEN'); END IF;
  IF target IS NULL THEN
    INSERT INTO core.users(name,email) VALUES(v_name,v_email) RETURNING id INTO target;
  ELSE
    UPDATE core.users SET name=CASE WHEN profile_updated_at IS NULL THEN v_name ELSE name END,updated_at=clock_timestamp() WHERE id=target;
  END IF;
  INSERT INTO core.tenant_members(tenant_id,user_id,role,status) VALUES(tenant,target,'member','active');
  INSERT INTO public.portal_members(tenant_id,portal_id,user_id,status) VALUES(tenant,p_portal,target,'active')
    ON CONFLICT(portal_id,user_id) DO UPDATE SET status='active';
  PERFORM core.platform_set_roles(target,tenant,p_portal,ARRAY[p_role]);
  expires := core.platform_issue(target,tenant,p_portal,p_token_hash,p_ttl_days,operator);
  PERFORM core.platform_log('invite.created',p_portal,target,operator,jsonb_build_object('roles',jsonb_build_array(p_role)));
  RETURN jsonb_build_object('person',core.platform_person(target),'expiresAt',expires);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_platform_renew_invite(p_user uuid,p_token_hash text,p_ttl_days integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE operator uuid := core.platform_operator(); target record; expires timestamptz;
BEGIN
  target := core.platform_target(p_user,operator);
  IF target.subject IS NOT NULL OR target.suspended THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  expires := core.platform_issue(p_user,target.tenant,target.portal,p_token_hash,p_ttl_days,operator);
  PERFORM core.platform_log('invite.renewed',target.portal,p_user,operator,NULL);
  RETURN jsonb_build_object('person',core.platform_person(p_user),'expiresAt',expires);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_platform_set_roles(p_user uuid,p_roles text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE operator uuid := core.platform_operator(); target record;
BEGIN
  target := core.platform_target(p_user,operator);
  PERFORM core.platform_set_roles(p_user,target.tenant,target.portal,p_roles);
  PERFORM core.platform_log('roles.changed',target.portal,p_user,operator,jsonb_build_object('roles',core.platform_roles(p_user,target.portal)));
  RETURN core.platform_person(p_user);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_platform_suspend(p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE operator uuid := core.platform_operator(); target record;
BEGIN
  target := core.platform_target(p_user,operator);
  IF target.suspended THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  -- Every request re-reads the membership, so access ends with this commit.
  UPDATE core.tenant_members SET status='disabled' WHERE user_id=p_user AND tenant_id=target.tenant;
  UPDATE public.portal_members SET status='disabled' WHERE user_id=p_user AND tenant_id=target.tenant;
  UPDATE core.access_invites SET state='revoked' WHERE user_id=p_user AND state='open';
  PERFORM core.platform_log('access.suspended',target.portal,p_user,operator,NULL);
  RETURN core.platform_person(p_user);
END $$;

-- Someone who never signed in comes back through a new link (`invite` in the answer).
CREATE OR REPLACE FUNCTION public.reporter_platform_restore(p_user uuid,p_token_hash text,p_ttl_days integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE operator uuid := core.platform_operator(); target record; expires timestamptz;
BEGIN
  target := core.platform_target(p_user,operator);
  IF NOT target.suspended THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  UPDATE core.tenant_members SET status='active' WHERE user_id=p_user AND tenant_id=target.tenant;
  UPDATE public.portal_members SET status='active' WHERE user_id=p_user AND portal_id=target.portal;
  IF target.subject IS NULL THEN expires := core.platform_issue(p_user,target.tenant,target.portal,p_token_hash,p_ttl_days,operator); END IF;
  PERFORM core.platform_log('access.restored',target.portal,p_user,operator,NULL);
  RETURN jsonb_strip_nulls(jsonb_build_object('person',core.platform_person(p_user),'expiresAt',expires));
END $$;

-- Releases an account that signed up on its own: binds it, marks the e-mail verified, gives roles.
CREATE OR REPLACE FUNCTION public.reporter_platform_approve(p_subject text,p_roles text[],p_portal uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE operator uuid := core.platform_operator(); account record; target uuid; tenant uuid;
BEGIN
  IF to_regclass('neon_auth."user"') IS NULL THEN PERFORM core.platform_refuse('NOT_FOUND'); END IF;
  EXECUTE 'SELECT id::text AS id,name,lower(email) AS email,image FROM neon_auth."user" WHERE id::text=$1' INTO account USING p_subject;
  IF account.id IS NULL THEN PERFORM core.platform_refuse('NOT_FOUND'); END IF;
  IF EXISTS(SELECT FROM core.users WHERE auth_subject=account.id OR lower(email)=account.email) THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  SELECT tenant_id INTO tenant FROM public.portals WHERE id=p_portal AND deleted_at IS NULL AND status='active';
  IF tenant IS NULL THEN PERFORM core.platform_refuse('INVALID_WORKSPACE'); END IF;
  INSERT INTO core.users(name,email,image,auth_subject,email_verified) VALUES(coalesce(nullif(btrim(account.name),''),account.email),account.email,account.image,account.id,true)
    RETURNING id INTO target;
  EXECUTE 'UPDATE neon_auth."user" SET "emailVerified"=true WHERE id::text=$1' USING account.id;
  INSERT INTO core.tenant_members(tenant_id,user_id,role,status) VALUES(tenant,target,'member','active');
  INSERT INTO public.portal_members(tenant_id,portal_id,user_id,status) VALUES(tenant,p_portal,target,'active');
  PERFORM core.platform_set_roles(target,tenant,p_portal,p_roles);
  PERFORM core.platform_log('access.approved',p_portal,target,operator,jsonb_build_object('roles',core.platform_roles(target,p_portal)));
  RETURN core.platform_person(target);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_platform_log(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE items jsonb; total bigint;
BEGIN
  PERFORM core.platform_operator();
  SELECT count(*) INTO total FROM public.audit_log WHERE source='platform';
  SELECT coalesce(jsonb_agg(entry ORDER BY at DESC),'[]'::jsonb) INTO items FROM (
    SELECT l.created_at AS at,jsonb_strip_nulls(jsonb_build_object('id',l.id,'at',l.created_at,'action',substr(l.action,10),
      'actor',CASE WHEN a.id IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object('id',a.id,'name',a.name,'avatarUrl',a.image)) END,
      'target',CASE WHEN t.id IS NOT NULL THEN jsonb_build_object('id',t.id,'name',t.name,'email',t.email) END,
      'roles',l.after_data->'roles')) AS entry
    FROM public.audit_log l
    LEFT JOIN core.users a ON a.id=l.user_id
    LEFT JOIN core.users t ON t.id=l.entity_id
    WHERE l.source='platform'
    ORDER BY l.created_at DESC LIMIT least(greatest(coalesce(p_limit,50),1),200)) page;
  RETURN jsonb_build_object('items',items,'total',total);
END $$;

-- Usage facts since a day (UsageFacts): per UTC day, person, workspace and model. The console's
-- domain turns them into totals, series and estimated cost. Tokens come from each run's folded
-- usage (the last cumulative value), never from summing usage events.
CREATE OR REPLACE FUNCTION public.reporter_platform_usage(p_from date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE since timestamptz; facts jsonb; signins jsonb := '[]'::jsonb; storage numeric;
BEGIN
  PERFORM core.platform_operator();
  IF p_from IS NULL OR p_from < current_date-400 OR p_from > current_date THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='22023'; END IF;
  since := p_from::timestamp AT TIME ZONE 'UTC';

  WITH runs AS (
    SELECT to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,r.portal_id::text AS workspace,
      CASE WHEN r.fold->'run'->>'createdBy' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN r.fold->'run'->>'createdBy' END AS person,
      coalesce(nullif(r.fold->'run'->'model'->>'alias',''),r.job->'provider'->>'model','—') AS model,r.status,
      coalesce(round((r.fold->'run'->'usage'->>'inputTokens')::numeric),0) AS input_tokens,
      coalesce(round((r.fold->'run'->'usage'->>'outputTokens')::numeric),0) AS output_tokens
    FROM public.reporter_ed_runs r WHERE r.created_at>=since AND r.status IN ('completed','failed')
  ), productions AS (
    SELECT to_char((p.doc->>'createdAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,p.portal_id::text AS workspace,
      CASE WHEN p.doc->>'createdBy' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p.doc->>'createdBy' END AS person
    FROM public.reporter_ed_productions p
    WHERE p.doc->>'createdAt' IS NOT NULL AND (p.doc->>'createdAt')::timestamptz>=since
  ), decisions AS (
    SELECT to_char((d.doc->>'at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,d.portal_id::text AS workspace,
      CASE WHEN d.doc->>'by' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN d.doc->>'by' END AS person,
      d.doc->>'decision' AS decision
    FROM public.reporter_ed_parts d
    WHERE d.kind='decision' AND NOT d.deleted AND d.doc->>'at' IS NOT NULL AND (d.doc->>'at')::timestamptz>=since
  ), audio AS (
    -- Transcription as the provider billed it (audio milliseconds of each finished transcript).
    SELECT to_char(l.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,t.created_by::text AS person,l.portal_id::text AS workspace,
      coalesce(l.after_data->'processing'->>'model',t.model,'—') AS model,
      sum(coalesce((l.after_data->'processing'->>'input_units')::numeric,0))/1000 AS seconds
    FROM public.audit_log l LEFT JOIN public.reporter_transcripts t ON t.id=l.entity_id
    WHERE l.action='reporter.transcript.generated' AND l.created_at>=since AND l.portal_id IS NOT NULL
      AND l.after_data->'processing'->>'usage_unit'='audio_ms'
    GROUP BY 1,2,3,4
  ), active AS (
    -- Active on a day: acted, generated, created or decided (sign-ins are added below).
    SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,user_id::text AS person,portal_id::text AS workspace
      FROM public.audit_log WHERE created_at>=since AND user_id IS NOT NULL AND portal_id IS NOT NULL AND source<>'platform'
    UNION SELECT day,person,workspace FROM runs WHERE person IS NOT NULL
    UNION SELECT day,person,workspace FROM productions WHERE person IS NOT NULL
    UNION SELECT day,person,workspace FROM decisions WHERE person IS NOT NULL
  )
  SELECT jsonb_build_object(
    'generations',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'personId',person,'workspaceId',workspace,'model',model,
        'completed',completed,'failed',failed,'inputTokens',input_tokens,'outputTokens',output_tokens)),'[]'::jsonb)
      FROM (SELECT day,person,workspace,model,count(*) FILTER (WHERE status='completed') AS completed,
        count(*) FILTER (WHERE status='failed') AS failed,sum(input_tokens) AS input_tokens,sum(output_tokens) AS output_tokens
        FROM runs GROUP BY day,person,workspace,model) g),
    'productions',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'personId',person,'workspaceId',workspace,'count',total)),'[]'::jsonb)
      FROM (SELECT day,person,workspace,count(*) AS total FROM productions GROUP BY day,person,workspace) g),
    'approvals',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'personId',person,'workspaceId',workspace,'count',total)),'[]'::jsonb)
      FROM (SELECT day,person,workspace,count(*) AS total FROM decisions WHERE decision='approved' GROUP BY day,person,workspace) g),
    'audio',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'personId',person,'workspaceId',workspace,'model',model,'seconds',seconds)),'[]'::jsonb) FROM audio),
    'activeDays',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'personId',person,'workspaceId',workspace)),'[]'::jsonb) FROM active))
  INTO facts;

  IF to_regclass('neon_auth.session') IS NOT NULL THEN
    EXECUTE $q$
      SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('day',to_char(s."createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD'),
        'personId',u.id::text,'workspaceId',pm.portal_id::text)),'[]'::jsonb)
      FROM neon_auth.session s JOIN core.users u ON u.auth_subject=s."userId"::text
      JOIN public.portal_members pm ON pm.user_id=u.id
      WHERE s."createdAt">=$1$q$ INTO signins USING since;
    SELECT coalesce(jsonb_agg(DISTINCT entry),'[]'::jsonb) INTO signins
      FROM jsonb_array_elements((facts->'activeDays')||signins) entry;
    facts := jsonb_set(facts,'{activeDays}',signins);
  END IF;

  SELECT (SELECT coalesce(sum(size),0) FROM core.storage_objects WHERE status='completed')
    + (SELECT coalesce(sum(coalesce((doc->'asset'->>'bytes')::numeric,(doc->>'bytes')::numeric,0)),0)
       FROM public.reporter_ed_items WHERE kind IN ('image_asset','library_image') AND NOT deleted) INTO storage;
  RETURN facts||jsonb_build_object('storageBytes',storage);
END $$;

-- The invite page, before anyone signs in: what the link opens, by the token's hash.
CREATE OR REPLACE FUNCTION public.reporter_invite_preview(p_token_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_build_object('name',u.name,'email',u.email,'workspaceName',p.name,'roles',core.platform_roles(u.id,i.portal_id),
    'expiresAt',i.expires_at,
    'state',CASE WHEN i.state='open' AND i.expires_at<=clock_timestamp() THEN 'expired' ELSE i.state END,
    'hasAccount',core.platform_auth_account(u.email) IS NOT NULL)
  FROM core.access_invites i JOIN core.users u ON u.id=i.user_id JOIN public.portals p ON p.id=i.portal_id
  WHERE p_token_hash ~ '^[a-f0-9]{64}$' AND i.token_hash=p_token_hash
$$;

-- After the server defined (or checked) the password with Neon Auth: binds the account, marks the
-- e-mail verified and closes the link. Without the Neon Auth schema (local), the subject is local.
CREATE OR REPLACE FUNCTION public.reporter_invite_accept(p_token_hash text,p_subject text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE invite record; v_email text; account text;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_subject IS NULL OR btrim(p_subject)='' OR length(p_subject)>255 THEN
    PERFORM core.platform_refuse('INVALID_LINK');
  END IF;
  SELECT i.* INTO invite FROM core.access_invites i WHERE i.token_hash=p_token_hash FOR UPDATE;
  IF invite.id IS NULL OR invite.state='revoked' THEN PERFORM core.platform_refuse('INVALID_LINK'); END IF;
  IF invite.state='used' THEN PERFORM core.platform_refuse('USED'); END IF;
  IF invite.expires_at<=clock_timestamp() THEN PERFORM core.platform_refuse('EXPIRED'); END IF;
  SELECT lower(email) INTO v_email FROM core.users WHERE id=invite.user_id FOR UPDATE;
  IF to_regclass('neon_auth."user"') IS NOT NULL THEN
    account := core.platform_auth_account(v_email);
    IF account IS DISTINCT FROM p_subject THEN PERFORM core.platform_refuse('INVALID_LINK'); END IF;
    EXECUTE 'UPDATE neon_auth."user" SET "emailVerified"=true WHERE id::text=$1' USING p_subject;
  END IF;
  IF EXISTS(SELECT FROM core.users WHERE auth_subject=p_subject AND id<>invite.user_id) THEN PERFORM core.platform_refuse('INVALID_LINK'); END IF;
  UPDATE core.users SET auth_subject=p_subject,email_verified=true,updated_at=clock_timestamp()
    WHERE id=invite.user_id AND (auth_subject IS NULL OR auth_subject=p_subject);
  IF NOT FOUND THEN PERFORM core.platform_refuse('INVALID_LINK'); END IF;
  UPDATE core.access_invites SET state='used',used_at=clock_timestamp() WHERE id=invite.id;
  PERFORM core.platform_log('invite.accepted',invite.portal_id,invite.user_id,NULL,NULL);
  RETURN jsonb_build_object('email',v_email);
END $$;

DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY['core.platform_operator()','core.platform_log(text,uuid,uuid,uuid,jsonb)',
    'core.platform_last_seen(uuid,text)','core.platform_auth_account(text)','core.platform_roles(uuid,uuid)',
    'core.platform_person(uuid)','core.platform_refuse(text)','core.platform_issue(uuid,uuid,uuid,text,integer,uuid)',
    'core.platform_set_roles(uuid,uuid,uuid,text[])','core.platform_target(uuid,uuid)',
    'public.reporter_platform_context(text,text)','public.reporter_platform_operator()','public.reporter_platform_directory()',
    'public.reporter_platform_invite(text,text,text,uuid,text,integer)','public.reporter_platform_renew_invite(uuid,text,integer)',
    'public.reporter_platform_set_roles(uuid,text[])','public.reporter_platform_suspend(uuid)',
    'public.reporter_platform_restore(uuid,text,integer)','public.reporter_platform_approve(text,text[],uuid)',
    'public.reporter_platform_log(integer)','public.reporter_platform_usage(date)','public.reporter_invite_preview(text)','public.reporter_invite_accept(text,text)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['public.reporter_platform_context(text,text)','public.reporter_platform_operator()',
    'public.reporter_platform_directory()','public.reporter_platform_invite(text,text,text,uuid,text,integer)',
    'public.reporter_platform_renew_invite(uuid,text,integer)','public.reporter_platform_set_roles(uuid,text[])',
    'public.reporter_platform_suspend(uuid)','public.reporter_platform_restore(uuid,text,integer)',
    'public.reporter_platform_approve(text,text[],uuid)','public.reporter_platform_log(integer)',
    'public.reporter_platform_usage(date)','public.reporter_invite_preview(text)','public.reporter_invite_accept(text,text)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporter_runtime',fn);
  END LOOP;
END $$;

COMMIT;
