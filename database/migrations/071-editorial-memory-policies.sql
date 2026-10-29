-- Frozen factual annotations and evaluated proposals; activation appends policy history and fences old work.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_memory_policy_records(
  portal_id uuid NOT NULL REFERENCES public.portals(id),kind text NOT NULL CHECK(kind IN ('case','proposal')),id text NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
  seq bigint GENERATED ALWAYS AS IDENTITY,doc jsonb NOT NULL CHECK(jsonb_typeof(doc)='object' AND octet_length(doc::text)<=262144),PRIMARY KEY(portal_id,kind,id)
);
CREATE INDEX IF NOT EXISTS reporter_memory_policy_records_page ON public.reporter_memory_policy_records(portal_id,kind,seq DESC);
ALTER TABLE public.reporter_memory_policy_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_memory_policy_records FROM PUBLIC,reporter_runtime,reporter_worker;
GRANT SELECT,INSERT ON public.reporter_memory_policy_records TO reporter_executor;
GRANT USAGE ON SEQUENCE public.reporter_memory_policy_records_seq_seq TO reporter_executor;
DROP POLICY IF EXISTS reporter_memory_policy_records_executor ON public.reporter_memory_policy_records;
CREATE POLICY reporter_memory_policy_records_executor ON public.reporter_memory_policy_records TO reporter_executor USING(true) WITH CHECK(true);
CREATE OR REPLACE FUNCTION core.reporter_memory_initial_policy(p_portal uuid) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('id','editorial-memory','workspaceId',p_portal,'revision',1,'mode','review_required',
    'thresholds',jsonb_build_object('fact',NULL,'declared',NULL,'opinion',NULL,'forecast',NULL),'calibrationReportId',NULL,'activatedAt',NULL,'activatedBy',NULL)
