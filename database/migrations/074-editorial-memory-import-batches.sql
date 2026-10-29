-- Durable per-document manifests. External storage never runs while these rows are locked.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_memory_batches(
  portal_id uuid NOT NULL,tenant_id uuid NOT NULL,id uuid NOT NULL,title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  created_by uuid NOT NULL REFERENCES core.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),seq bigserial NOT NULL,
  PRIMARY KEY(portal_id,id),FOREIGN KEY(tenant_id,portal_id) REFERENCES public.portals(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS public.reporter_memory_batch_items(
  portal_id uuid NOT NULL,tenant_id uuid NOT NULL,batch_id uuid NOT NULL,id uuid NOT NULL,
  position smallint NOT NULL CHECK(position BETWEEN 0 AND 99),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  file jsonb NOT NULL CHECK(jsonb_typeof(file)='object'),input jsonb NOT NULL CHECK(jsonb_typeof(input)='object'),
  original_id uuid,result jsonb,issue jsonb,reason text CHECK(length(reason)<=2000),
  updated_by uuid NOT NULL REFERENCES core.users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(portal_id,batch_id,id),UNIQUE(portal_id,batch_id,position),
  FOREIGN KEY(portal_id,batch_id) REFERENCES public.reporter_memory_batches(portal_id,id),
  FOREIGN KEY(portal_id,original_id) REFERENCES public.reporter_memory_originals(portal_id,id),
  FOREIGN KEY(tenant_id,portal_id) REFERENCES public.portals(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS reporter_memory_batch_owner ON public.reporter_memory_batches(portal_id,created_by,seq DESC,id);
CREATE INDEX IF NOT EXISTS reporter_memory_batch_order ON public.reporter_memory_batches(portal_id,seq DESC,id);
CREATE INDEX IF NOT EXISTS reporter_memory_batch_original ON public.reporter_memory_batch_items(portal_id,original_id) WHERE original_id IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE public.reporter_memory_batches ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.reporter_memory_batches FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.reporter_memory_batch_items ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.reporter_memory_batch_items FORCE ROW LEVEL SECURITY;
END $$;
REVOKE ALL ON public.reporter_memory_batches,public.reporter_memory_batch_items FROM PUBLIC,reporter_runtime,reporter_worker;
GRANT SELECT,INSERT,UPDATE ON public.reporter_memory_batches,public.reporter_memory_batch_items TO reporter_executor;
GRANT USAGE,SELECT ON SEQUENCE public.reporter_memory_batches_seq_seq TO reporter_executor;
DROP POLICY IF EXISTS reporter_memory_batches_scope ON public.reporter_memory_batches;
CREATE POLICY reporter_memory_batches_scope ON public.reporter_memory_batches TO reporter_executor
  USING(portal_id=nullif(current_setting('app.portal_id',true),'')::uuid AND tenant_id=core.context_tenant_id())
  WITH CHECK(portal_id=nullif(current_setting('app.portal_id',true),'')::uuid AND tenant_id=core.context_tenant_id());
DROP POLICY IF EXISTS reporter_memory_batch_items_scope ON public.reporter_memory_batch_items;
CREATE POLICY reporter_memory_batch_items_scope ON public.reporter_memory_batch_items TO reporter_executor
  USING(portal_id=nullif(current_setting('app.portal_id',true),'')::uuid AND tenant_id=core.context_tenant_id())
  WITH CHECK(portal_id=nullif(current_setting('app.portal_id',true),'')::uuid AND tenant_id=core.context_tenant_id());

CREATE OR REPLACE FUNCTION core.reporter_memory_batch_access(p_id uuid,p_write boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal(CASE WHEN p_write THEN 'write' ELSE 'read' END);
BEGIN
  IF p_write THEN PERFORM public.reporter_memory_authorize('library.edit'); END IF;
  RETURN EXISTS(SELECT FROM public.reporter_memory_batches b WHERE b.portal_id=portal AND b.id=p_id
    AND (b.created_by=core.context_user_id() OR core.reporter_memory_is_admin(portal)));
END $$;
CREATE OR REPLACE FUNCTION core.reporter_memory_batch_material_visible(p_id text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(SELECT FROM public.reporter_memory_heads m WHERE m.portal_id=nullif(current_setting('app.portal_id',true),'')::uuid
    AND m.kind='material' AND m.id=p_id AND core.reporter_memory_doc_visible(m.portal_id,m.kind,m.doc,m.origin_production_id)
    AND core.reporter_memory_source_visible(m.portal_id,m.source_id,m.origin_production_id))
$$;
CREATE OR REPLACE FUNCTION core.reporter_memory_batch_audit(p_batch uuid,p_item uuid,p_action text,p_before jsonb,p_after jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write');
BEGIN
  UPDATE public.reporter_memory_batches SET updated_at=clock_timestamp() WHERE portal_id=portal AND id=p_batch;
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,entity_id,before_data,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),p_action,'memory_batch',coalesce(p_item,p_batch),p_before,p_after,'reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
END $$;
CREATE OR REPLACE FUNCTION core.reporter_memory_batch_item_doc(p_item public.reporter_memory_batch_items) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE original jsonb; material text:=p_item.result->>'materialId'; candidate jsonb:=p_item.result->'candidate'; job jsonb;
BEGIN
  IF p_item.original_id IS NOT NULL THEN original:=public.reporter_memory_original(p_item.original_id); END IF;
  IF material IS NOT NULL AND NOT core.reporter_memory_batch_material_visible(material) THEN material:=NULL; END IF;
  IF candidate IS NOT NULL AND NOT core.reporter_memory_batch_material_visible(candidate->>'id') THEN candidate:=NULL; END IF;
  IF material IS NOT NULL THEN job:=public.reporter_memory_material_detail(material)->'job'; END IF;
  RETURN jsonb_build_object('id',p_item.id,'position',p_item.position,'revision',p_item.revision,'file',p_item.file,'input',p_item.input,
    'status',coalesce(p_item.result->>'status',CASE WHEN p_item.issue->>'terminal'='true' THEN 'refused' WHEN p_item.issue IS NOT NULL THEN 'failed'
      WHEN original->>'status'='stored' THEN 'ready' WHEN original IS NOT NULL THEN 'uploading' ELSE 'needs_file' END),
    'original',original,'materialId',material,'candidate',candidate,'issue',p_item.issue,'job',job,'reason',p_item.reason,
    'updatedBy',p_item.updated_by,'updatedAt',p_item.updated_at);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_batch(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); batch public.reporter_memory_batches;
BEGIN
  IF NOT core.reporter_memory_batch_access(p_id) THEN RETURN NULL; END IF;
  SELECT * INTO batch FROM public.reporter_memory_batches WHERE portal_id=portal AND id=p_id;
  RETURN jsonb_build_object('id',batch.id,'workspaceId',portal,'title',batch.title,'createdBy',batch.created_by,'createdAt',batch.created_at,'updatedAt',batch.updated_at,
    'items',(SELECT coalesce(jsonb_agg(core.reporter_memory_batch_item_doc(i) ORDER BY position),'[]') FROM public.reporter_memory_batch_items i WHERE i.portal_id=portal AND i.batch_id=p_id));
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_batch_item(p_batch uuid,p_item uuid,p_revision integer DEFAULT NULL,p_write boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal(CASE WHEN p_write THEN 'write' ELSE 'read' END); item public.reporter_memory_batch_items;
BEGIN
  IF NOT core.reporter_memory_batch_access(p_batch,p_write) THEN RETURN NULL; END IF;
  SELECT * INTO item FROM public.reporter_memory_batch_items WHERE portal_id=portal AND batch_id=p_batch AND id=p_item;
  IF item.id IS NULL THEN RETURN NULL; END IF;
  IF p_revision IS NOT NULL AND item.revision<>p_revision THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  RETURN core.reporter_memory_batch_item_doc(item);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_batch_create(p_id uuid,p_title text,p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); item jsonb; ordinal integer;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit');
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 160 OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  INSERT INTO public.reporter_memory_batches(portal_id,tenant_id,id,title,created_by) VALUES(portal,core.context_tenant_id(),p_id,p_title,core.context_user_id());
  FOR item,ordinal IN SELECT value,n-1 FROM jsonb_array_elements(p_items) WITH ORDINALITY a(value,n) LOOP
    IF item-ARRAY['id','file','input','issue']<>'{}'::jsonb OR NOT item ?& ARRAY['id','file','input'] THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
    INSERT INTO public.reporter_memory_batch_items(portal_id,tenant_id,batch_id,id,position,file,input,issue,updated_by)
      VALUES(portal,core.context_tenant_id(),p_id,(item->>'id')::uuid,ordinal,item->'file',item->'input',nullif(item->'issue','null'),core.context_user_id());
  END LOOP;
  PERFORM core.reporter_memory_batch_audit(p_id,NULL,'memory.batch.created',NULL,public.reporter_memory_batch(p_id));
  RETURN jsonb_build_object('id',p_id);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_batch_update(p_batch uuid,p_item uuid,p_revision integer,p_value jsonb,p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); item public.reporter_memory_batch_items; previous jsonb;
BEGIN
  IF NOT core.reporter_memory_batch_access(p_batch,true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO item FROM public.reporter_memory_batch_items WHERE portal_id=portal AND batch_id=p_batch AND id=p_item FOR UPDATE;
  IF item.id IS NULL OR item.revision IS DISTINCT FROM p_revision OR item.result->>'status' IN ('included','existing') THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 OR jsonb_typeof(p_value) IS DISTINCT FROM 'object'
    OR p_value-ARRAY['file','input','issue']<>'{}'::jsonb OR NOT p_value ?& ARRAY['file','input'] THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  previous:=core.reporter_memory_batch_item_doc(item);
  UPDATE public.reporter_memory_batch_items SET revision=revision+1,file=p_value->'file',input=p_value->'input',issue=nullif(p_value->'issue','null'),
    original_id=CASE WHEN item.file=p_value->'file' AND EXISTS(SELECT FROM public.reporter_memory_originals WHERE portal_id=portal AND id=item.original_id AND status='stored') THEN item.original_id END,result=NULL,reason=p_reason,updated_by=core.context_user_id(),updated_at=clock_timestamp() WHERE portal_id=portal AND batch_id=p_batch AND id=p_item;
  PERFORM core.reporter_memory_batch_audit(p_batch,p_item,'memory.batch.item.updated',previous,public.reporter_memory_batch_item(p_batch,p_item));
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_batch_bind(p_batch uuid,p_item uuid,p_revision integer,p_original uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); item public.reporter_memory_batch_items; original public.reporter_memory_originals;
BEGIN
  IF NOT core.reporter_memory_batch_access(p_batch,true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO item FROM public.reporter_memory_batch_items WHERE portal_id=portal AND batch_id=p_batch AND id=p_item FOR UPDATE;
  SELECT * INTO original FROM public.reporter_memory_originals WHERE portal_id=portal AND id=p_original;
  IF item.id IS NULL OR item.revision IS DISTINCT FROM p_revision OR item.original_id IS NOT NULL AND item.original_id<>p_original THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF original.id IS NULL OR (original.created_by<>core.context_user_id() AND NOT core.reporter_memory_is_admin(portal))
    OR original.file_name IS DISTINCT FROM item.file->>'name' OR original.byte_size::bigint IS DISTINCT FROM (item.file->>'size')::bigint
    OR original.checksum IS DISTINCT FROM item.file->>'checksum'
    OR original.delimiter IS DISTINCT FROM item.file->>'delimiter' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF item.original_id=p_original THEN RETURN true; END IF;
  UPDATE public.reporter_memory_batch_items SET original_id=p_original,issue=NULL,updated_by=core.context_user_id(),updated_at=clock_timestamp()
    WHERE portal_id=portal AND batch_id=p_batch AND id=p_item;
  PERFORM core.reporter_memory_batch_audit(p_batch,p_item,'memory.batch.item.original',NULL,jsonb_build_object('originalId',p_original,'revision',p_revision));
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_batch_issue(p_batch uuid,p_item uuid,p_revision integer,p_issue jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); item public.reporter_memory_batch_items;
BEGIN
  IF NOT core.reporter_memory_batch_access(p_batch,true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO item FROM public.reporter_memory_batch_items WHERE portal_id=portal AND batch_id=p_batch AND id=p_item FOR UPDATE;
  IF item.id IS NULL OR item.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF item.result IS NOT NULL THEN RETURN false; END IF;
  IF jsonb_typeof(p_issue) IS DISTINCT FROM 'object' OR p_issue-ARRAY['code','message','terminal']<>'{}'::jsonb
    OR length(p_issue->>'code') NOT BETWEEN 1 AND 120 OR length(p_issue->>'message') NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(p_issue->'terminal') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  UPDATE public.reporter_memory_batch_items SET issue=p_issue,updated_by=core.context_user_id(),updated_at=clock_timestamp()
    WHERE portal_id=portal AND batch_id=p_batch AND id=p_item;
  PERFORM core.reporter_memory_batch_audit(p_batch,p_item,'memory.batch.item.issue',item.issue,p_issue); RETURN true;
END $$;

-- A batch's original remains writable by its owner after an administrator resumes the upload.
CREATE OR REPLACE FUNCTION public.reporter_memory_original(p_id uuid,p_write boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal(CASE WHEN p_write THEN 'write' ELSE 'read' END); original public.reporter_memory_originals;
BEGIN
  IF p_write IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF p_write THEN PERFORM public.reporter_memory_authorize('library.edit'); END IF;
  SELECT * INTO original FROM public.reporter_memory_originals o WHERE o.portal_id=portal AND o.id=p_id AND o.tenant_id=core.context_tenant_id();
  IF original.id IS NULL THEN RETURN NULL; END IF;
  IF original.created_by<>core.context_user_id() AND NOT core.reporter_memory_is_admin(portal)
    AND NOT EXISTS(SELECT FROM public.reporter_memory_batch_items i JOIN public.reporter_memory_batches b ON b.portal_id=i.portal_id AND b.id=i.batch_id
      WHERE i.portal_id=portal AND i.original_id=p_id AND b.created_by=core.context_user_id())
    AND (p_write OR NOT EXISTS(SELECT FROM public.reporter_memory_heads m WHERE m.portal_id=portal AND m.kind='material' AND m.doc->>'originalFileId'=p_id::text
      AND core.reporter_memory_doc_visible(portal,m.kind,m.doc,m.origin_production_id) AND core.reporter_memory_source_visible(portal,m.source_id,m.origin_production_id)))
    THEN RETURN NULL; END IF;
  RETURN core.reporter_memory_original_doc(original);
END $$;
DO $$ DECLARE entry record; BEGIN
  FOR entry IN SELECT oid::regprocedure AS signature,pronamespace FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'core'::regnamespace)
    AND proname IN ('reporter_memory_batch_access','reporter_memory_batch_material_visible','reporter_memory_batch_audit','reporter_memory_batch_item_doc',
      'reporter_memory_batch','reporter_memory_batch_item','reporter_memory_batch_create','reporter_memory_batch_update','reporter_memory_batch_bind','reporter_memory_batch_issue') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO reporter_executor',entry.signature); EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',entry.signature);
    IF entry.pronamespace='public'::regnamespace THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporter_runtime,reporter_worker',entry.signature); END IF;
  END LOOP;
END $$;
COMMIT;
