-- Fenced extraction advances one complete original block per durable worker turn.
BEGIN;
GRANT EXECUTE ON FUNCTION core.reporter_worker_workspace_enabled(uuid) TO reporter_executor;
CREATE OR REPLACE FUNCTION core.reporter_memory_processing_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF OLD.kind='job' AND (OLD.doc-'revision'-'generation'-'status'-'totalBlocks'-'completedBlocks'-'failedBlocks'-'evidenceCount'-'error'-'updatedAt'-'_lease')
    IS DISTINCT FROM (NEW.doc-'revision'-'generation'-'status'-'totalBlocks'-'completedBlocks'-'failedBlocks'-'evidenceCount'-'error'-'updatedAt'-'_lease')
    OR OLD.kind='block' AND (OLD.doc-'status'-'attempts'-'error'-'evidenceIds'-'extraction') IS DISTINCT FROM (NEW.doc-'status'-'attempts'-'error'-'evidenceIds'-'extraction')
    THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER reporter_memory_processing_guard BEFORE UPDATE ON public.reporter_memory_heads
  FOR EACH ROW WHEN(OLD.kind IN ('job','block')) EXECUTE FUNCTION core.reporter_memory_processing_guard();
CREATE OR REPLACE FUNCTION core.reporter_memory_due(p_portal uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(SELECT FROM public.reporter_memory_heads WHERE portal_id=p_portal AND kind='job' AND doc->>'kind'='extract'
    AND doc->>'status' IN ('queued','running') AND coalesce((doc->'_lease'->>'until')::timestamptz,'-infinity')<clock_timestamp())
$$;
CREATE OR REPLACE FUNCTION public.reporter_memory_claim(p_owner text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.context_portal_id(); job public.reporter_memory_heads; block public.reporter_memory_heads; material jsonb; saved jsonb; context jsonb;
BEGIN
  PERFORM core.reporter_worker_require();
  IF portal IS NULL OR p_owner IS NULL OR p_owner !~ '^[A-Za-z0-9_-]{8,128}$' OR NOT core.reporter_worker_workspace_enabled(portal) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM core.reporter_memory_lock(portal);
  SELECT * INTO job FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='job' AND doc->>'kind'='extract' AND doc->>'status' IN ('queued','running')
    AND coalesce((doc->'_lease'->>'until')::timestamptz,'-infinity')<clock_timestamp() ORDER BY seq,id LIMIT 1 FOR UPDATE;
  IF job.id IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('app.user_id',job.doc->>'createdBy',true);
  -- An expired final attempt cannot remain pending forever.
  FOR block IN SELECT * FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='block' AND doc->>'jobId'=job.id
    AND doc->>'status'='pending' AND (doc->>'attempts')::integer>=3 LOOP
    PERFORM public.reporter_memory_put(jsonb_build_object('kind','block','id',block.id,'expected',block.storage_revision,
      'doc',block.doc||'{"status":"failed","error":"RETRY_EXHAUSTED"}'::jsonb,'parentKind','material','parentId',block.parent_id));
  END LOOP;
  SELECT * INTO block FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='block' AND doc->>'jobId'=job.id
    AND doc->>'status'<>'completed' AND (doc->>'attempts')::integer<3 ORDER BY (doc->>'ordinal')::integer LIMIT 1;
  IF block.id IS NULL THEN
    saved:=public.reporter_memory_put(jsonb_build_object('kind','job','id',job.id,'expected',job.storage_revision,'parentKind','material','parentId',job.parent_id,
      'doc',(job.doc-'_lease')||jsonb_build_object('revision',(job.doc->>'revision')::integer+1,'status','failed','error','RETRY_EXHAUSTED','updatedAt',clock_timestamp())));
    RETURN jsonb_build_object('job',saved->'doc','block',NULL);
  END IF;
  material:=public.reporter_memory_get('material',job.parent_id);
  saved:=public.reporter_memory_put(jsonb_build_object('kind','block','id',block.id,'expected',block.storage_revision,'parentKind','material','parentId',block.parent_id,
    'doc',block.doc||jsonb_build_object('status','pending','attempts',(block.doc->>'attempts')::integer+1,'error',NULL)));
  block.doc:=saved->'doc';
  saved:=public.reporter_memory_put(jsonb_build_object('kind','job','id',job.id,'expected',job.storage_revision,'parentKind','material','parentId',job.parent_id,
    'doc',job.doc||jsonb_build_object('revision',(job.doc->>'revision')::integer+1,'status','running','updatedAt',clock_timestamp(),
      '_lease',jsonb_build_object('owner',p_owner,'fence',gen_random_uuid(),'until',clock_timestamp()+interval '180 seconds','blockId',block.id))));
  SELECT jsonb_build_object('from',min((doc->'anchor'->'spans'->0->>'from')::integer),'text',string_agg(doc->'anchor'->>'excerpt','' ORDER BY (doc->>'ordinal')::integer)) INTO context
    FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='block' AND doc->>'jobId'=job.id
      AND (doc->>'ordinal')::integer BETWEEN (block.doc->>'ordinal')::integer-1 AND (block.doc->>'ordinal')::integer+1;
  RETURN jsonb_build_object('job',saved->'doc','block',block.doc,'material',material->'doc','context',context,
    'authorized',EXISTS(SELECT FROM public.reporter_ed_sources WHERE portal_id=portal AND source_id=job.source_id AND doc->'rights'->>'authorized'='true')
      AND material->'doc'->'source'->>'hash'=job.doc->>'sourceHash' AND material->'doc'->'source'->'sourceVersion'=job.doc->'sourceVersion');
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_finish(p_id text,p_owner text,p_fence text,p_generation integer,p_evidence jsonb,p_error text,p_terminal boolean,p_processing jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.context_portal_id(); job public.reporter_memory_heads; block public.reporter_memory_heads; material public.reporter_memory_heads;
  evidence jsonb; existing jsonb; evidence_ids jsonb:='[]'; counts jsonb; next_status text;
BEGIN
  PERFORM core.reporter_worker_require(); PERFORM core.reporter_memory_lock(portal);
  SELECT * INTO job FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='job' AND id=p_id;
  IF job.id IS NULL OR job.doc->>'status' IS DISTINCT FROM 'running' OR job.doc->'_lease'->>'owner' IS DISTINCT FROM p_owner
    OR job.doc->'_lease'->>'fence' IS DISTINCT FROM p_fence OR (job.doc->'_lease'->>'until')::timestamptz<=clock_timestamp()
    OR (job.doc->>'generation')::integer IS DISTINCT FROM p_generation OR job.doc->>'createdBy' IS DISTINCT FROM core.context_user_id()::text THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
  SELECT * INTO block FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='block' AND id=job.doc->'_lease'->>'blockId';
  SELECT * INTO material FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='material' AND id=job.parent_id;
  IF block.id IS NULL OR block.parent_id IS DISTINCT FROM material.id OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence)>20
    OR p_terminal IS NULL OR p_error IS NOT NULL AND p_error !~ '^[A-Z][A-Z0-9_]{0,99}$' OR p_error IS NOT NULL AND p_evidence<>'[]'::jsonb THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF p_error IS NULL AND (material.doc->'source'->>'hash' IS DISTINCT FROM job.doc->>'sourceHash' OR material.doc->'source'->'sourceVersion' IS DISTINCT FROM job.doc->'sourceVersion'
    OR NOT EXISTS(SELECT FROM public.reporter_ed_sources WHERE portal_id=portal AND source_id=job.source_id AND doc->'rights'->>'authorized'='true')) THEN RAISE EXCEPTION 'MEMORY_SOURCE_CHANGED'; END IF;
  FOR evidence IN SELECT value FROM jsonb_array_elements(p_evidence) LOOP
    IF evidence->>'materialId' IS DISTINCT FROM material.id OR evidence->'anchor'->'source' IS DISTINCT FROM material.doc->'source'
      OR jsonb_array_length(evidence->'anchor'->'spans') IS DISTINCT FROM 1 OR evidence->'anchor'->'spans'->0->>'segmentId' IS DISTINCT FROM 'original'
      OR (evidence->'anchor'->'spans'->0->>'from')::integer<(block.doc->'anchor'->'spans'->0->>'from')::integer
      OR (evidence->'anchor'->'spans'->0->>'from')::integer>=(block.doc->'anchor'->'spans'->0->>'to')::integer
      OR evidence->>'status' IS DISTINCT FROM 'active' OR evidence->'revision' IS DISTINCT FROM '0'::jsonb
      OR evidence->>'kind'='citation' AND (evidence->'personId' IS DISTINCT FROM 'null'::jsonb OR evidence->'authorConfirmed' IS DISTINCT FROM 'false'::jsonb)
      THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
    existing:=public.reporter_memory_get('evidence',evidence->>'id');
    IF existing IS NULL THEN
      evidence:=evidence-'fingerprint'||jsonb_build_object('createdAt',clock_timestamp(),'updatedAt',clock_timestamp());
      -- The server's semantic hash ignores operational timestamps.
      PERFORM public.reporter_memory_put(jsonb_build_object('kind','evidence','id',evidence->>'id','expected',NULL,'doc',evidence,
        'parentKind','material','parentId',material.id,'fingerprint',(SELECT value->>'fingerprint' FROM jsonb_array_elements(p_evidence) WHERE value->>'id'=evidence->>'id' LIMIT 1)));
    ELSIF existing->'doc'->'anchor' IS DISTINCT FROM evidence->'anchor' OR existing->'doc'->>'kind' IS DISTINCT FROM evidence->>'kind' THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    IF NOT evidence_ids ? (evidence->>'id') THEN evidence_ids:=evidence_ids||jsonb_build_array(evidence->>'id'); END IF;
  END LOOP;
  PERFORM public.reporter_memory_put(jsonb_build_object('kind','block','id',block.id,'expected',block.storage_revision,'parentKind','material','parentId',material.id,
    'doc',block.doc||jsonb_build_object('status',CASE WHEN p_error IS NULL THEN 'completed' ELSE 'failed' END,'error',p_error,
      'evidenceIds',CASE WHEN p_error IS NULL THEN evidence_ids ELSE block.doc->'evidenceIds' END,'extraction',p_processing)));
  counts:=public.reporter_memory_job(job.id);
  next_status:=CASE WHEN p_terminal AND p_error IS NOT NULL THEN CASE WHEN (counts->>'completedBlocks')::integer>0 THEN 'partial' ELSE 'failed' END
    WHEN EXISTS(SELECT FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='block' AND doc->>'jobId'=job.id AND doc->>'status'<>'completed' AND (doc->>'attempts')::integer<3) THEN 'queued'
    WHEN (counts->>'failedBlocks')::integer>0 THEN CASE WHEN (counts->>'completedBlocks')::integer>0 THEN 'partial' ELSE 'failed' END ELSE 'completed' END;
  PERFORM public.reporter_memory_put(jsonb_build_object('kind','job','id',job.id,'expected',job.storage_revision,'parentKind','material','parentId',material.id,
    'doc',(counts-'_lease')||jsonb_build_object('revision',(job.doc->>'revision')::integer+1,'status',next_status,'error',p_error,'updatedAt',clock_timestamp())));
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,after_data,source,request_id)
    VALUES(portal,core.context_user_id(),'memory.block.'||CASE WHEN p_error IS NULL THEN 'extracted' ELSE 'failed' END,'memory_block',
      jsonb_build_object('jobId',job.id,'blockId',block.id,'generation',p_generation,'evidenceIds',evidence_ids,'error',p_error,'processing',p_processing),'reporter_ai',nullif(current_setting('app.request_id',true),'')::uuid);
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION core.reporter_memory_job_view(p_portal uuid,p_id text,p_snapshot bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE job public.reporter_memory_history; result jsonb;
BEGIN
  SELECT * INTO job FROM public.reporter_memory_history h WHERE h.portal_id=p_portal AND h.kind='job' AND h.id=p_id AND h.seq<=p_snapshot ORDER BY seq DESC LIMIT 1;
  IF job.id IS NULL OR NOT core.reporter_memory_doc_visible(p_portal,'job',job.doc,job.origin_production_id) THEN RETURN NULL; END IF;
  WITH blocks AS MATERIALIZED (SELECT DISTINCT ON(id) doc FROM public.reporter_memory_history WHERE portal_id=p_portal AND kind='block' AND doc->>'jobId'=p_id AND seq<=p_snapshot ORDER BY id,seq DESC)
  SELECT (job.doc-'_lease')||jsonb_build_object('totalBlocks',count(*),'completedBlocks',count(*) FILTER(WHERE doc->>'status'='completed'),
    'failedBlocks',count(*) FILTER(WHERE doc->>'status'='failed'),'evidenceCount',(SELECT count(DISTINCT evidence) FROM blocks CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(doc->'evidenceIds','[]')) evidence)) INTO result FROM blocks;
  RETURN result;
END $$;
-- Memory jobs participate in existing fair dispatch and archive draining.
CREATE OR REPLACE FUNCTION core.reporter_workspace_pending(p_portal uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(SELECT FROM public.reporter_memory_heads WHERE portal_id=p_portal AND kind='job' AND doc->>'kind'='extract' AND doc->>'status' IN ('queued','running')) OR EXISTS(SELECT FROM public.reporter_ed_runs WHERE portal_id=p_portal AND job IS NOT NULL
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
CREATE OR REPLACE FUNCTION core.reporter_workspace_work_due(p_portal uuid,p_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT (p_kind='any' AND core.reporter_workspace_archive_due(p_portal)) OR core.reporter_worker_budget_open(p_portal) AND (p_kind IN ('any','remote') AND core.reporter_remote_claimable_since(p_portal) IS NOT NULL
    OR p_kind IN ('any','outbox') AND (core.reporter_outbox_claimable_since(p_portal) IS NOT NULL
      OR EXISTS(SELECT FROM core.integration_outbox WHERE portal_id=p_portal AND module='reporter_ai' AND processed_at IS NULL
        AND attempts>=8 AND coalesce(lease_until,'-infinity')<=clock_timestamp() AND last_error IS DISTINCT FROM 'ATTEMPTS_EXHAUSTED'))
    OR p_kind IN ('any','editorial','images','fact_check') AND EXISTS(SELECT FROM public.reporter_ed_runs
      WHERE portal_id=p_portal AND job IS NOT NULL AND available_at<=clock_timestamp() AND coalesce(lease_until,'-infinity')<clock_timestamp()
        AND (p_kind IN ('any','editorial') AND status IN ('queued','running','awaiting_input')
          OR p_kind IN ('any','images') AND status='completed' AND job->'images'->>'status'='queued'
          OR p_kind IN ('any','fact_check') AND status='completed' AND job->'factCheck'->>'status'='queued'))
    OR p_kind IN ('any','news') AND EXISTS(SELECT FROM public.reporter_workspaces WHERE portal_id=p_portal AND lifecycle='active') AND EXISTS(SELECT FROM public.reporter_news_sources WHERE portal_id=p_portal AND NOT paused
      AND next_read_at<=clock_timestamp() AND coalesce(lease_until,'-infinity')<clock_timestamp())
    OR p_kind IN ('any','search') AND EXISTS(SELECT FROM public.reporter_workspaces WHERE portal_id=p_portal AND lifecycle='active') AND core.reporter_news_search_due(p_portal)
    OR p_kind IN ('any','translation') AND core.reporter_news_translation_pending(p_portal)
    OR p_kind='any' AND core.reporter_memory_due(p_portal))
$$;
CREATE OR REPLACE FUNCTION public.reporter_memory_material_rights(p_id text,p_revision integer,p_authorized boolean,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); material jsonb; source jsonb; latest jsonb; saved jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit'); material:=public.reporter_memory_get('material',p_id);
  IF material IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_authorized IS NULL OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  SELECT doc INTO source FROM public.reporter_ed_sources WHERE portal_id=portal AND source_id=material->>'source_id';
  latest:=source->'versions'->(jsonb_array_length(source->'versions')-1);
  IF p_revision IS DISTINCT FROM (material->'doc'->>'revision')::integer OR latest->>'hash' IS DISTINCT FROM material->'doc'->'source'->>'hash'
    OR latest->'number' IS DISTINCT FROM material->'doc'->'source'->'sourceVersion' OR (source->'rights'->>'authorized')::boolean IS NOT DISTINCT FROM p_authorized THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  source:=source||jsonb_build_object('rights',jsonb_build_object('authorized',p_authorized,'authorizedBy',core.context_user_id(),'authorizedAt',clock_timestamp()));
  PERFORM public.reporter_ed_commit(jsonb_build_object('sources',jsonb_build_array(jsonb_build_object('id',source->>'id','doc',source))));
  saved:=public.reporter_memory_put(jsonb_build_object('kind','material','id',p_id,'expected',material->'storage_revision','sourceId',material->>'source_id',
    'productionId',material->>'origin_production_id','doc',material->'doc'||jsonb_build_object('revision',p_revision+1)));
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,before_data,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.material.authorization','memory_material',material->'doc',
      jsonb_build_object('material',saved->'doc','rights',source->'rights','reason',btrim(p_reason)),'reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN saved->'doc';
END $$;
ALTER FUNCTION public.reporter_memory_material_rights(text,integer,boolean,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_material_rights(text,integer,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_material_rights(text,integer,boolean,text) TO reporter_runtime;
DO $$ DECLARE signature text; BEGIN
  FOREACH signature IN ARRAY ARRAY['core.reporter_memory_processing_guard()','core.reporter_memory_due(uuid)',
    'public.reporter_memory_claim(text)','public.reporter_memory_finish(text,text,text,integer,jsonb,text,boolean,jsonb)'] LOOP
    EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO reporter_executor'; EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,reporter_runtime';
    IF signature LIKE 'public.%' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO reporter_worker'; END IF;
  END LOOP;
END $$;
COMMIT;
