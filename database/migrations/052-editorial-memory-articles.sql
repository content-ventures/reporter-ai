-- Preserve the exact article documents behind legacy projections, independently of live drafts.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_memory_articles(
  portal_id uuid NOT NULL REFERENCES public.portals(id),production_id text NOT NULL,kind text NOT NULL CHECK(kind IN ('piece','version')),
  id text NOT NULL,storage_hash text NOT NULL CHECK(storage_hash ~ '^[a-f0-9]{32}$'),body_hash text NOT NULL CHECK(body_hash ~ '^[a-f0-9]{16}$'),
  doc jsonb NOT NULL CHECK(jsonb_typeof(doc)='object' AND octet_length(doc::text)<=4194304),
  imported_by uuid NOT NULL REFERENCES core.users(id),imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(portal_id,production_id,kind,id,storage_hash),FOREIGN KEY(portal_id,production_id) REFERENCES public.reporter_ed_productions(portal_id,production_id)
);
ALTER TABLE public.reporter_memory_articles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_memory_articles FROM PUBLIC,reporter_runtime,reporter_worker;
GRANT SELECT,INSERT ON public.reporter_memory_articles TO reporter_executor;
DROP POLICY IF EXISTS reporter_memory_articles_executor ON public.reporter_memory_articles;
CREATE POLICY reporter_memory_articles_executor ON public.reporter_memory_articles TO reporter_executor USING(true) WITH CHECK(true);
CREATE OR REPLACE FUNCTION public.reporter_memory_articles_batch(p_after jsonb,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  WITH candidates AS (SELECT p.*,md5(p.doc::text) AS hash FROM public.reporter_ed_parts p WHERE p.portal_id=portal AND p.kind IN ('piece','version') AND NOT p.deleted
    AND coalesce(p.doc->'draft'->'body',p.doc->'body')->>'type'='article' AND core.reporter_memory_visible(portal,p.production_id)),
  shown AS (SELECT * FROM candidates p WHERE p_after IS NULL OR (p.production_id,p.kind,p.part_id)>(p_after->>'productionId',p_after->>'kind',p_after->>'id')
    OR (p.production_id,p.kind,p.part_id)=(p_after->>'productionId',p_after->>'kind',p_after->>'id') AND coalesce((p_after->>'offset')::integer,0)>0
    ORDER BY production_id,kind,part_id LIMIT p_limit)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object('productionId',production_id,'kind',kind,'id',part_id,'storageHash',hash,'doc',doc)
    ORDER BY production_id,kind,part_id) FROM shown),'[]'),'total',(SELECT count(*) FROM candidates)) INTO result;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_article_snapshot(p_origin jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); original jsonb; saved public.reporter_memory_articles;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit');
  SELECT p.doc INTO original FROM public.reporter_ed_parts p WHERE p.portal_id=portal AND p.kind=p_origin->>'kind' AND p.part_id=p_origin->>'id'
    AND p.production_id=p_origin->>'productionId' AND NOT p.deleted AND core.reporter_memory_visible(portal,p.production_id);
  IF original IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF md5(original::text) IS DISTINCT FROM p_origin->>'storageHash' THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF coalesce(original->'draft'->'body',original->'body')->>'type' IS DISTINCT FROM 'article' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  INSERT INTO public.reporter_memory_articles(portal_id,production_id,kind,id,storage_hash,body_hash,doc,imported_by)
    VALUES(portal,p_origin->>'productionId',p_origin->>'kind',p_origin->>'id',p_origin->>'storageHash',p_origin->>'bodyHash',original,core.context_user_id()) ON CONFLICT DO NOTHING;
  SELECT * INTO saved FROM public.reporter_memory_articles a WHERE a.portal_id=portal AND a.production_id=p_origin->>'productionId' AND a.kind=p_origin->>'kind'
    AND a.id=p_origin->>'id' AND a.storage_hash=p_origin->>'storageHash';
  IF saved.doc IS DISTINCT FROM original OR saved.body_hash IS DISTINCT FROM p_origin->>'bodyHash' THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  RETURN to_jsonb(saved)-'portal_id';
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_article_get(p_origin jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); result jsonb;
BEGIN
  SELECT to_jsonb(a)-'portal_id' INTO result FROM public.reporter_memory_articles a WHERE a.portal_id=portal AND a.production_id=p_origin->>'productionId'
    AND a.kind=p_origin->>'kind' AND a.id=p_origin->>'id' AND a.storage_hash=p_origin->>'storageHash' AND core.reporter_memory_visible(portal,a.production_id);
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_article_sources(p_origin jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); article jsonb:=public.reporter_memory_article_get(p_origin); result jsonb;
BEGIN
  IF article IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  WITH refs AS (SELECT DISTINCT ref FROM jsonb_array_elements(coalesce(article->'doc'->'draft'->'body',article->'doc'->'body')->'blocks') b
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(b->'sourceRefs','[]')) ref WHERE ref->'locator'->>'type'='segment')
  SELECT coalesce(jsonb_agg(s.doc||jsonb_build_object('workspaceId',portal,'versions',(SELECT jsonb_agg(v||jsonb_build_object('content',v->'content'||jsonb_build_object('segments',
    (SELECT jsonb_agg(segment ORDER BY ordinal) FROM jsonb_array_elements(v->'content'->'segments') WITH ORDINALITY segments(segment,ordinal)
      WHERE EXISTS(SELECT FROM refs WHERE ref->>'sourceId'=s.source_id AND ref->'sourceVersion'=v->'number' AND ref->'locator'->>'segmentId'=segment->>'id')))))
      FROM jsonb_array_elements(s.doc->'versions') v WHERE EXISTS(SELECT FROM refs WHERE ref->>'sourceId'=s.source_id AND ref->'sourceVersion'=v->'number')))),'[]') INTO result
    FROM public.reporter_ed_sources s WHERE s.portal_id=portal AND EXISTS(SELECT FROM refs WHERE ref->>'sourceId'=s.source_id)
      AND core.reporter_memory_source_visible(portal,s.source_id,p_origin->>'productionId');
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION core.reporter_memory_article_proof(p_origin jsonb,p_citation jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE article jsonb:=public.reporter_memory_article_get(p_origin);
BEGIN
  RETURN article IS NOT NULL AND p_origin->>'productionId'=p_citation->>'productionId' AND EXISTS(
    SELECT FROM jsonb_array_elements(coalesce(article->'doc'->'draft'->'body',article->'doc'->'body')->'blocks') b
    WHERE b->>'type' IN ('paragraph','quote') AND b->'sourceRefs' @> jsonb_build_array(p_citation->'ref')
      AND position(normalize(lower(p_citation->>'text'),NFC) IN normalize(lower(regexp_replace((SELECT string_agg(i->>'text','' ORDER BY n)
        FROM jsonb_array_elements(b->'inlines') WITH ORDINALITY lines(i,n)),'\s+',' ','g')),NFC))>0);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_article_context(p_origin jsonb,p_citation jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); curated jsonb;
BEGIN
  IF NOT coalesce(core.reporter_memory_article_proof(p_origin,p_citation),false) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT item INTO curated FROM jsonb_array_elements(public.reporter_memory_legacy_batch(NULL,1,ARRAY[p_citation->>'id'])->'items') item
    WHERE item->'citation'->>'productionId'=p_origin->>'productionId' AND item->'citation'->'ref'=p_citation->'ref'
      AND item->'citation'->>'sourceHash'=p_citation->>'sourceHash';
  RETURN jsonb_build_object('curated',curated,'factCheck',(SELECT f.doc FROM public.reporter_ed_items f
    WHERE f.portal_id=portal AND f.kind='fact_check' AND f.item_id=p_citation->>'id' AND NOT f.deleted));
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_article_save(p_change jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); document jsonb:=p_change->'doc'; original jsonb:=document->'legacy'->'citation'; previous jsonb; saved jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit');
  IF p_change->>'kind' IS DISTINCT FROM 'evidence' OR document->>'kind' IS DISTINCT FROM 'citation' OR (p_change->>'id' ~ '^article-[a-f0-9]{16}$') IS DISTINCT FROM true
    OR document->>'legacyCitationId' IS DISTINCT FROM original->>'id' OR NOT coalesce(core.reporter_memory_article_proof(document->'legacy'->'article',original),false)
    OR document->'legacy'->'factCheck' IS DISTINCT FROM coalesce((SELECT f.doc FROM public.reporter_ed_items f WHERE f.portal_id=portal AND f.kind='fact_check' AND f.item_id=original->>'id' AND NOT f.deleted),'null'::jsonb)
    OR (document->'legacy'->>'state' IN ('synchronized','conflict')) IS DISTINCT FROM true OR (document->'legacy'->>'mappedHash' ~ '^[a-f0-9]{16}$') IS DISTINCT FROM true
    OR NOT EXISTS(SELECT FROM public.reporter_memory_heads m WHERE m.portal_id=portal AND m.kind='material' AND m.id=p_change->>'parentId'
      AND m.origin_production_id=original->>'productionId' AND m.source_id=original->'ref'->>'sourceId') OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  SELECT h.doc INTO previous FROM public.reporter_memory_heads h WHERE h.portal_id=portal AND h.kind='evidence' AND h.id=p_change->>'id';
  document:=jsonb_set(document,'{legacy}',document->'legacy'||jsonb_build_object('importedAt',clock_timestamp(),'importedBy',core.context_user_id(),'reason',btrim(p_reason)));
  saved:=public.reporter_memory_put(p_change||jsonb_build_object('doc',document));
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,before_data,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.legacy.article','memory_evidence',previous,saved->'doc','reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN saved;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_legacy_lookup(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); result jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',h.id,'materialId',h.doc->>'materialId') ORDER BY h.id),'[]') INTO result
    FROM public.reporter_memory_heads h WHERE h.portal_id=portal AND h.kind='evidence' AND h.doc->>'kind'='citation' AND h.doc->>'legacyCitationId'=p_id
      AND h.doc->>'status'='active' AND core.reporter_memory_doc_visible(portal,h.kind,h.doc,h.origin_production_id);
  RETURN result;
END $$;
CREATE INDEX IF NOT EXISTS reporter_memory_legacy_alias ON public.reporter_memory_heads(portal_id,(doc->>'legacyCitationId')) WHERE kind='evidence';
CREATE OR REPLACE FUNCTION public.reporter_memory_article_evidence(p_id text,p_hash text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); origin jsonb;
BEGIN
  IF public.reporter_memory_get('evidence',p_id) IS NULL THEN RETURN NULL; END IF;
  IF p_hash IS NULL THEN origin:=public.reporter_memory_get('evidence',p_id)->'doc'->'legacy'->'article';
  ELSE SELECT h.doc->'legacy'->'article' INTO origin FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='evidence' AND h.id=p_id
    AND h.doc->'legacy'->'article'->>'storageHash'=p_hash AND core.reporter_memory_doc_visible(portal,h.kind,h.doc,h.origin_production_id) ORDER BY h.seq DESC LIMIT 1; END IF;
  RETURN CASE WHEN origin IS NULL THEN NULL ELSE public.reporter_memory_article_get(origin)||jsonb_build_object('origin',origin) END;
END $$;
DO $$ DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['public.reporter_memory_articles_batch(jsonb,integer)','public.reporter_memory_article_snapshot(jsonb)',
    'public.reporter_memory_article_get(jsonb)','public.reporter_memory_article_sources(jsonb)','public.reporter_memory_article_context(jsonb,jsonb)',
    'public.reporter_memory_article_save(jsonb,text)','public.reporter_memory_legacy_lookup(text)','public.reporter_memory_article_evidence(text,text)'] LOOP
    EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO reporter_executor'; EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO reporter_runtime,reporter_worker';
  END LOOP;
END $$;
ALTER FUNCTION core.reporter_memory_article_proof(jsonb,jsonb) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_memory_article_proof(jsonb,jsonb) FROM PUBLIC;
COMMIT;
