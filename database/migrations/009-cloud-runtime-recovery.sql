-- Durable image gateway discovery and review commands for cloud-only reviewers.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_workspace_members() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); result jsonb;
BEGIN
  SELECT jsonb_agg(member) INTO result FROM (
    SELECT u.id AS "personId",u.name,u.email,u.image AS "avatarUrl",p.id AS "workspaceId",p.name AS "workspaceName",p.slug AS "workspaceSlug",
      coalesce(array_agg(DISTINCT pr.name) FILTER(WHERE pr.name IS NOT NULL),'{}'::text[]) AS roles
    FROM public.portals p JOIN public.portal_members pm ON pm.portal_id=p.id
    JOIN core.users u ON u.id=pm.user_id JOIN core.tenant_members tm ON tm.user_id=u.id AND tm.tenant_id=p.tenant_id AND tm.status='active'
    LEFT JOIN public.portal_user_roles pur ON pur.portal_id=p.id AND pur.user_id=u.id
    LEFT JOIN public.portal_roles pr ON pr.id=pur.portal_role_id AND pr.portal_id=p.id
    WHERE p.id=portal AND pm.status='active' GROUP BY u.id,p.id
  ) member;
  RETURN coalesce(result,'[]'::jsonb);
END $$;
ALTER FUNCTION public.reporter_workspace_members() OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_workspace_members() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_workspace_members() TO reporter_runtime;
CREATE OR REPLACE FUNCTION public.reporter_object_endpoint() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); result text;
BEGIN
  SELECT endpoint_url INTO result FROM public.reporter_worker_heartbeats
    WHERE portal_id=portal AND endpoint_url IS NOT NULL ORDER BY seen_at DESC LIMIT 1;
  RETURN result;
END $$;
ALTER FUNCTION public.reporter_object_endpoint() OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_object_endpoint() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_object_endpoint() TO reporter_runtime;

INSERT INTO public.portal_role_permissions(portal_role_id,permission)
  SELECT id,'reporter.review' FROM public.portal_roles WHERE name='creative_reviewer'
  ON CONFLICT(portal_role_id,permission) DO NOTHING;

-- The API selects the permission from the named command, never from user input.
CREATE OR REPLACE FUNCTION public.reporter_editorial_load(p_lock boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid; result jsonb;
BEGIN
  IF current_setting('app.access_mode',true)='job' THEN
    PERFORM core.reporter_worker_require();portal := nullif(current_setting('app.portal_id',true),'')::uuid;
  ELSE portal := core.reporter_require(CASE WHEN NOT p_lock THEN 'reporter.read'
    WHEN current_setting('app.editorial_permission',true)='reporter.review' THEN 'reporter.review' ELSE 'reporter.edit' END); END IF;
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
  ELSE portal := core.reporter_require(CASE WHEN current_setting('app.editorial_permission',true)='reporter.review' THEN 'reporter.review' ELSE 'reporter.edit' END); END IF;
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
COMMIT;
