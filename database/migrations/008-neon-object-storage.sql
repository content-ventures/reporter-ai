-- Private Neon Object Storage intake for cloud media. Safe to replay.
BEGIN;

ALTER TABLE public.reporter_worker_heartbeats
  ADD COLUMN IF NOT EXISTS endpoint_url text;

GRANT INSERT ON core.storage_objects TO reporter_executor;
GRANT UPDATE(status,etag,reference) ON core.storage_objects TO reporter_executor;

DROP POLICY IF EXISTS reporter_executor_s3_upload ON core.storage_objects;
CREATE POLICY reporter_executor_s3_upload ON core.storage_objects FOR INSERT TO reporter_executor
  WITH CHECK(provider='s3' AND visibility='private' AND purpose='reporter-source'
    AND status='pending' AND store_id='reporter-source-media'
    AND portal_id=nullif(current_setting('app.portal_id',true),'')::uuid
    AND tenant_id=core.context_tenant_id() AND owner_user_id=core.context_user_id());

DROP POLICY IF EXISTS reporter_executor_s3_update ON core.storage_objects;
CREATE POLICY reporter_executor_s3_update ON core.storage_objects FOR UPDATE TO reporter_executor
  USING(provider='s3' AND visibility='private' AND purpose='reporter-source'
    AND store_id='reporter-source-media'
    AND portal_id=nullif(current_setting('app.portal_id',true),'')::uuid)
  WITH CHECK(provider='s3' AND visibility='private' AND purpose='reporter-source'
    AND store_id='reporter-source-media'
    AND portal_id=nullif(current_setting('app.portal_id',true),'')::uuid);

