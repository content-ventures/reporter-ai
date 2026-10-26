-- Worker callbacks derive ownership from registered rows, never a browser's active client.
BEGIN;
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
  IF NOT FOUND OR source.key !~ ('^incoming/'||source.portal_id::text||'/'||source.id::text||'\.(mp3|mp4|m4a|wav|ogg|flac|webm)$')
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
  IF NOT FOUND OR source.key !~ ('^incoming/'||source.portal_id::text||'/'||source.id::text||'\.(mp3|mp4|m4a|wav|ogg|flac|webm)$')
    OR NOT core.reporter_worker_workspace_enabled(source.portal_id) THEN
    RAISE EXCEPTION 'Unknown uploaded object' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('tenant',source.tenant_id,'portal',source.portal_id,'actor',source.owner_user_id);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_worker_job_context(p_event uuid,p_owner text,p_attempt integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE job core.integration_outbox; actor uuid;
BEGIN
  PERFORM core.reporter_worker_require();
  SELECT * INTO job FROM core.integration_outbox WHERE id=p_event AND portal_id=core.context_portal_id()
    AND module='reporter_ai' AND lease_owner=p_owner AND lease_until>clock_timestamp() AND attempts=p_attempt AND processed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lease expired or unavailable' USING ERRCODE='40001'; END IF;
  IF job.payload->>'entity_type'='transcript' THEN
    SELECT created_by INTO actor FROM public.reporter_transcripts WHERE id=job.aggregate_id::uuid AND portal_id=job.portal_id;
  ELSIF job.payload->>'entity_type'='article' THEN
    SELECT created_by INTO actor FROM public.reporter_articles WHERE id=job.aggregate_id::uuid AND portal_id=job.portal_id;
  ELSIF job.payload->>'entity_type'='carousel' THEN
    SELECT created_by INTO actor FROM public.reporter_carousels WHERE id=job.aggregate_id::uuid AND portal_id=job.portal_id;
  END IF;
  IF actor IS NULL THEN RAISE EXCEPTION 'Job owner missing' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('tenant',job.tenant_id,'portal',job.portal_id,'actor',actor);
END $$;

DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY['public.reporter_worker_upload_context(uuid,text)',
    'public.reporter_worker_object_context(text,text)','public.reporter_worker_job_context(uuid,text,integer)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporter_worker',fn);
  END LOOP;
END $$;
COMMIT;
