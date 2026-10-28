-- Writing consumes exact selection snapshots and records actual saved occurrences.
BEGIN;
-- Automatic effects of an authorized article review share its existing transaction permission.
CREATE OR REPLACE FUNCTION core.reporter_memory_portal(p_mode text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('read','write','review') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF p_mode<>'read' AND nullif(current_setting('app.member_view',true),'') IS NOT NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF current_setting('app.access_mode',true)='job' THEN
    portal:=core.reporter_ed_portal(p_mode<>'read');
    IF NOT core.reporter_worker_workspace_enabled(portal) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  ELSE portal:=core.reporter_require(CASE WHEN p_mode='write' AND current_setting('app.editorial_permission',true)='reporter.review' THEN 'reporter.review' WHEN p_mode='write' THEN 'reporter.edit' ELSE 'reporter.read' END); END IF;
  RETURN portal;
END $$;
CREATE OR REPLACE FUNCTION core.reporter_memory_utf16_slice(p_text text,p_from integer,p_to integer) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,core,public,pg_temp AS $$
  WITH chars AS (SELECT ch,n,sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END) OVER(ORDER BY n) AS finish
    FROM regexp_split_to_table(p_text,'') WITH ORDINALITY c(ch,n))
  SELECT CASE WHEN p_from>=0 AND p_to>p_from AND (p_from=0 OR EXISTS(SELECT FROM chars WHERE finish=p_from))
    AND EXISTS(SELECT FROM chars WHERE finish=p_to) THEN (SELECT string_agg(ch,'' ORDER BY n) FROM chars WHERE finish>p_from AND finish<=p_to) END
