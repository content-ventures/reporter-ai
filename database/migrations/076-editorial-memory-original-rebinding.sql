-- Reuse the existing write-access rule when binding an already owned batch original.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_memory_batch_bind(p_batch uuid,p_item uuid,p_revision integer,p_original uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); item public.reporter_memory_batch_items; original public.reporter_memory_originals;
BEGIN
  IF NOT core.reporter_memory_batch_access(p_batch,true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO item FROM public.reporter_memory_batch_items WHERE portal_id=portal AND batch_id=p_batch AND id=p_item FOR UPDATE;
  SELECT * INTO original FROM public.reporter_memory_originals WHERE portal_id=portal AND id=p_original;
  IF item.id IS NULL OR item.revision IS DISTINCT FROM p_revision OR item.original_id IS NOT NULL AND item.original_id<>p_original THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF original.id IS NULL OR public.reporter_memory_original(p_original,true) IS NULL
    OR original.file_name IS DISTINCT FROM item.file->>'name' OR original.byte_size::bigint IS DISTINCT FROM (item.file->>'size')::bigint
    OR original.checksum IS DISTINCT FROM item.file->>'checksum' OR original.delimiter IS DISTINCT FROM item.file->>'delimiter'
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF item.original_id=p_original THEN RETURN true; END IF;
  UPDATE public.reporter_memory_batch_items SET original_id=p_original,issue=NULL,updated_by=core.context_user_id(),updated_at=clock_timestamp()
    WHERE portal_id=portal AND batch_id=p_batch AND id=p_item;
  PERFORM core.reporter_memory_batch_audit(p_batch,p_item,'memory.batch.item.original',NULL,jsonb_build_object('originalId',p_original,'revision',p_revision));
  RETURN true;
END $$;
ALTER FUNCTION public.reporter_memory_batch_bind(uuid,uuid,integer,uuid) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_batch_bind(uuid,uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_batch_bind(uuid,uuid,integer,uuid) TO reporter_runtime,reporter_worker;
COMMIT;
