-- Reporter AI cloud identity, one explicitly provisioned workspace and cloud worker health.
-- Apply after the R1 commands and local-flow/editorial aggregate migrations. No user is auto-granted.
BEGIN;

ALTER TABLE core.users ADD COLUMN IF NOT EXISTS auth_subject text;
-- The self-edited profile (017). Added here too, so every replayed cloud function after this file
-- finds them; once profile_updated_at is set, sign-in stops copying Neon Auth's name and photo.
ALTER TABLE core.users ADD COLUMN IF NOT EXISTS title text CHECK(title IS NULL OR length(title) BETWEEN 1 AND 80);
ALTER TABLE core.users ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_core_users_auth_subject ON core.users(auth_subject) WHERE auth_subject IS NOT NULL;

INSERT INTO core.tenants(id,slug,name) VALUES
  ('10000000-0000-0000-0000-000000000001','reporter-ai','Repórter AI') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.portals(id,tenant_id,name,slug) VALUES
  ('10000000-0000-0000-0000-000000000101','10000000-0000-0000-0000-000000000001','Repórter AI','reporter-ai') ON CONFLICT(id) DO NOTHING;
INSERT INTO core.tenant_modules(tenant_id,module_key,enabled) VALUES
  ('10000000-0000-0000-0000-000000000001','reporter_ai',true) ON CONFLICT(tenant_id,module_key) DO UPDATE SET enabled=true;
INSERT INTO core.portal_modules(tenant_id,portal_id,module_key,enabled) VALUES
  ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000101','reporter_ai',true)
  ON CONFLICT(portal_id,module_key) DO UPDATE SET enabled=true;
INSERT INTO public.portal_roles(id,portal_id,name,description,is_default) VALUES
  ('10000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000101','admin','Administração do Reporter AI',false),
  ('10000000-0000-0000-0000-000000000202','10000000-0000-0000-0000-000000000101','editor','Criação e edição editorial',false),
  ('10000000-0000-0000-0000-000000000203','10000000-0000-0000-0000-000000000101','approver','Aprovação editorial',false),
  ('10000000-0000-0000-0000-000000000204','10000000-0000-0000-0000-000000000101','creative_reviewer','Revisão de criativos',false)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description;
