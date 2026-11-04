-- Accept the same recording containers in local intake while keeping its 2 GiB ceiling.
BEGIN;
CREATE OR REPLACE FUNCTION core.reporter_source(p_portal uuid,p_object uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  PERFORM 1 FROM core.storage_objects WHERE id=p_object AND portal_id=p_portal AND tenant_id=core.context_tenant_id()
    AND status='completed' AND owner_user_id=core.context_user_id() AND purpose='reporter-source'
    AND size BETWEEN 1 AND 2147483648
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
        AND s.size BETWEEN 1 AND 2147483648
        AND s.content_type IN ('audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/flac','audio/webm','video/mp4','video/webm','video/quicktime','video/x-matroska','video/x-msvideo')
        AND (s.expires_at IS NULL OR s.expires_at>clock_timestamp())
    UNION ALL SELECT FROM public.reporter_articles a JOIN public.reporter_transcripts t ON (t.portal_id,t.id)=(a.portal_id,a.transcript_id)
      WHERE job.payload->>'entity_type'='article' AND a.id=job.aggregate_id::uuid AND a.portal_id=job.portal_id
        AND a.source_kind='transcript' AND t.status='ready' AND t.revision=(job.payload->>'input_revision')::integer
    UNION ALL SELECT FROM public.reporter_carousels c JOIN public.reporter_articles a ON (a.portal_id,a.id,a.approved_revision)=(c.portal_id,c.article_id,c.article_revision)
      WHERE job.payload->>'entity_type'='carousel' AND c.id=job.aggregate_id::uuid AND c.portal_id=job.portal_id
        AND a.status='approved' AND a.approved_revision=(job.payload->>'input_revision')::integer)
$$;

CREATE OR REPLACE FUNCTION public.reporter_register_upload(p_id uuid,p_name text,p_size bigint,p_type text,p_checksum text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit');
BEGIN
  IF p_id IS NULL OR p_name IS NULL OR btrim(p_name)='' OR length(p_name)>255 OR p_name ~ '[[:cntrl:]]'
    OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 2147483648 OR p_checksum IS NULL
    OR p_checksum !~ '^[a-f0-9]{64}$' OR p_type IS NULL
    OR p_type NOT IN ('text/plain','audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/flac','audio/webm','video/mp4','video/webm','video/quicktime','video/x-matroska','video/x-msvideo')
    THEN RAISE EXCEPTION 'Invalid local upload' USING ERRCODE='22023'; END IF;
  INSERT INTO core.storage_objects(id,tenant_id,portal_id,owner_user_id,purpose,provider,visibility,key,file_name,size,content_type,checksum_sha256,status)
    VALUES(p_id,core.context_tenant_id(),portal,core.context_user_id(),'reporter-source','local','private',
      p_id::text||'.source',p_name,p_size,p_type,p_checksum,'completed');
  PERFORM core.reporter_audit(portal,'reporter.source.uploaded','source',p_id,jsonb_build_object('size',p_size,'content_type',p_type));
  RETURN p_id;
END $$;

COMMIT;
