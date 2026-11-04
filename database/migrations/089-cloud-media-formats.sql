-- Accept QuickTime, M4V, Matroska and AVI recordings throughout the cloud upload and worker path.
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
    OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 85899345920
    OR p_type NOT IN ('audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/flac','audio/webm','video/mp4','video/webm','video/quicktime','video/x-matroska','video/x-msvideo')
    OR p_object_key IS NULL OR p_object_key !~ ('^incoming/'||portal::text||'/'||p_id::text||'\.(mp3|mp4|m4a|wav|ogg|flac|webm|mov|m4v|mkv|avi)$')
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
        'upload_expires_at',(clock_timestamp()+interval '24 hours')::text),
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
    AND size BETWEEN 1 AND 85899345920
    AND content_type IN ('audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/flac','audio/webm','video/mp4','video/webm','video/quicktime','video/x-matroska','video/x-msvideo')
    AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source unavailable or outside limits' USING ERRCODE='23514'; END IF;
END $$;

CREATE OR REPLACE FUNCTION core.reporter_input_valid(job core.integration_outbox) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(
    SELECT FROM public.reporter_transcripts t JOIN core.storage_objects s ON (s.portal_id,s.id)=(t.portal_id,t.source_object_id)
      WHERE job.payload->>'entity_type'='transcript' AND t.id=job.aggregate_id::uuid AND t.portal_id=job.portal_id
        AND s.tenant_id=job.tenant_id AND s.status='completed' AND s.purpose='reporter-source' AND s.owner_user_id=t.created_by
        AND s.size BETWEEN 1 AND 85899345920
        AND s.content_type IN ('audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/flac','audio/webm','video/mp4','video/webm','video/quicktime','video/x-matroska','video/x-msvideo')
        AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp())
    UNION ALL SELECT FROM public.reporter_articles a JOIN public.reporter_transcripts t ON (t.portal_id,t.id)=(a.portal_id,a.transcript_id)
      WHERE job.payload->>'entity_type'='article' AND a.id=job.aggregate_id::uuid AND a.portal_id=job.portal_id
        AND a.source_kind='transcript' AND t.status='ready' AND t.revision=(job.payload->>'input_revision')::integer
    UNION ALL SELECT FROM public.reporter_carousels c JOIN public.reporter_articles a ON (a.portal_id,a.id,a.approved_revision)=(c.portal_id,c.article_id,c.article_revision)
      WHERE job.payload->>'entity_type'='carousel' AND c.id=job.aggregate_id::uuid AND c.portal_id=job.portal_id
        AND a.status='approved' AND a.approved_revision=(job.payload->>'input_revision')::integer)
$$;

CREATE OR REPLACE FUNCTION public.reporter_worker_upload_context(p_source uuid,p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE source core.storage_objects;
BEGIN
  PERFORM core.reporter_worker_require();
  IF p_source IS NULL OR p_token IS NULL OR length(p_token) NOT BETWEEN 32 AND 128 THEN
    RAISE EXCEPTION 'Upload authorization denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO source FROM core.storage_objects WHERE id=p_source AND provider='s3' AND visibility='private'
    AND purpose='reporter-source' AND status='pending' AND store_id='reporter-source-media'
    AND reference->>'upload_token_sha256'=encode(sha256(convert_to(p_token,'UTF8')),'hex')
    AND (reference->>'upload_expires_at')::timestamptz>clock_timestamp();
  IF NOT FOUND OR source.key !~ ('^incoming/'||source.portal_id::text||'/'||source.id::text||'\.(mp3|mp4|m4a|wav|ogg|flac|webm|mov|m4v|mkv|avi)$')
    OR NOT core.reporter_worker_workspace_enabled(source.portal_id) THEN
    RAISE EXCEPTION 'Upload authorization denied' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('tenant',source.tenant_id,'portal',source.portal_id,'actor',source.owner_user_id);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_worker_object_context(p_bucket text,p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE source core.storage_objects;
BEGIN
  PERFORM core.reporter_worker_require();
  IF p_bucket IS DISTINCT FROM 'reporter-source-media' OR p_key IS NULL THEN RAISE EXCEPTION 'Unknown uploaded object' USING ERRCODE='42501'; END IF;
  SELECT * INTO source FROM core.storage_objects WHERE store_id=p_bucket AND key=p_key AND provider='s3'
    AND visibility='private' AND purpose='reporter-source' AND status IN ('pending','completed');
  IF NOT FOUND OR source.key !~ ('^incoming/'||source.portal_id::text||'/'||source.id::text||'\.(mp3|mp4|m4a|wav|ogg|flac|webm|mov|m4v|mkv|avi)$')
    OR NOT core.reporter_worker_workspace_enabled(source.portal_id) THEN
    RAISE EXCEPTION 'Unknown uploaded object' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('tenant',source.tenant_id,'portal',source.portal_id,'actor',source.owner_user_id);
END $$;

COMMIT;
