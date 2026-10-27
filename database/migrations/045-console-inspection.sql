-- Bounded labels for visible report rows, independent of the first directory page.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_platform_people_labels(p_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE value jsonb;
BEGIN
  PERFORM core.platform_operator();
  IF coalesce(cardinality(p_ids),0)>100 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',u.id,'name',u.name,'avatarUrl',u.image)) ORDER BY u.id),'[]')
    INTO value FROM core.users u WHERE u.id=ANY(p_ids);
  RETURN value;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_platform_log_page(p_limit integer,p_offset integer,p_portal uuid,p_person uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE items jsonb; total bigint;
BEGIN
  PERFORM core.platform_operator();
  SELECT count(*) INTO total FROM public.audit_log l WHERE source IN ('platform','reporter_ai')
    AND (p_portal IS NULL OR l.portal_id=p_portal) AND (p_person IS NULL OR l.user_id=p_person OR l.entity_type IN ('user','membership') AND l.entity_id=p_person OR l.entity_type='member_view' AND l.after_data->>'personId'=p_person::text);
  SELECT coalesce(jsonb_agg(entry ORDER BY at DESC,id DESC),'[]') INTO items FROM (
    SELECT l.created_at AS at,l.id,jsonb_strip_nulls(jsonb_build_object('id',l.id,'at',l.created_at,
      'action',CASE WHEN l.source='platform' THEN substr(l.action,10) ELSE l.action END,
      'actor',CASE WHEN a.id IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object('id',a.id,'name',a.name,'avatarUrl',a.image)) END,
      'target',CASE WHEN t.id IS NOT NULL THEN jsonb_build_object('id',t.id,'name',t.name,'email',t.email) END,
      'workspace',CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('id',p.id,'name',p.name,'slug',p.slug) END,
      'roles',coalesce(l.after_data->'roles',l.after_data->'after'->'roles'))) AS entry
    FROM public.audit_log l LEFT JOIN core.users a ON a.id=l.user_id
    LEFT JOIN core.users t ON (l.entity_type IN ('user','membership') AND t.id=l.entity_id OR l.entity_type='member_view' AND t.id::text=l.after_data->>'personId') LEFT JOIN public.portals p ON p.id=l.portal_id
    WHERE l.source IN ('platform','reporter_ai') AND (p_portal IS NULL OR l.portal_id=p_portal)
      AND (p_person IS NULL OR l.user_id=p_person OR l.entity_type IN ('user','membership') AND l.entity_id=p_person OR l.entity_type='member_view' AND l.after_data->>'personId'=p_person::text)
    ORDER BY l.created_at DESC,l.id DESC LIMIT least(greatest(coalesce(p_limit,50),1),200) OFFSET greatest(coalesce(p_offset,0),0)) page;
  RETURN jsonb_build_object('items',items,'total',total);
END $$;

ALTER FUNCTION public.reporter_platform_people_labels(uuid[]) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.reporter_platform_people_labels(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_platform_people_labels(uuid[]) TO reporter_runtime;
-- Read-only member inspection must not acquire a management lock or a write permission.
CREATE OR REPLACE FUNCTION core.reporter_workspace_inspector(p_portal uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF nullif(current_setting('app.member_view',true),'') IS NULL THEN RETURN core.reporter_membership_manager(p_portal); END IF;
  IF core.reporter_require('reporter.read') IS DISTINCT FROM p_portal
    OR NOT (core.platform_roles(core.context_user_id(),p_portal) ? 'admin') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  RETURN core.context_user_id();
END $$;
ALTER FUNCTION core.reporter_workspace_inspector(uuid) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION core.reporter_workspace_inspector(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.reporter_team_page(p_portal uuid,p_search text,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE items jsonb; total bigint; search text:=left(coalesce(p_search,''),100);
BEGIN
  IF current_setting('app.access_mode',true)='platform' THEN PERFORM core.platform_operator();
  ELSE PERFORM core.reporter_workspace_inspector(p_portal); END IF;
  SELECT count(*) INTO total FROM public.portal_members m JOIN core.users u ON u.id=m.user_id
    WHERE m.portal_id=p_portal AND (u.name ILIKE '%'||search||'%' OR u.email ILIKE '%'||search||'%' OR m.user_id::text=search);
  SELECT coalesce(jsonb_agg(value ORDER BY name,id),'[]') INTO items FROM (
    SELECT u.name,u.id,core.reporter_membership_value(u.id,p_portal)||jsonb_strip_nulls(jsonb_build_object(
      'name',u.name,'email',u.email,'avatarUrl',u.image,'accountSuspended',u.banned)) AS value
    FROM public.portal_members m JOIN core.users u ON u.id=m.user_id WHERE m.portal_id=p_portal
      AND (u.name ILIKE '%'||search||'%' OR u.email ILIKE '%'||search||'%' OR m.user_id::text=search)
    ORDER BY u.name,u.id LIMIT least(greatest(coalesce(p_limit,20),1),100) OFFSET greatest(coalesce(p_offset,0),0)) page;
  RETURN jsonb_build_object('items',items,'total',total,'offset',greatest(coalesce(p_offset,0),0));
END $$;

CREATE OR REPLACE FUNCTION public.reporter_workspace_get(p_portal uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE value jsonb;
BEGIN
  IF current_setting('app.access_mode',true)='platform' THEN PERFORM core.platform_operator();
  ELSE PERFORM core.reporter_workspace_inspector(p_portal); END IF;
  value:=core.reporter_workspace_value(p_portal);
  IF value IS NULL THEN PERFORM core.platform_refuse('NOT_FOUND'); END IF;
  RETURN value;
END $$;

-- Keep immutable revision references and policy version changes without copying prompts into the ledger.
CREATE OR REPLACE FUNCTION core.reporter_configuration_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE previous jsonb; next jsonb;
BEGIN
  IF OLD.doc->'pipelineRef' IS NOT DISTINCT FROM NEW.doc->'pipelineRef' OR NEW.doc->'pipelineRef' IS NULL THEN RETURN NULL; END IF;
  SELECT OLD.doc->'pipelineRef'||jsonb_build_object('mapVersion',doc->'definition'->'editorial'->'map'->'version',
    'guideVersion',doc->'definition'->'editorial'->'guide'->'version') INTO previous
    FROM public.reporter_ed_pipelines WHERE portal_id=NEW.portal_id AND hash=OLD.doc->>'pipelineHash';
  SELECT NEW.doc->'pipelineRef'||jsonb_build_object('mapVersion',doc->'definition'->'editorial'->'map'->'version',
    'guideVersion',doc->'definition'->'editorial'->'guide'->'version') INTO next
    FROM public.reporter_ed_pipelines WHERE portal_id=NEW.portal_id AND hash=NEW.doc->>'pipelineHash';
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,entity_id,before_data,after_data,source,request_id,correlation_id)
    VALUES(NEW.portal_id,core.context_user_id(),'platform.configuration.changed','workspace',NEW.portal_id,
      coalesce(previous,OLD.doc->'pipelineRef'),coalesce(next,NEW.doc->'pipelineRef'),'platform',
      nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  RETURN NULL;
END $$;
ALTER FUNCTION core.reporter_configuration_audit() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION core.reporter_configuration_audit() FROM PUBLIC;
DROP TRIGGER IF EXISTS reporter_configuration_audit ON public.reporter_ed_workspace;
CREATE CONSTRAINT TRIGGER reporter_configuration_audit AFTER UPDATE ON public.reporter_ed_workspace
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.reporter_configuration_audit();
COMMIT;
