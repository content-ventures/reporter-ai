-- Drive files up to 20 GB: a whole event video, as recorded. Storage and the worker take them; the
-- browser upload keeps its 2 GB, checked where the app prepares it. Such a file is copied over
-- several syncs: each one holds the file while it copies, records how much is stored, and the next
-- continues from there. A file whose copy made no progress for an hour is abandoned. Replayable.
BEGIN;

ALTER TABLE public.reporter_drive_intakes
  ADD COLUMN IF NOT EXISTS copied_bytes bigint NOT NULL DEFAULT 0 CHECK(copied_bytes>=0),
  ADD COLUMN IF NOT EXISTS copied_at timestamptz,
  ADD COLUMN IF NOT EXISTS copy_until timestamptz;
GRANT UPDATE(copied_bytes,copied_at,copy_until) ON public.reporter_drive_intakes TO reporter_executor;

CREATE OR REPLACE FUNCTION public.reporter_prepare_cloud_upload(
  p_id uuid,p_name text,p_size bigint,p_type text,p_object_key text,
  p_token_hash text,p_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); actor uuid := core.context_user_id();
  receipt core.integration_outbox; source core.storage_objects; aggregate uuid := gen_random_uuid();
  generation uuid := gen_random_uuid(); endpoint text; inputs jsonb;
BEGIN
  IF p_id IS NULL OR p_name IS NULL OR btrim(p_name)='' OR length(p_name)>255 OR p_name ~ '[[:cntrl:]]'
    OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 21474836480
    OR p_type NOT IN ('audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/flac','audio/webm','video/mp4','video/webm')
    OR p_object_key IS NULL OR p_object_key !~ ('^incoming/'||portal::text||'/'||p_id::text||'\.(mp3|mp4|m4a|wav|ogg|flac|webm)$')
    OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
    OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{8,128}$' THEN
    RAISE EXCEPTION 'Invalid cloud upload' USING ERRCODE='22023';
  END IF;
  SELECT endpoint_url INTO endpoint FROM public.reporter_worker_heartbeats
    WHERE portal_id=portal AND endpoint_url IS NOT NULL ORDER BY seen_at DESC LIMIT 1;
  inputs := jsonb_build_object('source_id',p_id,'file_name',p_name,'size',p_size,
    'content_type',p_type,'object_key',p_object_key,'token_hash',p_token_hash);
  PERFORM pg_advisory_xact_lock(hashtextextended(portal::text||actor::text||'prepare.cloud-upload'||p_key,0));
  SELECT * INTO receipt FROM core.integration_outbox WHERE module='reporter_ai' AND portal_id=portal
    AND payload->'command'->>'actor_id'=actor::text
    AND payload->'command'->>'operation'='prepare.cloud-upload'
    AND payload->'command'->>'key'=p_key;
  IF FOUND THEN
    IF receipt.payload->'command'->'inputs' IS DISTINCT FROM inputs THEN
      RAISE EXCEPTION 'Idempotency key reused with different file' USING ERRCODE='22023';
    END IF;
    SELECT * INTO source FROM core.storage_objects WHERE id=p_id AND portal_id=portal;
    RETURN jsonb_build_object('id',receipt.aggregate_id,'source_id',source.id,'object_key',source.key,
      'bucket',source.store_id,'upload_endpoint',endpoint);
  END IF;
  INSERT INTO core.storage_objects(id,tenant_id,portal_id,owner_user_id,purpose,provider,visibility,key,
      file_name,reference,size,content_type,store_id,status,expires_at)
    VALUES(p_id,core.context_tenant_id(),portal,actor,'reporter-source','s3','private',p_object_key,
      p_name,jsonb_build_object('upload_token_sha256',p_token_hash,
        'upload_expires_at',(clock_timestamp()+interval '6 hours')::text),
      p_size,p_type,'reporter-source-media','pending',clock_timestamp()+interval '30 days');
  INSERT INTO public.reporter_transcripts(id,portal_id,source_object_id,created_by,generation_id)
    VALUES(aggregate,portal,p_id,actor,generation);
  INSERT INTO core.integration_outbox(tenant_id,portal_id,module,event_type,aggregate_id,payload,processed_at)
    VALUES(core.context_tenant_id(),portal,'reporter_ai','reporter.cloud_upload.prepared',aggregate::text,
      jsonb_build_object('command',jsonb_build_object('actor_id',actor,'operation','prepare.cloud-upload',
        'key',p_key,'inputs',inputs)),clock_timestamp());
  PERFORM core.reporter_audit(portal,'reporter.source.upload_prepared','source',p_id,
    jsonb_build_object('size',p_size,'content_type',p_type));
  RETURN jsonb_build_object('id',aggregate,'source_id',p_id,'object_key',p_object_key,
    'bucket','reporter-source-media','upload_endpoint',endpoint);
END $$;

