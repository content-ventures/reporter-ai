BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_prepare_remote_link(p_id uuid,p_name text,p_size bigint,p_type text,p_key text,p_token text,p_command text,p_url text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE result jsonb; portal uuid := core.reporter_require('reporter.edit');
BEGIN
  IF p_url IS NULL OR p_url !~ '^https://' OR length(p_url)>4000 THEN RAISE EXCEPTION 'Invalid remote source' USING ERRCODE='22023'; END IF;
  result := public.reporter_prepare_cloud_upload(p_id,p_name,p_size,p_type,p_key,p_token,p_command);
  UPDATE core.storage_objects SET reference=reference||jsonb_build_object('remote_url',p_url)
    WHERE id=(result->>'source_id')::uuid AND portal_id=portal AND status='pending';
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_remote_link_claim(p_owner text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := nullif(current_setting('app.portal_id',true),'')::uuid; source core.storage_objects;
BEGIN
  PERFORM core.reporter_worker_require();
  SELECT * INTO source FROM core.storage_objects WHERE portal_id=portal AND status='pending' AND provider='s3'
    AND reference ? 'remote_url' AND coalesce((reference->>'remote_attempts')::int,0)<3
    AND coalesce((reference->>'remote_lease_until')::timestamptz,'-infinity')<clock_timestamp()
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE core.storage_objects SET reference=reference||jsonb_build_object('remote_owner',p_owner,
    'remote_attempts',coalesce((reference->>'remote_attempts')::int,0)+1,'remote_lease_until',(clock_timestamp()+interval '14 minutes')::text) WHERE id=source.id;
  RETURN jsonb_build_object('id',source.id,'url',source.reference->>'remote_url','key',source.key,'size',source.size,'content_type',source.content_type);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_remote_link_failed(p_source uuid,p_owner text,p_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := nullif(current_setting('app.portal_id',true),'')::uuid; source core.storage_objects;
BEGIN
  PERFORM core.reporter_worker_require();
  SELECT * INTO source FROM core.storage_objects WHERE id=p_source AND portal_id=portal AND status='pending' AND reference->>'remote_owner'=p_owner FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE core.storage_objects SET reference=reference||jsonb_build_object('remote_error',p_code,'remote_lease_until',clock_timestamp()::text) WHERE id=p_source;
  IF (source.reference->>'remote_attempts')::int>=3 THEN
    UPDATE public.reporter_transcripts SET status='processing',started_at=clock_timestamp(),revision=revision+1
      WHERE portal_id=portal AND source_object_id=p_source AND status='queued';
    UPDATE public.reporter_transcripts SET status='failed',completed_at=clock_timestamp(),error_code=p_code,revision=revision+1
      WHERE portal_id=portal AND source_object_id=p_source AND status='processing';
  END IF;
END $$;
ALTER FUNCTION public.reporter_prepare_remote_link(uuid,text,bigint,text,text,text,text,text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_remote_link_claim(text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_remote_link_failed(uuid,text,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_prepare_remote_link(uuid,text,bigint,text,text,text,text,text),public.reporter_remote_link_claim(text),public.reporter_remote_link_failed(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_prepare_remote_link(uuid,text,bigint,text,text,text,text,text) TO reporter_runtime;
GRANT EXECUTE ON FUNCTION public.reporter_remote_link_claim(text),public.reporter_remote_link_failed(uuid,text,text) TO reporter_worker;
COMMIT;
