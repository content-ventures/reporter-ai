-- Configuration copying is an explicit platform operation; no editorial entities are copied.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_configuration_snapshot(p_source uuid,p_target uuid,p_lock boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE workspace uuid; result jsonb:='{}'; item jsonb;
BEGIN
  PERFORM core.platform_operator();
  IF p_source IS NULL OR p_target IS NULL OR p_source=p_target THEN PERFORM core.platform_refuse('INVALID_WORKSPACE'); END IF;
  IF p_lock THEN
    PERFORM 1 FROM public.reporter_workspaces WHERE portal_id IN (p_source,p_target) ORDER BY portal_id FOR UPDATE;
    PERFORM 1 FROM public.reporter_ed_workspace WHERE portal_id IN (p_source,p_target) ORDER BY portal_id FOR UPDATE;
  END IF;
  FOREACH workspace IN ARRAY ARRAY[p_source,p_target] LOOP
    IF NOT EXISTS(SELECT FROM public.reporter_workspaces WHERE portal_id=workspace AND lifecycle IN ('draft','active')) THEN
      PERFORM core.platform_refuse('INVALID_STATE'); END IF;
    SELECT jsonb_build_object('workspace',core.reporter_workspace_value(workspace),'templates',public.reporter_template_configuration(workspace),
      'pipeline',(SELECT p.doc||coalesce(ed.doc->'pipelineRef','{}') FROM public.reporter_ed_workspace ed JOIN public.reporter_ed_pipelines p ON p.portal_id=ed.portal_id AND p.hash=ed.doc->>'pipelineHash' WHERE ed.portal_id=workspace)) INTO item;
    result:=result||jsonb_build_object(CASE WHEN workspace=p_source THEN 'source' ELSE 'target' END,item);
  END LOOP;
  RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_configuration_apply(p_source uuid,p_target uuid,p_expected jsonb,p_fields jsonb,p_pipeline jsonb,p_template_hash text,p_template jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE current jsonb; target_revision bigint; next_seq bigint; previous_hash text; history jsonb; history_refs jsonb; workspace_doc jsonb;
BEGIN
  current:=public.reporter_configuration_snapshot(p_source,p_target,true);
  IF current IS DISTINCT FROM p_expected THEN PERFORM core.platform_refuse('CONFLICT'); END IF;
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields) NOT BETWEEN 1 AND 4
    OR EXISTS(SELECT FROM jsonb_array_elements_text(p_fields) f WHERE f NOT IN ('editorial_map','writing_guide','prompts','templates')) THEN
    RAISE EXCEPTION 'Invalid copy fields' USING ERRCODE='22023'; END IF;
  target_revision:=(current->'target'->'workspace'->>'revision')::bigint;
  IF p_fields ? 'templates' THEN
    PERFORM public.reporter_template_save(p_target,target_revision,p_template_hash,p_template);
  END IF;
  IF p_pipeline IS NOT NULL THEN
    IF jsonb_typeof(p_pipeline) IS DISTINCT FROM 'object' OR p_pipeline->>'hash' IS NULL OR p_pipeline->'definition' IS NULL THEN
      RAISE EXCEPTION 'Invalid pipeline' USING ERRCODE='22023'; END IF;
    previous_hash:=current->'target'->'pipeline'->>'hash';
    INSERT INTO public.reporter_ed_pipelines(portal_id,hash,doc) VALUES(p_target,p_pipeline->>'hash',p_pipeline) ON CONFLICT DO NOTHING;
    SELECT doc INTO workspace_doc FROM public.reporter_ed_workspace WHERE portal_id=p_target;
    workspace_doc:=coalesce(workspace_doc,jsonb_build_object('workspace',jsonb_build_object('id',p_target,
      'name',current->'target'->'workspace'->>'name','slug',current->'target'->'workspace'->>'slug','createdAt',clock_timestamp())));
    SELECT coalesce(jsonb_agg(value ORDER BY n),'[]') INTO history FROM (
      SELECT value,n FROM jsonb_array_elements(coalesce(workspace_doc->'historyHashes','[]')||CASE WHEN previous_hash IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(previous_hash) END)
      WITH ORDINALITY e(value,n) ORDER BY n DESC LIMIT 20) entries;
    IF workspace_doc ? 'historyRefs' THEN history_refs:=workspace_doc->'historyRefs';
    ELSE SELECT coalesce(jsonb_agg(jsonb_build_object('hash',p.hash,'revision',p.doc->'revision','savedAt',p.doc->'savedAt') ORDER BY h.n),'[]') INTO history_refs
      FROM jsonb_array_elements_text(coalesce(workspace_doc->'historyHashes','[]')) WITH ORDINALITY h(hash,n)
      JOIN public.reporter_ed_pipelines p ON p.portal_id=p_target AND p.hash=h.hash; END IF;
    IF previous_hash IS NOT NULL THEN history_refs:=history_refs||jsonb_build_array(jsonb_build_object('hash',previous_hash,
      'revision',current->'target'->'pipeline'->'revision','savedAt',current->'target'->'pipeline'->'savedAt')); END IF;
    SELECT coalesce(jsonb_agg(value ORDER BY n),'[]') INTO history_refs FROM (
      SELECT value,n FROM jsonb_array_elements(history_refs) WITH ORDINALITY e(value,n) ORDER BY n DESC LIMIT 20) entries;
    INSERT INTO public.reporter_ed_sync(portal_id) VALUES(p_target) ON CONFLICT DO NOTHING;
    UPDATE public.reporter_ed_sync SET seq=seq+1 WHERE portal_id=p_target RETURNING seq INTO next_seq;
    INSERT INTO public.reporter_ed_workspace(portal_id,doc,seq) VALUES(p_target,workspace_doc||jsonb_build_object('pipelineHash',p_pipeline->>'hash','historyHashes',history,
      'pipelineRef',jsonb_build_object('hash',p_pipeline->>'hash','revision',p_pipeline->'revision','savedAt',p_pipeline->'savedAt'),'historyRefs',history_refs),next_seq)
      ON CONFLICT(portal_id) DO UPDATE SET doc=excluded.doc,seq=excluded.seq;
  END IF;
  UPDATE public.reporter_workspaces SET revision=revision+1,updated_at=clock_timestamp() WHERE portal_id=p_target;
  PERFORM core.reporter_workspace_log('configuration.copied',p_target,NULL,NULL,jsonb_build_object('source',p_source,'fields',p_fields,
    'pipelineHash',p_pipeline->>'hash','templateHash',p_template_hash));
  RETURN public.reporter_configuration_snapshot(p_source,p_target);
END $$;
ALTER FUNCTION public.reporter_configuration_snapshot(uuid,uuid,boolean) OWNER TO CURRENT_USER;
ALTER FUNCTION public.reporter_configuration_apply(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.reporter_configuration_snapshot(uuid,uuid,boolean),public.reporter_configuration_apply(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_configuration_snapshot(uuid,uuid,boolean),public.reporter_configuration_apply(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb) TO reporter_runtime;
COMMIT;
