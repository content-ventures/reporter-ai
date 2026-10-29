-- Compact candidate context; never return the original document body for a comparison.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_memory_batch_candidate(p_batch uuid,p_item uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); candidate_id text; material jsonb; source jsonb; original jsonb;
BEGIN
  IF NOT core.reporter_memory_batch_access(p_batch) THEN RETURN NULL; END IF;
  SELECT i.result->'candidate'->>'id' INTO candidate_id FROM public.reporter_memory_batch_items i
    WHERE i.portal_id=portal AND i.batch_id=p_batch AND i.id=p_item;
  IF candidate_id IS NULL OR NOT core.reporter_memory_batch_material_visible(candidate_id) THEN RETURN NULL; END IF;
  SELECT m.doc,s.doc INTO material,source FROM public.reporter_memory_heads m
    JOIN public.reporter_ed_sources s ON s.portal_id=m.portal_id AND s.source_id=m.source_id
    WHERE m.portal_id=portal AND m.kind='material' AND m.id=candidate_id;
  IF material IS NULL THEN RETURN NULL; END IF;
  IF material->>'originalFileId' IS NOT NULL THEN original:=public.reporter_memory_original((material->>'originalFileId')::uuid); END IF;
  RETURN jsonb_build_object('material',material,'authorized',coalesce((source->'rights'->>'authorized')::boolean,false),'original',original);
END $$;
ALTER FUNCTION public.reporter_memory_batch_candidate(uuid,uuid) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_batch_candidate(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_batch_candidate(uuid,uuid) TO reporter_runtime,reporter_worker;
COMMIT;
