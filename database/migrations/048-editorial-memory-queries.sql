-- Bounded, authorized read projections. Queries never materialize a persistent snapshot on GET.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_memory_authorize(p_capability text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid;
BEGIN
  IF p_capability IS NULL OR p_capability NOT IN ('library.edit','library.review','pipeline.edit') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  portal:=core.reporter_memory_portal(CASE WHEN p_capability='library.review' THEN 'review' ELSE 'write' END);
  IF p_capability='pipeline.edit' AND NOT core.reporter_memory_is_admin(portal) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM core.reporter_memory_lock(portal);
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION core.reporter_memory_doc_visible(p_portal uuid,p_kind text,p_doc jsonb,p_origin text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT core.reporter_memory_visible(p_portal,p_origin)
    AND (p_kind NOT IN ('selection','use') OR core.reporter_memory_visible(p_portal,p_doc->>'productionId'))
    AND (p_kind NOT IN ('check','decision') OR NOT EXISTS(
      SELECT FROM jsonb_array_elements(coalesce(p_doc->'supports','[]')) s
      CROSS JOIN LATERAL (SELECT CASE WHEN s ? 'kind' THEN s ELSE s->'evidence' END AS ref) r
      WHERE r.ref->>'kind'='internal' AND NOT EXISTS(SELECT FROM public.reporter_memory_heads h
        JOIN public.reporter_memory_history v ON (v.portal_id,v.kind,v.id)=(h.portal_id,h.kind,h.id)
        WHERE h.portal_id=p_portal AND h.kind='evidence' AND h.id=r.ref->'evidence'->>'id'
          AND v.fingerprint=r.ref->'evidence'->>'hash' AND v.doc->'revision'=r.ref->'evidence'->'revision'
          AND core.reporter_memory_visible(p_portal,h.origin_production_id))))
$$;
CREATE OR REPLACE FUNCTION core.reporter_memory_fragment(p_portal uuid,p_anchor jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT s.doc||jsonb_build_object('versions',coalesce((SELECT jsonb_agg(v||jsonb_build_object('content',v->'content'||jsonb_build_object(
    'segments',(SELECT jsonb_agg(segment ORDER BY ordinal) FROM jsonb_array_elements(v->'content'->'segments') WITH ORDINALITY segments(segment,ordinal)
      WHERE EXISTS(SELECT FROM jsonb_array_elements(p_anchor->'spans') span WHERE span->>'segmentId'=segment->>'id')))))
    FROM jsonb_array_elements(s.doc->'versions') v WHERE v->>'number'=p_anchor->'source'->>'sourceVersion' AND v->>'hash'=p_anchor->'source'->>'hash'),'[]'))
  FROM public.reporter_ed_sources s WHERE s.portal_id=p_portal AND s.source_id=p_anchor->'source'->>'sourceId'
$$;
CREATE OR REPLACE FUNCTION public.reporter_memory_get(p_kind text,p_id text,p_revision integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); value jsonb;
BEGIN
  IF p_revision IS NULL THEN
    SELECT to_jsonb(h)-'portal_id' INTO value FROM public.reporter_memory_heads h WHERE h.portal_id=portal AND h.kind=p_kind AND h.id=p_id
      AND core.reporter_memory_doc_visible(portal,h.kind,h.doc,h.origin_production_id);
  ELSE
    SELECT to_jsonb(h)-'portal_id' INTO value FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind=p_kind AND h.id=p_id AND h.storage_revision=p_revision
      AND core.reporter_memory_doc_visible(portal,h.kind,h.doc,h.origin_production_id);
  END IF;
  RETURN value;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_scan(p_kind text,p_snapshot bigint,p_after text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); result jsonb;
BEGIN
  IF p_snapshot IS NULL OR p_snapshot<0 OR p_snapshot>coalesce((SELECT seq FROM public.reporter_memory_clock WHERE portal_id=portal),0)
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  WITH latest AS (SELECT DISTINCT ON(id) * FROM public.reporter_memory_history WHERE portal_id=portal AND kind=p_kind AND seq<=p_snapshot ORDER BY id,seq DESC)
  SELECT coalesce(jsonb_agg(value ORDER BY id),'[]') INTO result FROM (SELECT id,to_jsonb(h)-'portal_id' AS value FROM latest h
    WHERE (p_after IS NULL OR id>p_after) AND core.reporter_memory_doc_visible(portal,h.kind,h.doc,h.origin_production_id) ORDER BY id LIMIT p_limit) page;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_memory_query(p_query jsonb,p_snapshot bigint,p_after jsonb,p_visibility text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE v_portal uuid:=core.reporter_memory_portal('read'); v_context jsonb:=public.reporter_memory_context();
  v_limit integer:=coalesce((p_query->>'limit')::integer,25); v_sort text:=coalesce(p_query->>'sort','newest'); v_result jsonb;
BEGIN
  IF p_visibility IS DISTINCT FROM v_context->>'visibility' THEN RAISE EXCEPTION 'MEMORY_CURSOR_INVALID'; END IF;
  IF jsonb_typeof(p_query) IS DISTINCT FROM 'object' OR v_limit NOT BETWEEN 1 AND 100 OR p_snapshot IS NULL OR p_snapshot<0
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
DO $$ DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['core.reporter_memory_doc_visible(uuid,text,jsonb,text)','core.reporter_memory_fragment(uuid,jsonb)',
    'public.reporter_memory_get(text,text,integer)','public.reporter_memory_scan(text,bigint,text,integer)',
    'public.reporter_memory_query(jsonb,bigint,jsonb,text)','public.reporter_memory_authorize(text)'] LOOP
    EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO reporter_executor'; EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC';
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.reporter_memory_query(jsonb,bigint,jsonb,text),public.reporter_memory_authorize(text) TO reporter_runtime,reporter_worker;
END $$;
-- Search includes names; a profile change must not silently alter an existing page sequence.
CREATE OR REPLACE FUNCTION core.reporter_memory_identity_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.kind IN ('person','member') THEN UPDATE public.reporter_memory_clock SET visibility=visibility+1 WHERE portal_id=OLD.portal_id; END IF;
  ELSIF NEW.kind IN ('person','member') AND (TG_OP='INSERT' OR OLD.doc IS DISTINCT FROM NEW.doc OR OLD.deleted IS DISTINCT FROM NEW.deleted) THEN
    UPDATE public.reporter_memory_clock SET visibility=visibility+1 WHERE portal_id=NEW.portal_id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS reporter_memory_identity_visibility ON public.reporter_ed_items;
CREATE TRIGGER reporter_memory_identity_visibility AFTER INSERT OR UPDATE OR DELETE ON public.reporter_ed_items FOR EACH ROW EXECUTE FUNCTION core.reporter_memory_identity_changed();
ALTER FUNCTION core.reporter_memory_identity_changed() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION core.reporter_memory_identity_changed() FROM PUBLIC;
COMMIT;
