-- Durable material input and complete block accounting, independent of productions.
BEGIN;
CREATE OR REPLACE FUNCTION core.reporter_memory_utf16_length(p_text text) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$ SELECT char_length(p_text)+regexp_count(p_text,U&'[\+010000-\+10FFFF]') $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_import_access(p_file text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read');
BEGIN
  IF p_file IS NOT NULL AND NOT EXISTS(SELECT FROM core.storage_objects s WHERE s.id=p_file::uuid AND s.portal_id=portal AND s.tenant_id=core.context_tenant_id()
    AND s.status='completed' AND s.purpose LIKE 'reporter_%' AND (s.owner_user_id=core.context_user_id() OR core.reporter_memory_is_admin(portal)))
    THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_import(p_source jsonb,p_material jsonb,p_job jsonb,p_blocks jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); moment timestamptz:=clock_timestamp(); original text; amount integer; start_seq bigint; saved jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit'); PERFORM public.reporter_memory_import_access(p_material->>'originalFileId');
  original:=p_source->'versions'->0->'content'->'segments'->0->>'text'; amount:=jsonb_array_length(p_blocks);
  IF original IS NULL OR octet_length(original)>1048576 OR length(btrim(original))<24 OR amount IS NULL OR amount NOT BETWEEN 1 AND 1050
    OR jsonb_array_length(p_source->'versions') IS DISTINCT FROM 1 OR jsonb_array_length(p_source->'versions'->0->'content'->'segments') IS DISTINCT FROM 1
    OR p_source->'versions'->0->'content'->'segments'->0->>'id' IS DISTINCT FROM 'original'
    OR p_source->>'workspaceId' IS DISTINCT FROM portal::text OR p_material->>'workspaceId' IS DISTINCT FROM portal::text OR p_job->>'workspaceId' IS DISTINCT FROM portal::text
    OR p_material->'source'->>'sourceId' IS DISTINCT FROM p_source->>'id' OR p_material->'source'->>'hash' IS DISTINCT FROM p_source->'versions'->0->>'hash'
    OR p_material->'source'->'sourceVersion' IS DISTINCT FROM '1'::jsonb OR p_job->>'materialId' IS DISTINCT FROM p_material->>'id'
    OR p_job->>'sourceHash' IS DISTINCT FROM p_material->'source'->>'hash' OR p_job->>'status' IS DISTINCT FROM 'queued'
    OR p_job->'sourceVersion' IS DISTINCT FROM '1'::jsonb OR p_job->'revision' IS DISTINCT FROM '1'::jsonb OR p_job->'generation' IS DISTINCT FROM '1'::jsonb
    OR p_job->>'kind' IS DISTINCT FROM 'extract' OR p_job->>'extractorVersion' IS DISTINCT FROM 'memory-extract-v1'
    OR (p_job->>'totalBlocks')::integer IS DISTINCT FROM amount OR EXISTS(SELECT FROM public.reporter_ed_sources WHERE portal_id=portal AND source_id=p_source->>'id')
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF EXISTS(WITH ordered AS (SELECT value,n-1 AS ordinal,lag((value->'anchor'->'spans'->0->>'to')::integer,1,0) OVER(ORDER BY n) AS preceding
    FROM jsonb_array_elements(p_blocks) WITH ORDINALITY b(value,n)) SELECT FROM ordered WHERE value->>'workspaceId' IS DISTINCT FROM portal::text
    OR value->>'jobId' IS DISTINCT FROM p_job->>'id' OR value->>'materialId' IS DISTINCT FROM p_material->>'id' OR (value->>'ordinal')::integer IS DISTINCT FROM ordinal
    OR value->'anchor'->'source' IS DISTINCT FROM p_material->'source' OR value->'anchor'->'spans'->0->>'segmentId' IS DISTINCT FROM 'original'
    OR jsonb_array_length(value->'anchor'->'spans')<>1 OR (value->'anchor'->'spans'->0->>'from')::integer IS DISTINCT FROM preceding
    OR (value->'anchor'->'spans'->0->>'to')::integer-preceding IS DISTINCT FROM core.reporter_memory_utf16_length(value->'anchor'->>'excerpt')
    OR core.reporter_memory_utf16_length(value->'anchor'->>'excerpt') NOT BETWEEN 1 AND 1000 OR value->>'status' IS DISTINCT FROM 'pending'
    OR value->'attempts' IS DISTINCT FROM '0'::jsonb OR value->'error' IS DISTINCT FROM 'null'::jsonb OR value->'evidenceIds' IS DISTINCT FROM '[]'::jsonb)
    OR (SELECT string_agg(value->'anchor'->>'excerpt','' ORDER BY n) FROM jsonb_array_elements(p_blocks) WITH ORDINALITY b(value,n)) IS DISTINCT FROM original
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  p_source:=p_source||jsonb_build_object('createdBy',core.context_user_id(),'createdAt',moment,'rights',
    CASE WHEN p_source->'rights'->>'authorized'='true' THEN jsonb_build_object('authorized',true,'authorizedBy',core.context_user_id(),'authorizedAt',moment) ELSE '{"authorized":false}'::jsonb END);
  p_source:=jsonb_set(p_source,'{versions,0}',p_source->'versions'->0||jsonb_build_object('createdBy',core.context_user_id(),'createdAt',moment));
  PERFORM public.reporter_ed_commit(jsonb_build_object('sources',jsonb_build_array(jsonb_build_object('id',p_source->>'id','doc',p_source))));
  p_material:=p_material||jsonb_build_object('importedBy',core.context_user_id(),'importedAt',moment);
  PERFORM public.reporter_memory_put(jsonb_build_object('kind','material','id',p_material->>'id','expected',NULL,'doc',p_material,'sourceId',p_source->>'id'));
  p_job:=p_job||jsonb_build_object('createdBy',core.context_user_id(),'createdAt',moment,'updatedAt',moment);
  saved:=public.reporter_memory_put(jsonb_build_object('kind','job','id',p_job->>'id','expected',NULL,'doc',p_job,'parentKind','material','parentId',p_material->>'id'));
  UPDATE public.reporter_memory_clock SET seq=seq+amount WHERE portal_id=portal RETURNING seq-amount INTO start_seq;
  WITH inserted AS (INSERT INTO public.reporter_memory_heads(portal_id,kind,id,storage_revision,doc,parent_kind,parent_id,source_id,seq)
    SELECT portal,'block',value->>'id',0,value,'material',p_material->>'id',p_source->>'id',start_seq+n FROM jsonb_array_elements(p_blocks) WITH ORDINALITY b(value,n) RETURNING *)
  INSERT INTO public.reporter_memory_history(portal_id,kind,id,storage_revision,doc,parent_kind,parent_id,source_id,seq)
    SELECT portal_id,kind,id,storage_revision,doc,parent_kind,parent_id,source_id,seq FROM inserted;
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.material.import','memory_material',jsonb_build_object('material',p_material,'job',saved->'doc'),'reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN jsonb_build_object('material',p_material,'job',saved->'doc');
END $$;
CREATE OR REPLACE FUNCTION core.reporter_memory_job_view(p_portal uuid,p_id text,p_snapshot bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE job public.reporter_memory_history; result jsonb;
BEGIN
  SELECT * INTO job FROM public.reporter_memory_history h WHERE h.portal_id=p_portal AND h.kind='job' AND h.id=p_id AND h.seq<=p_snapshot ORDER BY seq DESC LIMIT 1;
  IF job.id IS NULL OR NOT core.reporter_memory_doc_visible(p_portal,'job',job.doc,job.origin_production_id) THEN RETURN NULL; END IF;
  WITH blocks AS MATERIALIZED (SELECT DISTINCT ON(id) doc FROM public.reporter_memory_history WHERE portal_id=p_portal AND kind='block' AND doc->>'jobId'=p_id AND seq<=p_snapshot ORDER BY id,seq DESC)
  SELECT job.doc||jsonb_build_object('totalBlocks',count(*),'completedBlocks',count(*) FILTER(WHERE doc->>'status'='completed'),
    'failedBlocks',count(*) FILTER(WHERE doc->>'status'='failed'),'evidenceCount',(SELECT count(DISTINCT evidence) FROM blocks CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(doc->'evidenceIds','[]')) evidence)) INTO result FROM blocks;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_job(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); context jsonb:=public.reporter_memory_context();
BEGIN RETURN core.reporter_memory_job_view(portal,p_id,(context->>'snapshot')::bigint); END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_material_page(p_snapshot bigint,p_after jsonb,p_limit integer,p_visibility text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); context jsonb:=public.reporter_memory_context(); result jsonb;
BEGIN
  IF p_visibility IS DISTINCT FROM context->>'visibility' THEN RAISE EXCEPTION 'MEMORY_CURSOR_INVALID'; END IF;
  IF p_limit IS NULL OR p_snapshot IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_snapshot<0 OR p_snapshot>(context->>'snapshot')::bigint THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  WITH latest AS (SELECT DISTINCT ON(id) * FROM public.reporter_memory_history WHERE portal_id=portal AND kind='material' AND seq<=p_snapshot ORDER BY id,seq DESC),
  visible AS MATERIALIZED (SELECT *,extract(epoch FROM (doc->>'importedAt')::timestamptz) AS key FROM latest WHERE core.reporter_memory_doc_visible(portal,kind,doc,origin_production_id)),
  page AS MATERIALIZED (SELECT * FROM visible WHERE p_after IS NULL OR (key,id)<((p_after->>'key')::numeric,p_after->>'id') ORDER BY key DESC,id DESC LIMIT p_limit+1),
  shown AS (SELECT * FROM page ORDER BY key DESC,id DESC LIMIT p_limit)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(doc||jsonb_build_object('job',(SELECT core.reporter_memory_job_view(portal,j.id,p_snapshot)
    FROM public.reporter_memory_history j WHERE j.portal_id=portal AND j.kind='job' AND j.parent_id=shown.id AND j.seq<=p_snapshot
      AND j.doc->>'kind'='extract' AND j.doc->>'sourceHash'=shown.doc->'source'->>'hash' ORDER BY j.seq DESC LIMIT 1)) ORDER BY key DESC,id DESC) FROM shown),'[]'),
    'total',(SELECT count(*) FROM visible),'snapshot',p_snapshot::text,'next',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN
      (SELECT jsonb_build_object('key',key::text,'id',id) FROM shown ORDER BY key,id LIMIT 1) END) INTO result;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_material_detail(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); material jsonb:=public.reporter_memory_get('material',p_id); original jsonb; job text;
