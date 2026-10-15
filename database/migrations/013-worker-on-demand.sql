-- Cloud intake no longer waits for a worker heartbeat. Safe to replay.
-- The app now names the worker from configuration and wakes it on demand. The endpoint
-- returned here only serves an application release that still reads it from SQL.
BEGIN;

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

-- Kept for an application release that still gates on it: "online" now means the queue
-- is not stalled, so an idle worker that is woken on demand no longer reads as offline.
CREATE OR REPLACE FUNCTION public.reporter_worker_online() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); since timestamptz;
BEGIN
  since := least(core.reporter_outbox_claimable_since(portal),core.reporter_remote_claimable_since(portal),
    core.reporter_editorial_claimable_since(portal));
  RETURN since IS NULL OR since>=clock_timestamp()-interval '90 seconds';
END $$;

ALTER FUNCTION public.reporter_prepare_cloud_upload(uuid,text,bigint,text,text,text,text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_worker_online() OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_prepare_cloud_upload(uuid,text,bigint,text,text,text,text),
  public.reporter_worker_online() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_prepare_cloud_upload(uuid,text,bigint,text,text,text,text),
  public.reporter_worker_online() TO reporter_runtime;
COMMENT ON FUNCTION public.reporter_worker_online() IS 'reporter-on-demand-worker-v1';
COMMIT;