CREATE OR REPLACE FUNCTION core.reporter_source(p_portal uuid,p_object uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  PERFORM 1 FROM core.storage_objects WHERE id=p_object AND portal_id=p_portal AND tenant_id=core.context_tenant_id()
    AND status='completed' AND owner_user_id=core.context_user_id() AND purpose='reporter-source'
    AND size BETWEEN 1 AND 21474836480
    AND content_type IN ('audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/flac','audio/webm','video/mp4','video/webm')
    AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source unavailable or outside limits' USING ERRCODE='23514'; END IF;
END $$;

CREATE OR REPLACE FUNCTION core.reporter_input_valid(job core.integration_outbox) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(
    SELECT FROM public.reporter_transcripts t JOIN core.storage_objects s ON (s.portal_id,s.id)=(t.portal_id,t.source_object_id)
      WHERE job.payload->>'entity_type'='transcript' AND t.id=job.aggregate_id::uuid AND t.portal_id=job.portal_id
        AND s.tenant_id=job.tenant_id AND s.status='completed' AND s.purpose='reporter-source' AND s.owner_user_id=t.created_by
        AND s.size BETWEEN 1 AND 21474836480
        AND s.content_type IN ('audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/flac','audio/webm','video/mp4','video/webm')
        AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp())
    UNION ALL SELECT FROM public.reporter_articles a JOIN public.reporter_transcripts t ON (t.portal_id,t.id)=(a.portal_id,a.transcript_id)
      WHERE job.payload->>'entity_type'='article' AND a.id=job.aggregate_id::uuid AND a.portal_id=job.portal_id
        AND a.source_kind='transcript' AND t.status='ready' AND t.revision=(job.payload->>'input_revision')::integer
    UNION ALL SELECT FROM public.reporter_carousels c JOIN public.reporter_articles a ON (a.portal_id,a.id,a.approved_revision)=(c.portal_id,c.article_id,c.article_revision)
      WHERE job.payload->>'entity_type'='carousel' AND c.id=job.aggregate_id::uuid AND c.portal_id=job.portal_id
        AND a.status='approved' AND a.approved_revision=(job.payload->>'input_revision')::integer)
$$;

-- A sync about to copy a file claims it for p_seconds, so no second copy starts meanwhile. It
-- answers how much is stored and whether the copy stalled: no progress for an hour.
CREATE OR REPLACE FUNCTION public.reporter_drive_copy_claim(p_transcript uuid,p_seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); intake public.reporter_drive_intakes;
BEGIN
  IF p_seconds IS NULL OR p_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'Invalid copy lease' USING ERRCODE='22023';
  END IF;
  SELECT * INTO intake FROM public.reporter_drive_intakes WHERE portal_id=portal AND transcript_id=p_transcript FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown Drive file' USING ERRCODE='22023'; END IF;
  IF coalesce(intake.copied_at,intake.created_at)<clock_timestamp()-interval '1 hour' THEN
    RETURN jsonb_build_object('claimed',false,'copied',intake.copied_bytes,'stalled',true);
  END IF;
  IF intake.copy_until>clock_timestamp() THEN
    RETURN jsonb_build_object('claimed',false,'copied',intake.copied_bytes,'stalled',false);
  END IF;
  UPDATE public.reporter_drive_intakes SET copy_until=clock_timestamp()+make_interval(secs=>p_seconds)
    WHERE portal_id=portal AND transcript_id=p_transcript;
  RETURN jsonb_build_object('claimed',true,'copied',intake.copied_bytes,'stalled',false);
END $$;

-- The copy records how much of the file is stored; p_release frees the file for the next sync.
CREATE OR REPLACE FUNCTION public.reporter_drive_copy_progress(p_transcript uuid,p_copied bigint,p_release boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit');
BEGIN
  IF p_copied IS NULL OR p_copied<0 OR p_release IS NULL THEN
    RAISE EXCEPTION 'Invalid copy progress' USING ERRCODE='22023';
  END IF;
  UPDATE public.reporter_drive_intakes SET
      copied_at=CASE WHEN p_copied>copied_bytes THEN clock_timestamp() ELSE copied_at END,
      copied_bytes=greatest(copied_bytes,p_copied),
      copy_until=CASE WHEN p_release THEN NULL ELSE copy_until END
    WHERE portal_id=portal AND transcript_id=p_transcript;
END $$;

-- Received files no production uses yet (one of them with p_transcript), newest first. A copy that
-- made no progress for an hour (or never started) was abandoned by the folder script: it reads
-- as failed. Failed files leave the board after two days, the others after thirty.
CREATE OR REPLACE FUNCTION public.reporter_drive_received(p_transcript uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read');
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.transcript_id,'fileName',i.file_name,'format',i.format,
      'recordedOn',i.recorded_on,'receivedAt',i.created_at,'size',s.size,'status',x.state,
      'errorCode',CASE WHEN t.status='failed' THEN t.error_code WHEN x.state='failed' THEN 'UPLOAD_FAILED' END) ORDER BY i.created_at DESC)
    FROM public.reporter_drive_intakes i
    JOIN public.reporter_transcripts t ON t.portal_id=i.portal_id AND t.id=i.transcript_id
    JOIN core.storage_objects s ON s.portal_id=t.portal_id AND s.id=t.source_object_id
    CROSS JOIN LATERAL (SELECT CASE WHEN t.status='ready' THEN 'ready'
      WHEN t.status='failed' OR (s.status='pending' AND coalesce(i.copied_at,i.created_at)<clock_timestamp()-interval '1 hour') THEN 'failed'
      ELSE 'transcribing' END AS state) x
    WHERE i.portal_id=portal AND (p_transcript IS NULL OR i.transcript_id=p_transcript)
      AND i.created_at>clock_timestamp()-CASE WHEN x.state='failed' THEN interval '2 days' ELSE interval '30 days' END
      AND NOT EXISTS(SELECT FROM public.reporter_ed_sources e WHERE e.portal_id=portal AND e.doc->>'transcriptId'=i.transcript_id::text)),'[]'::jsonb);
END $$;

ALTER FUNCTION public.reporter_prepare_cloud_upload(uuid,text,bigint,text,text,text,text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_drive_copy_claim(uuid,integer) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_drive_copy_progress(uuid,bigint,boolean) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_drive_received(uuid) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_drive_copy_claim(uuid,integer),public.reporter_drive_copy_progress(uuid,bigint,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_drive_copy_claim(uuid,integer),public.reporter_drive_copy_progress(uuid,bigint,boolean) TO reporter_runtime;
COMMIT;