BEGIN
  IF material IS NULL THEN RETURN NULL; END IF;
  SELECT doc INTO original FROM public.reporter_ed_sources WHERE portal_id=portal AND source_id=material->>'source_id';
  original:=original||jsonb_build_object('workspaceId',portal,'versions',(SELECT jsonb_agg(v) FROM jsonb_array_elements(original->'versions') v
    WHERE v->'number'=material->'doc'->'source'->'sourceVersion' AND v->>'hash'=material->'doc'->'source'->>'hash'));
  SELECT id INTO job FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='job' AND parent_id=p_id AND doc->>'kind'='extract'
    AND doc->>'sourceHash'=material->'doc'->'source'->>'hash' ORDER BY seq DESC LIMIT 1;
  RETURN jsonb_build_object('material',material->'doc','source',original,'job',CASE WHEN job IS NOT NULL THEN public.reporter_memory_job(job) END);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_block_page(p_id text,p_snapshot bigint,p_after integer,p_limit integer,p_visibility text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); context jsonb:=public.reporter_memory_context(); result jsonb;
BEGIN
  IF p_visibility IS DISTINCT FROM context->>'visibility' THEN RAISE EXCEPTION 'MEMORY_CURSOR_INVALID'; END IF;
  IF p_limit IS NULL OR p_snapshot IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_snapshot<0 OR p_snapshot>(context->>'snapshot')::bigint THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF public.reporter_memory_get('job',p_id) IS NULL THEN RETURN NULL; END IF;
  WITH latest AS (SELECT DISTINCT ON(id) id,doc FROM public.reporter_memory_history WHERE portal_id=portal AND kind='block' AND doc->>'jobId'=p_id AND seq<=p_snapshot ORDER BY id,seq DESC),
  page AS MATERIALIZED (SELECT * FROM latest WHERE p_after IS NULL OR (doc->>'ordinal')::integer>p_after ORDER BY (doc->>'ordinal')::integer LIMIT p_limit+1),
  shown AS (SELECT * FROM page ORDER BY (doc->>'ordinal')::integer LIMIT p_limit)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(doc ORDER BY (doc->>'ordinal')::integer) FROM shown),'[]'),'total',(SELECT count(*) FROM latest),
    'snapshot',p_snapshot::text,'next',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT jsonb_build_object('key',doc->>'ordinal','id',id)
      FROM shown ORDER BY (doc->>'ordinal')::integer DESC LIMIT 1) END) INTO result;
  RETURN result;
