-- Approved uses are derived from a real immutable article decision in its transaction.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_memory_approved_version(p_production text,p_version text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); result jsonb;
BEGIN
  IF NOT core.reporter_memory_visible(portal,p_production) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT v.doc INTO result FROM public.reporter_ed_parts v WHERE v.portal_id=portal AND v.production_id=p_production
    AND v.kind='version' AND v.part_id=p_version AND NOT v.deleted AND v.doc->'body'->>'type'='article'
    AND EXISTS(SELECT FROM public.reporter_ed_parts d WHERE d.portal_id=v.portal_id AND d.production_id=v.production_id
      AND d.kind='decision' AND NOT d.deleted AND d.doc->>'decision'='approved' AND d.doc->>'gate'='article.approval'
      AND d.doc->'subject'=jsonb_build_object('kind','version','pieceId',v.doc->>'pieceId','versionId',v.doc->>'id','number',v.doc->'number','hash',v.doc->>'hash'));
  RETURN result;
END $$;
ALTER FUNCTION public.reporter_memory_approved_version(text,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_approved_version(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_approved_version(text,text) TO reporter_runtime;
CREATE OR REPLACE FUNCTION public.reporter_memory_record_approval(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); production jsonb; decision_doc jsonb; approved_version jsonb; article_ref jsonb;
  body jsonb; block jsonb; original jsonb; receipt jsonb; binding jsonb; segment jsonb; selected jsonb;
  evidence public.reporter_memory_history; literal text; actual text; document jsonb; use_id text; existing jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit');
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_input) key WHERE key NOT IN
    ('productionId','decisionId','article','blockId','from','to','source')) OR jsonb_typeof(p_input->'article') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_input->'source') IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_input->'source') key
      WHERE key NOT IN ('id','version','segmentId','from','to'))
    OR jsonb_typeof(p_input->'from') IS DISTINCT FROM 'number' OR jsonb_typeof(p_input->'to') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_input->'source'->'version') IS DISTINCT FROM 'number' OR jsonb_typeof(p_input->'source'->'from') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_input->'source'->'to') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  SELECT doc INTO production FROM public.reporter_ed_productions WHERE portal_id=portal AND production_id=p_input->>'productionId';
  IF production IS NULL OR NOT core.reporter_memory_visible(portal,p_input->>'productionId') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT doc INTO decision_doc FROM public.reporter_ed_parts WHERE portal_id=portal AND production_id=p_input->>'productionId'
    AND kind='decision' AND part_id=p_input->>'decisionId' AND NOT deleted;
  SELECT doc INTO approved_version FROM public.reporter_ed_parts WHERE portal_id=portal AND production_id=p_input->>'productionId'
    AND kind='version' AND part_id=p_input->'article'->>'versionId' AND NOT deleted;
  IF decision_doc IS NULL OR decision_doc->>'decision' IS DISTINCT FROM 'approved' OR decision_doc->>'gate' IS DISTINCT FROM 'article.approval'
    OR approved_version IS NULL OR approved_version->'body'->>'type' IS DISTINCT FROM 'article' THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF decision_doc->>'by' IS DISTINCT FROM core.context_user_id()::text THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  article_ref:=jsonb_build_object('kind','version','pieceId',approved_version->>'pieceId','versionId',approved_version->>'id',
    'number',approved_version->'number','hash',approved_version->>'hash');
  IF p_input->'article' IS DISTINCT FROM article_ref OR decision_doc->'subject' IS DISTINCT FROM article_ref THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  body:=approved_version->'body';
  SELECT value INTO block FROM jsonb_array_elements(body->'blocks') WHERE value->>'id'=p_input->>'blockId';
  SELECT doc INTO original FROM public.reporter_ed_sources WHERE portal_id=portal AND source_id=p_input->'source'->>'id' AND production->'sourceIds' ? source_id;
  SELECT value INTO receipt FROM jsonb_array_elements(original->'memory') WHERE value->'version'->'number'=p_input->'source'->'version';
  SELECT value INTO binding FROM jsonb_array_elements(receipt->'items') WHERE value->>'segmentId'=p_input->'source'->>'segmentId';
  SELECT s INTO segment FROM jsonb_array_elements(original->'versions') v CROSS JOIN LATERAL jsonb_array_elements(v->'content'->'segments') s
    WHERE v->'number'=receipt->'version'->'number' AND v->>'hash'=receipt->'version'->>'hash' AND s->>'id'=binding->>'segmentId';
  SELECT h.doc INTO selected FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='selection' AND h.id=receipt->'selection'->>'id'
    AND h.doc->'revision'=receipt->'selection'->'revision' ORDER BY seq DESC LIMIT 1;
  SELECT * INTO evidence FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='evidence' AND h.id=binding->'selected'->'evidence'->>'id'
    AND h.fingerprint=binding->'selected'->'evidence'->>'hash' AND h.doc->'revision'=binding->'selected'->'evidence'->'revision' ORDER BY seq DESC LIMIT 1;
  IF block IS NULL OR binding IS NULL OR segment IS NULL OR selected IS NULL OR evidence.id IS NULL OR evidence.doc->'anchor' IS DISTINCT FROM binding->'anchor'
    OR NOT selected->'items' @> jsonb_build_array(binding->'selected') OR NOT core.reporter_memory_doc_visible(portal,'selection',selected,NULL)
    OR segment->>'text' IS DISTINCT FROM binding->'anchor'->>'excerpt' OR NOT EXISTS(SELECT FROM jsonb_array_elements(block->'sourceRefs') ref
      WHERE ref->>'sourceId'=original->>'id' AND ref->'sourceVersion'=receipt->'version'->'number' AND ref->'locator'->>'type'='segment'
        AND ref->'locator'->>'segmentId'=binding->>'segmentId'
        AND (binding->>'kind'='statistic' OR coalesce((ref->'locator'->>'from')::integer,0)=(p_input->'source'->>'from')::integer
          AND coalesce((ref->'locator'->>'to')::integer,core.reporter_memory_utf16_length(segment->>'text'))=(p_input->'source'->>'to')::integer))
    THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  literal:=core.reporter_memory_utf16_slice(segment->>'text',(p_input->'source'->>'from')::integer,(p_input->'source'->>'to')::integer);
  actual:=core.reporter_memory_utf16_slice(core.reporter_memory_block_text(block),(p_input->>'from')::integer,(p_input->>'to')::integer);
  IF literal IS NULL OR length(btrim(literal))=0 OR literal IS DISTINCT FROM actual OR binding->>'kind'='statistic' AND literal IS DISTINCT FROM binding->'anchor'->>'excerpt' THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  use_id:='memory-approved-'||md5(jsonb_build_array(decision_doc->>'id',article_ref,p_input->>'blockId',(p_input->>'from')::integer,
    (p_input->>'to')::integer,original->>'id',(receipt->'version'->>'number')::integer,binding->>'segmentId',
    (p_input->'source'->>'from')::integer,(p_input->'source'->>'to')::integer,binding->'selected'->'evidence')::text);
  existing:=public.reporter_memory_get('use',use_id);
  IF existing IS NOT NULL THEN RETURN existing->'doc'; END IF;
  document:=jsonb_build_object('id',use_id,'workspaceId',portal,'stage','approved','productionId',p_input->>'productionId',
    'article',article_ref,'decisionId',decision_doc->>'id','productionTitle',production->>'title','blockId',p_input->>'blockId','from',(p_input->>'from')::integer,'to',(p_input->>'to')::integer,
    'evidence',binding->'selected'->'evidence','sourceRange',jsonb_build_object('from',(p_input->'source'->>'from')::integer,'to',(p_input->'source'->>'to')::integer),
    'personId',decision_doc->>'by','at',decision_doc->>'at','proof',jsonb_build_object('selection',receipt->'selection','selected',binding->'selected',
      'anchor',binding->'anchor','source',jsonb_build_object('kind','source-version','sourceId',original->>'id','sourceVersion',receipt->'version'->'number',
        'hash',receipt->'version'->>'hash'),'segmentId',binding->>'segmentId'));
  PERFORM public.reporter_memory_put(jsonb_build_object('kind','use','id',use_id,'expected',NULL,'doc',document,'parentKind','evidence','parentId',evidence.id));
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,after_data,source,request_id)
    VALUES(portal,core.context_user_id(),'memory.use.approved','memory_use',document,'reporter_ai',nullif(current_setting('app.request_id',true),'')::uuid);
  RETURN document;
END $$;
ALTER FUNCTION public.reporter_memory_record_approval(jsonb) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_record_approval(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_record_approval(jsonb) TO reporter_runtime;
COMMIT;
