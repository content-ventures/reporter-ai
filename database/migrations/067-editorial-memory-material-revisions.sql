-- Original corrections append a source version and invalidate prior editorial context, never article history.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_memory_material_revise(p_id text,p_revision integer,p_expected jsonb,p_version jsonb,p_job jsonb,p_blocks jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); material jsonb; original jsonb; latest jsonb; source_ref jsonb;
  moment timestamptz:=clock_timestamp(); text_value text; amount integer; start_seq bigint; saved jsonb; job public.reporter_memory_heads;
  affected integer:=0; next_material jsonb; revision_stamp jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit'); PERFORM core.reporter_memory_lock(portal);
  material:=public.reporter_memory_get('material',p_id);
  IF material IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT doc INTO original FROM public.reporter_ed_sources WHERE portal_id=portal AND source_id=material->>'source_id';
  latest:=original->'versions'->(jsonb_array_length(original->'versions')-1);
  IF p_revision IS DISTINCT FROM (material->'doc'->>'revision')::integer OR p_expected IS DISTINCT FROM material->'doc'->'source'
    OR latest->'number' IS DISTINCT FROM p_expected->'sourceVersion' OR latest->>'hash' IS DISTINCT FROM p_expected->>'hash'
    OR original ? 'memory' THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  text_value:=p_version->'content'->'segments'->0->>'text'; amount:=jsonb_array_length(p_blocks);
  IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 OR text_value IS NULL OR length(btrim(text_value))<24 OR octet_length(text_value)>1048576
    OR (p_version->>'number')::integer IS DISTINCT FROM (latest->>'number')::integer+1 OR p_version->>'hash' IS NOT DISTINCT FROM latest->>'hash'
    OR coalesce(p_version->>'hash','') !~ '^[a-f0-9]{16}$' OR p_version->'content'->>'type' IS DISTINCT FROM 'transcript'
    OR p_version->'content'->>'format' IS DISTINCT FROM 'plain' OR jsonb_array_length(p_version->'content'->'segments') IS DISTINCT FROM 1
    OR p_version->'content'->'segments'->0 IS DISTINCT FROM jsonb_build_object('id','original','text',text_value)
    OR amount IS NULL OR amount NOT BETWEEN 1 AND 1050 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  source_ref:=jsonb_build_object('kind','source-version','sourceId',original->>'id','sourceVersion',p_version->'number','hash',p_version->>'hash');
  IF p_job->>'workspaceId' IS DISTINCT FROM portal::text OR p_job->>'materialId' IS DISTINCT FROM p_id OR p_job->>'kind' IS DISTINCT FROM 'extract'
    OR p_job->>'sourceHash' IS DISTINCT FROM source_ref->>'hash' OR p_job->'sourceVersion' IS DISTINCT FROM source_ref->'sourceVersion'
    OR p_job->>'status' IS DISTINCT FROM 'queued' OR p_job->'revision' IS DISTINCT FROM '1'::jsonb OR p_job->'generation' IS DISTINCT FROM '1'::jsonb
    OR p_job->>'extractorVersion' IS DISTINCT FROM 'memory-extract-v1' OR (p_job->>'totalBlocks')::integer IS DISTINCT FROM amount
    OR EXISTS(SELECT FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='job' AND id=p_job->>'id') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF EXISTS(WITH ordered AS (SELECT value,n-1 AS ordinal,lag((value->'anchor'->'spans'->0->>'to')::integer,1,0) OVER(ORDER BY n) AS preceding
    FROM jsonb_array_elements(p_blocks) WITH ORDINALITY b(value,n)) SELECT FROM ordered WHERE value->>'workspaceId' IS DISTINCT FROM portal::text
    OR value->>'jobId' IS DISTINCT FROM p_job->>'id' OR value->>'materialId' IS DISTINCT FROM p_id OR (value->>'ordinal')::integer IS DISTINCT FROM ordinal
    OR value->'anchor'->'source' IS DISTINCT FROM source_ref OR value->'anchor'->'spans'->0->>'segmentId' IS DISTINCT FROM 'original'
    OR jsonb_array_length(value->'anchor'->'spans')<>1 OR (value->'anchor'->'spans'->0->>'from')::integer IS DISTINCT FROM preceding
    OR (value->'anchor'->'spans'->0->>'to')::integer-preceding IS DISTINCT FROM core.reporter_memory_utf16_length(value->'anchor'->>'excerpt')
    OR core.reporter_memory_utf16_length(value->'anchor'->>'excerpt') NOT BETWEEN 1 AND 1000 OR value->>'status' IS DISTINCT FROM 'pending'
    OR value->'attempts' IS DISTINCT FROM '0'::jsonb OR value->'error' IS DISTINCT FROM 'null'::jsonb OR value->'evidenceIds' IS DISTINCT FROM '[]'::jsonb)
    OR (SELECT string_agg(value->'anchor'->>'excerpt','' ORDER BY n) FROM jsonb_array_elements(p_blocks) WITH ORDINALITY b(value,n)) IS DISTINCT FROM text_value
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  revision_stamp:=jsonb_build_object('reason',btrim(p_reason),'personId',core.context_user_id(),'at',moment,'materialRevision',p_revision+1);
  p_version:=p_version||jsonb_build_object('createdBy',core.context_user_id(),'createdAt',moment,'note',btrim(p_reason));
  PERFORM public.reporter_ed_commit(jsonb_build_object('sources',jsonb_build_array(jsonb_build_object('id',original->>'id','doc',
    jsonb_set(original,'{versions}',original->'versions'||jsonb_build_array(p_version))))));
  next_material:=material->'doc'||jsonb_build_object('revision',p_revision+1,'source',source_ref,'revisionInfo',revision_stamp||jsonb_build_object('previous',p_expected));
  saved:=public.reporter_memory_put(jsonb_build_object('kind','material','id',p_id,'expected',material->'storage_revision','doc',next_material,
    'sourceId',material->>'source_id','productionId',material->>'origin_production_id'));
  -- Bump context revisions, preserving the exact literal/semantic hash of historical observations.
  SELECT count(*)::integer INTO affected FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='evidence' AND parent_id=p_id AND doc->>'status'='active';
  UPDATE public.reporter_memory_clock SET seq=seq+affected WHERE portal_id=portal RETURNING seq-affected INTO start_seq;
  WITH pending AS MATERIALIZED (SELECT id,row_number() OVER(ORDER BY id) AS n FROM public.reporter_memory_heads
    WHERE portal_id=portal AND kind='evidence' AND parent_id=p_id AND doc->>'status'='active'),
  changed AS (UPDATE public.reporter_memory_heads h SET storage_revision=h.storage_revision+1,seq=start_seq+p.n,
    doc=h.doc||jsonb_build_object('revision',(h.doc->>'revision')::integer+1,'updatedAt',moment,'correction',revision_stamp)
    FROM pending p WHERE h.portal_id=portal AND h.kind='evidence' AND h.id=p.id RETURNING h.*)
  INSERT INTO public.reporter_memory_history SELECT * FROM changed;
  FOR job IN SELECT * FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='job' AND parent_id=p_id AND doc->>'kind'='extract' AND doc->>'status' IN ('queued','running') LOOP
    PERFORM public.reporter_memory_put(jsonb_build_object('kind','job','id',job.id,'expected',job.storage_revision,'parentKind','material','parentId',p_id,
      'doc',(job.doc-'_lease')||jsonb_build_object('revision',(job.doc->>'revision')::integer+1,'generation',(job.doc->>'generation')::integer+1,
        'status','cancelled','error','MEMORY_SOURCE_CHANGED','updatedAt',moment)));
  END LOOP;
  p_job:=p_job||jsonb_build_object('createdBy',core.context_user_id(),'createdAt',moment,'updatedAt',moment);
  saved:=public.reporter_memory_put(jsonb_build_object('kind','job','id',p_job->>'id','expected',NULL,'doc',p_job,'parentKind','material','parentId',p_id));
  UPDATE public.reporter_memory_clock SET seq=seq+amount WHERE portal_id=portal RETURNING seq-amount INTO start_seq;
  WITH inserted AS (INSERT INTO public.reporter_memory_heads(portal_id,kind,id,storage_revision,doc,parent_kind,parent_id,source_id,origin_production_id,seq)
    SELECT portal,'block',value->>'id',0,value,'material',p_id,original->>'id',material->>'origin_production_id',start_seq+n
      FROM jsonb_array_elements(p_blocks) WITH ORDINALITY b(value,n) RETURNING *)
  INSERT INTO public.reporter_memory_history SELECT * FROM inserted;
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,before_data,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.material.revise','memory_material',material->'doc',
      jsonb_build_object('material',next_material,'job',saved->'doc','affectedEvidence',affected),'reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN jsonb_build_object('material',next_material,'job',saved->'doc','affectedEvidence',affected);