END $$;
CREATE INDEX IF NOT EXISTS reporter_memory_blocks_job_history ON public.reporter_memory_history(portal_id,(doc->>'jobId'),id,seq DESC) WHERE kind='block';
CREATE INDEX IF NOT EXISTS reporter_memory_jobs_status ON public.reporter_memory_heads(portal_id,(doc->>'status'),seq) WHERE kind='job';
CREATE OR REPLACE FUNCTION public.reporter_memory_job_action(p_id text,p_action text,p_revision integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); stored jsonb; state jsonb; material jsonb; amount integer; start_seq bigint; saved jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit'); stored:=public.reporter_memory_get('job',p_id);
  IF stored IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  state:=public.reporter_memory_job(p_id); material:=public.reporter_memory_get('material',state->>'materialId');
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
DO $$ DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['core.reporter_memory_utf16_length(text)','core.reporter_memory_job_view(uuid,text,bigint)',
    'public.reporter_memory_import_access(text)','public.reporter_memory_import(jsonb,jsonb,jsonb,jsonb)','public.reporter_memory_job(text)',
    'public.reporter_memory_material_page(bigint,jsonb,integer,text)','public.reporter_memory_material_detail(text)','public.reporter_memory_block_page(text,bigint,integer,integer,text)',
    'public.reporter_memory_job_action(text,text,integer)'] LOOP
    EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO reporter_executor'; EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC';
    IF signature LIKE 'public.%' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO reporter_runtime,reporter_worker'; END IF;
  END LOOP;
END $$;
COMMIT;
