-- Read only the changed article or already imported variants affected by an editorial write.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_memory_article_entry(p_production text,p_kind text,p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); result jsonb;
BEGIN
  IF p_kind NOT IN ('piece','version') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object('productionId',p.production_id,'kind',p.kind,'id',p.part_id,'storageHash',md5(p.doc::text),'doc',p.doc) INTO result
    FROM public.reporter_ed_parts p WHERE p.portal_id=portal AND p.production_id=p_production AND p.kind=p_kind AND p.part_id=p_id AND NOT p.deleted
      AND coalesce(p.doc->'draft'->'body',p.doc->'body')->>'type'='article' AND core.reporter_memory_visible(portal,p.production_id);
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_article_refresh(p_after text,p_sources text[],p_checks text[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); result jsonb;
BEGIN
  IF cardinality(p_sources)>100 OR cardinality(p_checks)>100 OR length(p_after)>128 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  WITH page AS (SELECT h.id,h.doc FROM public.reporter_memory_heads h WHERE h.portal_id=portal AND h.kind='evidence'
    AND h.doc->>'status'='active' AND h.doc->'legacy'->'article' IS NOT NULL AND h.doc->>'kind'='citation'
    AND (p_after IS NULL OR h.id>p_after) AND (h.source_id=ANY(p_sources) OR h.doc->>'legacyCitationId'=ANY(p_checks))
    AND core.reporter_memory_doc_visible(portal,h.kind,h.doc,h.origin_production_id) ORDER BY h.id LIMIT 101),
  shown AS (SELECT * FROM page ORDER BY id LIMIT 100)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'origin',doc->'legacy'->'article','ref',doc->'legacy'->'citation'->'ref') ORDER BY id) FROM shown),'[]'),
    'nextAfter',CASE WHEN (SELECT count(*) FROM page)>100 THEN (SELECT max(id) FROM shown) END) INTO result;
  RETURN result;
END $$;
DO $$ DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['public.reporter_memory_article_entry(text,text,text)','public.reporter_memory_article_refresh(text,text[],text[])'] LOOP
    EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO reporter_executor'; EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO reporter_runtime,reporter_worker';
  END LOOP;
END $$;
COMMIT;
