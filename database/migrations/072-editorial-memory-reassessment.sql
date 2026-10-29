-- Reapply an activated policy only to an unchanged, accessible saved factual proof.
BEGIN;
CREATE OR REPLACE FUNCTION core.reporter_memory_confidence_allowed(p_portal uuid,p_check jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT coalesce(p_check->'confidence'='null'::jsonb,false) OR EXISTS(
    SELECT FROM public.reporter_memory_heads policy
      JOIN public.reporter_memory_heads evidence ON evidence.portal_id=policy.portal_id AND evidence.kind='evidence' AND evidence.id=p_check->'evidence'->>'id'
      JOIN public.reporter_memory_heads material ON material.portal_id=evidence.portal_id AND material.kind='material' AND material.id=evidence.parent_id
    WHERE policy.portal_id=p_portal AND policy.kind='policy' AND policy.id='editorial-memory' AND policy.doc->'revision'=p_check->'policyRevision'
      AND policy.doc->>'mode'='calibrated' AND policy.doc->>'calibrationReportId' IS NOT NULL
      AND policy.doc->'calibration'->>'version'='independent-confirmation-v1' AND p_check->>'verdict'='validated'
      AND jsonb_typeof(p_check->'confidence')='number'
      AND EXISTS(SELECT FROM jsonb_array_elements(policy.doc->'calibration'->'bins') bin WHERE bin->'confidence'=p_check->'confidence')
      AND EXISTS(SELECT FROM jsonb_array_elements(p_check->'claims') claim WHERE claim->>'kind' IN ('fact','declared'))
      AND NOT EXISTS(SELECT FROM jsonb_array_elements(p_check->'claims') WITH ORDINALITY claim(doc,n) WHERE claim.doc->>'kind' IN ('fact','declared')
        AND (claim.doc->>'verdict' IS DISTINCT FROM 'validated' OR NOT EXISTS(SELECT FROM jsonb_array_elements(p_check->'supports') support
          WHERE support->'claim'=to_jsonb(claim.n-1) AND support->>'relation'='confirms' AND support->'evidence'->>'originStatus' IS DISTINCT FROM 'unverified'
            AND support->'evidence'->>'primaryOrigin' IS DISTINCT FROM material.doc->>'primaryOrigin'
            AND btrim(support->'evidence'->>'excerpt') IS DISTINCT FROM btrim(evidence.doc->'anchor'->>'excerpt')))))
$$;
ALTER FUNCTION core.reporter_memory_confidence_allowed(uuid,jsonb) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_memory_confidence_allowed(uuid,jsonb) FROM PUBLIC,reporter_runtime,reporter_worker;
CREATE OR REPLACE FUNCTION public.reporter_memory_check_finish(p_id text,p_owner text,p_fence text,p_generation integer,p_check jsonb,p_error text,p_terminal boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.context_portal_id(); job public.reporter_memory_heads; previous public.reporter_memory_heads; support jsonb; saved_support jsonb;
BEGIN
  PERFORM core.reporter_worker_require(); PERFORM core.reporter_memory_lock(portal);
  SELECT * INTO job FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='job' AND id=p_id AND doc->>'kind'='check';
  IF job.id IS NULL OR job.doc->>'status' IS DISTINCT FROM 'running' OR job.doc->'_lease'->>'owner' IS DISTINCT FROM p_owner
    OR job.doc->'_lease'->>'fence' IS DISTINCT FROM p_fence OR (job.doc->'_lease'->>'until')::timestamptz<=clock_timestamp()
    OR (job.doc->>'generation')::integer IS DISTINCT FROM p_generation OR job.doc->>'createdBy' IS DISTINCT FROM core.context_user_id()::text THEN RAISE EXCEPTION 'LEASE_LOST'; END IF;
  IF p_terminal IS NULL OR p_error IS NOT NULL AND p_error !~ '^[A-Z][A-Z0-9_]{0,99}$' OR (p_check IS NULL) IS DISTINCT FROM (p_error IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF p_error IS NULL THEN
    IF NOT core.reporter_memory_check_current(portal,job.doc) THEN RAISE EXCEPTION 'MEMORY_CHECK_STALE'; END IF;
    SELECT * INTO previous FROM public.reporter_memory_heads WHERE portal_id=portal AND kind='check' AND id=job.doc->>'evidenceId';
    IF p_check->'evidence' IS DISTINCT FROM job.doc->'checkInput'->'evidence' OR p_check->'policyRevision' IS DISTINCT FROM job.doc->'checkInput'->'policyRevision'
      OR (p_check->>'revision')::integer IS DISTINCT FROM coalesce((previous.doc->>'revision')::integer,0)+1 OR p_check->>'id' IS DISTINCT FROM job.doc->>'evidenceId'
      OR p_check->>'model' IS DISTINCT FROM job.doc->>'model' OR NOT core.reporter_memory_confidence_allowed(portal,p_check) THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    FOR support IN SELECT value->'evidence' FROM jsonb_array_elements(p_check->'supports') WHERE value->'evidence'->>'kind'='internal' LOOP
      SELECT jsonb_build_object('evidence',e.doc,'primaryOrigin',m.doc->>'primaryOrigin') INTO saved_support
        FROM public.reporter_memory_heads e JOIN public.reporter_memory_heads m ON m.portal_id=e.portal_id AND m.kind='material' AND m.id=e.parent_id
        JOIN public.reporter_ed_sources s ON s.portal_id=e.portal_id AND s.source_id=e.source_id
        WHERE e.portal_id=portal AND e.kind='evidence' AND e.id=support->'evidence'->>'id' AND e.fingerprint=support->'evidence'->>'hash'
          AND e.doc->'revision'=support->'evidence'->'revision' AND e.doc->>'status'='active' AND s.doc->'rights'->>'authorized'='true'
          AND core.reporter_memory_doc_visible(portal,e.kind,e.doc,e.origin_production_id);
      IF saved_support IS NULL OR saved_support->>'primaryOrigin' IS DISTINCT FROM support->>'primaryOrigin'
        OR position(support->>'excerpt' IN saved_support->'evidence'->'anchor'->>'excerpt') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'MEMORY_CHECK_STALE'; END IF;
    END LOOP;
    PERFORM public.reporter_memory_put(jsonb_build_object('kind','check','id',p_check->>'id','expected',previous.storage_revision,'parentKind','evidence','parentId',p_check->>'id',
      'doc',(p_check-'policyEvaluation')||jsonb_build_object('checkedAt',clock_timestamp())));
  END IF;
  PERFORM public.reporter_memory_put(jsonb_build_object('kind','job','id',job.id,'expected',job.storage_revision,'parentKind','material','parentId',job.parent_id,
    'doc',(job.doc-'_lease')||jsonb_build_object('revision',(job.doc->>'revision')::integer+1,'status',CASE WHEN p_error IS NULL THEN 'completed'
      WHEN NOT p_terminal AND (job.doc->>'attempts')::integer<3 THEN 'queued' ELSE 'failed' END,'error',p_error,'updatedAt',clock_timestamp(),
      'completedBlocks',CASE WHEN p_error IS NULL THEN 1 ELSE 0 END,'failedBlocks',CASE WHEN p_error IS NULL THEN 0 ELSE 1 END,'evidenceCount',CASE WHEN p_error IS NULL THEN 1 ELSE 0 END)));
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,after_data,source,request_id)
    VALUES(portal,core.context_user_id(),'memory.check.'||CASE WHEN p_error IS NULL THEN 'completed' ELSE 'failed' END,'memory_check',
      jsonb_build_object('jobId',job.id,'evidence',job.doc->'checkInput'->'evidence','generation',p_generation,'check',p_check,'error',p_error),'reporter_ai',nullif(current_setting('app.request_id',true),'')::uuid);
  RETURN true;
END $$;
ALTER FUNCTION public.reporter_memory_check_finish(text,text,text,integer,jsonb,text,boolean) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_check_finish(text,text,text,integer,jsonb,text,boolean) FROM PUBLIC,reporter_runtime;
GRANT EXECUTE ON FUNCTION public.reporter_memory_check_finish(text,text,text,integer,jsonb,text,boolean) TO reporter_worker;

CREATE OR REPLACE FUNCTION public.reporter_memory_reassessment_context(p_id text,p_snapshot bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); evidence jsonb; material jsonb; checked jsonb; policy jsonb; job jsonb; proof jsonb;
BEGIN
  IF p_snapshot IS NOT NULL AND p_snapshot IS DISTINCT FROM (SELECT seq FROM public.reporter_memory_clock WHERE portal_id=portal) THEN RETURN NULL; END IF;
  evidence:=public.reporter_memory_get('evidence',p_id)->'doc'; checked:=public.reporter_memory_get('check',p_id)->'doc';
  IF evidence IS NULL OR checked IS NULL THEN RETURN NULL; END IF;
  material:=public.reporter_memory_get('material',evidence->>'materialId')->'doc';
  policy:=coalesce(public.reporter_memory_get('policy','editorial-memory')->'doc',core.reporter_memory_initial_policy(portal));
  proof:=jsonb_build_object('id',p_id,'revision',evidence->'revision','hash',(public.reporter_memory_get('evidence',p_id)->>'fingerprint'));
  IF material IS NULL OR evidence->>'status'<>'active' OR material->'source' IS DISTINCT FROM evidence->'anchor'->'source'
    OR checked->'evidence' IS DISTINCT FROM proof OR (checked->>'policyRevision')::integer IS NULL OR (checked->>'policyRevision')::integer<1
    OR (checked->>'policyRevision')::integer >= (policy->>'revision')::integer
    OR NOT public.reporter_memory_calibration_access(proof,jsonb_build_object('id',checked->>'id','revision',checked->'revision'),false,true)
    OR NOT core.reporter_memory_check_dependencies_current(portal,checked) THEN RETURN NULL; END IF;
  job:=public.reporter_memory_check_job(p_id);
  IF job->>'status' IN ('queued','running') THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('evidence',evidence,'material',material,'check',checked,'policy',policy);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_reassess(p_id text,p_evidence jsonb,p_check jsonb,p_revision integer,p_doc jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('write'); context jsonb; previous jsonb; head jsonb; policy jsonb; document jsonb;
BEGIN
  PERFORM public.reporter_memory_authorize('library.edit');
  context:=public.reporter_memory_reassessment_context(p_id); previous:=context->'check'; policy:=context->'policy';
  IF context IS NULL OR p_evidence IS DISTINCT FROM previous->'evidence' OR p_check IS DISTINCT FROM jsonb_build_object('id',previous->>'id','revision',previous->'revision')
    OR p_revision IS DISTINCT FROM (policy->>'revision')::integer THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 2000 OR jsonb_typeof(p_doc) IS DISTINCT FROM 'object'
    OR (p_doc-ARRAY['revision','policyRevision','confidence','policyEvaluation']) IS DISTINCT FROM (previous-ARRAY['revision','policyRevision','confidence','policyEvaluation'])
    OR p_doc->'revision' IS DISTINCT FROM to_jsonb((previous->>'revision')::integer+1) OR p_doc->'policyRevision' IS DISTINCT FROM policy->'revision'
    OR NOT core.reporter_memory_confidence_allowed(portal,p_doc)
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  document:=p_doc||jsonb_build_object('policyEvaluation',jsonb_build_object('check',p_check,'previousPolicyRevision',previous->'policyRevision',
    'personId',core.context_user_id(),'at',clock_timestamp(),'reason',btrim(p_reason)));
  head:=public.reporter_memory_get('check',p_id);
  PERFORM public.reporter_memory_put(jsonb_build_object('kind','check','id',p_id,'expected',head->'storage_revision','parentKind','evidence','parentId',p_id,'doc',document));
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,before_data,after_data,source,request_id,correlation_id)
    VALUES(portal,core.context_user_id(),'memory.check.reassess','memory_check',previous,document,'reporter_ai',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN document;
END $$;
ALTER FUNCTION public.reporter_memory_reassessment_context(text,bigint) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_memory_reassess(text,jsonb,jsonb,integer,jsonb,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_memory_reassessment_context(text,bigint),public.reporter_memory_reassess(text,jsonb,jsonb,integer,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_memory_reassessment_context(text,bigint),public.reporter_memory_reassess(text,jsonb,jsonb,integer,jsonb,text) TO reporter_runtime,reporter_worker;
COMMIT;
