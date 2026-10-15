-- Poll a small, authorized version stamp without reading the editorial JSON document.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_editorial_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); result jsonb;
BEGIN
  SELECT jsonb_build_object('revision',coalesce(w.revision,0),'membersHash',md5(
    jsonb_build_object('name',p.name,'slug',p.slug,'members',coalesce((
      SELECT jsonb_agg(member ORDER BY member->>'id') FROM (
        SELECT jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'image',u.image,
          'portalStatus',pm.status,'tenantStatus',tm.status,'roles',coalesce((
            SELECT jsonb_agg(pr.name ORDER BY pr.name) FROM public.portal_user_roles pur
            JOIN public.portal_roles pr ON pr.id=pur.portal_role_id AND pr.portal_id=portal
            WHERE pur.portal_id=portal AND pur.user_id=u.id),'[]'::jsonb)) AS member
        FROM public.portal_members pm JOIN core.users u ON u.id=pm.user_id
        JOIN core.tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=u.id
        WHERE pm.portal_id=portal
      ) members),'[]'::jsonb))::text)) INTO result
    FROM public.portals p LEFT JOIN public.reporter_editorial_workspaces w ON w.portal_id=p.id
    WHERE p.id=portal;
  RETURN result;
END $$;
ALTER FUNCTION public.reporter_editorial_status() OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_editorial_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_editorial_status() TO reporter_runtime;

-- An idle scheduled worker must not transfer the entire workspace to find no work.
CREATE OR REPLACE FUNCTION public.reporter_editorial_pending() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid; now_ms numeric := extract(epoch FROM clock_timestamp())*1000;
BEGIN
  PERFORM core.reporter_worker_require();
  portal := nullif(current_setting('app.portal_id',true),'')::uuid;
  IF portal IS NULL THEN RAISE EXCEPTION 'Portal context missing' USING ERRCODE='42501'; END IF;
  RETURN EXISTS(
    SELECT FROM public.reporter_editorial_workspaces w
    CROSS JOIN LATERAL jsonb_each(coalesce(w.checkpoint->'jobs','{}'::jsonb)) job
    WHERE w.portal_id=portal
      AND w.checkpoint->'state'->'runFolds'->job.key->'run'->>'status' IN ('queued','running','awaiting_input')
      AND (job.value->>'availableAt')::numeric<=now_ms
      AND (job.value->'lease' IS NULL OR job.value->'lease'='null'::jsonb OR (job.value->'lease'->>'until')::numeric<now_ms)
  );
END $$;
ALTER FUNCTION public.reporter_editorial_pending() OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_editorial_pending() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_editorial_pending() TO reporter_worker;
COMMIT;
