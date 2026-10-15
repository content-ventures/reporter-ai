-- Queue status and resumable transcription without worker heartbeats. Safe to replay.
-- Work is claimable when it is due and unleased; "stalled" means it stayed claimable
-- for more than 90 seconds. Neither check reads editorial bodies into the session.
BEGIN;

CREATE OR REPLACE FUNCTION core.reporter_outbox_claimable_since(p_portal uuid,p_aggregate text DEFAULT NULL)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT min(greatest(available_at,coalesce(lease_until,'-infinity'::timestamptz))) FROM core.integration_outbox
  WHERE module='reporter_ai' AND portal_id=p_portal
    AND event_type IN ('reporter.transcription.requested','reporter.article_generation.requested','reporter.carousel_generation.requested')
    AND processed_at IS NULL AND attempts<8 AND available_at<=clock_timestamp()
    AND coalesce(lease_until,'-infinity'::timestamptz)<=clock_timestamp()
    AND (p_aggregate IS NULL OR aggregate_id=p_aggregate)
$$;

CREATE OR REPLACE FUNCTION core.reporter_remote_claimable_since(p_portal uuid,p_source uuid DEFAULT NULL)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT min(greatest(created_at,coalesce((reference->>'remote_lease_until')::timestamptz,'-infinity'::timestamptz)))
  FROM core.storage_objects
  WHERE portal_id=p_portal AND status='pending' AND provider='s3' AND reference ? 'remote_url'
    AND coalesce((reference->>'remote_attempts')::int,0)<3
    AND coalesce((reference->>'remote_lease_until')::timestamptz,'-infinity'::timestamptz)<clock_timestamp()
    AND (p_source IS NULL OR id=p_source)
$$;

CREATE OR REPLACE FUNCTION core.reporter_editorial_claimable_since(p_portal uuid)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT min(to_timestamp(greatest((job.value->>'availableAt')::numeric,
      CASE WHEN jsonb_typeof(job.value->'lease')='object' THEN (job.value->'lease'->>'until')::numeric ELSE 0 END)/1000))
  FROM public.reporter_editorial_workspaces w
  CROSS JOIN LATERAL jsonb_each(coalesce(w.checkpoint->'jobs','{}'::jsonb)) job
  WHERE w.portal_id=p_portal
    AND w.checkpoint->'state'->'runFolds'->job.key->'run'->>'status' IN ('queued','running','awaiting_input')
    AND (job.value->>'availableAt')::numeric<=extract(epoch FROM clock_timestamp())*1000
    AND (jsonb_typeof(job.value->'lease') IS DISTINCT FROM 'object'
      OR (job.value->'lease'->>'until')::numeric<extract(epoch FROM clock_timestamp())*1000)
$$;

-- One cheap gate before a drain touches any job: idle invocations write nothing.
CREATE OR REPLACE FUNCTION public.reporter_worker_pending() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := nullif(current_setting('app.portal_id',true),'')::uuid;
BEGIN
  PERFORM core.reporter_worker_require();
  IF portal IS NULL THEN RAISE EXCEPTION 'Portal context missing' USING ERRCODE='42501'; END IF;
  RETURN core.reporter_outbox_claimable_since(portal) IS NOT NULL
    OR core.reporter_remote_claimable_since(portal) IS NOT NULL
    OR core.reporter_editorial_claimable_since(portal) IS NOT NULL;
END $$;

-- The browser's truthful replacement for "worker online": is this work waiting too long?
CREATE OR REPLACE FUNCTION public.reporter_queue_status(p_scope text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); since timestamptz; transcript public.reporter_transcripts;
BEGIN
  IF p_scope='editorial' THEN
    since := core.reporter_editorial_claimable_since(portal);
  ELSIF p_scope ~ '^transcript:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO transcript FROM public.reporter_transcripts WHERE portal_id=portal AND id=substr(p_scope,12)::uuid;
    IF FOUND THEN
      since := least(core.reporter_outbox_claimable_since(portal,transcript.id::text),
        core.reporter_remote_claimable_since(portal,transcript.source_object_id));
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid queue scope' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('pending',since IS NOT NULL,
    'stalled',coalesce(since<clock_timestamp()-interval '90 seconds',false));
END $$;

-- Validated provider results per audio chunk. Keyed by source rather than generation,
-- so a manual retry or a later invocation resumes instead of transcribing again.
CREATE TABLE IF NOT EXISTS public.reporter_transcript_chunks(
  portal_id uuid NOT NULL REFERENCES public.portals(id),
  source_object_id uuid NOT NULL REFERENCES core.storage_objects(id) ON DELETE CASCADE,
  model text NOT NULL CHECK(length(model) BETWEEN 1 AND 128),
  language text NOT NULL CHECK(btrim(language)<>'' AND length(language)<=35),
  chunk_index integer NOT NULL CHECK(chunk_index BETWEEN 0 AND 999),
  start_ms bigint NOT NULL CHECK(start_ms>=0),
  duration_ms bigint NOT NULL CHECK(duration_ms>0),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=4194304),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(portal_id,source_object_id,model,language,chunk_index)
);
ALTER TABLE public.reporter_transcript_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_transcript_chunks FROM PUBLIC;
GRANT SELECT,INSERT,DELETE ON public.reporter_transcript_chunks TO reporter_executor;
DROP POLICY IF EXISTS reporter_transcript_chunks_executor ON public.reporter_transcript_chunks;
CREATE POLICY reporter_transcript_chunks_executor ON public.reporter_transcript_chunks TO reporter_executor USING(true) WITH CHECK(true);

