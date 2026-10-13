-- Local file intake and worker bridges. No new tables; safe to replay.
BEGIN;
ALTER TABLE core.storage_objects DROP CONSTRAINT IF EXISTS storage_objects_provider_check;
ALTER TABLE core.storage_objects ADD CONSTRAINT storage_objects_provider_check
  CHECK(provider IN ('vercel-blob','s3','local'));
GRANT INSERT ON core.storage_objects TO reporter_executor;
DROP POLICY IF EXISTS reporter_executor_local_upload ON core.storage_objects;
CREATE POLICY reporter_executor_local_upload ON core.storage_objects FOR INSERT TO reporter_executor
  WITH CHECK(provider='local' AND visibility='private' AND status='completed');

CREATE OR REPLACE FUNCTION core.reporter_source(p_portal uuid,p_object uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  PERFORM 1 FROM core.storage_objects WHERE id=p_object AND portal_id=p_portal AND tenant_id=core.context_tenant_id()
    AND status='completed' AND owner_user_id=core.context_user_id() AND purpose='reporter-source'
    AND size BETWEEN 1 AND 2147483648
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
        AND s.size BETWEEN 1 AND 2147483648
        AND s.content_type IN ('audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/flac','audio/webm','video/mp4','video/webm')
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
    OR p_type NOT IN ('text/plain','audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/flac','audio/webm','video/mp4','video/webm')
    THEN RAISE EXCEPTION 'Invalid local upload' USING ERRCODE='22023'; END IF;
  INSERT INTO core.storage_objects(id,tenant_id,portal_id,owner_user_id,purpose,provider,visibility,key,file_name,size,content_type,checksum_sha256,status)
    VALUES(p_id,core.context_tenant_id(),portal,core.context_user_id(),'reporter-source','local','private',
      p_id::text||'.source',p_name,p_size,p_type,p_checksum,'completed');
  PERFORM core.reporter_audit(portal,'reporter.source.uploaded','source',p_id,jsonb_build_object('size',p_size,'content_type',p_type));
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_import_transcript(p_object uuid,p_content text,p_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); actor uuid := core.context_user_id();
  aggregate uuid := gen_random_uuid(); receipt core.integration_outbox; inputs jsonb;
BEGIN
  IF p_content IS NULL OR btrim(p_content)='' OR octet_length(p_content)>1048576
    OR p_key IS NULL OR btrim(p_key)='' OR length(p_key)>128 THEN
    RAISE EXCEPTION 'Invalid transcript import' USING ERRCODE='22023'; END IF;
  inputs := jsonb_build_object('source_id',p_object,'content_hash',encode(sha256(convert_to(p_content,'UTF8')),'hex'));
  PERFORM pg_advisory_xact_lock(hashtextextended(portal::text||actor::text||'import.transcript'||p_key,0));
  SELECT * INTO receipt FROM core.integration_outbox WHERE module='reporter_ai' AND portal_id=portal
    AND payload->'command'->>'actor_id'=actor::text AND payload->'command'->>'operation'='import.transcript'
    AND payload->'command'->>'key'=p_key;
  IF FOUND THEN
    IF receipt.payload->'command'->'inputs' IS DISTINCT FROM inputs THEN
      RAISE EXCEPTION 'Idempotency key reused' USING ERRCODE='22023'; END IF;
    RETURN receipt.aggregate_id::uuid;
  END IF;
  PERFORM 1 FROM core.storage_objects WHERE id=p_object AND portal_id=portal AND tenant_id=core.context_tenant_id()
    AND owner_user_id=actor AND provider='local' AND visibility='private' AND status='completed'
    AND purpose='reporter-source' AND content_type='text/plain' AND size BETWEEN 1 AND 1048576
    AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import source unavailable' USING ERRCODE='23514'; END IF;
  INSERT INTO public.reporter_transcripts(id,portal_id,source_object_id,created_by) VALUES(aggregate,portal,p_object,actor);
  UPDATE public.reporter_transcripts SET status='processing',started_at=clock_timestamp(),revision=2 WHERE id=aggregate;
  UPDATE public.reporter_transcripts SET status='ready',content=p_content,provider='local-import',
    model='plain-text-v1',completed_at=clock_timestamp(),revision=3 WHERE id=aggregate;
  INSERT INTO core.integration_outbox(tenant_id,portal_id,module,event_type,aggregate_id,payload,processed_at)
    VALUES(core.context_tenant_id(),portal,'reporter_ai','reporter.transcript.imported',aggregate::text,
      jsonb_build_object('command',jsonb_build_object('actor_id',actor,'operation','import.transcript','key',p_key,'inputs',inputs)),clock_timestamp());
  PERFORM core.reporter_audit(portal,'reporter.transcript.imported','transcript',aggregate,jsonb_build_object('revision',3,'provenance','local-text-import'));
  PERFORM core.reporter_outcome(portal,'reporter.transcript.imported','transcript',aggregate,jsonb_build_object('revision',3));
  RETURN aggregate;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_intake(p_id uuid,p_name text,p_size bigint,p_type text,p_checksum text,p_content text,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); actor uuid := core.context_user_id();
  receipt core.integration_outbox; source core.storage_objects; aggregate uuid; operation text;
BEGIN
  IF p_key IS NULL OR btrim(p_key)='' OR length(p_key)>128 THEN RAISE EXCEPTION 'Invalid intake key' USING ERRCODE='22023'; END IF;
  operation := CASE WHEN p_type='text/plain' THEN 'import.transcript' ELSE 'create.transcript' END;
  PERFORM pg_advisory_xact_lock(hashtextextended(portal::text||actor::text||'intake'||p_key,0));
  SELECT * INTO receipt FROM core.integration_outbox WHERE module='reporter_ai' AND portal_id=portal
    AND payload->'command'->>'actor_id'=actor::text AND payload->'command'->>'operation'=operation
    AND payload->'command'->>'key'=p_key;
  IF FOUND THEN
    SELECT * INTO source FROM core.storage_objects WHERE id=(receipt.payload->'command'->'inputs'->>'source_id')::uuid;
    IF source.checksum_sha256 IS DISTINCT FROM p_checksum OR source.size IS DISTINCT FROM p_size
      OR source.content_type IS DISTINCT FROM p_type OR source.file_name IS DISTINCT FROM p_name THEN
      RAISE EXCEPTION 'Idempotency key reused with different file' USING ERRCODE='22023'; END IF;
    RETURN jsonb_build_object('id',receipt.aggregate_id,'source_id',source.id);
  END IF;
  PERFORM public.reporter_register_upload(p_id,p_name,p_size,p_type,p_checksum);
  aggregate := CASE WHEN p_type='text/plain' THEN public.reporter_import_transcript(p_id,p_content,p_key)
    ELSE public.reporter_create('transcript',p_id,1,p_key,'{"language":"pt-BR"}') END;
  RETURN jsonb_build_object('id',aggregate,'source_id',p_id);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_local_state() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'transcripts',coalesce((SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('file_name',s.file_name,'job',(
      SELECT jsonb_build_object('progress',o.payload->'progress','attempts',o.attempts,'last_error',o.last_error,'available_at',o.available_at)
      FROM core.integration_outbox o WHERE o.portal_id=portal AND o.aggregate_id=t.id::text
        AND o.event_type='reporter.transcription.requested' ORDER BY o.occurred_at DESC,o.id DESC LIMIT 1)))
      FROM (SELECT * FROM public.reporter_transcripts WHERE portal_id=portal ORDER BY created_at DESC LIMIT 50) t
      JOIN core.storage_objects s ON s.id=t.source_object_id AND s.portal_id=portal),'[]'),
    'articles',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM
      (SELECT * FROM public.reporter_articles WHERE portal_id=portal ORDER BY created_at DESC LIMIT 50) a),'[]'),
    'carousels',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM
      (SELECT * FROM public.reporter_carousels WHERE portal_id=portal ORDER BY created_at DESC LIMIT 50) c),'[]')) INTO result;
  RETURN result;
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
    SELECT to_jsonb(t),jsonb_build_object('key',s.key,'checksum_sha256',s.checksum_sha256,'size',s.size,'content_type',s.content_type,'provider',s.provider,'language',t.language)
      INTO aggregate,result FROM public.reporter_transcripts t JOIN core.storage_objects s ON (s.portal_id,s.id)=(t.portal_id,t.source_object_id)
      WHERE t.id=job.aggregate_id::uuid AND t.portal_id=job.portal_id AND t.status='processing';
  ELSIF job.payload->>'entity_type'='article' THEN
    SELECT to_jsonb(a),jsonb_build_object('content',t.content) INTO aggregate,result
      FROM public.reporter_articles a JOIN public.reporter_transcripts t ON (t.portal_id,t.id)=(a.portal_id,a.transcript_id)
      WHERE a.id=job.aggregate_id::uuid AND a.portal_id=job.portal_id AND a.status='generating';
  ELSE
    SELECT to_jsonb(c),jsonb_build_object('title',a.title,'content',a.content) INTO aggregate,result
      FROM public.reporter_carousels c JOIN public.reporter_articles a ON (a.portal_id,a.id)=(c.portal_id,c.article_id)
      WHERE c.id=job.aggregate_id::uuid AND c.portal_id=job.portal_id AND c.status='generating';
  END IF;
  IF aggregate IS NULL OR aggregate->>'generation_id' IS DISTINCT FROM job.payload->>'generation_id'
    OR aggregate->>'revision' IS DISTINCT FROM job.payload->>'expected_revision' THEN
    RAISE EXCEPTION 'Stale worker input' USING ERRCODE='40001'; END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_progress(p_event uuid,p_owner text,p_attempt integer,p_phase text,p_done integer,p_total integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  PERFORM core.reporter_worker_require();
  IF p_phase IS NULL OR p_phase NOT IN ('preparing','transcribing','writing','slides')
    OR p_done IS NULL OR p_total IS NULL OR p_done<0 OR p_total<1 OR p_total>1000 OR p_done>p_total THEN
    RAISE EXCEPTION 'Invalid progress' USING ERRCODE='22023'; END IF;
  UPDATE core.integration_outbox SET payload=jsonb_set(payload,'{progress}',jsonb_build_object('phase',p_phase,'done',p_done,'total',p_total))
    WHERE id=p_event AND module='reporter_ai' AND lease_owner=p_owner AND lease_until>clock_timestamp()
      AND processed_at IS NULL AND attempts=p_attempt AND last_error='ATTEMPT_STARTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Lease unavailable' USING ERRCODE='40001'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_defer(p_event uuid,p_owner text,p_attempt integer,p_code text,p_seconds integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF p_seconds IS NULL OR p_seconds NOT BETWEEN 0 AND 7200 THEN RAISE EXCEPTION 'Invalid delay'; END IF;
  PERFORM public.reporter_release(p_event,p_owner,p_attempt,p_code);
  UPDATE core.integration_outbox SET available_at=greatest(available_at,clock_timestamp()+make_interval(secs=>p_seconds))
    WHERE id=p_event AND attempts=p_attempt AND processed_at IS NULL AND lease_owner IS NULL AND last_error=p_code;
END $$;

DO $$ DECLARE fn record; BEGIN
  FOR fn IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('reporter_register_upload','reporter_import_transcript','reporter_intake','reporter_local_state',
      'reporter_worker_input','reporter_progress','reporter_defer') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO reporter_executor',fn.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s',fn.signature,
      CASE WHEN fn.proname IN ('reporter_register_upload','reporter_import_transcript','reporter_intake','reporter_local_state') THEN 'reporter_runtime' ELSE 'reporter_worker' END);
  END LOOP;
END $$;
COMMENT ON FUNCTION public.reporter_local_state() IS 'reporter-local-flow-v1';
COMMIT;
