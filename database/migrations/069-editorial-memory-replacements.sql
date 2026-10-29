-- Replacement edges are immutable and independently visible; no private counterpart ID enters evidence JSON.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_memory_replacements(
  portal_id uuid NOT NULL REFERENCES public.portals(id),id text NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
  kind text NOT NULL DEFAULT 'evidence' CHECK(kind='evidence'),previous_id text NOT NULL,current_id text NOT NULL,
  doc jsonb NOT NULL CHECK(jsonb_typeof(doc)='object' AND octet_length(doc::text)<=16384),
  PRIMARY KEY(portal_id,id),UNIQUE(portal_id,previous_id),UNIQUE(portal_id,current_id),CHECK(previous_id<>current_id),
  FOREIGN KEY(portal_id,kind,previous_id) REFERENCES public.reporter_memory_heads(portal_id,kind,id),
  FOREIGN KEY(portal_id,kind,current_id) REFERENCES public.reporter_memory_heads(portal_id,kind,id)
);
ALTER TABLE public.reporter_memory_replacements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_memory_replacements FROM PUBLIC,reporter_runtime,reporter_worker;
GRANT SELECT,INSERT ON public.reporter_memory_replacements TO reporter_executor;
DROP POLICY IF EXISTS reporter_memory_replacements_executor ON public.reporter_memory_replacements;
CREATE POLICY reporter_memory_replacements_executor ON public.reporter_memory_replacements TO reporter_executor USING(true) WITH CHECK(true);
CREATE OR REPLACE FUNCTION public.reporter_memory_replace(p_previous jsonb,p_current jsonb,p_previous_doc jsonb,p_current_doc jsonb,p_previous_hash text,p_current_hash text,p_reason text,p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); previous public.reporter_memory_heads; current_record public.reporter_memory_heads;
  material jsonb; original jsonb; old_saved jsonb; new_saved jsonb; relation jsonb; job public.reporter_memory_heads; moment timestamptz:=clock_timestamp();
  allowed text[]:=ARRAY['revision','updatedAt','correction']; stamp jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit'); PERFORM core.reporter_memory_lock(portal);
  SELECT * INTO previous FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='evidence' AND id=p_previous->>'id';
  SELECT * INTO current_record FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='evidence' AND id=p_current->>'id';
  IF previous.id IS NULL OR current_record.id IS NULL OR NOT core.reporter_memory_doc_visible(portal,'evidence',previous.doc,previous.origin_production_id)
    OR NOT core.reporter_memory_doc_visible(portal,'evidence',current_record.doc,current_record.origin_production_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_previous IS DISTINCT FROM jsonb_build_object('id',previous.id,'revision',previous.doc->'revision','hash',previous.fingerprint)
    OR p_current IS DISTINCT FROM jsonb_build_object('id',current_record.id,'revision',current_record.doc->'revision','hash',current_record.fingerprint)
    OR EXISTS(SELECT FROM public.reporter_memory_replacements WHERE portal_id=portal AND (previous_id=previous.id OR current_id=current_record.id))
    THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF previous.id=current_record.id OR previous.doc->>'kind' IS DISTINCT FROM current_record.doc->>'kind'
    OR previous.doc->>'status' IS DISTINCT FROM 'active' OR current_record.doc->>'status' IS DISTINCT FROM 'active'
    OR previous.doc->'deduplication'->>'state'='pending' OR current_record.doc->'deduplication'->>'state'='pending'
    OR previous.doc->>'kind'='citation' AND (previous.source_id IS DISTINCT FROM current_record.source_id
      OR (current_record.doc->'anchor'->'source'->>'sourceVersion')::integer<=(previous.doc->'anchor'->'source'->>'sourceVersion')::integer)
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 OR length(coalesce(p_id,'')) NOT BETWEEN 1 AND 128
    OR coalesce(p_previous_hash,'') !~ '^[a-f0-9]{16}$' OR coalesce(p_current_hash,'') !~ '^[a-f0-9]{16}$'
    OR p_current_hash IS DISTINCT FROM current_record.fingerprint
    OR p_previous_doc->>'status' IS DISTINCT FROM 'superseded' OR p_current_doc->>'status' IS DISTINCT FROM 'active'
    OR (p_previous_doc->>'revision')::integer IS DISTINCT FROM (previous.doc->>'revision')::integer+1
    OR (p_current_doc->>'revision')::integer IS DISTINCT FROM (current_record.doc->>'revision')::integer+1
    OR p_previous_doc-(allowed||ARRAY['status']) IS DISTINCT FROM previous.doc-(allowed||ARRAY['status'])
    OR p_current_doc-allowed IS DISTINCT FROM current_record.doc-allowed
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  material:=public.reporter_memory_get('material',current_record.parent_id);
  SELECT doc INTO original FROM public.reporter_ed_sources WHERE portal_id=portal AND source_id=current_record.source_id;
  IF material IS NULL OR original->'rights'->>'authorized' IS DISTINCT FROM 'true' OR current_record.doc->'anchor'->'source' IS DISTINCT FROM material->'doc'->'source'
    OR NOT core.reporter_memory_anchor(portal,current_record.doc->'anchor') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  -- Free-text context belongs to the separately authorized edge, never the public endpoint.
  stamp:=jsonb_build_object('reason','Substituição editorial registrada.','personId',core.context_user_id(),'at',moment);
  old_saved:=public.reporter_memory_put(jsonb_build_object('kind','evidence','id',previous.id,'expected',previous.storage_revision,'parentKind','material','parentId',previous.parent_id,
    'doc',p_previous_doc||jsonb_build_object('updatedAt',moment,'correction',stamp),'fingerprint',p_previous_hash));
  new_saved:=public.reporter_memory_put(jsonb_build_object('kind','evidence','id',current_record.id,'expected',current_record.storage_revision,'parentKind','material','parentId',current_record.parent_id,
    'doc',p_current_doc||jsonb_build_object('updatedAt',moment,'correction',stamp),'fingerprint',p_current_hash));
  relation:=jsonb_build_object('id',p_id,'workspaceId',portal,'previous',jsonb_build_object('before',p_previous,'after',jsonb_build_object('id',previous.id,'revision',p_previous_doc->'revision','hash',p_previous_hash)),
    'current',jsonb_build_object('before',p_current,'after',jsonb_build_object('id',current_record.id,'revision',p_current_doc->'revision','hash',p_current_hash)),
    'reason',btrim(p_reason),'personId',core.context_user_id(),'at',moment);
  INSERT INTO public.reporter_memory_replacements(portal_id,id,previous_id,current_id,doc) VALUES(portal,p_id,previous.id,current_record.id,relation);
  FOR job IN SELECT * FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='job' AND doc->>'kind'='check'
    AND doc->>'evidenceId' IN (previous.id,current_record.id) AND doc->>'status' IN ('queued','running') LOOP
    PERFORM public.reporter_memory_put(jsonb_build_object('kind','job','id',job.id,'expected',job.storage_revision,'parentKind','material','parentId',job.parent_id,
      'doc',(job.doc-'_lease')||jsonb_build_object('revision',(job.doc->>'revision')::integer+1,'generation',(job.doc->>'generation')::integer+1,
        'status','cancelled','error','MEMORY_CHECK_STALE','updatedAt',moment)));
  END LOOP;
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,before_data,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.evidence.replace','memory_replacement',jsonb_build_object('previous',previous.doc,'current',current_record.doc),
      jsonb_build_object('relation',relation,'previous',old_saved->'doc','current',new_saved->'doc'),'reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN relation;
END $$;
ALTER FUNCTION public.reporter_memory_replace(jsonb,jsonb,jsonb,jsonb,text,text,text,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_replace(jsonb,jsonb,jsonb,jsonb,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_replace(jsonb,jsonb,jsonb,jsonb,text,text,text,text) TO reporter_runtime,reporter_worker;
CREATE OR REPLACE FUNCTION public.reporter_memory_replacements(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read');
BEGIN
  IF public.reporter_memory_get('evidence',p_id) IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('previous',(SELECT doc FROM public.reporter_memory_replacements WHERE portal_id=portal AND current_id=p_id
    AND public.reporter_memory_get('evidence',previous_id) IS NOT NULL AND public.reporter_memory_get('evidence',current_id) IS NOT NULL),
    'next',(SELECT doc FROM public.reporter_memory_replacements WHERE portal_id=portal AND previous_id=p_id
    AND public.reporter_memory_get('evidence',previous_id) IS NOT NULL AND public.reporter_memory_get('evidence',current_id) IS NOT NULL));
END $$;
ALTER FUNCTION public.reporter_memory_replacements(text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_replacements(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_replacements(text) TO reporter_runtime,reporter_worker;
CREATE OR REPLACE FUNCTION public.reporter_memory_replacement(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); relation public.reporter_memory_replacements; previous public.reporter_memory_history; current_record public.reporter_memory_history;
BEGIN
  SELECT * INTO relation FROM public.reporter_memory_replacements WHERE portal_id=portal AND id=p_id;
  IF relation.id IS NULL OR public.reporter_memory_get('evidence',relation.previous_id) IS NULL OR public.reporter_memory_get('evidence',relation.current_id) IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO previous FROM public.reporter_memory_history WHERE portal_id=portal AND kind='evidence' AND id=relation.previous_id
    AND doc->'revision'=relation.doc->'previous'->'after'->'revision' AND fingerprint=relation.doc->'previous'->'after'->>'hash' ORDER BY seq DESC LIMIT 1;
  SELECT * INTO current_record FROM public.reporter_memory_history WHERE portal_id=portal AND kind='evidence' AND id=relation.current_id
    AND doc->'revision'=relation.doc->'current'->'after'->'revision' AND fingerprint=relation.doc->'current'->'after'->>'hash' ORDER BY seq DESC LIMIT 1;
  IF previous.id IS NULL OR current_record.id IS NULL OR NOT core.reporter_memory_doc_visible(portal,'evidence',previous.doc,previous.origin_production_id)
    OR NOT core.reporter_memory_doc_visible(portal,'evidence',current_record.doc,current_record.origin_production_id) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('relation',relation.doc,'previous',previous.doc,'current',current_record.doc,'materials',jsonb_build_object(
    'previous',public.reporter_memory_get('material',previous.parent_id)->'doc'->>'title','current',public.reporter_memory_get('material',current_record.parent_id)->'doc'->>'title'));
END $$;
ALTER FUNCTION public.reporter_memory_replacement(text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_replacement(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_replacement(text) TO reporter_runtime,reporter_worker;
COMMIT;
