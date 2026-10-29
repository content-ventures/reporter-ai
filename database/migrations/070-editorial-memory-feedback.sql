-- Editorial outcomes remain distinct from factual labels. Capture is atomic with the original audit.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_memory_feedback(
  portal_id uuid NOT NULL REFERENCES public.portals(id),id text NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
  seq bigint GENERATED ALWAYS AS IDENTITY,kind text NOT NULL CHECK(kind IN ('correction','rejection','conflict_resolution','relevance')),
  target_kind text NOT NULL CHECK(target_kind IN ('material','evidence')),target_id text NOT NULL,material_id text NOT NULL,
  access jsonb NOT NULL,gate jsonb,doc jsonb NOT NULL CHECK(jsonb_typeof(doc)='object' AND octet_length(doc::text)<=32768),
  PRIMARY KEY(portal_id,id)
);
CREATE INDEX IF NOT EXISTS reporter_memory_feedback_page ON public.reporter_memory_feedback(portal_id,seq DESC);
CREATE INDEX IF NOT EXISTS reporter_memory_feedback_target ON public.reporter_memory_feedback(portal_id,target_kind,target_id,seq DESC);
CREATE INDEX IF NOT EXISTS reporter_memory_feedback_material ON public.reporter_memory_feedback(portal_id,material_id,seq DESC);
ALTER TABLE public.reporter_memory_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_memory_feedback FROM PUBLIC,reporter_runtime,reporter_worker;
GRANT SELECT,INSERT ON public.reporter_memory_feedback TO reporter_executor;
GRANT USAGE ON SEQUENCE public.reporter_memory_feedback_seq_seq TO reporter_executor;
DROP POLICY IF EXISTS reporter_memory_feedback_executor ON public.reporter_memory_feedback;
CREATE POLICY reporter_memory_feedback_executor ON public.reporter_memory_feedback TO reporter_executor USING(true) WITH CHECK(true);
CREATE OR REPLACE FUNCTION core.reporter_memory_feedback_ref(p_portal uuid,p_doc jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_build_object('id',h.id,'revision',h.doc->'revision','hash',h.fingerprint) FROM public.reporter_memory_history h
    WHERE h.portal_id=p_portal AND h.kind='evidence' AND h.id=p_doc->>'id' AND h.doc->'revision'=p_doc->'revision'
      AND h.doc=p_doc ORDER BY h.seq DESC LIMIT 1
$$;
CREATE OR REPLACE FUNCTION core.reporter_memory_feedback_capture(p_event public.audit_log) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=p_event.portal_id; old jsonb:=p_event.before_data; current_doc jsonb:=p_event.after_data; document jsonb;
  feedback_kind text; target_kind text:='evidence'; target_id text; material_id text; refs jsonb; gate jsonb; reason text;
  before_ref jsonb; after_ref jsonb; source_ref jsonb; previous_source jsonb; related jsonb:='[]'; checked jsonb; inserted bigint;
BEGIN
  IF portal IS NULL OR p_event.user_id IS NULL OR p_event.source<>'reporter_ai' THEN RETURN; END IF;
  IF p_event.action='memory.evidence.relevance' THEN
    document:=current_doc; feedback_kind:='relevance'; target_id:=document->'target'->>'id';
    SELECT parent_id INTO material_id FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='evidence' AND id=target_id;
    SELECT jsonb_agg(jsonb_build_object('kind','evidence','id',item->'evidence'->>'id')) INTO refs
      FROM public.reporter_memory_history h CROSS JOIN LATERAL jsonb_array_elements(h.doc->'items') item
      WHERE h.portal_id=portal AND h.kind='selection' AND h.id=document->'selection'->>'id' AND h.doc->'revision'=document->'selection'->'revision';
    gate:=jsonb_build_object('kind','selection','id',document->'selection'->>'id','revision',document->'selection'->'revision');
  ELSE
    IF p_event.action='memory.evidence.correct' THEN feedback_kind:='correction'; reason:=current_doc->'correction'->>'reason';
    ELSIF p_event.action='memory.material.revise' THEN
      feedback_kind:='correction'; target_kind:='material'; current_doc:=current_doc->'material';
      reason:=current_doc->'revisionInfo'->>'reason'; previous_source:=old->'source';
    ELSIF p_event.action='memory.evidence.replace' THEN
      feedback_kind:='correction'; reason:=current_doc->'relation'->>'reason'; related:=jsonb_build_array(current_doc->'relation'->'current'->'after');
      current_doc:=current_doc->'previous'; old:=old->'previous';
    ELSIF p_event.action IN ('memory.evidence.reject','memory.evidence.request_revision','memory.evidence.accept') THEN
      IF current_doc->'check' IS NOT NULL AND current_doc->'check'<>'null' THEN
        SELECT h.doc INTO checked FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='check'
          AND h.id=current_doc->'check'->>'id' AND h.doc->'revision'=current_doc->'check'->'revision' ORDER BY h.seq DESC LIMIT 1;
      END IF;
      IF p_event.action='memory.evidence.accept' AND checked->>'verdict' IS DISTINCT FROM 'disputed' THEN RETURN; END IF;
      feedback_kind:=CASE WHEN p_event.action='memory.evidence.accept' THEN 'conflict_resolution' ELSE 'rejection' END;
      after_ref:=current_doc->'evidence'; reason:=current_doc->>'reason'; gate:=jsonb_build_object('kind','decision','id',current_doc->>'id');
      SELECT h.doc INTO current_doc FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='evidence'
        AND h.id=after_ref->>'id' AND h.doc->'revision'=after_ref->'revision' AND h.fingerprint=after_ref->>'hash' ORDER BY h.seq DESC LIMIT 1;
    ELSIF p_event.action IN ('memory.legacy.reconcile','memory.legacy.article') AND old->'legacy'->>'state'='conflict'
      AND current_doc->'legacy'->>'state'='synchronized' AND current_doc->'legacy'->'resolution' IS NOT NULL THEN
      feedback_kind:='conflict_resolution'; reason:=current_doc->'legacy'->'resolution'->>'reason';
    ELSIF p_event.action='memory.duplicate.supersede' AND current_doc->'deduplication'->>'choice' IN ('keep_variant','use_curated') THEN
      feedback_kind:='conflict_resolution'; reason:=current_doc->'deduplication'->>'reason'; related:=jsonb_build_array(current_doc->'deduplication'->'canonical');
    ELSE RETURN; END IF;
    target_id:=current_doc->>'id';
    IF target_kind='material' THEN material_id:=target_id; source_ref:=current_doc->'source';
    ELSE material_id:=current_doc->>'materialId'; source_ref:=current_doc->'anchor'->'source';
      before_ref:=core.reporter_memory_feedback_ref(portal,old); after_ref:=coalesce(after_ref,core.reporter_memory_feedback_ref(portal,current_doc)); END IF;
    refs:=jsonb_build_array(jsonb_build_object('kind',target_kind,'id',target_id))||coalesce((SELECT jsonb_agg(jsonb_build_object('kind','evidence','id',r->>'id')) FROM jsonb_array_elements(related) r),'[]');
    document:=jsonb_build_object('before',before_ref,'after',after_ref,'related',related,'source',source_ref,'previousSource',previous_source,
      'check',p_event.after_data->'check','policyRevision',p_event.after_data->'policyRevision','decisionId',CASE WHEN gate->>'kind'='decision' THEN gate->>'id' END,
      'selection',NULL,'productionId',NULL,'query',NULL,'rating',NULL,
      'resolution',CASE WHEN p_event.action='memory.evidence.accept' THEN 'accept' WHEN p_event.action='memory.duplicate.supersede' THEN current_doc->'deduplication'->>'choice'
        WHEN p_event.action IN ('memory.legacy.reconcile','memory.legacy.article') THEN current_doc->'legacy'->'resolution'->>'choice' END,'reason',reason);
  END IF;
  IF target_id IS NULL OR material_id IS NULL OR length(btrim(coalesce(document->>'reason',''))) NOT BETWEEN 1 AND 2000 THEN RETURN; END IF;
  document:=document||jsonb_build_object('id','memory-feedback-'||p_event.id,'workspaceId',portal,'kind',feedback_kind,'action',p_event.action,
    'target',jsonb_build_object('kind',target_kind,'id',target_id),'personId',p_event.user_id,'at',p_event.created_at);
  INSERT INTO public.reporter_memory_feedback(portal_id,id,kind,target_kind,target_id,material_id,access,gate,doc)
    VALUES(portal,document->>'id',feedback_kind,target_kind,target_id,material_id,refs,gate,document)
    ON CONFLICT(portal_id,id) DO NOTHING RETURNING seq INTO inserted;
  IF inserted IS NOT NULL THEN INSERT INTO public.reporter_memory_clock(portal_id,seq) VALUES(portal,1)
    ON CONFLICT(portal_id) DO UPDATE SET seq=reporter_memory_clock.seq+1; END IF;
END $$;
ALTER FUNCTION core.reporter_memory_feedback_capture(public.audit_log) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_memory_feedback_capture(public.audit_log) FROM PUBLIC;
CREATE OR REPLACE FUNCTION core.reporter_memory_feedback_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN PERFORM core.reporter_memory_feedback_capture(NEW); RETURN NEW; END $$;
ALTER FUNCTION core.reporter_memory_feedback_audit() OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_memory_feedback_audit() FROM PUBLIC;
DROP TRIGGER IF EXISTS reporter_memory_feedback_audit ON public.audit_log;
CREATE TRIGGER reporter_memory_feedback_audit AFTER INSERT ON public.audit_log FOR EACH ROW
  WHEN(NEW.action IN ('memory.evidence.correct','memory.material.revise','memory.evidence.replace','memory.evidence.reject','memory.evidence.request_revision',
    'memory.evidence.accept','memory.legacy.reconcile','memory.legacy.article','memory.duplicate.supersede','memory.evidence.relevance')) EXECUTE FUNCTION core.reporter_memory_feedback_audit();
-- Existing audit IDs make replay/backfill idempotent; no fabricated editorial event is created.
DO $$ DECLARE event public.audit_log; BEGIN
  FOR event IN SELECT a.* FROM public.audit_log a WHERE a.source='reporter_ai' AND a.action IN ('memory.evidence.correct','memory.material.revise','memory.evidence.replace',
    'memory.evidence.reject','memory.evidence.request_revision','memory.evidence.accept','memory.legacy.reconcile','memory.legacy.article','memory.duplicate.supersede','memory.evidence.relevance')
    AND NOT EXISTS(SELECT FROM public.reporter_memory_feedback f WHERE f.portal_id=a.portal_id AND f.id='memory-feedback-'||a.id) ORDER BY a.created_at,a.id
  LOOP PERFORM core.reporter_memory_feedback_capture(event); END LOOP;
END $$;
CREATE OR REPLACE FUNCTION core.reporter_memory_feedback_visible(p_row public.reporter_memory_feedback) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE saved public.reporter_memory_history;
BEGIN
  IF EXISTS(SELECT FROM jsonb_array_elements(p_row.access) r WHERE public.reporter_memory_get(r->>'kind',r->>'id') IS NULL) THEN RETURN false; END IF;
  IF p_row.gate IS NOT NULL THEN
    SELECT * INTO saved FROM public.reporter_memory_history h WHERE h.portal_id=p_row.portal_id AND h.kind=p_row.gate->>'kind' AND h.id=p_row.gate->>'id'
      AND (p_row.gate->'revision' IS NULL OR h.doc->'revision'=p_row.gate->'revision') ORDER BY h.seq DESC LIMIT 1;
    IF saved.id IS NULL OR NOT core.reporter_memory_doc_visible(p_row.portal_id,saved.kind,saved.doc,saved.origin_production_id) THEN RETURN false; END IF;
  END IF;
  IF jsonb_typeof(p_row.doc->'check')='object' THEN
    SELECT * INTO saved FROM public.reporter_memory_history h WHERE h.portal_id=p_row.portal_id AND h.kind='check' AND h.id=p_row.doc->'check'->>'id'
      AND h.doc->'revision'=p_row.doc->'check'->'revision' ORDER BY h.seq DESC LIMIT 1;
    IF saved.id IS NULL OR NOT core.reporter_memory_doc_visible(p_row.portal_id,'check',saved.doc,saved.origin_production_id) THEN RETURN false; END IF;
  END IF;
  IF p_row.doc->>'decisionId' IS NOT NULL AND coalesce(p_row.gate->>'kind','')<>'decision' THEN
    SELECT * INTO saved FROM public.reporter_memory_history h WHERE h.portal_id=p_row.portal_id AND h.kind='decision' AND h.id=p_row.doc->>'decisionId' ORDER BY h.seq DESC LIMIT 1;
    IF saved.id IS NULL OR NOT core.reporter_memory_doc_visible(p_row.portal_id,'decision',saved.doc,saved.origin_production_id) THEN RETURN false; END IF;
  END IF;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_feedback_page(p_kind text,p_evidence text,p_material text,p_snapshot bigint,p_after bigint,p_limit integer,p_visibility text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); context jsonb:=public.reporter_memory_context(); result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_kind IS NOT NULL AND p_kind NOT IN ('correction','rejection','conflict_resolution','relevance') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF p_snapshot IS DISTINCT FROM (context->>'snapshot')::bigint OR p_visibility IS DISTINCT FROM context->>'visibility' THEN RAISE EXCEPTION 'MEMORY_CURSOR_INVALID'; END IF;
  WITH candidates AS MATERIALIZED (SELECT f.* FROM public.reporter_memory_feedback f WHERE f.portal_id=portal AND (p_kind IS NULL OR f.kind=p_kind)
    AND (p_evidence IS NULL OR f.target_kind='evidence' AND f.target_id=p_evidence) AND (p_material IS NULL OR f.material_id=p_material)
    AND core.reporter_memory_feedback_visible(f)), page AS(SELECT *,row_number() OVER(ORDER BY seq DESC) AS ordinal,
      sum(octet_length(doc::text)) OVER(ORDER BY seq DESC) AS bytes FROM candidates WHERE p_after IS NULL OR seq<p_after ORDER BY seq DESC LIMIT p_limit+1),
    shown AS(SELECT * FROM page WHERE ordinal<=p_limit AND bytes<=262144)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(doc ORDER BY seq DESC) FROM shown),'[]'),'total',(SELECT count(*) FROM candidates),'snapshot',p_snapshot::text,
    'next',CASE WHEN (SELECT count(*) FROM page)>(SELECT count(*) FROM shown) THEN (SELECT jsonb_build_object('key',seq::text,'id',id) FROM shown ORDER BY seq LIMIT 1) END) INTO result;
  RETURN result;
