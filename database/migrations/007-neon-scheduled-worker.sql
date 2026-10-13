-- Keep the minute-scheduled Neon worker visible between invocations.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_worker_online() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read');
BEGIN
  RETURN EXISTS(SELECT FROM public.reporter_worker_heartbeats
    WHERE portal_id=portal AND seen_at>clock_timestamp()-interval '90 seconds');
END $$;
ALTER FUNCTION public.reporter_worker_online() OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_worker_online() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_worker_online() TO reporter_runtime;
COMMENT ON FUNCTION public.reporter_worker_online() IS 'reporter-neon-scheduled-worker-v1';
COMMIT;
