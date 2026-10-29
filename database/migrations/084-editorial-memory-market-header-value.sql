-- Permit an explicitly mapped numeric value in a separately verified header cell.
BEGIN;
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
        AND NOT core.reporter_memory_market_header(portal,document,'value',document->'value'->>'raw')
      OR (position(nullif(document->>'unit','') IN document->'anchor'->>'excerpt') IS NULL OR position(nullif(document->>'unit','') IN document->'anchor'->>'excerpt')=0)
        AND NOT core.reporter_memory_market_header(portal,document,'unit',document->>'unit')))
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

COMMIT;
