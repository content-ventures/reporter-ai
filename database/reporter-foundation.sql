-- Reporter AI foundation / PostgreSQL 17. No external platform dependency.
-- Apply once to a fresh Reporter database before reporter-r1.sql and commands.
BEGIN;
DO $$ BEGIN
  IF to_regnamespace('core') IS NOT NULL THEN RAISE EXCEPTION 'Reporter foundation requires a fresh database'; END IF;
  CREATE ROLE reporter_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  CREATE ROLE reporter_worker NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
END $$;
CREATE SCHEMA core;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE core.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false, image text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  banned boolean NOT NULL DEFAULT false, ban_reason text, ban_expires timestamptz
);

CREATE TABLE core.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.tenant_members (
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  role text NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin')),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,user_id)
);

CREATE TABLE core.modules (key text PRIMARY KEY CHECK(key ~ '^[a-z][a-z0-9_]{0,63}$'), name text NOT NULL);

CREATE TABLE core.tenant_modules (
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  module_key text NOT NULL REFERENCES core.modules(key) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false, PRIMARY KEY(tenant_id,module_key)
);

CREATE TABLE core.portal_modules (
  tenant_id uuid NOT NULL, portal_id uuid NOT NULL, module_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false, PRIMARY KEY(portal_id,module_key),
  FOREIGN KEY(tenant_id,module_key) REFERENCES core.tenant_modules(tenant_id,module_key) ON DELETE RESTRICT
);

