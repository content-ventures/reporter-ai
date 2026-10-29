-- Append reviewed collection versions without rewriting historical evidence or attribution.
BEGIN;
CREATE OR REPLACE FUNCTION core.reporter_memory_writing_source_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE receipt jsonb; selected jsonb; item jsonb; evidence jsonb; segment jsonb; version jsonb; previous jsonb; speaker jsonb; ordinal bigint;
  original_doc jsonb; original_count integer; speaker_count integer;
BEGIN
  IF TG_OP='UPDATE' THEN original_doc:=OLD.doc;
  ELSE SELECT doc INTO original_doc FROM public.reporter_ed_sources WHERE portal_id=NEW.portal_id AND source_id=NEW.source_id; END IF;
  original_count:=jsonb_array_length(coalesce(original_doc->'memory','[]'));
  speaker_count:=jsonb_array_length(coalesce(original_doc->'speakers','[]'));
  IF NOT NEW.doc ? 'memory' AND original_count=0 THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.doc->'memory') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.doc->'memory')<original_count
    OR (SELECT coalesce(jsonb_agg(v ORDER BY n),'[]') FROM jsonb_array_elements(NEW.doc->'memory') WITH ORDINALITY a(v,n) WHERE n<=original_count)
      IS DISTINCT FROM coalesce(original_doc->'memory','[]') THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF original_count>0 AND (jsonb_array_length(NEW.doc->'versions')<jsonb_array_length(original_doc->'versions') OR
    (SELECT jsonb_agg(v ORDER BY n) FROM jsonb_array_elements(NEW.doc->'versions') WITH ORDINALITY a(v,n) WHERE n<=jsonb_array_length(original_doc->'versions'))
      IS DISTINCT FROM original_doc->'versions') THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF original_count>0 AND NEW.doc-ARRAY['rights','versions','memory','speakers'] IS DISTINCT FROM original_doc-ARRAY['rights','versions','memory','speakers']
    THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF jsonb_array_length(NEW.doc->'versions') IS DISTINCT FROM jsonb_array_length(NEW.doc->'memory')
    OR jsonb_array_length(NEW.doc->'memory')>greatest(original_count,0)+1 THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF jsonb_typeof(NEW.doc->'speakers') IS DISTINCT FROM 'array'
    OR (SELECT count(DISTINCT s->>'label') FROM jsonb_array_elements(NEW.doc->'speakers') s)<>jsonb_array_length(NEW.doc->'speakers')
    OR EXISTS(SELECT FROM jsonb_array_elements(NEW.doc->'speakers') s WHERE coalesce(length(btrim(s->>'label')),0)=0)
    THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF original_count>0 AND (jsonb_array_length(NEW.doc->'speakers')<speaker_count OR
    (SELECT coalesce(jsonb_agg(s ORDER BY n),'[]') FROM jsonb_array_elements(NEW.doc->'speakers') WITH ORDINALITY a(s,n) WHERE n<=speaker_count)
      IS DISTINCT FROM original_doc->'speakers') THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  FOR receipt,ordinal IN SELECT v,n FROM jsonb_array_elements(NEW.doc->'memory') WITH ORDINALITY a(v,n) LOOP
    version:=NEW.doc->'versions'->(ordinal::integer-1);
    IF receipt->'version'->'number' IS DISTINCT FROM to_jsonb(ordinal) OR version->'number' IS DISTINCT FROM to_jsonb(ordinal)
      OR version->>'hash' IS DISTINCT FROM receipt->'version'->>'hash' THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    IF ordinal<=original_count THEN CONTINUE; END IF;
    IF original_count>0 AND (version->>'createdBy' IS DISTINCT FROM core.context_user_id()::text
      OR coalesce(length(btrim(version->>'note')),0) NOT BETWEEN 1 AND 2000) THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    IF receipt ? 'retired' THEN
      previous:=NEW.doc->'memory'->(ordinal::integer-2);
      IF receipt->'retired' IS DISTINCT FROM 'true'::jsonb OR original_count=0 OR ordinal<2
        OR coalesce(previous->'retired','false'::jsonb)='true'::jsonb OR receipt->'items' IS DISTINCT FROM '[]'::jsonb
        OR version->'content' IS DISTINCT FROM '{"type":"transcript","format":"plain","segments":[]}'::jsonb
        OR receipt->'selection' IS DISTINCT FROM previous->'selection' OR NEW.doc->'rights' IS DISTINCT FROM original_doc->'rights'
        THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
      CONTINUE;
    END IF;
    SELECT h.doc INTO selected FROM public.reporter_memory_history h WHERE h.portal_id=NEW.portal_id AND h.kind='selection' AND h.id=receipt->'selection'->>'id'
      AND h.doc->'revision'=receipt->'selection'->'revision' ORDER BY seq DESC LIMIT 1;
    IF selected IS NULL OR NOT core.reporter_memory_doc_visible(NEW.portal_id,'selection',selected,NULL)
      OR jsonb_typeof(receipt->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(receipt->'items')=0
      OR (SELECT jsonb_agg(v->'selected' ORDER BY n) FROM jsonb_array_elements(receipt->'items') WITH ORDINALITY a(v,n)) IS DISTINCT FROM selected->'items'
      OR (SELECT count(DISTINCT s->>'id') FROM jsonb_array_elements(version->'content'->'segments') s)<>jsonb_array_length(receipt->'items')
      OR (SELECT jsonb_agg(s->>'id' ORDER BY n) FROM jsonb_array_elements(version->'content'->'segments') WITH ORDINALITY a(s,n)) IS DISTINCT FROM
        (SELECT jsonb_agg(i->>'segmentId' ORDER BY n) FROM jsonb_array_elements(receipt->'items') WITH ORDINALITY a(i,n)) THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(receipt->'items') LOOP
      SELECT h.doc INTO evidence FROM public.reporter_memory_heads h WHERE h.portal_id=NEW.portal_id AND h.kind='evidence' AND h.id=item->'selected'->'evidence'->>'id'
        AND h.fingerprint=item->'selected'->'evidence'->>'hash' AND h.doc->'revision'=item->'selected'->'evidence'->'revision';
      SELECT s INTO segment FROM jsonb_array_elements(version->'content'->'segments') s WHERE s->>'id'=item->>'segmentId';
      IF evidence IS NULL OR evidence->'anchor' IS DISTINCT FROM item->'anchor' OR evidence->>'materialId' IS DISTINCT FROM item->>'materialId'
        OR evidence->'metadata' IS DISTINCT FROM item->'metadata' OR evidence->>'kind' IS DISTINCT FROM item->>'kind'
        OR segment->>'text' IS DISTINCT FROM evidence->'anchor'->>'excerpt'
        OR evidence->>'kind'='citation' AND (evidence->>'authorConfirmed' IS DISTINCT FROM 'true' OR NOT EXISTS(SELECT FROM jsonb_array_elements(NEW.doc->'speakers') s
          WHERE s->>'label'=segment->>'speaker' AND s->>'personId'=evidence->>'personId'))
        OR evidence->>'kind'='statistic' AND segment ? 'speaker' OR NOT selected->'items' @> jsonb_build_array(item->'selected')
        THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    END LOOP;
  END LOOP;
  -- New labels must belong to a verified appended excerpt; old labels remain immutable.
  FOR speaker IN SELECT s FROM jsonb_array_elements(NEW.doc->'speakers') WITH ORDINALITY a(s,n) WHERE n>CASE WHEN original_count>0 THEN speaker_count ELSE 0 END LOOP
    IF NOT EXISTS(SELECT FROM jsonb_array_elements(NEW.doc->'versions') WITH ORDINALITY a(v,n)
      CROSS JOIN LATERAL jsonb_array_elements(v->'content'->'segments') s WHERE n>original_count AND s->>'speaker'=speaker->>'label')
      THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
ALTER FUNCTION core.reporter_memory_writing_source_guard() OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_memory_writing_source_guard() FROM PUBLIC;
CREATE OR REPLACE FUNCTION core.reporter_memory_source_refresh_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE previous jsonb:=OLD.doc->'memory'->-1; receipt jsonb:=NEW.doc->'memory'->-1; version jsonb:=NEW.doc->'versions'->-1;
BEGIN
  IF previous IS NULL OR jsonb_array_length(NEW.doc->'memory')<=jsonb_array_length(OLD.doc->'memory') THEN RETURN NEW; END IF;
  PERFORM public.reporter_memory_authorize('library.edit');
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,before_data,after_data,source,request_id,correlation_id)
    VALUES(NEW.portal_id,core.context_user_id(),'memory.source.refresh','memory_source',jsonb_build_object('sourceId',NEW.source_id,'receipt',previous),
      jsonb_build_object('sourceId',NEW.source_id,'receipt',receipt,'reason',version->>'note','retired',coalesce(receipt->'retired','false'::jsonb)),
      'reporter_ai',nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN NEW;
END $$;
ALTER FUNCTION core.reporter_memory_source_refresh_audit() OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_memory_source_refresh_audit() FROM PUBLIC;
CREATE OR REPLACE TRIGGER reporter_memory_source_refresh_audit AFTER UPDATE OF doc ON public.reporter_ed_sources
  FOR EACH ROW EXECUTE FUNCTION core.reporter_memory_source_refresh_audit();
COMMIT;
