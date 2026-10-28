-- Metadata corrections preserve literal/source identity and append authenticated audit provenance.
BEGIN;
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
    OR previous.doc->>'kind'='statistic' AND p_doc->>'qualifier' IS NOT NULL AND position(p_doc->>'qualifier' IN p_doc->'anchor'->>'excerpt')=0
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
COMMIT;
