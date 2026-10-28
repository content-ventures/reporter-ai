-- Consolidate only the exact same production/source span; never transfer old approvals or uses.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_memory_duplicate_save(p_change jsonb,p_target jsonb,p_reason text,p_automatic boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); previous public.reporter_memory_heads; canonical public.reporter_memory_heads;
  document jsonb:=p_change->'doc'; state text:=document->'deduplication'->>'state'; saved jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit');
  SELECT * INTO previous FROM public.reporter_memory_heads h WHERE h.portal_id=portal AND h.kind='evidence' AND h.id=p_change->>'id';
  SELECT * INTO canonical FROM public.reporter_memory_heads h WHERE h.portal_id=portal AND h.kind='evidence' AND h.id=p_target->>'id';
  IF previous.id IS NULL OR canonical.id IS NULL OR NOT core.reporter_memory_doc_visible(portal,'evidence',previous.doc,previous.origin_production_id)
    OR NOT core.reporter_memory_doc_visible(portal,'evidence',canonical.doc,canonical.origin_production_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF (p_change->>'expected')::integer IS DISTINCT FROM previous.storage_revision OR p_target->>'hash' IS DISTINCT FROM canonical.fingerprint
    OR p_target->'revision' IS DISTINCT FROM canonical.doc->'revision' OR (document->>'revision')::integer IS DISTINCT FROM (previous.doc->>'revision')::integer+1
    THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF p_automatic IS NULL OR p_change->>'kind' IS DISTINCT FROM 'evidence' OR state IS NULL OR state NOT IN ('pending','superseded')
    OR (p_change->>'fingerprint' ~ '^[a-f0-9]{16}$') IS DISTINCT FROM true OR previous.doc->>'status' IS DISTINCT FROM 'active'
    OR canonical.doc->>'status' IS DISTINCT FROM 'active' OR previous.doc->>'kind' IS DISTINCT FROM 'citation' OR canonical.doc->>'kind' IS DISTINCT FROM 'citation'
    OR jsonb_typeof(previous.doc->'legacy'->'article') IS DISTINCT FROM 'object' OR canonical.id IS DISTINCT FROM previous.doc->>'legacyCitationId'
    OR canonical.doc->>'legacyCitationId' IS DISTINCT FROM canonical.id OR previous.id=canonical.id
    OR previous.origin_production_id IS DISTINCT FROM canonical.origin_production_id OR previous.parent_id IS DISTINCT FROM canonical.parent_id
    OR previous.doc->'anchor' IS DISTINCT FROM canonical.doc->'anchor'
    OR previous.doc->'legacy'->'citation'->'ref' IS DISTINCT FROM canonical.doc->'legacy'->'citation'->'ref'
    OR previous.doc->'legacy'->'citation'->>'sourceHash' IS DISTINCT FROM canonical.doc->'legacy'->'citation'->>'sourceHash'
    OR document->>'status' IS DISTINCT FROM (CASE WHEN state='pending' THEN 'active' ELSE 'superseded' END)
    OR document->'deduplication'->>'canonicalId' IS DISTINCT FROM canonical.id
    OR document->'deduplication'->'canonical' IS DISTINCT FROM jsonb_build_object('id',canonical.id,'revision',canonical.doc->'revision','hash',canonical.fingerprint)
    OR (document->'deduplication'->>'choice' IN ('pending','automatic','keep_variant','use_curated')) IS DISTINCT FROM true
    OR p_automatic AND document->'deduplication'->>'choice' IS DISTINCT FROM (CASE WHEN state='pending' THEN 'pending' ELSE 'automatic' END)
    OR NOT p_automatic AND (state IS DISTINCT FROM 'superseded' OR document->'deduplication'->>'choice' NOT IN ('keep_variant','use_curated'))
    OR (document-ARRAY['revision','updatedAt','status','deduplication']) IS DISTINCT FROM (previous.doc-ARRAY['revision','updatedAt','status','deduplication'])
    OR state='superseded' AND canonical.doc->'legacy'->>'state' IS DISTINCT FROM 'synchronized'
    OR p_automatic AND state='superseded' AND (previous.fingerprint IS DISTINCT FROM previous.doc->'legacy'->>'mappedHash' OR previous.doc->'legacy'->>'state' IS DISTINCT FROM 'synchronized')
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000
    OR NOT EXISTS(SELECT FROM public.reporter_ed_items c WHERE c.portal_id=portal AND c.kind='citation' AND c.item_id=canonical.id AND NOT c.deleted
      AND c.doc=canonical.doc->'legacy'->'citation') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  document:=document||jsonb_build_object('updatedAt',clock_timestamp(),'deduplication',jsonb_build_object(
    'canonicalId',canonical.id,'canonical',jsonb_build_object('id',canonical.id,'revision',canonical.doc->'revision','hash',canonical.fingerprint),
    'state',state,'choice',document->'deduplication'->>'choice','reason',btrim(p_reason),'personId',core.context_user_id(),'at',clock_timestamp()));
  saved:=public.reporter_memory_put(p_change||jsonb_build_object('doc',document));
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,before_data,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),CASE WHEN state='pending' THEN 'memory.duplicate.pending' ELSE 'memory.duplicate.supersede' END,
      'memory_evidence',previous.doc,saved->'doc','reporter_ai',nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN saved;
