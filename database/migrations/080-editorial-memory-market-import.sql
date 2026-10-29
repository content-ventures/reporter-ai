-- Add literal observations without replacing existing evidence or editorial decisions.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_memory_market_import(p_material text,p_revision integer,p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); plan jsonb; material jsonb; source_doc jsonb; row jsonb; evidence jsonb;
  existing jsonb; saved jsonb; result jsonb:='[]'::jsonb; inserted integer:=0;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit');
  IF p_revision IS NULL OR p_revision<1 OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>50
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  PERFORM core.reporter_memory_lock(portal);
  plan:=public.reporter_memory_market_mapping(p_material);
  material:=public.reporter_memory_get('material',p_material);
  IF plan IS NULL OR material IS NULL THEN RETURN NULL; END IF;
  SELECT doc INTO source_doc FROM public.reporter_ed_sources WHERE portal_id=portal AND source_id=material->>'source_id';
  IF (plan->>'revision')::integer IS DISTINCT FROM p_revision OR material->'doc'->'source' IS DISTINCT FROM plan->'source'
    OR material->'doc'->>'originalFileId' IS DISTINCT FROM plan->>'originalFileId' OR source_doc->'rights'->>'authorized' IS DISTINCT FROM 'true'
    THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    evidence:=row->'evidence';
    IF jsonb_typeof(evidence) IS DISTINCT FROM 'object' OR evidence->>'kind' IS DISTINCT FROM 'statistic'
      OR evidence->>'materialId' IS DISTINCT FROM p_material OR evidence->'anchor'->'source' IS DISTINCT FROM plan->'source'
      OR evidence->'market'->>'originalFileId' IS DISTINCT FROM plan->>'originalFileId'
      OR evidence->'market'->>'checksum' IS DISTINCT FROM plan->>'checksum' OR evidence->'market'->>'mappingRevision' IS DISTINCT FROM p_revision::text
      OR evidence->'market'->>'record' IS DISTINCT FROM row->>'record' OR evidence->>'revision' IS DISTINCT FROM '0'
      OR evidence->'market'->'fields'->'value'->>'value' IS DISTINCT FROM evidence->'value'->>'raw'
      OR evidence->'market'->'fields'->'unit'->>'value' IS DISTINCT FROM evidence->>'unit'
      OR evidence->'market'->'fields'->'indicator'->>'value' IS DISTINCT FROM evidence->>'indicator'
      OR evidence->'market'->'fields'->'institution'->>'value' IS DISTINCT FROM evidence->>'issuingInstitution'
      OR evidence->'market'->'fields'->'period'->>'value' IS DISTINCT FROM evidence->'period'->>'label'
      OR length(coalesce(evidence->'anchor'->>'excerpt','')) NOT BETWEEN 1 AND 2000
      OR EXISTS(SELECT FROM jsonb_each(evidence->'market'->'fields') f WHERE nullif(f.value->>'value','') IS NOT NULL
        AND position(f.value->>'value' IN evidence->'anchor'->>'excerpt')=0)
      THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
    existing:=public.reporter_memory_get('evidence',evidence->>'id');
    IF existing IS NULL THEN
      saved:=public.reporter_memory_put(jsonb_build_object('kind','evidence','id',evidence->>'id','expected',NULL,'doc',evidence,
        'parentKind','material','parentId',p_material,'fingerprint',row->>'fingerprint'));
      inserted:=inserted+1; result:=result||jsonb_build_array(jsonb_build_object('record',row->'record','id',saved->>'id','status','created'));
    ELSE
      result:=result||jsonb_build_array(jsonb_build_object('record',row->'record','id',existing->>'id',
        'status',CASE WHEN existing->>'fingerprint'=row->>'fingerprint' THEN 'existing' ELSE 'conflict' END));
    END IF;
  END LOOP;
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.market.import','memory_material',jsonb_build_object('materialId',p_material,
      'mappingRevision',p_revision,'created',inserted,'items',result),'reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN result;
END $$;
ALTER FUNCTION public.reporter_memory_market_import(text,integer,jsonb) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_market_import(text,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_market_import(text,integer,jsonb) TO reporter_runtime,reporter_worker;
COMMIT;