$$;
CREATE OR REPLACE FUNCTION core.reporter_memory_block_text(p_block jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT CASE WHEN p_block->>'type' IN ('paragraph','heading','quote') THEN
    (SELECT coalesce(string_agg(value->>'text','' ORDER BY n),'') FROM jsonb_array_elements(p_block->'inlines') WITH ORDINALITY i(value,n))
    WHEN p_block->>'type'='list' THEN (SELECT coalesce(string_agg(line,E'\n' ORDER BY n),'') FROM
      (SELECT n,(SELECT string_agg(value->>'text','' ORDER BY pos) FROM jsonb_array_elements(item) WITH ORDINALITY i(value,pos)) AS line
        FROM jsonb_array_elements(p_block->'items') WITH ORDINALITY list(item,n)) lines) ELSE '' END
$$;
CREATE OR REPLACE FUNCTION public.reporter_memory_selection_scope(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); selection jsonb:=public.reporter_memory_get('selection',p_id); original text; production jsonb;
  readers text[]:=NULL; current_readers text[];
BEGIN
  IF selection IS NULL THEN RETURN NULL; END IF;
  FOR original IN SELECT DISTINCT origin FROM (
    SELECT selection->'doc'->>'productionId' AS origin UNION ALL SELECT h.origin_production_id FROM public.reporter_memory_heads h
      JOIN jsonb_array_elements(selection->'doc'->'items') i ON i->'evidence'->>'id'=h.id WHERE h.portal_id=portal AND h.kind='evidence') origins WHERE origin IS NOT NULL LOOP
    SELECT doc INTO production FROM public.reporter_ed_productions WHERE portal_id=portal AND production_id=original;
    IF production IS NULL OR NOT core.reporter_memory_visible(portal,original) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
    IF jsonb_typeof(production->'restrictedTo')='array' THEN
      SELECT array_agg(DISTINCT id) INTO current_readers FROM (SELECT production->>'ownerId' AS id UNION ALL SELECT jsonb_array_elements_text(production->'restrictedTo')) people;
      IF readers IS NULL THEN readers:=current_readers; ELSE SELECT coalesce(array_agg(id),'{}') INTO readers FROM unnest(readers) id WHERE id=ANY(current_readers); END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('selection',selection->'doc','restrictedTo',to_jsonb(readers));
END $$;
CREATE OR REPLACE FUNCTION core.reporter_memory_writing_source_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE receipt jsonb; selected jsonb; item jsonb; evidence jsonb; segment jsonb; original_count integer:=CASE WHEN TG_OP='UPDATE' THEN jsonb_array_length(coalesce(OLD.doc->'memory','[]')) ELSE 0 END;
BEGIN
  IF NOT NEW.doc ? 'memory' AND original_count=0 THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.doc->'memory') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.doc->'memory')<original_count
    OR (SELECT coalesce(jsonb_agg(v ORDER BY n),'[]') FROM jsonb_array_elements(NEW.doc->'memory') WITH ORDINALITY a(v,n) WHERE n<=original_count)
      IS DISTINCT FROM (CASE WHEN TG_OP='UPDATE' THEN coalesce(OLD.doc->'memory','[]') ELSE '[]'::jsonb END) THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF original_count>0 AND (jsonb_array_length(NEW.doc->'versions')<jsonb_array_length(OLD.doc->'versions') OR
    (SELECT jsonb_agg(v ORDER BY n) FROM jsonb_array_elements(NEW.doc->'versions') WITH ORDINALITY a(v,n) WHERE n<=jsonb_array_length(OLD.doc->'versions'))
      IS DISTINCT FROM OLD.doc->'versions') THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF original_count>0 AND NEW.doc-ARRAY['rights','versions','memory'] IS DISTINCT FROM OLD.doc-ARRAY['rights','versions','memory'] THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF jsonb_array_length(NEW.doc->'versions') IS DISTINCT FROM jsonb_array_length(NEW.doc->'memory') THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF (SELECT count(DISTINCT v->'version'->>'number') FROM jsonb_array_elements(NEW.doc->'memory') v)<>jsonb_array_length(NEW.doc->'memory') THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  FOR receipt IN SELECT v FROM jsonb_array_elements(NEW.doc->'memory') WITH ORDINALITY a(v,n) WHERE n>original_count LOOP
    SELECT h.doc INTO selected FROM public.reporter_memory_history h WHERE h.portal_id=NEW.portal_id AND h.kind='selection' AND h.id=receipt->'selection'->>'id'
      AND h.doc->'revision'=receipt->'selection'->'revision' ORDER BY seq DESC LIMIT 1;
    IF selected IS NULL OR NOT core.reporter_memory_doc_visible(NEW.portal_id,'selection',selected,NULL)
      OR (SELECT jsonb_agg(v->'selected' ORDER BY n) FROM jsonb_array_elements(receipt->'items') WITH ORDINALITY a(v,n)) IS DISTINCT FROM selected->'items'
      OR NOT EXISTS(SELECT FROM jsonb_array_elements(NEW.doc->'versions') v
        WHERE v->'number'=receipt->'version'->'number' AND v->>'hash'=receipt->'version'->>'hash'
          AND (SELECT jsonb_agg(s->>'id' ORDER BY n) FROM jsonb_array_elements(v->'content'->'segments') WITH ORDINALITY a(s,n))=
            (SELECT jsonb_agg(i->>'segmentId' ORDER BY n) FROM jsonb_array_elements(receipt->'items') WITH ORDINALITY a(i,n))) THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(receipt->'items') LOOP
      SELECT h.doc INTO evidence FROM public.reporter_memory_heads h WHERE h.portal_id=NEW.portal_id AND h.kind='evidence' AND h.id=item->'selected'->'evidence'->>'id'
        AND h.fingerprint=item->'selected'->'evidence'->>'hash' AND h.doc->'revision'=item->'selected'->'evidence'->'revision';
      SELECT s INTO segment FROM jsonb_array_elements(NEW.doc->'versions') v CROSS JOIN LATERAL jsonb_array_elements(v->'content'->'segments') s
        WHERE v->'number'=receipt->'version'->'number' AND s->>'id'=item->>'segmentId';
      IF evidence IS NULL OR evidence->'anchor' IS DISTINCT FROM item->'anchor' OR evidence->>'materialId' IS DISTINCT FROM item->>'materialId'
        OR evidence->'metadata' IS DISTINCT FROM item->'metadata' OR evidence->>'kind' IS DISTINCT FROM item->>'kind'
        OR segment->>'text' IS DISTINCT FROM evidence->'anchor'->>'excerpt'
        OR evidence->>'kind'='citation' AND (evidence->>'authorConfirmed' IS DISTINCT FROM 'true' OR NOT EXISTS(SELECT FROM jsonb_array_elements(NEW.doc->'speakers') speaker
          WHERE speaker->>'label'=segment->>'speaker' AND speaker->>'personId'=evidence->>'personId'))
        OR evidence->>'kind'='statistic' AND segment ? 'speaker' OR NOT selected->'items' @> jsonb_build_array(item->'selected')
        THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER reporter_memory_writing_source_guard BEFORE INSERT OR UPDATE ON public.reporter_ed_sources
  FOR EACH ROW EXECUTE FUNCTION core.reporter_memory_writing_source_guard();