END $$;
ALTER FUNCTION public.reporter_memory_feedback_page(text,text,text,bigint,bigint,integer,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_feedback_page(text,text,text,bigint,bigint,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_feedback_page(text,text,text,bigint,bigint,integer,text) TO reporter_runtime,reporter_worker;
CREATE OR REPLACE FUNCTION public.reporter_memory_relevance_context(p_selection jsonb,p_evidence jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); selected public.reporter_memory_history; item jsonb; evidence public.reporter_memory_history; proof public.reporter_memory_history;
BEGIN
  IF public.reporter_memory_get('selection',p_selection->>'id') IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO selected FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='selection' AND h.id=p_selection->>'id'
    AND h.doc->'revision'=p_selection->'revision' ORDER BY h.seq DESC LIMIT 1;
  IF selected.id IS NULL OR NOT core.reporter_memory_doc_visible(portal,'selection',selected.doc,selected.origin_production_id)
    OR EXISTS(SELECT FROM jsonb_array_elements(selected.doc->'items') i WHERE public.reporter_memory_get('evidence',i->'evidence'->>'id') IS NULL) THEN RETURN NULL; END IF;
  SELECT i INTO item FROM jsonb_array_elements(selected.doc->'items') i WHERE i->'evidence'=p_evidence;
  SELECT * INTO evidence FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='evidence' AND h.id=p_evidence->>'id'
    AND h.doc->'revision'=p_evidence->'revision' AND h.fingerprint=p_evidence->>'hash' ORDER BY h.seq DESC LIMIT 1;
  IF item IS NULL OR evidence.id IS NULL OR NOT core.reporter_memory_doc_visible(portal,'evidence',evidence.doc,evidence.origin_production_id) THEN RETURN NULL; END IF;
  IF jsonb_typeof(item->'check')='object' THEN
    SELECT * INTO proof FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='check' AND h.id=item->'check'->>'id'
      AND h.doc->'revision'=item->'check'->'revision' ORDER BY h.seq DESC LIMIT 1;
    IF proof.id IS NULL OR NOT core.reporter_memory_doc_visible(portal,'check',proof.doc,proof.origin_production_id) THEN RETURN NULL; END IF;
  END IF;
  IF item->>'decisionId' IS NOT NULL THEN
    SELECT * INTO proof FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='decision' AND h.id=item->>'decisionId' ORDER BY h.seq DESC LIMIT 1;
    IF proof.id IS NULL OR NOT core.reporter_memory_doc_visible(portal,'decision',proof.doc,proof.origin_production_id) THEN RETURN NULL; END IF;
  END IF;
  RETURN jsonb_build_object('selection',p_selection,'item',item,'evidence',evidence.doc,'source',evidence.doc->'anchor'->'source',
    'material',jsonb_build_object('id',evidence.parent_id,'title',public.reporter_memory_get('material',evidence.parent_id)->'doc'->>'title'),
    'productionId',selected.doc->'productionId','productionTitle',(SELECT doc->>'title' FROM public.reporter_ed_productions WHERE portal_id=portal AND production_id=selected.doc->>'productionId'));
END $$;
ALTER FUNCTION public.reporter_memory_relevance_context(jsonb,jsonb) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_relevance_context(jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_relevance_context(jsonb,jsonb) TO reporter_runtime,reporter_worker;
CREATE OR REPLACE FUNCTION public.reporter_memory_relevance_save(p_selection jsonb,p_evidence jsonb,p_rating text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('review'); context jsonb; document jsonb; event_id uuid:=gen_random_uuid(); moment timestamptz:=clock_timestamp();
BEGIN
  PERFORM public.reporter_memory_authorize('library.review'); PERFORM core.reporter_memory_lock(portal);
  context:=public.reporter_memory_relevance_context(p_selection,p_evidence);
  IF context IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_rating IS NULL OR p_rating NOT IN ('useful','not_useful') OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  document:=jsonb_build_object('id','memory-feedback-'||event_id,'workspaceId',portal,'kind','relevance','action','memory.evidence.relevance',
    'target',jsonb_build_object('kind','evidence','id',p_evidence->>'id'),'before',NULL,'after',p_evidence,'related','[]'::jsonb,
    'source',context->'source','previousSource',NULL,'check',context->'item'->'check','policyRevision',context->'item'->'policyRevision','decisionId',context->'item'->'decisionId',
    'selection',p_selection,'productionId',context->'productionId','query',context->'item'->'discovery'->'query','rating',p_rating,'resolution',NULL,
    'reason',btrim(p_reason),'personId',core.context_user_id(),'at',moment);
  INSERT INTO public.audit_log(id,portal_id,user_id,action,entity_type,after_data,source,request_id,correlation_id,created_at)
    VALUES(event_id,portal,core.context_user_id(),'memory.evidence.relevance','memory_feedback',document,'reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid,moment);
  RETURN document;
END $$;
ALTER FUNCTION public.reporter_memory_relevance_save(jsonb,jsonb,text,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_relevance_save(jsonb,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_relevance_save(jsonb,jsonb,text,text) TO reporter_runtime,reporter_worker;
ALTER FUNCTION core.reporter_memory_feedback_ref(uuid,jsonb) OWNER TO reporter_executor;
ALTER FUNCTION core.reporter_memory_feedback_visible(public.reporter_memory_feedback) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_memory_feedback_ref(uuid,jsonb),core.reporter_memory_feedback_visible(public.reporter_memory_feedback) FROM PUBLIC;
COMMIT;
