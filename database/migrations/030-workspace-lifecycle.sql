-- Client workspaces extend existing portal IDs. No editorial row or policy is rewritten.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_workspaces (
  portal_id uuid PRIMARY KEY REFERENCES public.portals(id) ON DELETE RESTRICT,
  lifecycle text NOT NULL DEFAULT 'draft' CHECK(lifecycle IN ('draft','active','archiving','archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  pilot boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(settings)='object' AND octet_length(settings::text)<=65536),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS reporter_workspaces_pilot ON public.reporter_workspaces(pilot) WHERE pilot;
ALTER TABLE public.reporter_workspaces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_workspaces FROM PUBLIC;
-- The local bootstrap may also contain the cloud fixture. Only the configured cloud pilot is marked.
INSERT INTO public.reporter_workspaces(portal_id,lifecycle,pilot)
  SELECT id,CASE WHEN status='active' AND deleted_at IS NULL THEN 'active' ELSE 'archived' END,
    id='10000000-0000-0000-0000-000000000101'::uuid
  FROM public.portals ON CONFLICT(portal_id) DO NOTHING;
ALTER TABLE public.portal_members ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1 CHECK(revision>0);
CREATE INDEX IF NOT EXISTS reporter_members_by_account ON public.portal_members(user_id,portal_id);

CREATE OR REPLACE FUNCTION core.reporter_workspace_value(p_portal uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_build_object('id',p.id,'name',p.name,'slug',p.slug,'status',w.lifecycle,'revision',w.revision,
    'pilot',w.pilot,'createdAt',w.created_at,'updatedAt',w.updated_at,
    'readiness',jsonb_build_object('ready',cardinality(missing)=0,'missing',to_jsonb(missing)))
  FROM public.portals p JOIN public.reporter_workspaces w ON w.portal_id=p.id
  LEFT JOIN public.reporter_ed_workspace ed ON ed.portal_id=p.id
  LEFT JOIN public.reporter_ed_pipelines pipeline ON pipeline.portal_id=p.id AND pipeline.hash=ed.doc->>'pipelineHash'
  CROSS JOIN LATERAL (SELECT array_remove(ARRAY[
    CASE WHEN coalesce(btrim(pipeline.doc->'definition'->'editorial'->'map'->>'audience'),'')='' THEN 'editorial_map' END,
    CASE WHEN coalesce(btrim(pipeline.doc->'definition'->'editorial'->'guide'->>'voice'),'')='' THEN 'writing_guide' END,
    CASE WHEN NOT w.pilot AND coalesce(jsonb_array_length(w.settings->'templateIds'),0)=0 THEN 'templates' END,
    CASE WHEN NOT EXISTS(SELECT FROM public.portal_members m JOIN core.users u ON u.id=m.user_id
      JOIN public.portal_user_roles ur ON ur.portal_id=m.portal_id AND ur.user_id=m.user_id
      JOIN public.portal_roles r ON r.id=ur.portal_role_id AND r.portal_id=m.portal_id
      WHERE m.portal_id=p.id AND m.status='active' AND NOT u.banned AND u.auth_subject IS NOT NULL AND r.name IN ('editor','admin')) THEN 'editor' END,
    CASE WHEN NOT EXISTS(SELECT FROM public.portal_members m JOIN core.users u ON u.id=m.user_id
      JOIN public.portal_user_roles ur ON ur.portal_id=m.portal_id AND ur.user_id=m.user_id
      JOIN public.portal_roles r ON r.id=ur.portal_role_id AND r.portal_id=m.portal_id
      WHERE m.portal_id=p.id AND m.status='active' AND NOT u.banned AND u.auth_subject IS NOT NULL AND r.name IN ('approver','admin')) THEN 'approver' END
  ]::text[],NULL) AS missing) readiness
  WHERE p.id=p_portal
$$;

CREATE OR REPLACE FUNCTION core.reporter_workspace_log(p_action text,p_portal uuid,p_target uuid,p_before jsonb,p_after jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,entity_id,before_data,after_data,source,request_id,correlation_id)
  VALUES(p_portal,core.context_user_id(),'platform.'||p_action,CASE WHEN p_target IS NULL THEN 'workspace' ELSE 'membership' END,
    coalesce(p_target,p_portal),p_before,p_after,'platform',nullif(current_setting('app.request_id',true),'')::uuid,
    nullif(current_setting('app.correlation_id',true),'')::uuid)
$$;

CREATE OR REPLACE FUNCTION public.reporter_workspace_list(p_search text,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE items jsonb; total bigint; search text:=left(coalesce(btrim(p_search),''),100);
BEGIN
  PERFORM core.platform_operator();
  SELECT count(*) INTO total FROM public.portals p JOIN public.reporter_workspaces w ON w.portal_id=p.id
    WHERE p.name ILIKE '%'||search||'%' OR p.slug ILIKE '%'||search||'%';
  SELECT coalesce(jsonb_agg(value ORDER BY name,id),'[]') INTO items FROM (
    SELECT p.id,p.name,core.reporter_workspace_value(p.id) AS value FROM public.portals p JOIN public.reporter_workspaces w ON w.portal_id=p.id
    WHERE p.name ILIKE '%'||search||'%' OR p.slug ILIKE '%'||search||'%'
    ORDER BY p.name,p.id LIMIT least(greatest(coalesce(p_limit,50),1),100) OFFSET greatest(coalesce(p_offset,0),0)) page;
  RETURN jsonb_build_object('items',items,'total',total,'offset',greatest(coalesce(p_offset,0),0));
END $$;

CREATE OR REPLACE FUNCTION public.reporter_workspace_create(p_name text,p_slug text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.platform_operator(); tenant uuid:=gen_random_uuid(); portal uuid:=gen_random_uuid(); value jsonb;
  name text:=btrim(regexp_replace(coalesce(p_name,''),'\s+',' ','g')); slug text:=btrim(coalesce(p_slug,''));
BEGIN
  IF length(name) NOT BETWEEN 2 AND 80 THEN PERFORM core.platform_refuse('INVALID_NAME'); END IF;
  IF length(slug) NOT BETWEEN 3 AND 63 OR slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR slug=ANY(ARRAY['api','auth','platform','settings','workspaces','productions','login','logout']) THEN
    PERFORM core.platform_refuse('INVALID_SLUG');
  END IF;
  -- One client owns its internal tenant. The operator receives no implicit member identity.
  INSERT INTO core.tenants(id,name,slug) VALUES(tenant,name,'workspace-'||portal::text);
  BEGIN
    INSERT INTO public.portals(id,tenant_id,name,slug,status) VALUES(portal,tenant,name,slug,'draft');
  EXCEPTION WHEN unique_violation THEN PERFORM core.platform_refuse('SLUG_TAKEN'); END;
  INSERT INTO core.tenant_modules(tenant_id,module_key,enabled) VALUES(tenant,'reporter_ai',true);
  INSERT INTO core.portal_modules(tenant_id,portal_id,module_key,enabled) VALUES(tenant,portal,'reporter_ai',true);
  INSERT INTO public.reporter_workspaces(portal_id) VALUES(portal);
  INSERT INTO public.portal_roles(portal_id,name,description)
    SELECT portal,r,r FROM unnest(ARRAY['editor','approver','creative_reviewer','admin']) r;
  INSERT INTO public.portal_role_permissions(portal_role_id,permission)
    SELECT pr.id,permission FROM public.portal_roles pr CROSS JOIN LATERAL unnest(CASE pr.name
      WHEN 'admin' THEN ARRAY['reporter.read','reporter.edit','reporter.submit','reporter.review','reporter.retry']
      WHEN 'editor' THEN ARRAY['reporter.read','reporter.edit','reporter.submit','reporter.retry']
      ELSE ARRAY['reporter.read','reporter.review'] END) permission WHERE pr.portal_id=portal;
  value:=core.reporter_workspace_value(portal);
  PERFORM core.reporter_workspace_log('workspace.created',portal,NULL,NULL,value);
  RETURN value;
END $$;

CREATE OR REPLACE FUNCTION core.reporter_workspace_pending(p_portal uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(SELECT FROM public.reporter_ed_runs WHERE portal_id=p_portal AND status IN ('queued','running','awaiting_input') AND job IS NOT NULL)
    OR EXISTS(SELECT FROM public.reporter_transcripts WHERE portal_id=p_portal AND status IN ('queued','processing'))
    OR EXISTS(SELECT FROM core.integration_outbox WHERE portal_id=p_portal AND processed_at IS NULL AND module='reporter_ai')
$$;

CREATE OR REPLACE FUNCTION public.reporter_workspace_update(p_portal uuid,p_name text,p_status text,p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.platform_operator(); current public.reporter_workspaces; before_value jsonb; value jsonb;
  v_name text:=btrim(regexp_replace(coalesce(p_name,''),'\s+',' ','g')); next_status text:=p_status;
BEGIN
  SELECT * INTO current FROM public.reporter_workspaces WHERE portal_id=p_portal FOR UPDATE;
  IF NOT FOUND THEN PERFORM core.platform_refuse('NOT_FOUND'); END IF;
  IF p_revision IS NULL OR current.revision<>p_revision THEN PERFORM core.platform_refuse('CONFLICT'); END IF;
  IF length(v_name) NOT BETWEEN 2 AND 80 THEN PERFORM core.platform_refuse('INVALID_NAME'); END IF;
  IF p_status IS NULL OR p_status NOT IN ('draft','active','archived') THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  IF p_status='draft' AND current.lifecycle NOT IN ('draft','archived') THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  before_value:=core.reporter_workspace_value(p_portal);
  IF p_status='archived' AND core.reporter_workspace_pending(p_portal) THEN next_status:='archiving'; END IF;
  UPDATE public.portals SET name=v_name,status=next_status WHERE id=p_portal;
  UPDATE public.reporter_workspaces SET lifecycle=next_status,revision=revision+1,updated_at=clock_timestamp() WHERE portal_id=p_portal;
  value:=core.reporter_workspace_value(p_portal);
  PERFORM core.reporter_workspace_log('workspace.changed',p_portal,NULL,before_value,value);
  RETURN value;
END $$;

DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY['core.reporter_workspace_value(uuid)','core.reporter_workspace_log(text,uuid,uuid,jsonb,jsonb)',
    'core.reporter_workspace_pending(uuid)','public.reporter_workspace_list(text,integer,integer)',
    'public.reporter_workspace_create(text,text)','public.reporter_workspace_update(uuid,text,text,bigint)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['public.reporter_workspace_list(text,integer,integer)',
    'public.reporter_workspace_create(text,text)','public.reporter_workspace_update(uuid,text,text,bigint)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporter_runtime',fn);
  END LOOP;
END $$;
COMMIT;
