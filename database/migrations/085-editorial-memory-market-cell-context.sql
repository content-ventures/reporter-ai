-- Validate decoded values against their original mapped CSV/TSV cells.
BEGIN;
CREATE OR REPLACE FUNCTION core.reporter_memory_market_cell(p_portal uuid,p_evidence jsonb,p_field text,p_value text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE proof jsonb:=p_evidence->'market'; cell jsonb:=proof->'fields'->p_field; spec jsonb:=proof->'mapping'->p_field;
  original text; source_text text; decoded text; cell_from integer; cell_to integer;
BEGIN
  IF p_portal IS DISTINCT FROM core.context_portal_id() OR p_value IS NULL OR p_value='' OR cell IS NULL OR spec IS NULL
    OR (spec->>'record'='header' AND cell->>'record'='1' OR spec->>'record'='row' AND cell->>'record'=proof->>'record') IS DISTINCT FROM true
    OR cell->>'value' IS DISTINCT FROM p_value OR coalesce(spec->>'column','') !~ '^(0|[1-9][0-9]{0,2})$'
    OR coalesce(cell->>'column','') !~ '^[1-9][0-9]{0,2}$' OR (spec->>'column')::integer+1<>(cell->>'column')::integer
    OR coalesce(cell->>'from','') !~ '^(0|[1-9][0-9]{0,6})$' OR coalesce(cell->>'to','') !~ '^[1-9][0-9]{0,6}$'
    OR coalesce(p_evidence->'anchor'->'spans'->0->>'from','') !~ '^(0|[1-9][0-9]{0,6})$'
    OR coalesce(p_evidence->'anchor'->'spans'->0->>'to','') !~ '^[1-9][0-9]{0,6}$' THEN RETURN false; END IF;
  cell_from:=(cell->>'from')::integer; cell_to:=(cell->>'to')::integer; original:=cell->>'original';
  IF cell_to<=cell_from OR cell_to>1048576 OR original IS NULL OR original=''
    OR spec->>'record'='header' AND cell_to>(p_evidence->'anchor'->'spans'->0->>'from')::integer
    OR spec->>'record'='row' AND (cell_from<(p_evidence->'anchor'->'spans'->0->>'from')::integer
      OR cell_to>(p_evidence->'anchor'->'spans'->0->>'to')::integer) THEN RETURN false; END IF;
  SELECT seg->>'text' INTO source_text FROM public.reporter_memory_heads m JOIN public.reporter_ed_sources s
    ON s.portal_id=m.portal_id AND s.source_id=m.source_id
    CROSS JOIN LATERAL jsonb_array_elements(s.doc->'versions') v CROSS JOIN LATERAL jsonb_array_elements(v->'content'->'segments') seg
    WHERE m.portal_id=p_portal AND m.kind='material' AND m.id=p_evidence->>'materialId'
      AND m.doc->>'originalFileId'=proof->>'originalFileId' AND s.doc->'rights'->>'authorized'='true'
      AND s.source_id=p_evidence->'anchor'->'source'->>'sourceId' AND v->>'number'=p_evidence->'anchor'->'source'->>'sourceVersion'
      AND v->>'hash'=p_evidence->'anchor'->'source'->>'hash' AND seg->>'id'='original'
      AND core.reporter_memory_visible(p_portal,m.origin_production_id);
  IF source_text IS NULL OR core.reporter_memory_utf16_slice(left(source_text,cell_to+1),cell_from,cell_to) IS DISTINCT FROM original THEN RETURN false; END IF;
  decoded:=CASE WHEN left(original,1)='"' AND right(original,1)='"' AND length(original)>=2
    THEN replace(substring(original FROM 2 FOR length(original)-2),'""','"') ELSE original END;
  RETURN decoded=p_value;
END $$;
ALTER FUNCTION core.reporter_memory_market_cell(uuid,jsonb,text,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_memory_market_cell(uuid,jsonb,text,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.reporter_memory_put(p_change jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
#variable_conflict use_variable
DECLARE kind text:=p_change->>'kind'; entity text:=p_change->>'id'; document jsonb:=p_change->'doc';
  portal uuid; previous public.reporter_memory_heads; parent public.reporter_memory_heads; saved public.reporter_memory_heads;
  source_id text; production_id text; expected integer; next_seq bigint; latest_check jsonb; policy_revision integer; next_decision integer;
BEGIN
  portal:=core.reporter_memory_portal(CASE WHEN kind='decision' THEN 'review' ELSE 'write' END);
  IF kind IS NULL OR kind NOT IN ('material','evidence','check','decision','policy','selection','use','job','block') OR entity IS NULL OR length(entity) NOT BETWEEN 1 AND 128
    OR jsonb_typeof(document) IS DISTINCT FROM 'object' OR octet_length(document::text)>1048576
    OR document->>'id' IS DISTINCT FROM entity OR document->>'workspaceId' IS DISTINCT FROM portal::text
    OR jsonb_typeof(p_change->'expected') NOT IN ('number','null') OR NOT p_change ? 'expected' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF kind='policy' AND NOT core.reporter_memory_is_admin(portal) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF kind IN ('selection','use') AND NOT core.reporter_memory_visible(portal,document->>'productionId') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF kind='evidence' AND ((document->>'kind') IN ('citation','statistic')) IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  PERFORM core.reporter_memory_lock(portal);
  SELECT * INTO previous FROM public.reporter_memory_heads WHERE portal_id=portal AND reporter_memory_heads.kind=kind AND id=entity;
  expected:=(p_change->>'expected')::integer;
  IF previous.id IS NULL AND expected IS NOT NULL OR previous.id IS NOT NULL AND (expected IS DISTINCT FROM previous.storage_revision OR kind IN ('decision','use')) THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF previous.id IS NOT NULL AND NOT core.reporter_memory_visible(portal,previous.origin_production_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF kind IN ('evidence','job','block','check','decision','use') THEN
    SELECT * INTO parent FROM public.reporter_memory_heads WHERE portal_id=portal AND reporter_memory_heads.kind=p_change->>'parentKind' AND id=p_change->>'parentId';
    IF parent.id IS NULL OR NOT core.reporter_memory_visible(portal,parent.origin_production_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
    source_id:=parent.source_id;production_id:=parent.origin_production_id;
  ELSIF kind='material' THEN
    source_id:=p_change->>'sourceId';production_id:=p_change->>'productionId';
    IF NOT core.reporter_memory_source_visible(portal,source_id,production_id) OR NOT EXISTS(SELECT FROM public.reporter_ed_sources s WHERE s.portal_id=portal AND s.source_id=source_id
      AND EXISTS(SELECT FROM jsonb_array_elements(s.doc->'versions') v WHERE v->>'number'=document->'source'->>'sourceVersion' AND v->>'hash'=document->'source'->>'hash'))
      OR document->'source'->>'sourceId' IS DISTINCT FROM source_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  END IF;
  IF previous.id IS NOT NULL AND (previous.source_id IS DISTINCT FROM source_id OR previous.parent_kind IS DISTINCT FROM p_change->>'parentKind'
    OR previous.parent_id IS DISTINCT FROM p_change->>'parentId' OR kind='evidence' AND previous.doc->'anchor' IS DISTINCT FROM document->'anchor') THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF kind='evidence' AND (document->>'materialId' IS DISTINCT FROM parent.id OR document->'anchor'->'source'->>'sourceId' IS DISTINCT FROM source_id
    OR NOT core.reporter_memory_anchor(portal,document->'anchor') OR document->>'kind'='citation' AND document->>'text' IS DISTINCT FROM document->'anchor'->>'excerpt'
    OR document->>'kind'='statistic' AND ((position(nullif(document->'value'->>'raw','') IN document->'anchor'->>'excerpt') IS NULL
      OR position(nullif(document->'value'->>'raw','') IN document->'anchor'->>'excerpt')=0)
        AND NOT core.reporter_memory_market_cell(portal,document,'value',document->'value'->>'raw')
      OR (position(nullif(document->>'unit','') IN document->'anchor'->>'excerpt') IS NULL OR position(nullif(document->>'unit','') IN document->'anchor'->>'excerpt')=0)
        AND NOT core.reporter_memory_market_cell(portal,document,'unit',document->>'unit')))
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF kind IN ('check','decision','use') AND document->'evidence'->>'id' IS DISTINCT FROM parent.id THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF kind='check' AND entity IS DISTINCT FROM parent.id THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF kind='decision' THEN
    SELECT doc INTO latest_check FROM public.reporter_memory_heads WHERE portal_id=portal AND reporter_memory_heads.kind='check' AND parent_id=parent.id;
    SELECT coalesce(max((doc->>'sequence')::integer),0)+1 INTO next_decision FROM public.reporter_memory_heads WHERE portal_id=portal AND reporter_memory_heads.kind='decision' AND parent_id=parent.id;
    SELECT coalesce((SELECT (doc->>'revision')::integer FROM public.reporter_memory_heads WHERE portal_id=portal AND reporter_memory_heads.kind='policy' AND id='editorial-memory'),1) INTO policy_revision;
    IF document->'evidence'->>'hash' IS DISTINCT FROM parent.fingerprint OR document->'evidence'->'revision' IS DISTINCT FROM parent.doc->'revision'
      OR (document->>'sequence')::integer IS DISTINCT FROM next_decision OR (document->>'policyRevision')::integer IS DISTINCT FROM policy_revision
      OR latest_check IS NOT NULL AND (latest_check->'evidence'->>'hash' IS DISTINCT FROM parent.fingerprint OR latest_check->'evidence'->'revision' IS DISTINCT FROM parent.doc->'revision')
      OR document->'check' IS DISTINCT FROM (CASE WHEN latest_check IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('id',latest_check->>'id','revision',latest_check->'revision') END)
      OR length(btrim(coalesce(document->>'reason',''))) NOT BETWEEN 1 AND 2000 OR document->>'action' NOT IN ('accept','reject','request_revision') THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    IF document->>'action'='accept' AND (parent.doc->>'status'<>'active' OR parent.doc->>'kind'='citation' AND (parent.doc->>'authorConfirmed'<>'true' OR nullif(parent.doc->>'personId','') IS NULL)
      OR NOT EXISTS(SELECT FROM public.reporter_ed_sources s WHERE s.portal_id=portal AND s.source_id=source_id AND s.doc->'rights'->>'authorized'='true')) THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    document:=document||jsonb_build_object('personId',core.context_user_id(),'at',clock_timestamp());
  END IF;
  UPDATE public.reporter_memory_clock SET seq=seq+1 WHERE portal_id=portal RETURNING seq INTO next_seq;
  INSERT INTO public.reporter_memory_heads(portal_id,kind,id,storage_revision,doc,fingerprint,parent_kind,parent_id,source_id,origin_production_id,seq)
    VALUES(portal,kind,entity,coalesce(previous.storage_revision,-1)+1,document,p_change->>'fingerprint',p_change->>'parentKind',p_change->>'parentId',source_id,production_id,next_seq)
    ON CONFLICT ON CONSTRAINT reporter_memory_heads_pkey DO UPDATE SET storage_revision=excluded.storage_revision,doc=excluded.doc,fingerprint=excluded.fingerprint,
      parent_kind=excluded.parent_kind,parent_id=excluded.parent_id,source_id=excluded.source_id,origin_production_id=excluded.origin_production_id,seq=excluded.seq RETURNING * INTO saved;
  INSERT INTO public.reporter_memory_history(portal_id,kind,id,storage_revision,doc,fingerprint,parent_kind,parent_id,source_id,origin_production_id,seq)
    VALUES(saved.portal_id,saved.kind,saved.id,saved.storage_revision,saved.doc,saved.fingerprint,saved.parent_kind,saved.parent_id,saved.source_id,saved.origin_production_id,saved.seq);
  IF kind='decision' THEN
    INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,after_data,source,request_id,correlation_id)
      VALUES(portal,core.context_user_id(),'memory.evidence.'||(document->>'action'),'memory_decision',document,'reporter_ai',
        nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  END IF;
  RETURN to_jsonb(saved)-'portal_id';
END $$;

CREATE OR REPLACE FUNCTION public.reporter_memory_correct(p_id text,p_expected integer,p_doc jsonb,p_hash text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); previous public.reporter_memory_heads; saved jsonb;
  allowed text[]; document jsonb; person text;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit');
  SELECT * INTO previous FROM public.reporter_memory_heads h WHERE h.portal_id=portal AND h.kind='evidence' AND h.id=p_id;
  IF previous.id IS NULL OR NOT core.reporter_memory_doc_visible(portal,'evidence',previous.doc,previous.origin_production_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_expected IS DISTINCT FROM previous.storage_revision OR (p_doc->>'revision')::integer IS DISTINCT FROM (previous.doc->>'revision')::integer+1 THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF jsonb_typeof(p_doc) IS DISTINCT FROM 'object' OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  allowed:=ARRAY['revision','updatedAt','metadata','correction']||CASE WHEN previous.doc->>'kind'='citation' THEN ARRAY['personId','authorConfirmed']
    ELSE ARRAY['indicator','value','unit','period','geography','population','qualifier','issuingInstitution','declaringPersonId'] END;
  IF (p_doc-allowed) IS DISTINCT FROM (previous.doc-allowed) THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  person:=CASE WHEN previous.doc->>'kind'='citation' THEN p_doc->>'personId' ELSE p_doc->>'declaringPersonId' END;
  IF person IS NOT NULL AND NOT EXISTS(SELECT FROM public.reporter_ed_items h WHERE h.portal_id=portal AND h.kind='person' AND h.item_id=person AND NOT h.deleted)
    OR previous.doc->>'kind'='citation' AND p_doc->>'authorConfirmed'='true' AND person IS NULL
    OR previous.doc->>'kind'='statistic' AND p_doc->>'qualifier' IS NOT NULL AND position(p_doc->>'qualifier' IN p_doc->'anchor'->>'excerpt')=0 AND NOT core.reporter_memory_market_cell(portal,p_doc,'qualifier',p_doc->>'qualifier')
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  document:=p_doc||jsonb_build_object('updatedAt',clock_timestamp(),'correction',jsonb_build_object('reason',btrim(p_reason),'personId',core.context_user_id(),'at',clock_timestamp()));
  saved:=public.reporter_memory_put(jsonb_build_object('kind','evidence','id',p_id,'expected',p_expected,'doc',document,'fingerprint',p_hash,
    'parentKind',previous.parent_kind,'parentId',previous.parent_id));
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,before_data,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.evidence.correct','memory_evidence',previous.doc,saved->'doc','reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN saved;
END $$;
ALTER FUNCTION public.reporter_memory_correct(text,integer,jsonb,text,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_correct(text,integer,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_correct(text,integer,jsonb,text,text) TO reporter_runtime,reporter_worker;
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
      OR evidence->'market'->'mapping' IS DISTINCT FROM plan->'mapping'
      OR length(coalesce(evidence->'anchor'->>'excerpt','')) NOT BETWEEN 1 AND 2000
      OR EXISTS(SELECT FROM jsonb_each(evidence->'market'->'fields') f WHERE nullif(f.value->>'value','') IS NOT NULL
        AND position(f.value->>'value' IN evidence->'anchor'->>'excerpt')=0
        AND NOT core.reporter_memory_market_cell(portal,evidence,f.key,f.value->>'value'))
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
CREATE OR REPLACE FUNCTION core.reporter_memory_market_binding_context(p_evidence jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(jsonb_object_agg(f.key,f.value->'value'),'{}'::jsonb)
  FROM jsonb_each(coalesce(p_evidence->'market'->'fields','{}'::jsonb)) f
  WHERE (f.value->>'record'='1' AND p_evidence->'market'->'mapping'->f.key->>'record'='header'
    OR f.value->>'record'=p_evidence->'market'->>'record' AND p_evidence->'market'->'mapping'->f.key->>'record'='row'
      AND position(f.value->>'value' IN p_evidence->'anchor'->>'excerpt')=0)
    AND nullif(f.value->>'value','') IS NOT NULL
    AND f.value->>'value'=CASE f.key WHEN 'indicator' THEN p_evidence->>'indicator' WHEN 'value' THEN p_evidence->'value'->>'raw'
      WHEN 'unit' THEN p_evidence->>'unit' WHEN 'period' THEN p_evidence->'period'->>'label' WHEN 'geography' THEN p_evidence->>'geography'
      WHEN 'population' THEN p_evidence->>'population' WHEN 'qualifier' THEN p_evidence->>'qualifier' WHEN 'institution' THEN p_evidence->>'issuingInstitution' END
$$;
ALTER FUNCTION core.reporter_memory_market_binding_context(jsonb) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_memory_market_binding_context(jsonb) FROM PUBLIC;
COMMIT;