INSERT INTO public.portal_role_permissions(portal_role_id,permission)
  SELECT '10000000-0000-0000-0000-000000000201'::uuid,unnest(ARRAY['reporter.read','reporter.edit','reporter.submit','reporter.review','reporter.retry'])
  UNION ALL SELECT '10000000-0000-0000-0000-000000000202'::uuid,unnest(ARRAY['reporter.read','reporter.edit','reporter.submit','reporter.retry'])
  UNION ALL SELECT '10000000-0000-0000-0000-000000000203'::uuid,unnest(ARRAY['reporter.read','reporter.review'])
  UNION ALL SELECT '10000000-0000-0000-0000-000000000204'::uuid,unnest(ARRAY['reporter.read'])
  ON CONFLICT(portal_role_id,permission) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reporter_session_context(
  p_subject text,p_email text,p_name text,p_image text,p_email_verified boolean,p_portal uuid
) RETURNS TABLE(tenant_id uuid,portal_id uuid,user_id uuid,workspace_name text,workspace_slug text,user_name text,user_email text,user_image text,roles text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE bound_user uuid;
BEGIN
  IF p_subject IS NULL OR btrim(p_subject)='' OR length(p_subject)>255 OR p_email IS NULL OR btrim(p_email)=''
    OR length(p_email)>320 OR p_name IS NULL OR btrim(p_name)='' OR length(p_name)>255 OR p_email_verified IS NOT TRUE
    OR p_portal IS NULL THEN RETURN; END IF;
  SELECT id INTO bound_user FROM core.users WHERE auth_subject=p_subject FOR UPDATE;
  IF bound_user IS NULL THEN
    SELECT id INTO bound_user FROM core.users WHERE auth_subject IS NULL AND lower(email)=lower(p_email) FOR UPDATE;
    IF bound_user IS NOT NULL THEN
      UPDATE core.users SET auth_subject=p_subject,email_verified=true,
        name=CASE WHEN profile_updated_at IS NULL THEN p_name ELSE name END,
        image=CASE WHEN profile_updated_at IS NULL THEN p_image ELSE image END,updated_at=clock_timestamp() WHERE id=bound_user;
    END IF;
  ELSE
    UPDATE core.users SET email_verified=true,
      name=CASE WHEN profile_updated_at IS NULL THEN p_name ELSE name END,
      image=CASE WHEN profile_updated_at IS NULL THEN p_image ELSE image END,updated_at=clock_timestamp() WHERE id=bound_user;
  END IF;
  IF bound_user IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT p.tenant_id,p.id,u.id,p.name,p.slug,u.name,u.email,u.image,
      coalesce(array_agg(DISTINCT pr.name ORDER BY pr.name) FILTER (WHERE pr.name IS NOT NULL),'{}'::text[])
    FROM core.users u
    JOIN core.tenant_members tm ON tm.user_id=u.id AND tm.status='active'
    JOIN public.portal_members pm ON pm.user_id=u.id AND pm.tenant_id=tm.tenant_id AND pm.status='active'
    JOIN public.portals p ON p.id=pm.portal_id AND p.tenant_id=tm.tenant_id AND p.status='active' AND p.deleted_at IS NULL
    LEFT JOIN public.portal_user_roles pur ON pur.portal_id=p.id AND pur.user_id=u.id
    LEFT JOIN public.portal_roles pr ON pr.id=pur.portal_role_id AND pr.portal_id=p.id
    WHERE u.id=bound_user AND p.id=p_portal AND core.authorize_context(p.tenant_id,p.id,u.id,'reporter_ai',false)
    GROUP BY p.tenant_id,p.id,u.id,p.name,p.slug,u.name,u.email,u.image;
END $$;
-- Keep this bridge owned by the migration/table owner. The NOLOGIN executor deliberately
-- has no direct UPDATE privilege on core.users; runtime receives only EXECUTE below.
ALTER FUNCTION public.reporter_session_context(text,text,text,text,boolean,uuid) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.reporter_session_context(text,text,text,text,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_session_context(text,text,text,text,boolean,uuid) TO reporter_runtime;

CREATE TABLE IF NOT EXISTS public.reporter_worker_heartbeats(
  portal_id uuid NOT NULL REFERENCES public.portals(id),worker_id text NOT NULL CHECK(length(worker_id) BETWEEN 1 AND 200),
  seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(portal_id,worker_id)
);
ALTER TABLE public.reporter_worker_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_worker_heartbeats FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.reporter_worker_heartbeats TO reporter_executor;
DROP POLICY IF EXISTS reporter_worker_heartbeats_executor ON public.reporter_worker_heartbeats;
CREATE POLICY reporter_worker_heartbeats_executor ON public.reporter_worker_heartbeats TO reporter_executor USING(true) WITH CHECK(true);

CREATE OR REPLACE FUNCTION public.reporter_worker_heartbeat(p_worker text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := nullif(current_setting('app.portal_id',true),'')::uuid;
BEGIN
  PERFORM core.reporter_worker_require();
  IF portal IS NULL OR p_worker IS NULL OR length(p_worker) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid worker heartbeat'; END IF;
  INSERT INTO public.reporter_worker_heartbeats(portal_id,worker_id,seen_at) VALUES(portal,p_worker,clock_timestamp())
    ON CONFLICT(portal_id,worker_id) DO UPDATE SET seen_at=excluded.seen_at;
  DELETE FROM public.reporter_worker_heartbeats WHERE portal_id=portal AND seen_at<clock_timestamp()-interval '1 day';
END $$;
CREATE OR REPLACE FUNCTION public.reporter_worker_online() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read');
BEGIN
  RETURN EXISTS(SELECT FROM public.reporter_worker_heartbeats WHERE portal_id=portal AND seen_at>clock_timestamp()-interval '20 seconds');
END $$;
ALTER FUNCTION public.reporter_worker_heartbeat(text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_worker_online() OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_worker_heartbeat(text),public.reporter_worker_online() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_worker_heartbeat(text) TO reporter_worker;
GRANT EXECUTE ON FUNCTION public.reporter_worker_online() TO reporter_runtime;

CREATE OR REPLACE FUNCTION public.reporter_editorial_load(p_lock boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid; result jsonb;
BEGIN
  IF current_setting('app.access_mode',true)='job' THEN
    PERFORM core.reporter_worker_require();portal := nullif(current_setting('app.portal_id',true),'')::uuid;
  ELSE portal := core.reporter_require(CASE WHEN p_lock THEN 'reporter.edit' ELSE 'reporter.read' END); END IF;
  IF portal IS NULL THEN RAISE EXCEPTION 'Portal context missing' USING ERRCODE='42501'; END IF;
  IF p_lock THEN PERFORM pg_advisory_xact_lock(hashtextextended('reporter-editorial:'||portal::text,0)); END IF;
  SELECT jsonb_build_object('revision',revision,'checkpoint',checkpoint) INTO result FROM public.reporter_editorial_workspaces WHERE portal_id=portal;
  RETURN coalesce(result,'{"revision":0,"checkpoint":{}}'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_editorial_save(p_revision bigint,p_checkpoint jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid;current_revision bigint;session_person uuid;
BEGIN
  IF current_setting('app.access_mode',true)='job' THEN
    PERFORM core.reporter_worker_require();portal := nullif(current_setting('app.portal_id',true),'')::uuid;
  ELSE portal := core.reporter_require('reporter.edit'); END IF;
  BEGIN session_person := (p_checkpoint->'state'->>'sessionPersonId')::uuid;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid editorial checkpoint' USING ERRCODE='22023';END;
  IF portal IS NULL OR jsonb_typeof(p_checkpoint->'state') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_checkpoint->'jobs') IS DISTINCT FROM 'object'
    OR p_checkpoint->'state'->'workspace'->>'id' IS DISTINCT FROM portal::text
    OR session_person IS NULL OR NOT EXISTS(SELECT FROM public.portal_members WHERE portal_id=portal AND user_id=session_person AND status='active')
    OR octet_length(p_checkpoint::text)>33554432 THEN RAISE EXCEPTION 'Invalid editorial checkpoint' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('reporter-editorial:'||portal::text,0));
  SELECT revision INTO current_revision FROM public.reporter_editorial_workspaces WHERE portal_id=portal;
  IF coalesce(current_revision,0) IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Editorial revision conflict' USING ERRCODE='40001'; END IF;
  INSERT INTO public.reporter_editorial_workspaces(portal_id,revision,checkpoint) VALUES(portal,p_revision+1,p_checkpoint)
    ON CONFLICT(portal_id) DO UPDATE SET revision=excluded.revision,checkpoint=excluded.checkpoint,updated_at=clock_timestamp();
  RETURN p_revision+1;
END $$;
ALTER FUNCTION public.reporter_editorial_load(boolean) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_editorial_save(bigint,jsonb) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_editorial_load(boolean),public.reporter_editorial_save(bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_editorial_load(boolean),public.reporter_editorial_save(bigint,jsonb) TO reporter_runtime,reporter_worker;

COMMENT ON FUNCTION public.reporter_session_context(text,text,text,text,boolean,uuid) IS 'reporter-neon-cloud-v1';
COMMIT;
