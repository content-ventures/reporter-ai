-- Immutable original-file metadata, scoped retrieval and exact source binding. Bytes stay private in storage.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_memory_originals(
  portal_id uuid NOT NULL,tenant_id uuid NOT NULL,id uuid NOT NULL,
  file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 255 AND file_name !~ '[[:cntrl:]/\\]'),
  byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 1048576),
  checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),
  format text NOT NULL CHECK(format IN ('text','markdown','srt','vtt','csv','tsv')),
  delimiter text,parser_version text NOT NULL CHECK(parser_version='memory-document-v1'),
  storage text NOT NULL CHECK(storage IN ('local','s3')),
  created_by uuid NOT NULL REFERENCES core.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','stored')),stored_by uuid REFERENCES core.users(id),stored_at timestamptz,
  PRIMARY KEY(portal_id,id),FOREIGN KEY(tenant_id,portal_id) REFERENCES public.portals(tenant_id,id),
  CHECK((format='csv' AND delimiter IN (',',';',E'\t') OR format='tsv' AND delimiter=E'\t'
    OR format NOT IN ('csv','tsv') AND delimiter IS NULL) IS TRUE),
  CHECK((status='pending' AND stored_by IS NULL AND stored_at IS NULL OR status='stored' AND stored_by IS NOT NULL AND stored_at IS NOT NULL) IS TRUE)
);
CREATE INDEX IF NOT EXISTS reporter_memory_originals_checksum ON public.reporter_memory_originals(portal_id,checksum);
CREATE INDEX IF NOT EXISTS reporter_memory_original_material ON public.reporter_memory_heads(portal_id,(doc->>'originalFileId')) WHERE kind='material';
ALTER TABLE public.reporter_memory_originals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reporter_memory_originals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_memory_originals FROM PUBLIC,reporter_runtime,reporter_worker;
GRANT SELECT,INSERT ON public.reporter_memory_originals TO reporter_executor;
GRANT UPDATE(status,stored_by,stored_at) ON public.reporter_memory_originals TO reporter_executor;
DROP POLICY IF EXISTS reporter_memory_originals_executor ON public.reporter_memory_originals;
CREATE POLICY reporter_memory_originals_executor ON public.reporter_memory_originals TO reporter_executor
  USING(portal_id=nullif(current_setting('app.portal_id',true),'')::uuid AND tenant_id=core.context_tenant_id())
  WITH CHECK(portal_id=nullif(current_setting('app.portal_id',true),'')::uuid AND tenant_id=core.context_tenant_id());

CREATE OR REPLACE FUNCTION core.reporter_memory_original_doc(p_file public.reporter_memory_originals) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_build_object('id',p_file.id,'workspaceId',p_file.portal_id,'name',p_file.file_name,'size',p_file.byte_size,
    'checksum',p_file.checksum,'format',p_file.format,'delimiter',p_file.delimiter,'parserVersion',p_file.parser_version,
    'storage',p_file.storage,'createdBy',p_file.created_by,'createdAt',p_file.created_at,'status',p_file.status,'storedBy',p_file.stored_by,'storedAt',p_file.stored_at)