CREATE TABLE core.integration_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, portal_id uuid NOT NULL,
  module text NOT NULL REFERENCES core.modules(key), event_type text NOT NULL, aggregate_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  lease_owner text, lease_until timestamptz, processed_at timestamptz, last_error text,
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL)),
  FOREIGN KEY(tenant_id) REFERENCES core.tenants(id)
);
CREATE TABLE public.portals(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES core.tenants(id),
  name text NOT NULL, slug text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'active', deleted_at timestamptz,
  UNIQUE(tenant_id,id)
);
CREATE TABLE public.portal_members(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,portal_id uuid NOT NULL,
  user_id uuid NOT NULL,status text NOT NULL DEFAULT 'active',UNIQUE(portal_id,user_id),
  FOREIGN KEY(tenant_id,portal_id) REFERENCES public.portals(tenant_id,id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES core.tenant_members(tenant_id,user_id)
);
CREATE TABLE public.user_roles(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES core.users(id),
  role text NOT NULL,UNIQUE(user_id,role)
);
CREATE TABLE public.portal_roles(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),portal_id uuid NOT NULL REFERENCES public.portals(id),
  name text NOT NULL,description text,is_default boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.portal_role_permissions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),portal_role_id uuid NOT NULL REFERENCES public.portal_roles(id),
  permission text NOT NULL,UNIQUE(portal_role_id,permission)
);
CREATE TABLE public.portal_user_roles(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),portal_id uuid NOT NULL REFERENCES public.portals(id),
  user_id uuid NOT NULL REFERENCES core.users(id),portal_role_id uuid NOT NULL REFERENCES public.portal_roles(id),
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(portal_id,user_id,portal_role_id)
);
CREATE TABLE core.storage_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, portal_id uuid NOT NULL,
  owner_user_id uuid REFERENCES core.users(id) ON DELETE RESTRICT,
  purpose text NOT NULL, provider text NOT NULL CHECK(provider IN ('vercel-blob','s3')),
  visibility text NOT NULL CHECK(visibility IN ('private','public')),
  key text NOT NULL, url text,
  file_name text NOT NULL, reference jsonb NOT NULL DEFAULT '{}',
  checksum_sha256 text CHECK(checksum_sha256 ~ '^[a-f0-9]{64}$'),
  size bigint NOT NULL CHECK(size>=0), content_type text NOT NULL,
  etag text, store_id text,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  FOREIGN KEY(tenant_id,portal_id) REFERENCES public.portals(tenant_id,id) ON DELETE RESTRICT,
  UNIQUE(provider,key)
);
CREATE TABLE public.audit_log(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES core.users(id),portal_id uuid REFERENCES public.portals(id),
  action text NOT NULL,entity_type text,entity_id uuid,before_data jsonb,after_data jsonb,severity text NOT NULL DEFAULT 'info',
  source text NOT NULL DEFAULT 'app',request_id uuid,correlation_id uuid,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.event_outbox(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),portal_id uuid REFERENCES public.portals(id),event_type text NOT NULL,
  entity_type text NOT NULL,entity_id uuid NOT NULL,payload jsonb DEFAULT '{}',
  processed boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE core.portal_modules ADD FOREIGN KEY(tenant_id,portal_id) REFERENCES public.portals(tenant_id,id);
ALTER TABLE core.integration_outbox ADD FOREIGN KEY(tenant_id,portal_id) REFERENCES public.portals(tenant_id,id);
CREATE FUNCTION core.context_tenant_id() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog AS $$ SELECT nullif(current_setting('app.tenant_id',true),'')::uuid $$;
CREATE FUNCTION core.context_portal_id() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog AS $$ SELECT nullif(current_setting('app.portal_id',true),'')::uuid $$;
CREATE FUNCTION core.context_user_id() RETURNS uuid LANGUAGE sql STABLE
  SET search_path = pg_catalog AS $$ SELECT nullif(current_setting('app.user_id',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION core.authorize_context(p_tenant uuid,p_portal uuid,p_user uuid,p_module text,p_public boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  -- Reporter is private. Public access and global roles never bypass membership.
  IF p_public OR p_tenant IS NULL OR p_portal IS NULL OR p_user IS NULL OR p_module<>'reporter_ai'
    OR p_module IS NULL THEN RETURN false; END IF;
  RETURN EXISTS(
    SELECT FROM core.tenants t
    JOIN public.portals p ON p.tenant_id=t.id
    JOIN core.tenant_members tm ON tm.tenant_id=t.id AND tm.user_id=p_user
    JOIN public.portal_members pm ON pm.tenant_id=t.id AND pm.portal_id=p.id AND pm.user_id=p_user
    JOIN core.users u ON u.id=p_user
    JOIN core.tenant_modules m ON m.tenant_id=t.id AND m.module_key=p_module
    JOIN core.portal_modules f ON f.tenant_id=t.id AND f.portal_id=p.id AND f.module_key=p_module
    WHERE t.id=p_tenant AND p.id=p_portal AND t.status='active' AND p.status='active'
      AND p.deleted_at IS NULL AND tm.status='active' AND pm.status='active'
      AND (NOT u.banned OR u.ban_expires<=now()) AND m.enabled AND f.enabled
  );
END $$;
CREATE OR REPLACE FUNCTION core.job_allowed(p_keys text[]) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT session_user='reporter_worker' AND current_setting('app.access_mode',true)='job'
    AND current_setting('app.job_key',true)=ANY(p_keys)
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA core FROM PUBLIC;
GRANT USAGE ON SCHEMA core,public TO reporter_runtime,reporter_worker;
GRANT EXECUTE ON FUNCTION core.context_tenant_id(),core.context_portal_id(),core.context_user_id(),
  core.authorize_context(uuid,uuid,uuid,text,boolean) TO reporter_runtime;
GRANT EXECUTE ON FUNCTION core.job_allowed(text[]) TO reporter_worker;
DO $$ DECLARE relation text; BEGIN
  FOREACH relation IN ARRAY ARRAY['core.users','core.tenants','core.tenant_members','core.modules',
    'core.tenant_modules','core.portal_modules','core.storage_objects','core.integration_outbox',
    'public.portals','public.portal_members','public.user_roles','public.portal_roles',
    'public.portal_role_permissions','public.portal_user_roles','public.audit_log','public.event_outbox'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC',relation);
  END LOOP;
END $$;
CREATE INDEX integration_outbox_pending_idx ON core.integration_outbox(available_at,occurred_at,id)
  WHERE processed_at IS NULL AND attempts<8;
CREATE INDEX idx_audit_log_entity ON public.audit_log(entity_type,entity_id);
CREATE INDEX idx_audit_log_portal_created ON public.audit_log(portal_id,created_at DESC);
CREATE INDEX idx_event_outbox_processed ON public.event_outbox(processed) WHERE processed=false;
COMMIT;
