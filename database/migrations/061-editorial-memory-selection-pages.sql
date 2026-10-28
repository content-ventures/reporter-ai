-- Recover saved selections with the same current visibility and signed snapshot contract.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_memory_selection_page(p_snapshot bigint,p_after jsonb,p_limit integer,p_visibility text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); context jsonb:=public.reporter_memory_context(); result jsonb;
BEGIN
  IF p_visibility IS DISTINCT FROM context->>'visibility' THEN RAISE EXCEPTION 'MEMORY_CURSOR_INVALID'; END IF;
  IF p_snapshot IS NULL OR p_snapshot<0 OR p_snapshot>(context->>'snapshot')::bigint OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR p_after IS NOT NULL AND (p_after->>'key' !~ '^[0-9]{1,19}$' OR p_after->>'id' IS NULL) THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  WITH latest AS (SELECT DISTINCT ON(id) id,doc,origin_production_id,seq FROM public.reporter_memory_history
    WHERE portal_id=portal AND kind='selection' AND seq<=p_snapshot ORDER BY id,seq DESC), visible AS MATERIALIZED (
    SELECT * FROM latest WHERE core.reporter_memory_doc_visible(portal,'selection',doc,origin_production_id)), page AS MATERIALIZED (
    SELECT * FROM visible WHERE p_after IS NULL OR seq<(p_after->>'key')::bigint OR seq=(p_after->>'key')::bigint AND id>p_after->>'id'
    ORDER BY seq DESC,id LIMIT p_limit), last_item AS (SELECT * FROM page ORDER BY seq,id DESC LIMIT 1)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(doc ORDER BY seq DESC,id) FROM page),'[]'),'total',(SELECT count(*) FROM visible),
    'snapshot',p_snapshot::text,'next',CASE WHEN EXISTS(SELECT FROM visible v,last_item last WHERE v.seq<last.seq OR v.seq=last.seq AND v.id>last.id)
      THEN (SELECT jsonb_build_object('key',seq::text,'id',id) FROM last_item) ELSE NULL END) INTO result;
  RETURN result;
END $$;
ALTER FUNCTION public.reporter_memory_selection_page(bigint,jsonb,integer,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_selection_page(bigint,jsonb,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_selection_page(bigint,jsonb,integer,text) TO reporter_runtime,reporter_worker;
COMMIT;