END $$;
ALTER FUNCTION public.reporter_memory_material_revise(text,integer,jsonb,jsonb,jsonb,jsonb,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_material_revise(text,integer,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_material_revise(text,integer,jsonb,jsonb,jsonb,jsonb,text) TO reporter_runtime,reporter_worker;
CREATE OR REPLACE FUNCTION public.reporter_memory_material_version(p_id text,p_revision integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); current_material jsonb:=public.reporter_memory_get('material',p_id); material jsonb; original jsonb; job text;
BEGIN
  IF p_revision IS NULL OR p_revision<1 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF current_material IS NULL THEN RETURN NULL; END IF;
  SELECT h.doc INTO material FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='material' AND h.id=p_id
    AND (h.doc->>'revision')::integer=p_revision AND core.reporter_memory_doc_visible(portal,h.kind,h.doc,h.origin_production_id) ORDER BY h.seq DESC LIMIT 1;
  IF material IS NULL THEN RETURN NULL; END IF;
  SELECT doc INTO original FROM public.reporter_ed_sources WHERE portal_id=portal AND source_id=current_material->>'source_id';
  original:=original||jsonb_build_object('workspaceId',portal,'versions',(SELECT jsonb_agg(v) FROM jsonb_array_elements(original->'versions') v
    WHERE v->'number'=material->'source'->'sourceVersion' AND v->>'hash'=material->'source'->>'hash'));
  SELECT id INTO job FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='job' AND parent_id=p_id AND doc->>'kind'='extract'
    AND doc->>'sourceHash'=material->'source'->>'hash' ORDER BY seq DESC LIMIT 1;
  RETURN jsonb_build_object('material',material,'source',original,'job',CASE WHEN job IS NOT NULL THEN public.reporter_memory_job(job) END);
END $$;
ALTER FUNCTION public.reporter_memory_material_version(text,integer) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_material_version(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_material_version(text,integer) TO reporter_runtime,reporter_worker;
COMMIT;