$$;
CREATE OR REPLACE FUNCTION public.reporter_memory_original(p_id uuid,p_write boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal(CASE WHEN p_write THEN 'write' ELSE 'read' END); original public.reporter_memory_originals;
BEGIN
  IF p_write IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF p_write THEN PERFORM public.reporter_memory_authorize('library.edit'); END IF;
  SELECT * INTO original FROM public.reporter_memory_originals o WHERE o.portal_id=portal AND o.id=p_id AND o.tenant_id=core.context_tenant_id();
  IF original.id IS NULL THEN RETURN NULL; END IF;
  IF original.created_by<>core.context_user_id() AND NOT core.reporter_memory_is_admin(portal)
    AND (p_write OR NOT EXISTS(SELECT FROM public.reporter_memory_heads m WHERE m.portal_id=portal AND m.kind='material'
      AND m.doc->>'originalFileId'=p_id::text AND core.reporter_memory_doc_visible(portal,m.kind,m.doc,m.origin_production_id)
      AND core.reporter_memory_source_visible(portal,m.source_id,m.origin_production_id))) THEN RETURN NULL; END IF;
  RETURN core.reporter_memory_original_doc(original);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_original_register(p_doc jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); original public.reporter_memory_originals; result jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit');
  IF jsonb_typeof(p_doc) IS DISTINCT FROM 'object' OR p_doc-ARRAY['id','workspaceId','name','size','checksum','format','delimiter','parserVersion','storage']<>'{}'::jsonb
    OR p_doc->>'workspaceId' IS DISTINCT FROM portal::text OR NOT p_doc ?& ARRAY['id','name','size','checksum','format','delimiter','parserVersion','storage']
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  INSERT INTO public.reporter_memory_originals(portal_id,tenant_id,id,file_name,byte_size,checksum,format,delimiter,parser_version,storage,created_by)
    VALUES(portal,core.context_tenant_id(),(p_doc->>'id')::uuid,p_doc->>'name',(p_doc->>'size')::integer,p_doc->>'checksum',
      p_doc->>'format',p_doc->>'delimiter',p_doc->>'parserVersion',p_doc->>'storage',core.context_user_id()) RETURNING * INTO original;
  result:=core.reporter_memory_original_doc(original);
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,entity_id,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.original.prepared','memory_original',original.id,result,'reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_original_complete(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); original public.reporter_memory_originals; previous jsonb; result jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit');
  IF public.reporter_memory_original(p_id,true) IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO original FROM public.reporter_memory_originals o WHERE o.portal_id=portal AND o.id=p_id FOR UPDATE;
  IF original.status='stored' THEN RETURN core.reporter_memory_original_doc(original); END IF;
  previous:=core.reporter_memory_original_doc(original);
  UPDATE public.reporter_memory_originals SET status='stored',stored_by=core.context_user_id(),stored_at=clock_timestamp()
    WHERE portal_id=portal AND id=p_id RETURNING * INTO original;
  result:=core.reporter_memory_original_doc(original);
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,entity_id,before_data,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.original.stored','memory_original',original.id,previous,result,'reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_memory_import_access(p_file text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read');
BEGIN
  IF p_file IS NOT NULL AND public.reporter_memory_original(p_file::uuid,true)->>'status' IS DISTINCT FROM 'stored' AND NOT EXISTS(
    SELECT FROM core.storage_objects s WHERE s.id=p_file::uuid AND s.portal_id=portal AND s.tenant_id=core.context_tenant_id()
      AND s.status='completed' AND s.purpose LIKE 'reporter_%' AND (s.owner_user_id=core.context_user_id() OR core.reporter_memory_is_admin(portal)))
    THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION core.reporter_memory_original_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE original public.reporter_memory_originals; source_text text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.doc->>'originalFileId' IS DISTINCT FROM OLD.doc->>'originalFileId' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.doc->>'originalFileId' IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO original FROM public.reporter_memory_originals o WHERE o.portal_id=NEW.portal_id AND o.id=(NEW.doc->>'originalFileId')::uuid;
  IF original.id IS NULL THEN RETURN NEW; END IF;
  SELECT doc->'versions'->0->'content'->'segments'->0->>'text' INTO source_text FROM public.reporter_ed_sources
    WHERE portal_id=NEW.portal_id AND source_id=NEW.source_id;
  IF original.status<>'stored' OR source_text IS NULL OR octet_length(source_text)<>original.byte_size OR encode(sha256(convert_to(source_text,'UTF8')),'hex')<>original.checksum
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reporter_memory_original_binding ON public.reporter_memory_heads;
CREATE TRIGGER reporter_memory_original_binding BEFORE INSERT OR UPDATE ON public.reporter_memory_heads
  FOR EACH ROW WHEN(NEW.kind='material') EXECUTE FUNCTION core.reporter_memory_original_binding();
ALTER FUNCTION core.reporter_memory_original_doc(public.reporter_memory_originals) OWNER TO reporter_executor;
ALTER FUNCTION core.reporter_memory_original_binding() OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_memory_original(uuid,boolean) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_memory_original_register(jsonb) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_memory_original_complete(uuid) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_memory_import_access(text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_memory_original_doc(public.reporter_memory_originals),core.reporter_memory_original_binding(),
  public.reporter_memory_original(uuid,boolean),public.reporter_memory_original_register(jsonb),public.reporter_memory_original_complete(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_original(uuid,boolean),public.reporter_memory_original_register(jsonb),public.reporter_memory_original_complete(uuid) TO reporter_runtime,reporter_worker;
COMMIT;