END $$;
ALTER FUNCTION public.reporter_memory_duplicate_save(jsonb,jsonb,text,boolean) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_duplicate_save(jsonb,jsonb,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_duplicate_save(jsonb,jsonb,text,boolean) TO reporter_runtime,reporter_worker;

-- Other compatibility/correction writers cannot erase a pending choice or resurrect a retired projection.
CREATE OR REPLACE FUNCTION core.reporter_memory_duplicate_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.kind='evidence' AND OLD.doc ? 'deduplication' AND
    (NEW.doc->'deduplication'->>'canonicalId' IS DISTINCT FROM OLD.doc->'deduplication'->>'canonicalId'
      OR (NEW.doc->'deduplication'->>'state' IN ('pending','superseded')) IS DISTINCT FROM true
      OR OLD.doc->'deduplication'->>'state'='superseded' AND (NEW.doc->>'status' IS DISTINCT FROM 'superseded' OR NEW.doc->'deduplication'->>'state' IS DISTINCT FROM 'superseded'))
    THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF NEW.kind='decision' AND NEW.doc->>'action'='accept' AND EXISTS(SELECT FROM public.reporter_memory_heads h
    WHERE (h.portal_id,h.kind,h.id)=(NEW.portal_id,'evidence',NEW.parent_id) AND h.doc->'deduplication'->>'state'='pending')
    THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION core.reporter_memory_duplicate_guard() OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_memory_duplicate_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS reporter_memory_duplicate_guard ON public.reporter_memory_heads;
CREATE TRIGGER reporter_memory_duplicate_guard BEFORE INSERT OR UPDATE ON public.reporter_memory_heads FOR EACH ROW EXECUTE FUNCTION core.reporter_memory_duplicate_guard();

-- Status participates in the same snapshot and cursor query; active is the default.
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
  WITH records AS (
    SELECT kind,id,doc,parent_id,origin_production_id,seq,fingerprint FROM public.reporter_memory_heads WHERE portal_id=v_portal
      AND kind IN ('material','evidence','check','decision','policy','use') AND p_snapshot=(v_context->>'snapshot')::bigint
    UNION ALL
    SELECT kind,id,doc,parent_id,origin_production_id,seq,fingerprint FROM (
      SELECT DISTINCT ON(kind,id) kind,id,doc,parent_id,origin_production_id,seq,fingerprint FROM public.reporter_memory_history WHERE portal_id=v_portal
        AND kind IN ('material','evidence','check','decision','policy','use') AND seq<=p_snapshot AND p_snapshot<(v_context->>'snapshot')::bigint
        ORDER BY kind,id,seq DESC) historical
  ), checks AS (
    SELECT DISTINCT ON(parent_id) parent_id,doc,core.reporter_memory_doc_visible(v_portal,kind,doc,origin_production_id) AS visible FROM records WHERE kind='check' ORDER BY parent_id,seq DESC
  ), decisions AS (
    SELECT DISTINCT ON(parent_id) parent_id,doc,core.reporter_memory_doc_visible(v_portal,kind,doc,origin_production_id) AS visible FROM records WHERE kind='decision' ORDER BY parent_id,seq DESC
  ), usage_counts AS (
    SELECT parent_id,jsonb_build_object(
      'selected',count(DISTINCT coalesce(doc->>'productionId',doc->>'selectionId')) FILTER(WHERE doc->>'stage'='selected'),
      'inserted',count(DISTINCT doc->>'productionId') FILTER(WHERE doc->>'stage'='inserted'),
      'approved',count(DISTINCT doc->>'productionId') FILTER(WHERE doc->>'stage'='approved'),
      'published',count(DISTINCT doc->>'productionId') FILTER(WHERE doc->>'stage'='published')) AS counts
    FROM records WHERE kind='use' AND core.reporter_memory_doc_visible(v_portal,kind,doc,origin_production_id) GROUP BY parent_id
  ), candidates AS (
    SELECT e.id,e.doc AS evidence,m.doc AS material,
      CASE WHEN c.visible AND c.doc->'evidence'->>'hash'=e.fingerprint AND c.doc->'evidence'->'revision'=e.doc->'revision'
        AND (c.doc->>'policyRevision')::integer=coalesce((SELECT (doc->>'revision')::integer FROM records WHERE kind='policy' AND id='editorial-memory'),1) THEN c.doc END AS checked,
      CASE WHEN c.doc IS NULL THEN 'missing' WHEN NOT c.visible THEN 'restricted'
        WHEN c.doc->'evidence'->>'hash' IS DISTINCT FROM e.fingerprint OR c.doc->'evidence'->'revision' IS DISTINCT FROM e.doc->'revision'
          OR (c.doc->>'policyRevision')::integer IS DISTINCT FROM coalesce((SELECT (doc->>'revision')::integer FROM records WHERE kind='policy' AND id='editorial-memory'),1)
          THEN 'outdated' ELSE 'current' END AS check_state,
      CASE WHEN d.visible THEN d.doc END AS decision,coalesce(NOT d.visible,false) AS review_restricted,
      (SELECT doc FROM records WHERE kind='policy' AND id='editorial-memory') AS policy,
      coalesce(u.counts,'{"selected":0,"inserted":0,"approved":0,"published":0}'::jsonb) AS uses,
      to_tsvector('simple',concat_ws(' ',e.doc->>'text',e.doc->>'indicator',e.doc->'value'->>'raw',e.doc->>'unit',person.doc->>'name',m.doc->>'title',
        e.doc->'anchor'->>'excerpt',e.doc->>'issuingInstitution',e.doc->>'geography',e.doc->'period'->>'label',
        e.doc->'metadata'->>'company',e.doc->'metadata'->>'institution',e.doc->'metadata'->>'event',e.doc->'metadata'->>'edition',e.doc->'metadata'->>'topics')) AS terms,
      coalesce(e.doc->'metadata'->>'publishedOn','') AS published_on,coalesce(e.doc->'metadata'->>'recordedOn','') AS recorded_on
    FROM records e JOIN records m ON m.kind='material' AND m.id=e.parent_id
    LEFT JOIN public.reporter_ed_items person ON person.portal_id=v_portal AND person.kind='person' AND person.item_id=coalesce(e.doc->>'personId',e.doc->>'declaringPersonId') AND NOT person.deleted
    LEFT JOIN checks c ON c.parent_id=e.id
    LEFT JOIN decisions d ON d.parent_id=e.id
    LEFT JOIN usage_counts u ON u.parent_id=e.id
    WHERE e.kind='evidence' AND core.reporter_memory_visible(v_portal,e.origin_production_id)
      AND core.reporter_memory_visible(v_portal,m.origin_production_id)
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
    SELECT *,CASE WHEN v_sort='confidence' THEN coalesce((checked->>'confidence')::numeric,-1)
      WHEN v_sort='relevance' THEN relevance WHEN v_sort='usage' THEN (uses->>coalesce(p_query->>'useStage','inserted'))::numeric
      ELSE extract(epoch FROM (evidence->>'createdAt')::timestamptz)*CASE WHEN v_sort='oldest' THEN -1 ELSE 1 END END AS sort_key FROM matched
  ), page AS (
    SELECT * FROM ranked WHERE p_after IS NULL OR (sort_key,id)<((p_after->>'key')::numeric,p_after->>'id') ORDER BY sort_key DESC,id DESC LIMIT v_limit+1
  ), shown AS (SELECT * FROM page ORDER BY sort_key DESC,id DESC LIMIT v_limit)
  SELECT jsonb_build_object('total',(SELECT count(*) FROM ranked),'snapshot',p_snapshot::text,
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('evidence',evidence,'material',material,'check',checked,'checkState',check_state,'decision',decision,'reviewRestricted',review_restricted,'policy',policy,'uses',uses,
      'source',core.reporter_memory_fragment(v_portal,evidence->'anchor'),'relevance',CASE WHEN nullif(p_query->>'query','') IS NULL THEN NULL ELSE relevance END)
      ORDER BY sort_key DESC,id DESC) FROM shown),'[]'),
    'next',CASE WHEN (SELECT count(*) FROM page)>v_limit THEN (SELECT jsonb_build_object('key',sort_key::text,'id',id) FROM shown ORDER BY sort_key,id LIMIT 1) ELSE NULL END) INTO v_result;
  RETURN v_result;
END $$;
ALTER FUNCTION public.reporter_memory_query(jsonb,bigint,jsonb,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_query(jsonb,bigint,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_query(jsonb,bigint,jsonb,text) TO reporter_runtime,reporter_worker;
COMMIT;