-- The source and language always come from the fenced job, never from the caller.
CREATE OR REPLACE FUNCTION core.reporter_chunk_job(p_event uuid,p_owner text,p_attempt integer)
RETURNS TABLE(portal_id uuid,source_object_id uuid,language text)
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT t.portal_id,t.source_object_id,t.language FROM core.integration_outbox o
    JOIN public.reporter_transcripts t ON t.id::text=o.aggregate_id AND t.portal_id=o.portal_id
    WHERE o.id=p_event AND o.module='reporter_ai' AND o.event_type='reporter.transcription.requested'
      AND o.lease_owner=p_owner AND o.lease_until>clock_timestamp() AND o.processed_at IS NULL
      AND o.attempts=p_attempt AND o.last_error='ATTEMPT_STARTED'
$$;

CREATE OR REPLACE FUNCTION public.reporter_transcript_chunks_read(p_event uuid,p_owner text,p_attempt integer,p_model text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE job record;
BEGIN
  PERFORM core.reporter_worker_require();
  SELECT * INTO job FROM core.reporter_chunk_job(p_event,p_owner,p_attempt);
  IF NOT FOUND THEN RAISE EXCEPTION 'Lease unavailable' USING ERRCODE='40001'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('index',c.chunk_index,'start_ms',c.start_ms,
      'duration_ms',c.duration_ms,'result',c.result) ORDER BY c.chunk_index)
    FROM public.reporter_transcript_chunks c WHERE c.portal_id=job.portal_id
      AND c.source_object_id=job.source_object_id AND c.model=p_model AND c.language=job.language),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_transcript_chunk_save(p_event uuid,p_owner text,p_attempt integer,p_model text,
  p_index integer,p_start_ms bigint,p_duration_ms bigint,p_result jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE job record;
BEGIN
  PERFORM core.reporter_worker_require();
  SELECT * INTO job FROM core.reporter_chunk_job(p_event,p_owner,p_attempt);
  IF NOT FOUND THEN RAISE EXCEPTION 'Lease unavailable' USING ERRCODE='40001'; END IF;
  INSERT INTO public.reporter_transcript_chunks(portal_id,source_object_id,model,language,chunk_index,start_ms,duration_ms,result)
    VALUES(job.portal_id,job.source_object_id,p_model,job.language,p_index,p_start_ms,p_duration_ms,p_result)
    ON CONFLICT DO NOTHING;
END $$;

-- Chunk results are only a resume aid; the transcript row is the record once ready.
CREATE OR REPLACE FUNCTION public.reporter_transcript_chunks_clear(p_transcript uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := nullif(current_setting('app.portal_id',true),'')::uuid;
BEGIN
  PERFORM core.reporter_worker_require();
  DELETE FROM public.reporter_transcript_chunks c USING public.reporter_transcripts t
    WHERE t.id=p_transcript AND t.portal_id=portal AND t.status='ready'
      AND c.portal_id=t.portal_id AND c.source_object_id=t.source_object_id;
END $$;

-- Hand a job back before the invocation budget ends without spending an attempt.
CREATE OR REPLACE FUNCTION public.reporter_yield(p_event uuid,p_owner text,p_attempt integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  PERFORM core.reporter_worker_require();
  UPDATE core.integration_outbox SET lease_owner=NULL,lease_until=NULL,attempts=attempts-1,last_error='YIELDED',
      available_at=clock_timestamp(),payload=jsonb_set(payload,'{yields}',to_jsonb(coalesce((payload->>'yields')::int,0)+1))
    WHERE id=p_event AND module='reporter_ai' AND lease_owner=p_owner AND lease_until>clock_timestamp()
      AND processed_at IS NULL AND attempts=p_attempt AND attempts>0 AND last_error='ATTEMPT_STARTED'
      AND coalesce((payload->>'yields')::int,0)<50;
  RETURN FOUND;
END $$;

ALTER FUNCTION core.reporter_outbox_claimable_since(uuid,text) OWNER TO reporter_executor;
ALTER FUNCTION core.reporter_remote_claimable_since(uuid,uuid) OWNER TO reporter_executor;
ALTER FUNCTION core.reporter_editorial_claimable_since(uuid) OWNER TO reporter_executor;
ALTER FUNCTION core.reporter_chunk_job(uuid,text,integer) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_worker_pending() OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_queue_status(text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_transcript_chunks_read(uuid,text,integer,text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_transcript_chunk_save(uuid,text,integer,text,integer,bigint,bigint,jsonb) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_transcript_chunks_clear(uuid) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_yield(uuid,text,integer) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_outbox_claimable_since(uuid,text),core.reporter_remote_claimable_since(uuid,uuid),
  core.reporter_editorial_claimable_since(uuid),core.reporter_chunk_job(uuid,text,integer),
  public.reporter_worker_pending(),public.reporter_queue_status(text),
  public.reporter_transcript_chunks_read(uuid,text,integer,text),
  public.reporter_transcript_chunk_save(uuid,text,integer,text,integer,bigint,bigint,jsonb),
  public.reporter_transcript_chunks_clear(uuid),public.reporter_yield(uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_queue_status(text) TO reporter_runtime;
GRANT EXECUTE ON FUNCTION public.reporter_worker_pending(),public.reporter_transcript_chunks_read(uuid,text,integer,text),
  public.reporter_transcript_chunk_save(uuid,text,integer,text,integer,bigint,bigint,jsonb),
  public.reporter_transcript_chunks_clear(uuid),public.reporter_yield(uuid,text,integer) TO reporter_worker;
COMMENT ON FUNCTION public.reporter_queue_status(text) IS 'reporter-queue-status-v1';
COMMIT;
