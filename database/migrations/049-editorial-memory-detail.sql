-- Evidence details and independently paginated immutable history share one observed snapshot.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_memory_detail(p_id text,p_snapshot bigint,p_visibility text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); context jsonb:=public.reporter_memory_context();
  evidence public.reporter_memory_history; material jsonb; checked public.reporter_memory_history;
  decision public.reporter_memory_history; policy jsonb; current_check boolean; check_visible boolean; counts jsonb;
BEGIN
  IF p_visibility IS DISTINCT FROM context->>'visibility' THEN RAISE EXCEPTION 'MEMORY_CURSOR_INVALID'; END IF;
  IF p_snapshot IS NULL OR p_snapshot<0 OR p_snapshot>(context->>'snapshot')::bigint THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  SELECT * INTO evidence FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='evidence' AND h.id=p_id AND h.seq<=p_snapshot ORDER BY h.seq DESC LIMIT 1;
  IF evidence.id IS NULL OR NOT core.reporter_memory_doc_visible(portal,'evidence',evidence.doc,evidence.origin_production_id) THEN RETURN NULL; END IF;
  SELECT h.doc INTO material FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='material' AND h.id=evidence.parent_id
    AND h.seq<=p_snapshot AND core.reporter_memory_doc_visible(portal,h.kind,h.doc,h.origin_production_id) ORDER BY h.seq DESC LIMIT 1;
  IF material IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO checked FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='check' AND h.parent_id=p_id AND h.seq<=p_snapshot ORDER BY h.seq DESC LIMIT 1;
  SELECT * INTO decision FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='decision' AND h.parent_id=p_id AND h.seq<=p_snapshot ORDER BY h.seq DESC LIMIT 1;
  SELECT h.doc INTO policy FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='policy' AND h.id='editorial-memory' AND h.seq<=p_snapshot ORDER BY h.seq DESC LIMIT 1;
  check_visible:=checked.id IS NOT NULL AND core.reporter_memory_doc_visible(portal,'check',checked.doc,checked.origin_production_id);
  current_check:=checked.doc->'evidence'->>'hash'=evidence.fingerprint AND checked.doc->'evidence'->'revision'=evidence.doc->'revision'
    AND (checked.doc->>'policyRevision')::integer=coalesce((policy->>'revision')::integer,1);
  SELECT jsonb_build_object(
    'selected',count(DISTINCT coalesce(h.doc->>'productionId',h.doc->>'selectionId')) FILTER(WHERE h.doc->>'stage'='selected'),
    'inserted',count(DISTINCT h.doc->>'productionId') FILTER(WHERE h.doc->>'stage'='inserted'),
    'approved',count(DISTINCT h.doc->>'productionId') FILTER(WHERE h.doc->>'stage'='approved'),
    'published',count(DISTINCT h.doc->>'productionId') FILTER(WHERE h.doc->>'stage'='published')) INTO counts
    FROM public.reporter_memory_heads h WHERE h.portal_id=portal AND h.kind='use' AND h.parent_id=p_id AND h.seq<=p_snapshot
      AND core.reporter_memory_doc_visible(portal,h.kind,h.doc,h.origin_production_id);
  RETURN jsonb_build_object('evidence',evidence.doc,'material',material,'policy',policy,'uses',counts,'relevance',NULL,
    'source',core.reporter_memory_fragment(portal,evidence.doc->'anchor'),
    'check',CASE WHEN check_visible AND current_check THEN checked.doc END,
    'checkState',CASE WHEN checked.id IS NULL THEN 'missing' WHEN NOT check_visible THEN 'restricted' WHEN current_check THEN 'current' ELSE 'outdated' END,
    'decision',CASE WHEN decision.id IS NOT NULL AND core.reporter_memory_doc_visible(portal,'decision',decision.doc,decision.origin_production_id) THEN decision.doc END,
    'reviewRestricted',decision.id IS NOT NULL AND NOT core.reporter_memory_doc_visible(portal,'decision',decision.doc,decision.origin_production_id));
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_history(p_id text,p_kind text,p_snapshot bigint,p_after bigint,p_limit integer,p_visibility text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); context jsonb:=public.reporter_memory_context(); result jsonb;
BEGIN
  IF p_visibility IS DISTINCT FROM context->>'visibility' THEN RAISE EXCEPTION 'MEMORY_CURSOR_INVALID'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('checks','decisions','revisions','occurrences') OR p_snapshot IS NULL OR p_snapshot<0
    OR p_snapshot>(context->>'snapshot')::bigint OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR p_after IS NOT NULL AND p_after<0 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF public.reporter_memory_get('evidence',p_id) IS NULL THEN RETURN NULL; END IF;
  WITH records AS MATERIALIZED (
    SELECT h.id,h.seq,h.doc FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.seq<=p_snapshot
      AND h.kind=CASE p_kind WHEN 'checks' THEN 'check' WHEN 'decisions' THEN 'decision' WHEN 'revisions' THEN 'evidence' ELSE 'use' END
      AND (CASE WHEN p_kind='revisions' THEN h.id=p_id ELSE h.parent_kind='evidence' AND h.parent_id=p_id END)
      AND core.reporter_memory_doc_visible(portal,h.kind,h.doc,h.origin_production_id)
  ), page AS (SELECT * FROM records WHERE p_after IS NULL OR seq<p_after ORDER BY seq DESC LIMIT p_limit+1),
  shown AS (SELECT * FROM page ORDER BY seq DESC LIMIT p_limit)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(doc ORDER BY seq DESC) FROM shown),'[]'),
    'total',(SELECT count(*) FROM records),'snapshot',p_snapshot::text,
    'next',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT jsonb_build_object('key',seq::text,'id',id) FROM shown ORDER BY seq LIMIT 1) END) INTO result;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_support(p_ref jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); result jsonb;
BEGIN
  SELECT jsonb_build_object('evidence',h.doc,'primaryOrigin',m.doc->>'primaryOrigin') INTO result
    FROM public.reporter_memory_history h JOIN public.reporter_memory_heads m ON m.portal_id=h.portal_id AND m.kind='material' AND m.id=h.parent_id
    WHERE h.portal_id=portal AND h.kind='evidence' AND h.id=p_ref->>'id' AND h.fingerprint=p_ref->>'hash' AND h.doc->'revision'=p_ref->'revision'
      AND core.reporter_memory_doc_visible(portal,h.kind,h.doc,h.origin_production_id)
      AND core.reporter_memory_doc_visible(portal,m.kind,m.doc,m.origin_production_id) ORDER BY h.seq DESC LIMIT 1;
  RETURN result;
END $$;
CREATE INDEX IF NOT EXISTS reporter_memory_history_parent ON public.reporter_memory_history(portal_id,parent_kind,parent_id,kind,seq DESC);
DO $$ DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['public.reporter_memory_detail(text,bigint,text)','public.reporter_memory_history(text,text,bigint,bigint,integer,text)','public.reporter_memory_support(jsonb)'] LOOP
    EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO reporter_executor'; EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO reporter_runtime,reporter_worker';
  END LOOP;
END $$;
COMMIT;