$$;
CREATE OR REPLACE FUNCTION public.reporter_memory_calibration_access(p_evidence jsonb,p_check jsonb,p_current boolean DEFAULT false,p_authorized boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); evidence public.reporter_memory_history; checked public.reporter_memory_history; material jsonb; original jsonb;
BEGIN
  IF public.reporter_memory_get('evidence',p_evidence->>'id') IS NULL THEN RETURN false; END IF;
  SELECT * INTO evidence FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='evidence' AND h.id=p_evidence->>'id'
    AND h.doc->'revision'=p_evidence->'revision' AND h.fingerprint=p_evidence->>'hash' ORDER BY h.seq DESC LIMIT 1;
  SELECT * INTO checked FROM public.reporter_memory_history h WHERE h.portal_id=portal AND h.kind='check' AND h.id=p_check->>'id'
    AND h.doc->'revision'=p_check->'revision' AND h.doc->'evidence'=p_evidence ORDER BY h.seq DESC LIMIT 1;
  IF evidence.id IS NULL OR checked.id IS NULL OR NOT core.reporter_memory_doc_visible(portal,'evidence',evidence.doc,evidence.origin_production_id)
    OR NOT core.reporter_memory_doc_visible(portal,'check',checked.doc,checked.origin_production_id) THEN RETURN false; END IF;
  material:=public.reporter_memory_get('material',evidence.parent_id);
  SELECT doc INTO original FROM public.reporter_ed_sources WHERE portal_id=portal AND source_id=evidence.source_id;
  IF material IS NULL OR original IS NULL OR NOT core.reporter_memory_anchor(portal,evidence.doc->'anchor')
    OR p_authorized AND original->'rights'->>'authorized' IS DISTINCT FROM 'true' THEN RETURN false; END IF;
  IF p_current AND (evidence.doc->>'status'<>'active' OR evidence.doc->'anchor'->'source' IS DISTINCT FROM material->'doc'->'source'
    OR public.reporter_memory_get('evidence',evidence.id)->'doc' IS DISTINCT FROM evidence.doc OR public.reporter_memory_get('check',checked.id)->'doc' IS DISTINCT FROM checked.doc
    OR (checked.doc->>'policyRevision')::integer IS DISTINCT FROM coalesce((SELECT (doc->>'revision')::integer FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='policy' AND id='editorial-memory'),1)) THEN RETURN false; END IF;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_calibration_save(p_doc jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('review'); evidence jsonb; material jsonb; checked jsonb; document jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('library.review');
  IF NOT public.reporter_memory_calibration_access(p_doc->'evidence',p_doc->'check',true,true) THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  evidence:=public.reporter_memory_get('evidence',p_doc->'evidence'->>'id')->'doc'; material:=public.reporter_memory_get('material',evidence->>'materialId')->'doc';
  checked:=public.reporter_memory_get('check',p_doc->'check'->>'id')->'doc';
  IF length(coalesce(p_doc->>'id','')) NOT BETWEEN 1 AND 128 OR length(btrim(coalesce(p_doc->>'reason',''))) NOT BETWEEN 1 AND 2000
    OR coalesce(p_doc->>'purpose','') NOT IN ('technical','editorial') OR coalesce(p_doc->>'outcome','') NOT IN ('confirmed','contradicted','insufficient')
    OR jsonb_typeof(p_doc->'groups') IS DISTINCT FROM 'array' OR jsonb_array_length(p_doc->'groups') NOT BETWEEN 1 AND 30
    OR EXISTS(SELECT FROM jsonb_array_elements_text(p_doc->'groups') g WHERE g !~ '^[a-f0-9]{16}$')
    OR NOT (evidence->'kinds' ?| ARRAY['fact','declared']) OR p_doc->>'bin' IS NOT NULL AND p_doc->>'bin' NOT IN ('one_origin','multiple_origins')
    OR p_doc->>'bin' IS NOT NULL AND checked->>'verdict' IS DISTINCT FROM 'validated' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  document:=p_doc||jsonb_build_object('workspaceId',portal,'version','independent-confirmation-v1','source',evidence->'anchor'->'source','materialId',material->>'id',
    'primaryOrigin',material->>'primaryOrigin','excerpt',evidence->'anchor'->>'excerpt','materialTitle',material->>'title','kinds',evidence->'kinds','policyRevision',checked->'policyRevision',
    'structurallyUsable',evidence->>'status'='active' AND coalesce(evidence->'deduplication'->>'state','')<>'pending' AND coalesce(evidence->'legacy'->>'state','')<>'conflict'
      AND (evidence->>'kind'<>'citation' OR evidence->>'authorConfirmed'='true' AND evidence->>'personId' IS NOT NULL),
    'reason',btrim(p_doc->>'reason'),'personId',core.context_user_id(),'at',clock_timestamp());
  INSERT INTO public.reporter_memory_policy_records(portal_id,kind,id,doc) VALUES(portal,'case',document->>'id',document);
  UPDATE public.reporter_memory_clock SET seq=seq+1 WHERE portal_id=portal;
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.calibration.case','memory_calibration',document,'reporter_ai',nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN document;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_policy_record(p_kind text,p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); document jsonb;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('case','proposal','version') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF p_kind<>'case' AND (NOT core.reporter_memory_is_admin(portal) OR nullif(current_setting('app.member_view',true),'') IS NOT NULL) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_kind='version' THEN
    SELECT doc INTO document FROM public.reporter_memory_history WHERE portal_id=portal AND kind='policy' AND id='editorial-memory' AND doc->>'revision'=p_id ORDER BY seq DESC LIMIT 1;
    IF document IS NULL AND p_id='1' THEN document:=core.reporter_memory_initial_policy(portal); END IF;
  ELSE SELECT doc INTO document FROM public.reporter_memory_policy_records WHERE portal_id=portal AND kind=p_kind AND id=p_id; END IF;
  IF p_kind='case' AND document IS NOT NULL AND NOT public.reporter_memory_calibration_access(document->'evidence',document->'check') THEN RETURN NULL; END IF;
  RETURN document;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_policy_propose(p_doc jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); current_policy jsonb; document jsonb; item jsonb; saved jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('pipeline.edit');
  current_policy:=coalesce(public.reporter_memory_get('policy','editorial-memory')->'doc',core.reporter_memory_initial_policy(portal));
  IF p_doc->'baseRevision' IS DISTINCT FROM current_policy->'revision' OR p_doc->'baseline' IS DISTINCT FROM current_policy THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF length(coalesce(p_doc->>'id','')) NOT BETWEEN 1 AND 128 OR length(btrim(coalesce(p_doc->>'reason',''))) NOT BETWEEN 1 AND 2000
    OR coalesce(p_doc->'settings'->>'mode','') NOT IN ('review_required','calibrated') OR jsonb_typeof(p_doc->'cases') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_doc->'cases')>1000 OR p_doc->'evaluation'->>'version' IS DISTINCT FROM 'independent-confirmation-v1'
    OR jsonb_typeof(p_doc->'evaluation'->'activatable') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_doc->'cases') LOOP
    saved:=public.reporter_memory_policy_record('case',item->>'id');
    IF saved IS NULL OR NOT public.reporter_memory_calibration_access(saved->'evidence',saved->'check',false,true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  END LOOP;
  document:=p_doc||jsonb_build_object('workspaceId',portal,'createdBy',core.context_user_id(),'createdAt',clock_timestamp(),'reason',btrim(p_doc->>'reason'));
  INSERT INTO public.reporter_memory_policy_records(portal_id,kind,id,doc) VALUES(portal,'proposal',document->>'id',document);
  UPDATE public.reporter_memory_clock SET seq=seq+1 WHERE portal_id=portal;
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.policy.propose','memory_policy',document,'reporter_ai',nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN document;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_policy_activate(p_id text,p_revision integer,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); current_policy jsonb; proposal jsonb; document jsonb; head jsonb; item jsonb; saved jsonb; job public.reporter_memory_heads; cancelled integer:=0;
BEGIN
  PERFORM public.reporter_memory_authorize('pipeline.edit'); head:=public.reporter_memory_get('policy','editorial-memory');
  current_policy:=coalesce(head->'doc',core.reporter_memory_initial_policy(portal)); proposal:=public.reporter_memory_policy_record('proposal',p_id);
  IF proposal IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_revision IS DISTINCT FROM (current_policy->>'revision')::integer OR proposal->'baseRevision' IS DISTINCT FROM current_policy->'revision'
    OR proposal->'baseline' IS DISTINCT FROM current_policy THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF proposal->'evaluation'->>'activatable' IS DISTINCT FROM 'true' OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000
    OR proposal->'settings'->>'mode'='calibrated' AND (proposal->'evaluation'->>'purpose'<>'editorial' OR proposal->'evaluation'->'calibration'->>'version'<>'independent-confirmation-v1')
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(proposal->'cases') LOOP
    saved:=public.reporter_memory_policy_record('case',item->>'id');
    IF saved IS NULL OR NOT public.reporter_memory_calibration_access(saved->'evidence',saved->'check',false,true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  END LOOP;
  IF head IS NULL THEN head:=public.reporter_memory_put(jsonb_build_object('kind','policy','id','editorial-memory','expected',NULL,'doc',current_policy)); END IF;
  document:=jsonb_build_object('id','editorial-memory','workspaceId',portal,'revision',p_revision+1,'mode',proposal->'settings'->>'mode','thresholds',proposal->'settings'->'thresholds',
    'calibrationReportId',CASE WHEN proposal->'settings'->>'mode'='calibrated' THEN p_id END,'activatedAt',clock_timestamp(),'activatedBy',core.context_user_id(),
    'change',jsonb_build_object('proposalId',p_id,'previousRevision',p_revision,'restoredFrom',proposal->'restoredFrom','reason',btrim(p_reason)))
    ||CASE WHEN proposal->'settings'->>'mode'='calibrated' THEN jsonb_build_object('calibration',proposal->'evaluation'->'calibration') ELSE '{}'::jsonb END;
  saved:=public.reporter_memory_put(jsonb_build_object('kind','policy','id','editorial-memory','expected',head->'storage_revision','doc',document));
  FOR job IN SELECT * FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='job' AND doc->>'kind'='check' AND doc->>'status' IN ('queued','running') LOOP
    PERFORM public.reporter_memory_put(jsonb_build_object('kind','job','id',job.id,'expected',job.storage_revision,'parentKind','material','parentId',job.parent_id,
      'doc',(job.doc-'_lease')||jsonb_build_object('revision',(job.doc->>'revision')::integer+1,'generation',(job.doc->>'generation')::integer+1,'status','cancelled','error','MEMORY_CHECK_STALE','updatedAt',clock_timestamp()))); cancelled:=cancelled+1;
  END LOOP;
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,before_data,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.policy.activate','memory_policy',current_policy,jsonb_build_object('policy',document,'cancelledChecks',cancelled),'reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN document;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_policy_page(p_kind text,p_snapshot bigint,p_after bigint,p_limit integer,p_visibility text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); context jsonb:=public.reporter_memory_context(); result jsonb;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('case','proposal','version') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF p_kind<>'case' AND (NOT core.reporter_memory_is_admin(portal) OR nullif(current_setting('app.member_view',true),'') IS NOT NULL) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_snapshot IS DISTINCT FROM (context->>'snapshot')::bigint OR p_visibility IS DISTINCT FROM context->>'visibility' THEN RAISE EXCEPTION 'MEMORY_CURSOR_INVALID'; END IF;
  WITH records AS MATERIALIZED(SELECT seq,doc FROM public.reporter_memory_policy_records WHERE portal_id=portal AND kind=p_kind
    AND (p_kind<>'case' OR public.reporter_memory_calibration_access(doc->'evidence',doc->'check'))
    UNION ALL SELECT seq,doc FROM public.reporter_memory_history WHERE p_kind='version' AND portal_id=portal AND kind='policy' AND id='editorial-memory'
    UNION ALL SELECT 0::bigint,core.reporter_memory_initial_policy(portal) WHERE p_kind='version' AND NOT EXISTS(SELECT FROM public.reporter_memory_history WHERE portal_id=portal AND kind='policy' AND id='editorial-memory' AND doc->>'revision'='1')),
  page AS(SELECT *,row_number() OVER(ORDER BY seq DESC) AS ordinal,sum(octet_length(doc::text)) OVER(ORDER BY seq DESC) AS bytes FROM records WHERE p_after IS NULL OR seq<p_after ORDER BY seq DESC LIMIT p_limit+1),
  shown AS(SELECT * FROM page WHERE ordinal<=p_limit AND bytes<=262144)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(doc ORDER BY seq DESC) FROM shown),'[]'),'total',(SELECT count(*) FROM records),'snapshot',p_snapshot::text,
    'next',CASE WHEN (SELECT count(*) FROM page)>(SELECT count(*) FROM shown) THEN (SELECT jsonb_build_object('key',seq::text,'id',coalesce(doc->>'id',doc->>'revision')) FROM shown ORDER BY seq LIMIT 1) END) INTO result;
  RETURN result;
END $$;
DO $$ DECLARE target regprocedure; BEGIN
  FOR target IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
    ('reporter_memory_calibration_access','reporter_memory_calibration_save','reporter_memory_policy_record','reporter_memory_policy_propose','reporter_memory_policy_activate','reporter_memory_policy_page') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO reporter_executor',target); EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',target);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporter_runtime,reporter_worker',target);
  END LOOP;
END $$;
ALTER FUNCTION core.reporter_memory_initial_policy(uuid) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_memory_initial_policy(uuid) FROM PUBLIC;
COMMIT;
