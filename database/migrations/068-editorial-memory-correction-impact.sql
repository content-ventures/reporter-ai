-- Current affected selections and attached/draft references; immutable articles are never read or rewritten.
BEGIN;
CREATE INDEX IF NOT EXISTS reporter_memory_selection_items ON public.reporter_memory_heads USING gin((doc->'items') jsonb_path_ops) WHERE kind='selection';
CREATE INDEX IF NOT EXISTS reporter_memory_source_bindings ON public.reporter_ed_sources USING gin((doc->'memory') jsonb_path_ops) WHERE doc ? 'memory';
CREATE OR REPLACE FUNCTION public.reporter_memory_correction_impact(p_kind text,p_id text,p_snapshot bigint,p_after jsonb,p_limit integer,p_visibility text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); context jsonb:=public.reporter_memory_context(); root jsonb; material_id text; result jsonb;
  editorial_seq text:=coalesce((SELECT seq FROM public.reporter_ed_sync WHERE portal_id=portal),0)::text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('material','evidence') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR p_after IS NOT NULL AND (coalesce(p_after->>'key','') !~ '^[0-9]{1,19}:(production|selection)$' OR nullif(p_after->>'id','') IS NULL)
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  root:=public.reporter_memory_get(p_kind,p_id);
  IF root IS NULL THEN RETURN NULL; END IF;
  material_id:=CASE WHEN p_kind='material' THEN p_id ELSE root->'doc'->>'materialId' END;
  IF public.reporter_memory_get('material',material_id) IS NULL THEN RETURN NULL; END IF;
  -- Pages describe current drafts, so both ledgers must remain unchanged throughout a sequence.
  IF p_visibility IS DISTINCT FROM context->>'visibility' OR p_snapshot IS DISTINCT FROM (context->>'snapshot')::bigint
    OR p_after IS NOT NULL AND split_part(p_after->>'key',':',1) IS DISTINCT FROM editorial_seq THEN RAISE EXCEPTION 'MEMORY_CURSOR_INVALID'; END IF;
  WITH evidence AS MATERIALIZED (
    SELECT id,doc,fingerprint FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='evidence' AND parent_id=material_id
      AND (p_kind='material' OR id=p_id) AND core.reporter_memory_doc_visible(portal,kind,doc,origin_production_id)
  ), changed_selections AS MATERIALIZED (
    SELECT s.id,s.doc,count(DISTINCT e.id)::integer AS changed FROM evidence e
    JOIN public.reporter_memory_heads s ON s.portal_id=portal AND s.kind='selection'
      AND s.doc->'items' @> jsonb_build_array(jsonb_build_object('evidence',jsonb_build_object('id',e.id)))
    CROSS JOIN LATERAL jsonb_array_elements(s.doc->'items') item
    WHERE item->'evidence'->>'id'=e.id AND core.reporter_memory_doc_visible(portal,'selection',s.doc,s.origin_production_id)
      AND (item->'evidence' IS DISTINCT FROM jsonb_build_object('id',e.id,'revision',e.doc->'revision','hash',e.fingerprint) OR e.doc->>'status'<>'active')
    GROUP BY s.id,s.doc
  ), changed_bindings AS MATERIALIZED (
    SELECT s.source_id,receipt->'version'->>'number' AS version,binding->>'segmentId' AS segment_id,e.id AS evidence_id,
      receipt->'version'->'number'=s.doc->'versions'->-1->'number' AND receipt->'version'->>'hash'=s.doc->'versions'->-1->>'hash' AS latest
    FROM public.reporter_ed_sources s CROSS JOIN LATERAL jsonb_array_elements(s.doc->'memory') receipt
    CROSS JOIN LATERAL jsonb_array_elements(receipt->'items') binding JOIN evidence e ON binding->'selected'->'evidence'->>'id'=e.id
    WHERE s.portal_id=portal AND s.doc ? 'memory' AND s.doc->'memory' @> jsonb_build_array(jsonb_build_object('items',jsonb_build_array(jsonb_build_object('materialId',material_id))))
      AND receipt->>'retired' IS DISTINCT FROM 'true'
      AND (binding->'selected'->'evidence' IS DISTINCT FROM jsonb_build_object('id',e.id,'revision',e.doc->'revision','hash',e.fingerprint) OR e.doc->>'status'<>'active')
  ), productions AS MATERIALIZED (
    SELECT DISTINCT p.production_id,p.doc,p.source_ids FROM (SELECT DISTINCT source_id FROM changed_bindings) s
    JOIN public.reporter_ed_productions p ON p.portal_id=portal AND p.source_ids @> ARRAY[s.source_id]
    WHERE NOT p.archived AND core.reporter_memory_visible(portal,p.production_id)
  ), draft_refs AS MATERIALIZED (
    SELECT DISTINCT p.production_id,ref->>'sourceId' AS source_id,ref->>'sourceVersion' AS version,ref->'locator'->>'segmentId' AS segment_id
    FROM productions p JOIN public.reporter_ed_parts part ON part.portal_id=portal AND part.production_id=p.production_id AND part.kind='piece' AND NOT part.deleted
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(part.doc->'draft'->'body'->'blocks','[]')) block
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(block->'sourceRefs','[]')) ref
    WHERE part.doc->>'kind'='article' AND ref->'locator'->>'type'='segment'
  ), changed_productions AS (
    SELECT p.production_id AS id,p.doc,count(DISTINCT b.evidence_id) FILTER(WHERE b.latest)::integer AS selected,
      count(DISTINCT b.evidence_id) FILTER(WHERE r.source_id IS NOT NULL)::integer AS draft
    FROM productions p JOIN changed_bindings b ON p.source_ids @> ARRAY[b.source_id]
    LEFT JOIN draft_refs r ON r.production_id=p.production_id AND r.source_id=b.source_id AND r.version=b.version AND r.segment_id=b.segment_id
    GROUP BY p.production_id,p.doc
  ), targets AS MATERIALIZED (
    SELECT 'selection' AS kind,id,jsonb_build_object('kind','selection','id',id,'revision',doc->'revision','productionId',doc->'productionId',
      'totalEvidence',jsonb_array_length(doc->'items'),'changedEvidence',changed,'updatedAt',doc->>'updatedAt') AS doc FROM changed_selections
    UNION ALL SELECT 'production',id,jsonb_build_object('kind','production','id',id,'title',doc->>'title','updatedAt',doc->>'updatedAt',
      'selectedEvidence',selected,'draftEvidence',draft) FROM changed_productions WHERE selected>0 OR draft>0
  ), page AS MATERIALIZED (
    SELECT * FROM targets WHERE p_after IS NULL OR (kind,id)>(split_part(p_after->>'key',':',2),p_after->>'id') ORDER BY kind,id LIMIT p_limit
  ), last_item AS (SELECT * FROM page ORDER BY kind DESC,id DESC LIMIT 1)
  SELECT jsonb_build_object('scope',jsonb_build_object('kind',p_kind,'id',p_id),'currentRevision',root->'doc'->'revision','materialId',material_id,
    'items',coalesce((SELECT jsonb_agg(doc ORDER BY kind,id) FROM page),'[]'),'total',(SELECT count(*) FROM targets),'snapshot',p_snapshot::text,
    'next',CASE WHEN EXISTS(SELECT FROM targets t,last_item last WHERE (t.kind,t.id)>(last.kind,last.id))
      THEN (SELECT jsonb_build_object('key',editorial_seq||':'||kind,'id',id) FROM last_item) ELSE NULL END) INTO result;
  RETURN result;
END $$;
ALTER FUNCTION public.reporter_memory_correction_impact(text,text,bigint,jsonb,integer,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_correction_impact(text,text,bigint,jsonb,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_correction_impact(text,text,bigint,jsonb,integer,text) TO reporter_runtime,reporter_worker;
COMMIT;
