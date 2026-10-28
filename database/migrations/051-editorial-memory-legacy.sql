-- Import existing curated citations without rewriting their original rows or legacy checks.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_memory_legacy_batch(p_after text,p_limit integer,p_ids text[] DEFAULT NULL,p_sources text[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR length(p_after)>128 OR cardinality(p_ids)>100 OR cardinality(p_sources)>100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  WITH candidates AS MATERIALIZED (
    SELECT c.item_id,c.doc FROM public.reporter_ed_items c WHERE c.portal_id=portal AND c.kind='citation' AND NOT c.deleted
      AND (p_ids IS NULL AND p_sources IS NULL OR c.item_id=ANY(p_ids) OR c.doc->'ref'->>'sourceId'=ANY(p_sources))
      AND (core.reporter_memory_visible(portal,c.doc->>'productionId') OR core.reporter_memory_is_admin(portal)
        AND NOT EXISTS(SELECT FROM public.reporter_ed_productions p WHERE p.portal_id=portal AND p.production_id=c.doc->>'productionId'))
  ), page AS (SELECT * FROM candidates WHERE p_after IS NULL OR item_id>p_after ORDER BY item_id LIMIT p_limit+1),
  shown AS (SELECT * FROM page ORDER BY item_id LIMIT p_limit)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object('citation',c.doc,
    'factCheck',(SELECT f.doc FROM public.reporter_ed_items f WHERE f.portal_id=portal AND f.kind='fact_check' AND f.item_id=c.item_id AND NOT f.deleted),
    'source',CASE WHEN c.doc->>'productionId' IS NOT NULL AND core.reporter_memory_source_visible(portal,c.doc->'ref'->>'sourceId',c.doc->>'productionId') THEN
      core.reporter_memory_fragment(portal,jsonb_build_object('source',jsonb_build_object('sourceId',c.doc->'ref'->>'sourceId',
        'sourceVersion',c.doc->'ref'->'sourceVersion','hash',c.doc->>'sourceHash'),
        'spans',jsonb_build_array(jsonb_build_object('segmentId',c.doc->'ref'->'locator'->>'segmentId')))) END) ORDER BY c.item_id) FROM shown c),'[]'),
    'total',(SELECT count(*) FROM candidates),'nextAfter',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT max(item_id) FROM shown) END) INTO result;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_legacy_save(p_change jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); original jsonb; previous jsonb; saved jsonb; document jsonb:=p_change->'doc';
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit');
  SELECT c.doc INTO original FROM public.reporter_ed_items c WHERE c.portal_id=portal AND c.kind='citation' AND c.item_id=p_change->>'id' AND NOT c.deleted;
  IF p_change->>'kind' IS DISTINCT FROM 'evidence' OR document->>'kind' IS DISTINCT FROM 'citation'
    OR original IS NULL OR document->>'legacyCitationId' IS DISTINCT FROM original->>'id' OR document->'legacy'->'citation' IS DISTINCT FROM original
    OR NOT core.reporter_memory_visible(portal,original->>'productionId')
    OR document->'legacy'->'factCheck' IS DISTINCT FROM coalesce((SELECT f.doc FROM public.reporter_ed_items f WHERE f.portal_id=portal AND f.kind='fact_check' AND f.item_id=original->>'id' AND NOT f.deleted),'null'::jsonb)
    OR (document->'legacy'->>'state' IN ('synchronized','conflict')) IS DISTINCT FROM true OR (document->'legacy'->>'mappedHash' ~ '^[a-f0-9]{16}$') IS DISTINCT FROM true
    OR NOT EXISTS(SELECT FROM public.reporter_memory_heads m WHERE m.portal_id=portal AND m.kind='material' AND m.id=p_change->>'parentId'
      AND m.origin_production_id=original->>'productionId' AND m.source_id=original->'ref'->>'sourceId')
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  SELECT h.doc INTO previous FROM public.reporter_memory_heads h WHERE h.portal_id=portal AND h.kind='evidence' AND h.id=p_change->>'id';
  document:=jsonb_set(document,'{legacy}',document->'legacy'||jsonb_build_object('importedAt',clock_timestamp(),'importedBy',core.context_user_id(),'reason',btrim(p_reason)));
  saved:=public.reporter_memory_put(p_change||jsonb_build_object('doc',document));
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,before_data,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.legacy.reconcile','memory_evidence',previous,saved->'doc','reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN saved;
END $$;
-- The actual row owner is authoritative; old pilot workspace aliases stay untouched in stored sources.
CREATE OR REPLACE FUNCTION core.reporter_memory_fragment(p_portal uuid,p_anchor jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT s.doc||jsonb_build_object('workspaceId',p_portal,'versions',coalesce((SELECT jsonb_agg(v||jsonb_build_object('content',v->'content'||jsonb_build_object(
    'segments',(SELECT jsonb_agg(segment ORDER BY ordinal) FROM jsonb_array_elements(v->'content'->'segments') WITH ORDINALITY segments(segment,ordinal)
      WHERE EXISTS(SELECT FROM jsonb_array_elements(p_anchor->'spans') span WHERE span->>'segmentId'=segment->>'id')))))
    FROM jsonb_array_elements(s.doc->'versions') v WHERE v->>'number'=p_anchor->'source'->>'sourceVersion' AND v->>'hash'=p_anchor->'source'->>'hash'),'[]'))
  FROM public.reporter_ed_sources s WHERE s.portal_id=p_portal AND s.source_id=p_anchor->'source'->>'sourceId'
$$;
DO $$ DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['public.reporter_memory_legacy_batch(text,integer,text[],text[])','public.reporter_memory_legacy_save(jsonb,text)'] LOOP
    EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO reporter_executor'; EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO reporter_runtime,reporter_worker';
  END LOOP;
END $$;
COMMIT;
