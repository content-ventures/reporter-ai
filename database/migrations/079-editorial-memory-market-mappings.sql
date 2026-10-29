-- Saved, auditable column choices belong to a specific visible material and original version.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_memory_market_mappings (
  portal_id uuid NOT NULL, tenant_id uuid NOT NULL, material_id text NOT NULL,
  revision integer NOT NULL CHECK(revision>0), doc jsonb NOT NULL CHECK(jsonb_typeof(doc)='object'),
  PRIMARY KEY(portal_id,material_id), FOREIGN KEY(tenant_id,portal_id) REFERENCES public.portals(tenant_id,id)
);
ALTER TABLE public.reporter_memory_market_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reporter_memory_market_mappings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_memory_market_mappings FROM PUBLIC,reporter_runtime,reporter_worker;
GRANT SELECT,INSERT,UPDATE ON public.reporter_memory_market_mappings TO reporter_executor;
DROP POLICY IF EXISTS reporter_memory_market_mappings_scope ON public.reporter_memory_market_mappings;
CREATE POLICY reporter_memory_market_mappings_scope ON public.reporter_memory_market_mappings TO reporter_executor
  USING(portal_id=nullif(current_setting('app.portal_id',true),'')::uuid AND tenant_id=core.context_tenant_id())
  WITH CHECK(portal_id=nullif(current_setting('app.portal_id',true),'')::uuid AND tenant_id=core.context_tenant_id());

CREATE OR REPLACE FUNCTION public.reporter_memory_market_mapping(p_material text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); material jsonb:=public.reporter_memory_get('material',p_material); result jsonb;
BEGIN
  IF material IS NULL OR NOT core.reporter_memory_source_visible(portal,material->>'source_id',material->>'origin_production_id') THEN RETURN NULL; END IF;
  SELECT doc INTO result FROM public.reporter_memory_market_mappings WHERE portal_id=portal AND material_id=p_material;
  IF result IS NOT NULL AND public.reporter_memory_original((result->>'originalFileId')::uuid,false) IS NULL THEN RETURN NULL; END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_memory_market_mapping_save(p_material text,p_expected integer,p_doc jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); material jsonb; file jsonb; previous jsonb; result jsonb; current_revision integer;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit');
  IF p_expected IS NULL OR p_expected<0 OR jsonb_typeof(p_doc) IS DISTINCT FROM 'object'
    OR p_doc-ARRAY['source','originalFileId','checksum','mapping']<>'{}'::jsonb OR NOT p_doc ?& ARRAY['source','originalFileId','checksum','mapping']
    OR jsonb_typeof(p_doc->'mapping') IS DISTINCT FROM 'object'
    OR NOT (p_doc->'mapping') ?& ARRAY['institution','indicator','value','unit','period']
    OR (p_doc->'mapping')-ARRAY['institution','indicator','value','unit','period','geography','population','qualifier']<>'{}'::jsonb
    OR EXISTS(SELECT FROM jsonb_each(p_doc->'mapping') f WHERE jsonb_typeof(f.value) IS DISTINCT FROM 'object'
      OR f.value-ARRAY['record','column']<>'{}'::jsonb OR NOT f.value ?& ARRAY['record','column']
      OR jsonb_typeof(f.value->'record') IS DISTINCT FROM 'string' OR f.value->>'record' NOT IN ('header','row')
      OR jsonb_typeof(f.value->'column') IS DISTINCT FROM 'number' OR f.value->>'column' !~ '^(0|[1-9][0-9]{0,2})$'
      OR CASE WHEN f.value->>'column' ~ '^(0|[1-9][0-9]{0,2})$' THEN (f.value->>'column')::integer>127 ELSE true END)
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  PERFORM core.reporter_memory_lock(portal);
  material:=public.reporter_memory_get('material',p_material);
  IF material IS NULL OR NOT core.reporter_memory_source_visible(portal,material->>'source_id',material->>'origin_production_id') THEN RETURN NULL; END IF;
  file:=public.reporter_memory_original((p_doc->>'originalFileId')::uuid,false);
  IF material->'doc'->>'kind' IS DISTINCT FROM 'market_data' OR material->'doc'->'source' IS DISTINCT FROM p_doc->'source'
    OR material->'doc'->>'originalFileId' IS DISTINCT FROM p_doc->>'originalFileId' OR file->>'status' IS DISTINCT FROM 'stored'
    OR file->>'checksum' IS DISTINCT FROM p_doc->>'checksum' OR file->>'format' NOT IN ('csv','tsv') THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  SELECT doc,revision INTO previous,current_revision FROM public.reporter_memory_market_mappings WHERE portal_id=portal AND material_id=p_material FOR UPDATE;
  IF coalesce(current_revision,0)<>p_expected THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  result:=p_doc||jsonb_build_object('materialId',p_material,'revision',p_expected+1,'updatedBy',core.context_user_id(),'updatedAt',clock_timestamp());
  INSERT INTO public.reporter_memory_market_mappings(portal_id,tenant_id,material_id,revision,doc)
    VALUES(portal,core.context_tenant_id(),p_material,p_expected+1,result)
    ON CONFLICT(portal_id,material_id) DO UPDATE SET revision=excluded.revision,doc=excluded.doc;
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,before_data,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.market.mapping','memory_material',previous,result,'reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN result;
END $$;
ALTER FUNCTION public.reporter_memory_market_mapping(text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_memory_market_mapping_save(text,integer,jsonb) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_market_mapping(text),public.reporter_memory_market_mapping_save(text,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_market_mapping(text),public.reporter_memory_market_mapping_save(text,integer,jsonb) TO reporter_runtime,reporter_worker;
COMMIT;
