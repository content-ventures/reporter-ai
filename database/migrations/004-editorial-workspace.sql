-- One aggregate preserves rich documents, immutable versions and exact approvals.
-- Audio intake still uses reporter_transcripts and the existing durable outbox.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_editorial_workspaces (
  portal_id uuid PRIMARY KEY REFERENCES public.portals(id),
  revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(checkpoint)='object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.reporter_editorial_workspaces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_editorial_workspaces FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON public.reporter_editorial_workspaces TO reporter_executor;
DROP POLICY IF EXISTS reporter_editorial_executor ON public.reporter_editorial_workspaces;
CREATE POLICY reporter_editorial_executor ON public.reporter_editorial_workspaces TO reporter_executor
  USING (true) WITH CHECK (true);
CREATE OR REPLACE FUNCTION public.reporter_editorial_load(p_lock boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid; result jsonb;
BEGIN
  IF current_setting('app.access_mode',true)='job' THEN
    PERFORM core.reporter_worker_require(); portal := '00000000-0000-0000-0000-000000000101';
  ELSE
    portal := core.reporter_require(CASE WHEN p_lock THEN 'reporter.edit' ELSE 'reporter.read' END);
  END IF;
  IF p_lock THEN PERFORM pg_advisory_xact_lock(hashtextextended('reporter-editorial:'||portal::text,0)); END IF;
  SELECT jsonb_build_object('revision',revision,'checkpoint',checkpoint) INTO result
    FROM public.reporter_editorial_workspaces WHERE portal_id=portal;
  RETURN coalesce(result,'{"revision":0,"checkpoint":{}}'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_editorial_save(p_revision bigint,p_checkpoint jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid; current_revision bigint;
BEGIN
  IF current_setting('app.access_mode',true)='job' THEN
    PERFORM core.reporter_worker_require(); portal := '00000000-0000-0000-0000-000000000101';
  ELSE portal := core.reporter_require('reporter.edit'); END IF;
  IF jsonb_typeof(p_checkpoint->'state') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_checkpoint->'jobs') IS DISTINCT FROM 'object'
    OR p_checkpoint->'state'->'workspace'->>'id' IS DISTINCT FROM portal::text
    OR p_checkpoint->'state'->>'sessionPersonId' IS DISTINCT FROM '00000000-0000-0000-0000-000000000031'
    OR octet_length(p_checkpoint::text)>33554432 THEN
    RAISE EXCEPTION 'Invalid editorial checkpoint' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('reporter-editorial:'||portal::text,0));
  SELECT revision INTO current_revision FROM public.reporter_editorial_workspaces WHERE portal_id=portal;
  IF coalesce(current_revision,0) IS DISTINCT FROM p_revision THEN
    RAISE EXCEPTION 'Editorial revision conflict' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.reporter_editorial_workspaces(portal_id,revision,checkpoint)
    VALUES(portal,p_revision+1,p_checkpoint)
    ON CONFLICT(portal_id) DO UPDATE SET revision=excluded.revision,checkpoint=excluded.checkpoint,updated_at=clock_timestamp();
  RETURN p_revision+1;
END $$;
ALTER FUNCTION public.reporter_editorial_load(boolean) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_editorial_save(bigint,jsonb) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_editorial_load(boolean),public.reporter_editorial_save(bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_editorial_load(boolean),public.reporter_editorial_save(bigint,jsonb) TO reporter_runtime,reporter_worker;

-- Look up the actual upload, even after more than 50 later uploads exist.
CREATE OR REPLACE FUNCTION public.reporter_local_transcript(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); result jsonb;
BEGIN
  SELECT to_jsonb(t)||jsonb_build_object('file_name',s.file_name,'job',(
    SELECT jsonb_build_object('progress',o.payload->'progress','attempts',o.attempts,'last_error',o.last_error)
      FROM core.integration_outbox o WHERE o.portal_id=portal AND o.aggregate_id=t.id::text
      AND o.event_type='reporter.transcription.requested' ORDER BY o.occurred_at DESC,o.id DESC LIMIT 1))
    INTO result FROM public.reporter_transcripts t JOIN core.storage_objects s ON s.id=t.source_object_id AND s.portal_id=portal
    WHERE t.portal_id=portal AND t.id=p_id;
  RETURN result;
END $$;
ALTER FUNCTION public.reporter_local_transcript(uuid) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_local_transcript(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_local_transcript(uuid) TO reporter_runtime;
COMMIT;