CREATE OR REPLACE FUNCTION public.reporter_memory_writing_sources(p_production text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); result jsonb;
BEGIN
  IF NOT core.reporter_memory_visible(portal,p_production) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(s.doc),'[]') INTO result FROM public.reporter_ed_sources s JOIN public.reporter_ed_productions p
    ON p.portal_id=s.portal_id AND p.source_ids @> ARRAY[s.source_id] WHERE p.portal_id=portal AND p.production_id=p_production AND s.doc ? 'memory';
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_record_insertion(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); piece jsonb; production jsonb; body jsonb; block jsonb; original jsonb; receipt jsonb; binding jsonb; segment jsonb;
  selected jsonb; evidence public.reporter_memory_history; literal text; actual text; document jsonb; use_id text; existing jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit');
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_input) key WHERE key NOT IN
    ('productionId','pieceId','draftRevision','articleHash','blockId','from','to','source')) OR jsonb_typeof(p_input->'from') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_input->'to') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  SELECT doc INTO production FROM public.reporter_ed_productions WHERE portal_id=portal AND production_id=p_input->>'productionId';
  IF production IS NULL OR NOT core.reporter_memory_visible(portal,p_input->>'productionId') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT doc INTO piece FROM public.reporter_ed_parts WHERE portal_id=portal AND kind='piece' AND part_id=p_input->>'pieceId' AND production_id=p_input->>'productionId' AND NOT deleted;
  IF piece IS NULL OR piece->'draft'->'revision' IS DISTINCT FROM p_input->'draftRevision' OR piece->>'kind' IS DISTINCT FROM 'article'
    OR p_input->>'articleHash' !~ '^[a-f0-9]{16}$' THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  body:=piece->'draft'->'body';
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
  use_id:='memory-inserted-'||md5(jsonb_build_array(p_input,binding->'selected'->'evidence')::text);
  document:=(p_input-'source')||jsonb_build_object('id',use_id,'workspaceId',portal,'stage','inserted','evidence',binding->'selected'->'evidence',
    'sourceRange',jsonb_build_object('from',p_input->'source'->'from','to',p_input->'source'->'to'),'personId',piece->'draft'->'updatedBy','at',piece->'draft'->'updatedAt');
  existing:=public.reporter_memory_get('use',use_id);
  IF existing IS NOT NULL THEN RETURN existing->'doc'; END IF;
  PERFORM public.reporter_memory_put(jsonb_build_object('kind','use','id',use_id,'expected',NULL,'doc',document,'parentKind','evidence','parentId',evidence.id));
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,after_data,source,request_id)
    VALUES(portal,core.context_user_id(),'memory.use.inserted','memory_use',document,'reporter_ai',nullif(current_setting('app.request_id',true),'')::uuid);
  RETURN document;
END $$;
DO $$ DECLARE signature text; BEGIN
  FOREACH signature IN ARRAY ARRAY['core.reporter_memory_utf16_slice(text,integer,integer)','core.reporter_memory_block_text(jsonb)',
    'core.reporter_memory_writing_source_guard()','public.reporter_memory_selection_scope(text)','public.reporter_memory_writing_sources(text)','public.reporter_memory_record_insertion(jsonb)'] LOOP
    EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO reporter_executor'; EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC';
    IF signature LIKE 'public.%' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO reporter_runtime,reporter_worker'; END IF;
  END LOOP;
END $$;
COMMIT;
