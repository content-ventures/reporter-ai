-- Snapshot-bound checks share the memory queue without changing original extraction jobs.
BEGIN;
CREATE OR REPLACE FUNCTION core.reporter_memory_check_current(p_portal uuid,p_job jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(SELECT FROM public.reporter_memory_heads e JOIN public.reporter_memory_heads m ON m.portal_id=e.portal_id AND m.kind='material' AND m.id=e.parent_id
    JOIN public.reporter_ed_sources s ON s.portal_id=e.portal_id AND s.source_id=e.source_id
    WHERE e.portal_id=p_portal AND e.kind='evidence' AND e.id=p_job->>'evidenceId' AND e.fingerprint=p_job->'checkInput'->'evidence'->>'hash'
      AND e.doc->'revision'=p_job->'checkInput'->'evidence'->'revision' AND e.doc->>'status'='active' AND e.doc->'anchor'->'source'=m.doc->'source' AND s.doc->'rights'->>'authorized'='true'
      AND m.doc->'source'->>'hash'=p_job->>'sourceHash' AND m.doc->'source'->'sourceVersion'=p_job->'sourceVersion'
      AND core.reporter_memory_anchor(p_portal,e.doc->'anchor')
      AND coalesce((SELECT doc->'revision' FROM public.reporter_memory_heads WHERE portal_id=p_portal AND kind='policy' AND id='editorial-memory'),'1'::jsonb)=p_job->'checkInput'->'policyRevision'
      AND coalesce((SELECT doc->'revision' FROM public.reporter_memory_heads WHERE portal_id=p_portal AND kind='check' AND id=e.id),'0'::jsonb)=p_job->'checkInput'->'previousCheckRevision')
$$;
CREATE OR REPLACE FUNCTION public.reporter_memory_check_start(p_id text,p_expected jsonb,p_model text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); evidence jsonb; material jsonb; input jsonb; job jsonb; existing text;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit'); evidence:=public.reporter_memory_get('evidence',p_id);
  IF evidence IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  material:=public.reporter_memory_get('material',evidence->'doc'->>'materialId');
  IF p_expected IS DISTINCT FROM jsonb_build_object('id',p_id,'revision',evidence->'doc'->'revision','hash',evidence->>'fingerprint') THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF length(coalesce(p_model,'')) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  input:=jsonb_build_object('evidence',p_expected,'policyRevision',coalesce((SELECT doc->'revision' FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='policy' AND id='editorial-memory'),'1'::jsonb),
    'previousCheckRevision',coalesce((SELECT doc->'revision' FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='check' AND id=p_id),'0'::jsonb));
  job:=jsonb_build_object('id','memory-check-job-'||gen_random_uuid(),'workspaceId',portal,'revision',1,'kind','check','materialId',material->>'id','evidenceId',p_id,
    'sourceVersion',material->'doc'->'source'->'sourceVersion','sourceHash',material->'doc'->'source'->>'hash','extractorVersion','memory-check-v1','model',p_model,
    'checkInput',input,'attempts',0,'generation',1,'status','queued','totalBlocks',1,'completedBlocks',0,'failedBlocks',0,'evidenceCount',0,'error',NULL,
    'createdBy',core.context_user_id(),'createdAt',clock_timestamp(),'updatedAt',clock_timestamp());
  IF NOT core.reporter_memory_check_current(portal,job) THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  SELECT id INTO existing FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='job' AND doc->>'kind'='check' AND doc->>'evidenceId'=p_id
    AND doc->'checkInput'=input AND doc->>'status' IN ('queued','running') ORDER BY seq DESC LIMIT 1;
  IF existing IS NOT NULL THEN RETURN public.reporter_memory_job(existing); END IF;
  PERFORM public.reporter_memory_put(jsonb_build_object('kind','job','id',job->>'id','expected',NULL,'parentKind','material','parentId',material->>'id','doc',job));
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,after_data,source,request_id)
    VALUES(portal,core.context_user_id(),'memory.check.requested','memory_job',job,'reporter_ai',nullif(current_setting('app.request_id',true),'')::uuid);
  RETURN job;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_check_claim(p_owner text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.context_portal_id(); job public.reporter_memory_heads; saved jsonb; evidence jsonb; material jsonb; policy jsonb; previous jsonb;
BEGIN
  PERFORM core.reporter_worker_require();
  IF portal IS NULL OR p_owner IS NULL OR p_owner !~ '^[A-Za-z0-9_-]{8,128}$' OR NOT core.reporter_worker_workspace_enabled(portal) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM core.reporter_memory_lock(portal);
  SELECT * INTO job FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='job' AND doc->>'kind'='check' AND doc->>'status' IN ('queued','running')
    AND coalesce((doc->'_lease'->>'until')::timestamptz,'-infinity')<clock_timestamp() ORDER BY seq,id LIMIT 1 FOR UPDATE;
  IF job.id IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('app.user_id',job.doc->>'createdBy',true);
  IF (job.doc->>'attempts')::integer>=3 OR NOT core.reporter_memory_check_current(portal,job.doc) THEN
    PERFORM public.reporter_memory_put(jsonb_build_object('kind','job','id',job.id,'expected',job.storage_revision,'parentKind','material','parentId',job.parent_id,
      'doc',(job.doc-'_lease')||jsonb_build_object('revision',(job.doc->>'revision')::integer+1,'status','failed','failedBlocks',1,'updatedAt',clock_timestamp(),
        'error',CASE WHEN (job.doc->>'attempts')::integer>=3 THEN 'RETRY_EXHAUSTED' ELSE 'MEMORY_CHECK_STALE' END)));
    RETURN jsonb_build_object('job',NULL);
  END IF;
  evidence:=public.reporter_memory_get('evidence',job.doc->>'evidenceId'); material:=public.reporter_memory_get('material',job.parent_id);
  policy:=public.reporter_memory_get('policy','editorial-memory');
  SELECT jsonb_build_object('doc',jsonb_build_object('id',id,'workspaceId',portal,'revision',doc->'revision')) INTO previous FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='check' AND id=job.doc->>'evidenceId';
  saved:=public.reporter_memory_put(jsonb_build_object('kind','job','id',job.id,'expected',job.storage_revision,'parentKind','material','parentId',job.parent_id,
    'doc',job.doc||jsonb_build_object('revision',(job.doc->>'revision')::integer+1,'attempts',(job.doc->>'attempts')::integer+1,'status','running','updatedAt',clock_timestamp(),
      '_lease',jsonb_build_object('owner',p_owner,'fence',gen_random_uuid(),'until',clock_timestamp()+interval '180 seconds'))));
  RETURN jsonb_build_object('job',saved->'doc','evidence',evidence->'doc','material',material->'doc','policy',policy->'doc','previous',previous->'doc');
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_check_collect(p_query text,p_exclude text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); result jsonb;
BEGIN
  IF length(coalesce(p_query,'')) NOT BETWEEN 1 AND 400 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(value ORDER BY rank DESC,id),'[]') INTO result FROM (
    SELECT e.id,ts_rank_cd(to_tsvector('simple',e.doc->'anchor'->>'excerpt'),websearch_to_tsquery('simple',p_query)) AS rank,
      jsonb_build_object('kind','internal','evidence',jsonb_build_object('id',e.id,'revision',e.doc->'revision','hash',e.fingerprint),'primaryOrigin',m.doc->>'primaryOrigin',
        'excerpt',e.doc->'anchor'->>'excerpt')||CASE WHEN m.doc->>'primaryOrigin' LIKE 'text:%' THEN '{"originStatus":"unverified"}'::jsonb ELSE '{}'::jsonb END AS value
    FROM public.reporter_memory_heads e JOIN public.reporter_memory_heads m ON m.portal_id=e.portal_id AND m.kind='material' AND m.id=e.parent_id
      JOIN public.reporter_ed_sources s ON s.portal_id=e.portal_id AND s.source_id=e.source_id
    WHERE e.portal_id=portal AND e.kind='evidence' AND e.id<>p_exclude AND e.doc->>'status'='active' AND s.doc->'rights'->>'authorized'='true'
      AND char_length(e.doc->'anchor'->>'excerpt')<=4000 AND core.reporter_memory_doc_visible(portal,e.kind,e.doc,e.origin_production_id)
      AND core.reporter_memory_anchor(portal,e.doc->'anchor') AND to_tsvector('simple',e.doc->'anchor'->>'excerpt') @@ websearch_to_tsquery('simple',p_query)
    ORDER BY rank DESC,e.id LIMIT 5) candidates;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_check_finish(p_id text,p_owner text,p_fence text,p_generation integer,p_check jsonb,p_error text,p_terminal boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.context_portal_id(); job public.reporter_memory_heads; previous public.reporter_memory_heads; support jsonb; saved_support jsonb;
BEGIN
  PERFORM core.reporter_worker_require(); PERFORM core.reporter_memory_lock(portal);
  SELECT * INTO job FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='job' AND id=p_id AND doc->>'kind'='check';
  IF job.id IS NULL OR job.doc->>'status' IS DISTINCT FROM 'running' OR job.doc->'_lease'->>'owner' IS DISTINCT FROM p_owner
    OR job.doc->'_lease'->>'fence' IS DISTINCT FROM p_fence OR (job.doc->'_lease'->>'until')::timestamptz<=clock_timestamp()
    OR (job.doc->>'generation')::integer IS DISTINCT FROM p_generation OR job.doc->>'createdBy' IS DISTINCT FROM core.context_user_id()::text THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
  IF p_terminal IS NULL OR p_error IS NOT NULL AND p_error !~ '^[A-Z][A-Z0-9_]{0,99}$' OR (p_check IS NULL) IS DISTINCT FROM (p_error IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF p_error IS NULL THEN
    IF NOT core.reporter_memory_check_current(portal,job.doc) THEN RAISE EXCEPTION 'MEMORY_CHECK_STALE'; END IF;
    SELECT * INTO previous FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='check' AND id=job.doc->>'evidenceId';
    IF p_check->'evidence' IS DISTINCT FROM job.doc->'checkInput'->'evidence' OR p_check->'policyRevision' IS DISTINCT FROM job.doc->'checkInput'->'policyRevision'
      OR (p_check->>'revision')::integer IS DISTINCT FROM coalesce((previous.doc->>'revision')::integer,0)+1 OR p_check->>'id' IS DISTINCT FROM job.doc->>'evidenceId'
      OR p_check->>'model' IS DISTINCT FROM job.doc->>'model' OR p_check->'confidence' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    FOR support IN SELECT value->'evidence' FROM jsonb_array_elements(p_check->'supports') WHERE value->'evidence'->>'kind'='internal' LOOP
      SELECT jsonb_build_object('evidence',e.doc,'primaryOrigin',m.doc->>'primaryOrigin') INTO saved_support
        FROM public.reporter_memory_heads e JOIN public.reporter_memory_heads m ON m.portal_id=e.portal_id AND m.kind='material' AND m.id=e.parent_id
        JOIN public.reporter_ed_sources s ON s.portal_id=e.portal_id AND s.source_id=e.source_id
        WHERE e.portal_id=portal AND e.kind='evidence' AND e.id=support->'evidence'->>'id' AND e.fingerprint=support->'evidence'->>'hash'
          AND e.doc->'revision'=support->'evidence'->'revision' AND e.doc->>'status'='active' AND s.doc->'rights'->>'authorized'='true'
          AND core.reporter_memory_doc_visible(portal,e.kind,e.doc,e.origin_production_id);
      IF saved_support IS NULL OR saved_support->>'primaryOrigin' IS DISTINCT FROM support->>'primaryOrigin'
        OR position(support->>'excerpt' IN saved_support->'evidence'->'anchor'->>'excerpt') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'MEMORY_CHECK_STALE'; END IF;
    END LOOP;
    PERFORM public.reporter_memory_put(jsonb_build_object('kind','check','id',p_check->>'id','expected',previous.storage_revision,'parentKind','evidence','parentId',p_check->>'id',
      'doc',p_check||jsonb_build_object('checkedAt',clock_timestamp())));
  END IF;
  PERFORM public.reporter_memory_put(jsonb_build_object('kind','job','id',job.id,'expected',job.storage_revision,'parentKind','material','parentId',job.parent_id,
    'doc',(job.doc-'_lease')||jsonb_build_object('revision',(job.doc->>'revision')::integer+1,'status',CASE WHEN p_error IS NULL THEN 'completed'
      WHEN NOT p_terminal AND (job.doc->>'attempts')::integer<3 THEN 'queued' ELSE 'failed' END,'error',p_error,'updatedAt',clock_timestamp(),
      'completedBlocks',CASE WHEN p_error IS NULL THEN 1 ELSE 0 END,'failedBlocks',CASE WHEN p_error IS NULL THEN 0 ELSE 1 END,'evidenceCount',CASE WHEN p_error IS NULL THEN 1 ELSE 0 END)));
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,after_data,source,request_id)
    VALUES(portal,core.context_user_id(),'memory.check.'||CASE WHEN p_error IS NULL THEN 'completed' ELSE 'failed' END,'memory_check',
      jsonb_build_object('jobId',job.id,'evidence',job.doc->'checkInput'->'evidence','generation',p_generation,'check',p_check,'error',p_error),'reporter_ai',nullif(current_setting('app.request_id',true),'')::uuid);
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION core.reporter_memory_processing_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF OLD.kind='job' AND (OLD.doc-'revision'-'generation'-'status'-'totalBlocks'-'completedBlocks'-'failedBlocks'-'evidenceCount'-'error'-'updatedAt'-'_lease'-'attempts')
    IS DISTINCT FROM (NEW.doc-'revision'-'generation'-'status'-'totalBlocks'-'completedBlocks'-'failedBlocks'-'evidenceCount'-'error'-'updatedAt'-'_lease'-'attempts')
    OR OLD.kind='block' AND (OLD.doc-'status'-'attempts'-'error'-'evidenceIds'-'extraction') IS DISTINCT FROM (NEW.doc-'status'-'attempts'-'error'-'evidenceIds'-'extraction')
    THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION core.reporter_memory_job_view(p_portal uuid,p_id text,p_snapshot bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE job public.reporter_memory_history; result jsonb;
BEGIN
  SELECT * INTO job FROM public.reporter_memory_history h WHERE h.portal_id=p_portal AND h.kind='job' AND h.id=p_id AND h.seq<=p_snapshot ORDER BY seq DESC LIMIT 1;
  IF job.id IS NULL OR NOT core.reporter_memory_doc_visible(p_portal,'job',job.doc,job.origin_production_id) THEN RETURN NULL; END IF;
  IF job.doc->>'kind'='check' THEN RETURN job.doc-'_lease'; END IF;
  WITH blocks AS MATERIALIZED (SELECT DISTINCT ON(id) doc FROM public.reporter_memory_history WHERE portal_id=p_portal AND kind='block' AND doc->>'jobId'=p_id AND seq<=p_snapshot ORDER BY id,seq DESC)
  SELECT (job.doc-'_lease')||jsonb_build_object('totalBlocks',count(*),'completedBlocks',count(*) FILTER(WHERE doc->>'status'='completed'),
    'failedBlocks',count(*) FILTER(WHERE doc->>'status'='failed'),'evidenceCount',(SELECT count(DISTINCT evidence) FROM blocks CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(doc->'evidenceIds','[]')) evidence)) INTO result FROM blocks;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_job_action(p_id text,p_action text,p_revision integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); stored jsonb; state jsonb; material jsonb; amount integer; start_seq bigint; saved jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit'); stored:=public.reporter_memory_get('job',p_id);
  IF stored IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  state:=public.reporter_memory_job(p_id); material:=public.reporter_memory_get('material',state->>'materialId');
  IF state->>'kind'='check' THEN
    IF p_action IS NULL OR p_action NOT IN ('retry','cancel') OR p_action='cancel' AND (p_revision IS DISTINCT FROM (state->>'revision')::integer OR state->>'status' IN ('completed','cancelled'))
      OR p_action='retry' AND (state->>'status' NOT IN ('failed','cancelled') OR NOT core.reporter_memory_check_current(portal,state)) THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    state:=state||jsonb_build_object('revision',(state->>'revision')::integer+1,'generation',(state->>'generation')::integer+1,'attempts',0,
      'status',CASE WHEN p_action='retry' THEN 'queued' ELSE 'cancelled' END,'failedBlocks',0,'error',NULL,'updatedAt',clock_timestamp());
    saved:=public.reporter_memory_put(jsonb_build_object('kind','job','id',p_id,'expected',stored->'storage_revision','doc',state,'parentKind','material','parentId',state->>'materialId'));
    INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,before_data,after_data,source,request_id)
      VALUES(portal,core.context_user_id(),'memory.job.'||p_action,'memory_job',stored->'doc',saved->'doc','reporter_ai',nullif(current_setting('app.request_id',true),'')::uuid);
    RETURN saved->'doc';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('retry','cancel') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF p_action='cancel' AND (p_revision IS DISTINCT FROM (state->>'revision')::integer OR state->>'status' IN ('completed','cancelled'))
    OR p_action='retry' AND (state->>'status' NOT IN ('failed','partial','cancelled') OR (state->>'completedBlocks')::integer=(state->>'totalBlocks')::integer
      OR material->'doc'->'source'->>'hash' IS DISTINCT FROM state->>'sourceHash' OR NOT EXISTS(SELECT FROM public.reporter_ed_sources s
        WHERE s.portal_id=portal AND s.source_id=stored->>'source_id' AND s.doc->'rights'->>'authorized'='true')) THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF p_action='retry' THEN
    SELECT count(*)::integer INTO amount FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='block' AND doc->>'jobId'=p_id AND doc->>'status'<>'completed';
    UPDATE public.reporter_memory_clock SET seq=seq+amount WHERE portal_id=portal RETURNING seq-amount INTO start_seq;
    WITH pending AS MATERIALIZED (SELECT id,row_number() OVER(ORDER BY id) AS n FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='block' AND doc->>'jobId'=p_id AND doc->>'status'<>'completed'),
    changed AS (UPDATE public.reporter_memory_heads h SET doc=h.doc||'{"status":"pending","attempts":0,"error":null}'::jsonb,storage_revision=h.storage_revision+1,seq=start_seq+p.n
      FROM pending p WHERE h.portal_id=portal AND h.kind='block' AND h.id=p.id RETURNING h.*)
    INSERT INTO public.reporter_memory_history(portal_id,kind,id,storage_revision,doc,parent_kind,parent_id,source_id,origin_production_id,seq)
      SELECT portal_id,kind,id,storage_revision,doc,parent_kind,parent_id,source_id,origin_production_id,seq FROM changed;
  END IF;
  state:=state||jsonb_build_object('revision',(state->>'revision')::integer+1,'generation',(state->>'generation')::integer+1,
    'status',CASE WHEN p_action='retry' THEN 'queued' ELSE 'cancelled' END,'error',NULL,'updatedAt',clock_timestamp());
  saved:=public.reporter_memory_put(jsonb_build_object('kind','job','id',p_id,'expected',stored->'storage_revision','doc',state,'parentKind','material','parentId',state->>'materialId'));
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,before_data,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.job.'||p_action,'memory_job',stored->'doc',saved->'doc','reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN public.reporter_memory_job(p_id);
END $$;
CREATE OR REPLACE FUNCTION core.reporter_workspace_pending(p_portal uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(SELECT FROM public.reporter_memory_heads WHERE portal_id=p_portal AND kind='job' AND doc->>'kind' IN ('extract','check') AND doc->>'status' IN ('queued','running')) OR EXISTS(SELECT FROM public.reporter_ed_runs WHERE portal_id=p_portal AND job IS NOT NULL
    AND (status IN ('queued','running','awaiting_input') OR job->'images'->>'status'='queued' OR job->'factCheck'->>'status'='queued'))
    OR EXISTS(SELECT FROM public.reporter_transcripts WHERE portal_id=p_portal AND status IN ('queued','processing'))
    OR EXISTS(SELECT FROM core.integration_outbox WHERE portal_id=p_portal AND processed_at IS NULL AND module='reporter_ai'
      AND event_type IN ('reporter.transcription.requested','reporter.article_generation.requested','reporter.carousel_generation.requested')
      AND (attempts<8 OR last_error IS DISTINCT FROM 'ATTEMPTS_EXHAUSTED'))
    OR EXISTS(SELECT FROM public.reporter_worker_dispatches WHERE portal_id=p_portal AND lease_until>clock_timestamp())
    OR EXISTS(SELECT FROM public.reporter_news_sources WHERE portal_id=p_portal AND lease_until>clock_timestamp())
    OR EXISTS(SELECT FROM public.reporter_news_search WHERE portal_id=p_portal AND lease_until>clock_timestamp())
    OR EXISTS(SELECT FROM public.reporter_news_items i WHERE portal_id=p_portal AND translation_status='pending' AND core.reporter_news_translation_active(i))
$$;
CREATE OR REPLACE FUNCTION core.reporter_memory_due(p_portal uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(SELECT FROM public.reporter_memory_heads WHERE portal_id=p_portal AND kind='job' AND doc->>'kind' IN ('extract','check')
    AND doc->>'status' IN ('queued','running') AND coalesce((doc->'_lease'->>'until')::timestamptz,'-infinity')<clock_timestamp())
$$;
CREATE OR REPLACE FUNCTION public.reporter_memory_check_job(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); job text;
BEGIN
  IF public.reporter_memory_get('evidence',p_id) IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO job FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='job' AND doc->>'kind'='check' AND doc->>'evidenceId'=p_id ORDER BY seq DESC LIMIT 1;
  RETURN CASE WHEN job IS NOT NULL THEN public.reporter_memory_job(job) END;
END $$;
ALTER FUNCTION public.reporter_memory_check_job(text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_check_job(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_check_job(text) TO reporter_runtime,reporter_worker;
DO $$ DECLARE signature text; BEGIN
  FOREACH signature IN ARRAY ARRAY['core.reporter_memory_check_current(uuid,jsonb)','public.reporter_memory_check_start(text,jsonb,text)',
    'public.reporter_memory_check_claim(text)','public.reporter_memory_check_collect(text,text)','public.reporter_memory_check_finish(text,text,text,integer,jsonb,text,boolean)'] LOOP
    EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO reporter_executor'; EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,reporter_runtime,reporter_worker';
    IF signature='public.reporter_memory_check_start(text,jsonb,text)' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO reporter_runtime';
    ELSIF signature LIKE 'public.%' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO reporter_worker'; END IF;
  END LOOP;
END $$;
COMMIT;
