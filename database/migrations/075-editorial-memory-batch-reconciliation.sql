-- Atomic material creation/reconciliation and stable creation-order batch pagination.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_memory_batch_ready(p_batch uuid,p_item uuid,p_revision integer,p_original uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); item public.reporter_memory_batch_items;
BEGIN
  IF NOT core.reporter_memory_batch_access(p_batch,true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO item FROM public.reporter_memory_batch_items WHERE portal_id=portal AND batch_id=p_batch AND id=p_item FOR UPDATE;
  IF item.id IS NULL OR item.revision IS DISTINCT FROM p_revision OR item.original_id IS DISTINCT FROM p_original THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF public.reporter_memory_original(p_original,true)->>'status' IS DISTINCT FROM 'stored' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  UPDATE public.reporter_memory_batch_items SET issue=NULL,updated_by=core.context_user_id(),updated_at=clock_timestamp()
    WHERE portal_id=portal AND batch_id=p_batch AND id=p_item;
  PERFORM core.reporter_memory_batch_audit(p_batch,p_item,'memory.batch.item.ready',NULL,jsonb_build_object('originalId',p_original,'revision',p_revision)); RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_batch_commit(p_batch uuid,p_item uuid,p_revision integer,p_bundle jsonb,p_decision jsonb DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); item public.reporter_memory_batch_items; original public.reporter_memory_originals;
  proposed jsonb:=p_bundle->'material'; candidate public.reporter_memory_heads; candidate_original public.reporter_memory_originals;
  candidate_source jsonb; basis jsonb; matches boolean; outcome jsonb; imported jsonb;
BEGIN
  IF NOT core.reporter_memory_batch_access(p_batch,true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO item FROM public.reporter_memory_batch_items WHERE portal_id=portal AND batch_id=p_batch AND id=p_item FOR UPDATE;
  IF item.id IS NULL OR item.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF item.result->>'status' IN ('included','existing') OR item.result->>'status'='pending_review' AND p_decision IS NULL THEN RETURN true; END IF;
  SELECT * INTO original FROM public.reporter_memory_originals WHERE portal_id=portal AND id=item.original_id;
  IF original.id IS NULL OR original.status<>'stored' OR public.reporter_memory_original(original.id,true) IS NULL
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF p_decision IS NOT NULL AND (jsonb_typeof(p_decision) IS DISTINCT FROM 'object' OR p_decision-ARRAY['choice','reason','expected']<>'{}'::jsonb OR coalesce(p_decision->>'choice','') NOT IN ('reuse','distinct')
    OR p_decision->>'reason' IS NULL
    OR length(btrim(p_decision->>'reason')) NOT BETWEEN 1 AND 2000 OR item.result->>'status' IS DISTINCT FROM 'pending_review'
    OR p_decision->'expected' IS DISTINCT FROM item.result->'candidate') THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  -- The content lock serializes imports, not storage. Exact hash predicates still decide identity.
  PERFORM pg_advisory_xact_lock(hashtextextended('memory-batch-file:'||portal::text||':'||original.checksum,0));
  SELECT m.* INTO candidate FROM public.reporter_memory_originals o JOIN public.reporter_memory_heads m
    ON m.portal_id=o.portal_id AND m.kind='material' AND m.doc->>'originalFileId'=o.id::text
    JOIN public.reporter_ed_sources s ON s.portal_id=m.portal_id AND s.source_id=m.source_id
    WHERE o.portal_id=portal AND o.checksum=original.checksum AND core.reporter_memory_batch_material_visible(m.id)
      AND (p_decision IS NULL OR m.id=p_decision->'expected'->>'id')
    ORDER BY (m.doc->'metadata'=item.input->'metadata' AND m.doc->>'kind'=item.input->>'kind'
      AND m.doc->'source'->>'sourceVersion'='1' AND o.format=original.format AND o.delimiter IS NOT DISTINCT FROM original.delimiter
      AND (s.doc->'rights'->>'authorized')::boolean=(item.input->>'authorized')::boolean
      AND m.doc->>'primaryOrigin'=coalesce(item.input->>'primaryOrigin',item.input->'metadata'->>'originalUrl',proposed->>'primaryOrigin')) DESC NULLS LAST,
      m.doc->>'importedAt',m.id LIMIT 1 FOR SHARE OF m,s;
  IF candidate.id IS NOT NULL THEN
    SELECT * INTO candidate_original FROM public.reporter_memory_originals WHERE portal_id=portal AND id=(candidate.doc->>'originalFileId')::uuid;
    SELECT doc INTO candidate_source FROM public.reporter_ed_sources WHERE portal_id=portal AND source_id=candidate.source_id;
    basis:=jsonb_build_object('id',candidate.id,'revision',(candidate.doc->>'revision')::integer,'source',candidate.doc->'source');
    IF p_decision IS NOT NULL AND basis IS DISTINCT FROM p_decision->'expected' THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    matches:=candidate.doc->'metadata'=item.input->'metadata' AND candidate.doc->>'kind'=item.input->>'kind'
      AND candidate.doc->'source'->>'sourceVersion'='1' AND candidate_original.format=original.format
      AND candidate_original.delimiter IS NOT DISTINCT FROM original.delimiter
      AND (candidate_source->'rights'->>'authorized')::boolean=(item.input->>'authorized')::boolean
      AND candidate.doc->>'primaryOrigin'=coalesce(item.input->>'primaryOrigin',item.input->'metadata'->>'originalUrl',proposed->>'primaryOrigin');
    IF p_decision IS NULL AND matches IS NOT TRUE THEN
      outcome:=jsonb_build_object('status','pending_review','candidate',basis);
    ELSIF p_decision->>'choice' IS DISTINCT FROM 'distinct' THEN
      outcome:=jsonb_build_object('status','existing','materialId',candidate.id,'candidate',basis);
    END IF;
  ELSIF p_decision IS NOT NULL THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF outcome IS NULL THEN
    IF p_bundle IS NULL OR proposed->>'originalFileId' IS DISTINCT FROM original.id::text OR proposed->>'title' IS DISTINCT FROM item.input->>'title'
      OR proposed->>'kind' IS DISTINCT FROM item.input->>'kind' OR proposed->'metadata' IS DISTINCT FROM item.input->'metadata'
      OR p_bundle->'source'->'rights'->'authorized' IS DISTINCT FROM item.input->'authorized'
      OR item.input->>'primaryOrigin' IS NOT NULL AND proposed->>'primaryOrigin' IS DISTINCT FROM item.input->>'primaryOrigin'
      THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
    imported:=public.reporter_memory_import(p_bundle->'source',proposed,p_bundle->'job',p_bundle->'blocks');
    outcome:=jsonb_build_object('status','included','materialId',imported->'material'->>'id','candidate',basis);
  END IF;
  UPDATE public.reporter_memory_batch_items SET result=outcome,issue=NULL,reason=p_decision->>'reason',updated_by=core.context_user_id(),updated_at=clock_timestamp()
    WHERE portal_id=portal AND batch_id=p_batch AND id=p_item;
  PERFORM core.reporter_memory_batch_audit(p_batch,p_item,'memory.batch.item.reconciled',item.result,outcome||jsonb_build_object('reason',p_decision->>'reason','revision',p_revision)); RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_batch_page(p_snapshot bigint,p_after bigint,p_limit integer,p_visibility text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); context jsonb:=public.reporter_memory_context(); ceiling bigint; result jsonb;
BEGIN
  IF p_visibility IS DISTINCT FROM context->>'visibility' THEN RAISE EXCEPTION 'MEMORY_CURSOR_INVALID'; END IF;
  SELECT coalesce(max(seq),0) INTO ceiling FROM public.reporter_memory_batches WHERE portal_id=portal AND (created_by=core.context_user_id() OR core.reporter_memory_is_admin(portal));
  p_snapshot:=coalesce(p_snapshot,ceiling);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_snapshot<0 OR p_snapshot>ceiling OR p_after IS NOT NULL AND p_after<0
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  WITH visible AS MATERIALIZED (SELECT * FROM public.reporter_memory_batches WHERE portal_id=portal AND seq<=p_snapshot AND (created_by=core.context_user_id() OR core.reporter_memory_is_admin(portal))),
  page AS MATERIALIZED (SELECT * FROM visible WHERE p_after IS NULL OR seq<p_after ORDER BY seq DESC LIMIT p_limit+1),
  shown AS (SELECT * FROM page ORDER BY seq DESC LIMIT p_limit)
  SELECT jsonb_build_object('snapshot',p_snapshot::text,'total',(SELECT count(*) FROM visible),'items',coalesce((SELECT jsonb_agg(
    jsonb_build_object('id',b.id,'workspaceId',portal,'title',b.title,'createdBy',b.created_by,'createdAt',b.created_at,'updatedAt',b.updated_at,
      'total',(SELECT count(*) FROM public.reporter_memory_batch_items i WHERE i.portal_id=portal AND i.batch_id=b.id),
      'resolved',(SELECT count(*) FROM public.reporter_memory_batch_items i WHERE i.portal_id=portal AND i.batch_id=b.id AND i.result->>'status' IN ('included','existing')),
      'pendingReview',(SELECT count(*) FROM public.reporter_memory_batch_items i WHERE i.portal_id=portal AND i.batch_id=b.id AND i.result->>'status'='pending_review'),
      'refused',(SELECT count(*) FROM public.reporter_memory_batch_items i WHERE i.portal_id=portal AND i.batch_id=b.id AND i.issue->>'terminal'='true')) ORDER BY b.seq DESC) FROM shown b),'[]'),
    'next',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT jsonb_build_object('key',seq::text,'id',id) FROM shown ORDER BY seq LIMIT 1) END) INTO result;
  RETURN result;
END $$;
ALTER FUNCTION public.reporter_memory_batch_ready(uuid,uuid,integer,uuid) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_memory_batch_commit(uuid,uuid,integer,jsonb,jsonb) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_memory_batch_page(bigint,bigint,integer,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_batch_ready(uuid,uuid,integer,uuid),public.reporter_memory_batch_commit(uuid,uuid,integer,jsonb,jsonb),public.reporter_memory_batch_page(bigint,bigint,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_batch_ready(uuid,uuid,integer,uuid),public.reporter_memory_batch_commit(uuid,uuid,integer,jsonb,jsonb),public.reporter_memory_batch_page(bigint,bigint,integer,text) TO reporter_runtime,reporter_worker;
COMMIT;