CREATE OR REPLACE FUNCTION public.reporter_worker_register(p_worker text,p_endpoint text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := nullif(current_setting('app.portal_id',true),'')::uuid;
BEGIN
  PERFORM core.reporter_worker_require();
  IF p_worker IS NULL OR p_worker !~ '^[a-zA-Z0-9_-]{8,128}$'
    OR p_endpoint IS NULL OR length(p_endpoint)>500
    OR p_endpoint !~ '^https://[a-zA-Z0-9.-]+(?::[0-9]+)?$' THEN
    RAISE EXCEPTION 'Invalid worker endpoint' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.reporter_worker_heartbeats(portal_id,worker_id,seen_at,endpoint_url)
    VALUES(portal,p_worker,clock_timestamp(),p_endpoint)
    ON CONFLICT(portal_id,worker_id) DO UPDATE
      SET seen_at=excluded.seen_at,endpoint_url=excluded.endpoint_url;
  DELETE FROM public.reporter_worker_heartbeats
    WHERE portal_id=portal AND seen_at<clock_timestamp()-interval '1 day';
END $$;

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
    OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 2147483648
    OR p_type NOT IN ('audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/flac','audio/webm','video/mp4','video/webm')
    OR p_object_key IS NULL OR p_object_key !~ ('^incoming/'||portal::text||'/'||p_id::text||'\.(mp3|mp4|m4a|wav|ogg|flac|webm)$')
    OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
    OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{8,128}$' THEN
    RAISE EXCEPTION 'Invalid cloud upload' USING ERRCODE='22023';
  END IF;
  SELECT endpoint_url INTO endpoint FROM public.reporter_worker_heartbeats
    WHERE portal_id=portal AND endpoint_url IS NOT NULL
      AND seen_at>clock_timestamp()-interval '3 minutes'
    ORDER BY seen_at DESC LIMIT 1;
  IF endpoint IS NULL THEN RAISE EXCEPTION 'Upload worker unavailable' USING ERRCODE='55000'; END IF;
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

CREATE OR REPLACE FUNCTION public.reporter_cloud_upload_input(p_source uuid,p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := nullif(current_setting('app.portal_id',true),'')::uuid; result jsonb;
BEGIN
  PERFORM core.reporter_worker_require();
  IF p_source IS NULL OR p_token IS NULL OR length(p_token) NOT BETWEEN 32 AND 128 THEN
    RAISE EXCEPTION 'Invalid upload authorization' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('source_id',id,'bucket',store_id,'key',key,'size',size,
      'content_type',content_type,'file_name',file_name,
      'upload_id',reference->>'multipart_upload_id') INTO result
    FROM core.storage_objects WHERE id=p_source AND portal_id=portal AND provider='s3'
      AND visibility='private' AND purpose='reporter-source' AND status='pending'
      AND store_id='reporter-source-media'
      AND reference->>'upload_token_sha256'=encode(sha256(convert_to(p_token,'UTF8')),'hex')
      AND (reference->>'upload_expires_at')::timestamptz>clock_timestamp();
  IF result IS NULL THEN RAISE EXCEPTION 'Upload authorization denied' USING ERRCODE='42501'; END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_cloud_upload_set_id(p_source uuid,p_token text,p_upload_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := nullif(current_setting('app.portal_id',true),'')::uuid;
BEGIN
  PERFORM core.reporter_worker_require();
  IF p_upload_id IS NULL OR length(p_upload_id) NOT BETWEEN 8 AND 1024 THEN
    RAISE EXCEPTION 'Invalid multipart upload' USING ERRCODE='22023'; END IF;
  UPDATE core.storage_objects SET reference=jsonb_set(reference,'{multipart_upload_id}',to_jsonb(p_upload_id))
    WHERE id=p_source AND portal_id=portal AND provider='s3' AND status='pending'
      AND reference->>'upload_token_sha256'=encode(sha256(convert_to(p_token,'UTF8')),'hex')
      AND (reference->>'upload_expires_at')::timestamptz>clock_timestamp()
      AND NOT (reference ? 'multipart_upload_id');
  IF NOT FOUND THEN
    PERFORM 1 FROM core.storage_objects WHERE id=p_source AND portal_id=portal AND status='pending'
      AND reference->>'multipart_upload_id'=p_upload_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Upload session conflict' USING ERRCODE='40001'; END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_complete_cloud_upload(
  p_bucket text,p_object_key text,p_size bigint,p_type text,p_etag text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := nullif(current_setting('app.portal_id',true),'')::uuid;
  source core.storage_objects; transcript public.reporter_transcripts; event uuid := gen_random_uuid();
BEGIN
  PERFORM core.reporter_worker_require();
  IF p_bucket<>'reporter-source-media' OR p_object_key IS NULL OR p_size IS NULL OR p_size<1
    OR p_type IS NULL OR p_etag IS NULL OR length(p_etag)>256 THEN
    RAISE EXCEPTION 'Invalid uploaded object' USING ERRCODE='22023'; END IF;
  SELECT * INTO source FROM core.storage_objects WHERE portal_id=portal AND provider='s3'
    AND store_id=p_bucket AND key=p_object_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown uploaded object' USING ERRCODE='23514'; END IF;
  SELECT * INTO transcript FROM public.reporter_transcripts
    WHERE portal_id=portal AND source_object_id=source.id FOR UPDATE;
  IF source.status='completed' THEN
    RETURN jsonb_build_object('id',transcript.id,'source_id',source.id);
  END IF;
  IF source.status<>'pending' OR source.size<>p_size OR source.content_type<>p_type
    OR transcript.status<>'queued' OR transcript.revision<>1 THEN
    RAISE EXCEPTION 'Uploaded object differs from registration' USING ERRCODE='23514';
  END IF;
  UPDATE core.storage_objects SET status='completed',etag=p_etag,
    reference=reference-ARRAY['upload_token_sha256','upload_expires_at','multipart_upload_id']
    WHERE id=source.id;
  INSERT INTO core.integration_outbox(id,tenant_id,portal_id,module,event_type,aggregate_id,payload)
    VALUES(event,source.tenant_id,portal,'reporter_ai','reporter.transcription.requested',transcript.id::text,
      jsonb_build_object('schema_version',1,'event_id',event,'tenant_id',source.tenant_id,
        'portal_id',portal,'module','reporter_ai','entity_type','transcript','entity_id',transcript.id,
        'generation_id',transcript.generation_id,'expected_revision',1,'input_revision',1,
        'parameters',jsonb_build_object('language',transcript.language)))
    ON CONFLICT DO NOTHING;
  PERFORM core.reporter_audit(portal,'reporter.source.uploaded','source',source.id,
    jsonb_build_object('size',source.size,'content_type',source.content_type,'provider','s3'));
  RETURN jsonb_build_object('id',transcript.id,'source_id',source.id);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_worker_input(p_event uuid,p_owner text,p_attempt integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE job core.integration_outbox; result jsonb; aggregate jsonb;
BEGIN
  PERFORM core.reporter_worker_require();
  SELECT * INTO job FROM core.integration_outbox WHERE id=p_event AND module='reporter_ai'
    AND lease_owner=p_owner AND lease_until>clock_timestamp() AND processed_at IS NULL
    AND attempts=p_attempt AND last_error='ATTEMPT_STARTED' FOR SHARE;
  IF NOT FOUND OR NOT core.reporter_input_valid(job) THEN
    RAISE EXCEPTION 'Worker input unavailable' USING ERRCODE='40001'; END IF;
  IF job.payload->>'entity_type'='transcript' THEN
    SELECT to_jsonb(t),jsonb_build_object('key',s.key,'bucket',s.store_id,
      'checksum_sha256',s.checksum_sha256,'etag',s.etag,'size',s.size,
      'content_type',s.content_type,'provider',s.provider,'language',t.language)
      INTO aggregate,result FROM public.reporter_transcripts t JOIN core.storage_objects s
        ON (s.portal_id,s.id)=(t.portal_id,t.source_object_id)
      WHERE t.id=job.aggregate_id::uuid AND t.portal_id=job.portal_id AND t.status='processing';
  ELSIF job.payload->>'entity_type'='article' THEN
    SELECT to_jsonb(a),jsonb_build_object('content',t.content) INTO aggregate,result
      FROM public.reporter_articles a JOIN public.reporter_transcripts t
        ON (t.portal_id,t.id)=(a.portal_id,a.transcript_id)
      WHERE a.id=job.aggregate_id::uuid AND a.portal_id=job.portal_id AND a.status='generating';
  ELSE
    SELECT to_jsonb(c),jsonb_build_object('title',a.title,'content',a.content) INTO aggregate,result
      FROM public.reporter_carousels c JOIN public.reporter_articles a
        ON (a.portal_id,a.id)=(c.portal_id,c.article_id)
      WHERE c.id=job.aggregate_id::uuid AND c.portal_id=job.portal_id AND c.status='generating';
  END IF;
  IF aggregate IS NULL OR aggregate->>'generation_id' IS DISTINCT FROM job.payload->>'generation_id'
    OR aggregate->>'revision' IS DISTINCT FROM job.payload->>'expected_revision' THEN
    RAISE EXCEPTION 'Stale worker input' USING ERRCODE='40001'; END IF;
  RETURN result;
END $$;

ALTER FUNCTION public.reporter_worker_register(text,text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_prepare_cloud_upload(uuid,text,bigint,text,text,text,text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_cloud_upload_input(uuid,text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_cloud_upload_set_id(uuid,text,text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_complete_cloud_upload(text,text,bigint,text,text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_worker_input(uuid,text,integer) OWNER TO reporter_executor;

REVOKE ALL ON FUNCTION public.reporter_worker_register(text,text),
  public.reporter_prepare_cloud_upload(uuid,text,bigint,text,text,text,text),
  public.reporter_cloud_upload_input(uuid,text),public.reporter_cloud_upload_set_id(uuid,text,text),
  public.reporter_complete_cloud_upload(text,text,bigint,text,text),
  public.reporter_worker_input(uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_prepare_cloud_upload(uuid,text,bigint,text,text,text,text)
  TO reporter_runtime;
GRANT EXECUTE ON FUNCTION public.reporter_worker_register(text,text),
  public.reporter_cloud_upload_input(uuid,text),public.reporter_cloud_upload_set_id(uuid,text,text),
  public.reporter_complete_cloud_upload(text,text,bigint,text,text),
  public.reporter_worker_input(uuid,text,integer) TO reporter_worker;

COMMIT;
