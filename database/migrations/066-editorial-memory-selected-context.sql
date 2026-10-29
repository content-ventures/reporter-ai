-- Read-only origin/proof for an exact collection item, with current visibility on every read.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_memory_selected_context(p_production text,p_source text,p_version integer,p_segment text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); collection jsonb; version jsonb; receipt jsonb; item jsonb;
  selection public.reporter_memory_history; evidence public.reporter_memory_history; material jsonb; checked jsonb; decided jsonb; policy jsonb; original jsonb;
BEGIN
  IF p_version IS NULL OR p_version<1 OR nullif(p_segment,'') IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT FROM public.reporter_ed_productions p WHERE p.portal_id=portal AND p.production_id=p_production
    AND p_source=ANY(p.source_ids) AND core.reporter_memory_visible(portal,p.production_id)) THEN RETURN NULL; END IF;
  SELECT s.doc INTO collection FROM public.reporter_ed_sources s WHERE s.portal_id=portal AND s.source_id=p_source;
  SELECT v INTO version FROM jsonb_array_elements(collection->'versions') v WHERE v->>'number'=p_version::text;
  SELECT r INTO receipt FROM jsonb_array_elements(collection->'memory') r WHERE r->'version'->>'number'=p_version::text AND r->'version'->>'hash'=version->>'hash';
  SELECT i INTO item FROM jsonb_array_elements(receipt->'items') i WHERE i->>'segmentId'=p_segment;
  IF item IS NULL OR receipt->>'retired'='true' THEN RETURN NULL; END IF;
  SELECT * INTO selection FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='selection' AND h.id=receipt->'selection'->>'id'
    AND h.doc->'revision'=receipt->'selection'->'revision' ORDER BY h.seq DESC LIMIT 1;
  IF selection.id IS NULL OR NOT core.reporter_memory_doc_visible(portal,'selection',selection.doc,selection.origin_production_id)
    OR public.reporter_memory_get('selection',selection.id) IS NULL OR NOT selection.doc->'items' @> jsonb_build_array(item->'selected') THEN RETURN NULL; END IF;
  IF public.reporter_memory_get('evidence',item->'selected'->'evidence'->>'id') IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO evidence FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='evidence' AND h.id=item->'selected'->'evidence'->>'id'
    AND h.fingerprint=item->'selected'->'evidence'->>'hash' AND h.doc->'revision'=item->'selected'->'evidence'->'revision'
    AND h.seq<=selection.seq ORDER BY h.seq DESC LIMIT 1;
  IF evidence.id IS NULL OR NOT core.reporter_memory_doc_visible(portal,'evidence',evidence.doc,evidence.origin_production_id)
    OR NOT core.reporter_memory_source_visible(portal,evidence.source_id,evidence.origin_production_id)
    OR evidence.doc->'anchor' IS DISTINCT FROM item->'anchor' OR evidence.doc->>'kind' IS DISTINCT FROM item->>'kind'
    OR evidence.parent_id IS DISTINCT FROM item->>'materialId' THEN RETURN NULL; END IF;
  SELECT h.doc INTO material FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='material' AND h.id=evidence.parent_id
    AND h.seq<=selection.seq AND core.reporter_memory_doc_visible(portal,h.kind,h.doc,h.origin_production_id) ORDER BY h.seq DESC LIMIT 1;
  IF material IS NULL OR public.reporter_memory_get('material',evidence.parent_id) IS NULL THEN RETURN NULL; END IF;
  SELECT s.doc INTO original FROM public.reporter_ed_sources s WHERE s.portal_id=portal AND s.source_id=evidence.source_id;
  original:=original||jsonb_build_object('versions',(SELECT jsonb_agg(v) FROM jsonb_array_elements(original->'versions') v
    WHERE v->'number'=item->'anchor'->'source'->'sourceVersion' AND v->>'hash'=item->'anchor'->'source'->>'hash'));
  IF original IS NULL OR coalesce(jsonb_array_length(original->'versions'),0)<>1 THEN RETURN NULL; END IF;
  SELECT h.doc INTO checked FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='check' AND h.parent_id=evidence.id
    AND h.id=item->'selected'->'check'->>'id' AND h.doc->'revision'=item->'selected'->'check'->'revision' AND h.seq<=selection.seq
    AND h.doc->'evidence'=item->'selected'->'evidence' AND h.doc->'policyRevision'=item->'selected'->'policyRevision'
    AND core.reporter_memory_doc_visible(portal,h.kind,h.doc,h.origin_production_id) ORDER BY h.seq DESC LIMIT 1;
  SELECT h.doc INTO decided FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='decision' AND h.parent_id=evidence.id
    AND h.id=item->'selected'->>'decisionId' AND h.seq<=selection.seq AND h.doc->'evidence'=item->'selected'->'evidence'
    AND h.doc->'policyRevision'=item->'selected'->'policyRevision' AND h.doc->'check'=item->'selected'->'check'
    AND core.reporter_memory_doc_visible(portal,h.kind,h.doc,h.origin_production_id) ORDER BY h.seq DESC LIMIT 1;
  SELECT h.doc INTO policy FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='policy' AND h.id='editorial-memory'
    AND h.doc->'revision'=item->'selected'->'policyRevision' AND h.seq<=selection.seq ORDER BY h.seq DESC LIMIT 1;
  RETURN jsonb_build_object('binding',item,'selection',selection.doc,'snapshot',selection.seq::text,'evidence',evidence.doc,'material',material,'source',original,
    'check',checked,'decision',decided,'policy',policy,
    'checkRestricted',item->'selected'->>'check' IS NOT NULL AND checked IS NULL,
    'decisionRestricted',item->'selected'->>'decisionId' IS NOT NULL AND decided IS NULL);
END $$;
ALTER FUNCTION public.reporter_memory_selected_context(text,text,integer,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_selected_context(text,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_selected_context(text,text,integer,text) TO reporter_runtime,reporter_worker;
COMMIT;
