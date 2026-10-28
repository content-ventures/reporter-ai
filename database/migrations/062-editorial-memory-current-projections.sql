-- Retain optimized paginated reads, status selectors and distinct selection namespaces
-- while applying dependency freshness in both the shared reader and query filters.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_memory_query(p_query jsonb,p_snapshot bigint,p_after jsonb,p_visibility text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE v_portal uuid:=core.reporter_memory_portal('read'); v_context jsonb:=public.reporter_memory_context();
  v_limit integer:=coalesce((p_query->>'limit')::integer,25); v_sort text:=coalesce(p_query->>'sort','newest'); v_result jsonb;
BEGIN
  IF p_visibility IS DISTINCT FROM v_context->>'visibility' THEN RAISE EXCEPTION 'MEMORY_CURSOR_INVALID'; END IF;
  IF jsonb_typeof(p_query) IS DISTINCT FROM 'object' OR v_limit NOT BETWEEN 1 AND 100 OR p_snapshot IS NULL OR p_snapshot<0
    OR coalesce(p_query->>'status','active') NOT IN ('active','withdrawn','superseded','all')
    OR p_snapshot>(v_context->>'snapshot')::bigint OR v_sort NOT IN ('newest','oldest','confidence','relevance','usage')
    OR p_after IS NOT NULL AND (length(p_after->>'key')>100 OR (p_after->>'key') !~ '^-?[0-9]+(\.[0-9]+)?$' OR p_after->>'id' IS NULL)
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  WITH visible_productions AS MATERIALIZED (
    SELECT production_id FROM public.reporter_ed_productions WHERE portal_id=v_portal AND core.reporter_memory_visible(v_portal,production_id)
  -- Let each cached subset use the base kind indexes instead of rescanning all document payloads.
  ), records AS NOT MATERIALIZED (
    SELECT kind,id,doc,parent_id,origin_production_id,seq,fingerprint FROM public.reporter_memory_heads WHERE portal_id=v_portal
      AND kind IN ('material','evidence','check','decision','policy','use') AND p_snapshot=(v_context->>'snapshot')::bigint
    UNION ALL
    SELECT kind,id,doc,parent_id,origin_production_id,seq,fingerprint FROM (
      SELECT DISTINCT ON(kind,id) kind,id,doc,parent_id,origin_production_id,seq,fingerprint FROM public.reporter_memory_history WHERE portal_id=v_portal
        AND kind IN ('material','evidence','check','decision','policy','use') AND seq<=p_snapshot AND p_snapshot<(v_context->>'snapshot')::bigint
        ORDER BY kind,id,seq DESC) historical
  ), people AS MATERIALIZED (
    SELECT item_id,doc->>'name' AS name FROM public.reporter_ed_items WHERE portal_id=v_portal AND kind='person' AND NOT deleted
  ), materials AS MATERIALIZED (
    SELECT id,doc,origin_production_id FROM records WHERE kind='material'
      AND (origin_production_id IS NULL OR origin_production_id IN (SELECT production_id FROM visible_productions))
  ), checks AS MATERIALIZED (
    SELECT DISTINCT ON(parent_id) parent_id,doc,core.reporter_memory_doc_visible(v_portal,kind,doc,origin_production_id) AS visible,
      core.reporter_memory_check_dependencies_current(v_portal,doc) AS dependencies_current FROM records WHERE kind='check' ORDER BY parent_id,seq DESC
  ), decisions AS MATERIALIZED (
    SELECT DISTINCT ON(parent_id) parent_id,doc,core.reporter_memory_doc_visible(v_portal,kind,doc,origin_production_id) AS visible FROM records WHERE kind='decision' ORDER BY parent_id,seq DESC
  ), usage_counts AS MATERIALIZED (
    SELECT parent_id,jsonb_build_object(
      'selected',count(DISTINCT jsonb_build_array(CASE WHEN doc->>'productionId' IS NULL THEN 'selection' ELSE 'production' END,coalesce(doc->>'productionId',doc->>'selectionId')))
        FILTER(WHERE doc->>'stage'='selected' AND coalesce(doc->>'productionId',doc->>'selectionId') IS NOT NULL),
      'inserted',count(DISTINCT doc->>'productionId') FILTER(WHERE doc->>'stage'='inserted'),
      'approved',count(DISTINCT doc->>'productionId') FILTER(WHERE doc->>'stage'='approved'),
      'published',count(DISTINCT doc->>'productionId') FILTER(WHERE doc->>'stage'='published')) AS counts
    FROM records WHERE kind='use' AND core.reporter_memory_doc_visible(v_portal,kind,doc,origin_production_id) GROUP BY parent_id
  ), candidates AS NOT MATERIALIZED (
    SELECT e.id,e.doc AS evidence,m.doc AS material,
      CASE WHEN c.visible AND c.dependencies_current AND c.doc->'evidence'->>'hash'=e.fingerprint AND c.doc->'evidence'->'revision'=e.doc->'revision'
        AND (c.doc->>'policyRevision')::integer=coalesce((SELECT (doc->>'revision')::integer FROM records WHERE kind='policy' AND id='editorial-memory'),1) THEN c.doc END AS checked,
      CASE WHEN c.doc IS NULL THEN 'missing' WHEN NOT c.visible THEN 'restricted'
        WHEN NOT c.dependencies_current OR c.doc->'evidence'->>'hash' IS DISTINCT FROM e.fingerprint OR c.doc->'evidence'->'revision' IS DISTINCT FROM e.doc->'revision'
          OR (c.doc->>'policyRevision')::integer IS DISTINCT FROM coalesce((SELECT (doc->>'revision')::integer FROM records WHERE kind='policy' AND id='editorial-memory'),1)
          THEN 'outdated' ELSE 'current' END AS check_state,
      CASE WHEN d.visible THEN d.doc END AS decision,coalesce(NOT d.visible,false) AS review_restricted,
      (SELECT doc FROM records WHERE kind='policy' AND id='editorial-memory') AS policy,
      coalesce(u.counts,'{"selected":0,"inserted":0,"approved":0,"published":0}'::jsonb) AS uses,
      search.terms,
      coalesce(e.doc->'metadata'->>'publishedOn','') AS published_on,coalesce(e.doc->'metadata'->>'recordedOn','') AS recorded_on
    FROM records e JOIN materials m ON m.id=e.parent_id
    LEFT JOIN people person ON person.item_id=coalesce(e.doc->>'personId',e.doc->>'declaringPersonId')
    -- Parse one search document per row without building a workspace-sized vector join.
    LEFT JOIN LATERAL (
      WITH document AS MATERIALIZED (
        SELECT CASE WHEN nullif(p_query->>'query','') IS NULL THEN NULL::tsvector ELSE to_tsvector('simple',concat_ws(' ',
          e.doc->>'text',e.doc->>'indicator',e.doc->'value'->>'raw',e.doc->>'unit',person.name,m.doc->>'title',e.doc->'anchor'->>'excerpt',
          e.doc->>'issuingInstitution',e.doc->>'geography',e.doc->'period'->>'label',e.doc->'metadata'->>'company',e.doc->'metadata'->>'institution',
          e.doc->'metadata'->>'event',e.doc->'metadata'->>'edition',e.doc->'metadata'->>'topics')) END AS terms
      ) SELECT terms FROM document
    ) search ON true
    LEFT JOIN checks c ON c.parent_id=e.id
    LEFT JOIN decisions d ON d.parent_id=e.id
    LEFT JOIN usage_counts u ON u.parent_id=e.id
    WHERE e.kind='evidence' AND (e.origin_production_id IS NULL OR e.origin_production_id IN (SELECT production_id FROM visible_productions))
  ), matched AS (
    SELECT *,CASE WHEN nullif(p_query->>'query','') IS NULL THEN 0 ELSE ts_rank(terms,websearch_to_tsquery('simple',p_query->>'query'),32)::numeric*100 END AS relevance
    FROM candidates WHERE (NOT p_query ? 'kind' OR evidence->>'kind'=p_query->>'kind')
      AND (p_query->>'status'='all' OR evidence->>'status'=coalesce(p_query->>'status','active'))
      AND (NOT p_query ? 'query' OR p_query->>'query'='' OR terms @@ websearch_to_tsquery('simple',p_query->>'query'))
      AND (NOT p_query ? 'topics' OR (evidence->'metadata'->'topics') @> (p_query->'topics'))
      AND (NOT p_query ? 'personId' OR coalesce(evidence->>'personId',evidence->>'declaringPersonId')=p_query->>'personId')
      AND (NOT p_query ? 'institution' OR evidence->>'issuingInstitution'=p_query->>'institution' OR evidence->'metadata'->>'institution'=p_query->>'institution')
      AND (NOT p_query ? 'company' OR evidence->'metadata'->>'company'=p_query->>'company')
      AND (NOT p_query ? 'event' OR evidence->'metadata'->>'event'=p_query->>'event')
      AND (NOT p_query ? 'edition' OR evidence->'metadata'->>'edition'=p_query->>'edition')
      AND (NOT p_query ? 'materialId' OR material->>'id'=p_query->>'materialId')
      AND (NOT p_query ? 'materialKind' OR material->>'kind'=p_query->>'materialKind')
      AND (NOT p_query ? 'verdict' OR coalesce(checked->>'verdict','pending')=p_query->>'verdict')
      AND (NOT p_query ? 'minConfidence' OR (checked->>'confidence')::numeric>=(p_query->>'minConfidence')::numeric)
      AND (NOT p_query ? 'unused' OR ((uses->>coalesce(p_query->>'useStage','inserted'))::bigint=0)=(p_query->>'unused')::boolean)
      AND (NOT p_query ? 'from' AND NOT p_query ? 'to' OR CASE WHEN p_query->>'dateField'='observation' THEN
        evidence->'period'->>'from' IS NOT NULL AND evidence->'period'->>'to' IS NOT NULL
          AND (NOT p_query ? 'from' OR evidence->'period'->>'to'>=p_query->>'from')
          AND (NOT p_query ? 'to' OR evidence->'period'->>'from'<=p_query->>'to')
        ELSE CASE WHEN p_query->>'dateField'='recorded' THEN recorded_on ELSE published_on END <>''
          AND (NOT p_query ? 'from' OR CASE WHEN p_query->>'dateField'='recorded' THEN recorded_on ELSE published_on END>=p_query->>'from')
          AND (NOT p_query ? 'to' OR CASE WHEN p_query->>'dateField'='recorded' THEN recorded_on ELSE published_on END<=p_query->>'to') END)
  ), ranked AS (
    SELECT id,relevance,
      CASE WHEN v_sort='confidence' THEN coalesce((checked->>'confidence')::numeric,-1)
      WHEN v_sort='relevance' THEN relevance WHEN v_sort='usage' THEN (uses->>coalesce(p_query->>'useStage','inserted'))::numeric
      ELSE extract(epoch FROM (evidence->>'createdAt')::timestamptz)*CASE WHEN v_sort='oldest' THEN -1 ELSE 1 END END AS sort_key FROM matched
  ), page AS (
    SELECT * FROM ranked WHERE p_after IS NULL OR (sort_key,id)<((p_after->>'key')::numeric,p_after->>'id') ORDER BY sort_key DESC,id DESC LIMIT v_limit+1
  ), shown AS (SELECT * FROM page ORDER BY sort_key DESC,id DESC LIMIT v_limit)
  SELECT jsonb_build_object('total',(SELECT count(*) FROM ranked),'snapshot',p_snapshot::text,
    'items',coalesce((SELECT jsonb_agg(core.reporter_memory_bundle(v_portal,id,p_snapshot)||jsonb_build_object(
      'relevance',CASE WHEN nullif(p_query->>'query','') IS NULL THEN NULL ELSE relevance END)
      ORDER BY sort_key DESC,id DESC) FROM shown),'[]'),
    'next',CASE WHEN (SELECT count(*) FROM page)>v_limit THEN (SELECT jsonb_build_object('key',sort_key::text,'id',id) FROM shown ORDER BY sort_key,id LIMIT 1) ELSE NULL END) INTO v_result;
  RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION core.reporter_memory_bundle(p_portal uuid,p_id text,p_snapshot bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=p_portal;
  evidence public.reporter_memory_history; material jsonb; checked public.reporter_memory_history;
  decision public.reporter_memory_history; policy jsonb; current_check boolean; check_visible boolean; counts jsonb;
BEGIN
  -- Only authenticated wrappers may call this reader; row visibility still repeats below.
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
    AND (checked.doc->>'policyRevision')::integer=coalesce((policy->>'revision')::integer,1)
    AND core.reporter_memory_check_dependencies_current(portal,checked.doc);
  SELECT jsonb_build_object(
    'selected',count(DISTINCT jsonb_build_array(CASE WHEN h.doc->>'productionId' IS NULL THEN 'selection' ELSE 'production' END,coalesce(h.doc->>'productionId',h.doc->>'selectionId')))
      FILTER(WHERE h.doc->>'stage'='selected' AND coalesce(h.doc->>'productionId',h.doc->>'selectionId') IS NOT NULL),
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

CREATE OR REPLACE FUNCTION public.reporter_memory_detail(p_id text,p_snapshot bigint,p_visibility text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); context jsonb:=public.reporter_memory_context();
BEGIN
  IF p_visibility IS DISTINCT FROM context->>'visibility' THEN RAISE EXCEPTION 'MEMORY_CURSOR_INVALID'; END IF;
  IF p_snapshot IS NULL OR p_snapshot<0 OR p_snapshot>(context->>'snapshot')::bigint THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  RETURN core.reporter_memory_bundle(portal,p_id,p_snapshot);
END $$;

ALTER FUNCTION core.reporter_memory_bundle(uuid,text,bigint) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_memory_bundle(uuid,text,bigint) FROM PUBLIC;
ALTER FUNCTION public.reporter_memory_query(jsonb,bigint,jsonb,text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_memory_detail(text,bigint,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_query(jsonb,bigint,jsonb,text),public.reporter_memory_detail(text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_query(jsonb,bigint,jsonb,text),public.reporter_memory_detail(text,bigint,text) TO reporter_runtime,reporter_worker;
COMMIT;
