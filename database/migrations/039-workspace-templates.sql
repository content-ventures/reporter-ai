-- Immutable client render packs and private brand assets retain old export identities.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_brand_assets(
  id uuid PRIMARY KEY,portal_id uuid NOT NULL REFERENCES public.portals(id) ON DELETE RESTRICT,
  file_key text NOT NULL CHECK(file_key ~ '^[a-f0-9]{64}\.image$'),
  width integer NOT NULL CHECK(width BETWEEN 1 AND 1024),height integer NOT NULL CHECK(height BETWEEN 1 AND 1024),
  created_by uuid NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(portal_id,id),UNIQUE(portal_id,file_key)
);
CREATE INDEX IF NOT EXISTS reporter_brand_assets_creator ON public.reporter_brand_assets(created_by);
CREATE TABLE IF NOT EXISTS public.reporter_template_revisions(
  portal_id uuid NOT NULL REFERENCES public.portals(id) ON DELETE RESTRICT,hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{16}$'),
  revision bigint NOT NULL CHECK(revision>0),created_by uuid NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),doc jsonb NOT NULL CHECK(jsonb_typeof(doc)='object' AND octet_length(doc::text)<=16000),
  logo_id uuid GENERATED ALWAYS AS (nullif(doc->'config'->>'logoId','')::uuid) STORED,
  PRIMARY KEY(portal_id,hash),UNIQUE(portal_id,revision),
  FOREIGN KEY(portal_id,logo_id) REFERENCES public.reporter_brand_assets(portal_id,id) ON DELETE RESTRICT,
  CHECK(doc ?& ARRAY['workspaceId','renderer','hash','revision','savedAt','savedBy','config']
    AND doc->>'workspaceId'=portal_id::text AND doc->>'hash'=hash AND (doc->>'revision')::bigint=revision
    AND doc->>'renderer'='workspace-v1' AND doc->>'savedBy'=created_by::text)
);
CREATE INDEX IF NOT EXISTS reporter_template_revisions_logo ON public.reporter_template_revisions(portal_id,logo_id) WHERE logo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reporter_template_revisions_creator ON public.reporter_template_revisions(created_by);
ALTER TABLE public.reporter_brand_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reporter_template_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_brand_assets,public.reporter_template_revisions FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.reporter_template_access(p_portal uuid,p_manage boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF current_setting('app.access_mode',true)='platform' THEN
    PERFORM core.platform_operator();
    IF p_manage THEN PERFORM core.reporter_membership_manager(p_portal); END IF;
  ELSIF current_setting('app.access_mode',true)='job' THEN
    PERFORM core.reporter_worker_require();
    IF p_manage OR p_portal IS DISTINCT FROM core.context_portal_id() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  ELSE
    IF p_portal IS DISTINCT FROM core.reporter_require(CASE WHEN p_manage THEN 'reporter.edit' ELSE 'reporter.read' END) THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
    IF p_manage AND NOT (current_setting('app.access_mode',true)='platform_workspace' AND core.reporter_is_operator(core.context_user_id())) THEN
      PERFORM core.reporter_membership_manager(p_portal);
    END IF;
  END IF;
  IF NOT EXISTS(SELECT FROM public.reporter_workspaces WHERE portal_id=p_portal) THEN PERFORM core.platform_refuse('NOT_FOUND'); END IF;
END $$;
CREATE OR REPLACE FUNCTION core.reporter_template_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Immutable template or brand asset' USING ERRCODE='23514'; END $$;
CREATE OR REPLACE TRIGGER reporter_template_immutable BEFORE UPDATE OR DELETE ON public.reporter_template_revisions
  FOR EACH ROW EXECUTE FUNCTION core.reporter_template_immutable();
CREATE OR REPLACE TRIGGER reporter_brand_asset_immutable BEFORE UPDATE OR DELETE ON public.reporter_brand_assets
  FOR EACH ROW EXECUTE FUNCTION core.reporter_template_immutable();

CREATE OR REPLACE FUNCTION public.reporter_template_configuration(p_portal uuid,p_hashes text[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE metadata public.reporter_workspaces; active jsonb;
BEGIN
  PERFORM core.reporter_template_access(p_portal,false);
  IF p_hashes IS NULL OR cardinality(p_hashes)>200 OR EXISTS(SELECT FROM unnest(p_hashes) h WHERE h !~ '^[a-f0-9]{16}$') THEN
    RAISE EXCEPTION 'Invalid template history' USING ERRCODE='22023'; END IF;
  SELECT * INTO metadata FROM public.reporter_workspaces WHERE portal_id=p_portal;
  SELECT doc INTO active FROM public.reporter_template_revisions WHERE portal_id=p_portal AND hash=metadata.settings->>'templateHash';
  RETURN jsonb_build_object('workspaceId',p_portal,'revision',metadata.revision,
    'pilot',metadata.pilot OR p_portal='00000000-0000-0000-0000-000000000101'::uuid,
    'readiness',core.reporter_workspace_value(p_portal)->'readiness','active',active,
    'history',(SELECT coalesce(jsonb_agg(doc ORDER BY revision DESC),'[]') FROM public.reporter_template_revisions
      WHERE portal_id=p_portal AND hash=ANY(p_hashes) AND hash IS DISTINCT FROM metadata.settings->>'templateHash'));
END $$;

CREATE OR REPLACE FUNCTION public.reporter_template_save(p_portal uuid,p_revision bigint,p_hash text,p_config jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE metadata public.reporter_workspaces; existing jsonb; value jsonb; previous jsonb; pack_revision bigint; next_seq bigint;
BEGIN
  PERFORM core.reporter_template_access(p_portal,true);
  IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{16}$' OR p_config IS NULL OR jsonb_typeof(p_config) IS DISTINCT FROM 'object'
    OR p_config-ARRAY['publication','presets','defaultPreset','font','logoId']<>'{}'
    OR p_config->>'publication' IS NULL OR length(btrim(p_config->>'publication')) NOT BETWEEN 2 AND 80
    OR p_config->>'font' IS NULL OR p_config->>'font' NOT IN ('Inter','Montserrat')
    OR jsonb_typeof(p_config->'presets') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_CONFIGURATION'; END IF;
  IF jsonb_array_length(p_config->'presets') NOT BETWEEN 1 AND 5
    OR p_config->'presets'->>0 IS DISTINCT FROM p_config->>'defaultPreset'
    OR EXISTS(SELECT FROM jsonb_array_elements_text(p_config->'presets') p WHERE p NOT IN ('editorial','photo','night','paper','minimal'))
    OR (SELECT count(DISTINCT p) FROM jsonb_array_elements_text(p_config->'presets') p)<>jsonb_array_length(p_config->'presets') THEN
    RAISE EXCEPTION 'INVALID_CONFIGURATION'; END IF;
  IF p_config ? 'logoId' AND NOT EXISTS(SELECT FROM public.reporter_brand_assets WHERE portal_id=p_portal AND id=(p_config->>'logoId')::uuid) THEN
    RAISE EXCEPTION 'UNKNOWN_LOGO'; END IF;
  SELECT * INTO metadata FROM public.reporter_workspaces WHERE portal_id=p_portal FOR UPDATE;
  IF p_revision IS NULL OR metadata.revision<>p_revision THEN PERFORM core.platform_refuse('CONFLICT'); END IF;
  previous:=public.reporter_template_configuration(p_portal);
  SELECT doc INTO existing FROM public.reporter_template_revisions WHERE portal_id=p_portal AND hash=p_hash;
  IF existing IS NOT NULL AND existing->'config' IS DISTINCT FROM p_config THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF existing IS NULL THEN
    SELECT coalesce(max(revision),0)+1 INTO pack_revision FROM public.reporter_template_revisions WHERE portal_id=p_portal;
    value:=jsonb_build_object('workspaceId',p_portal,'renderer','workspace-v1','hash',p_hash,'revision',pack_revision,
      'savedAt',clock_timestamp(),'savedBy',core.context_user_id(),'config',p_config);
    INSERT INTO public.reporter_template_revisions(portal_id,hash,revision,created_by,doc)
      VALUES(p_portal,p_hash,pack_revision,core.context_user_id(),value);
  END IF;
  IF metadata.settings->>'templateHash' IS NOT DISTINCT FROM p_hash THEN RETURN previous; END IF;
  UPDATE public.reporter_workspaces SET settings=settings||jsonb_build_object('templateHash',p_hash,
      'templateIds',(SELECT jsonb_agg('wst-'||p_portal::text||'-'||p_hash||'-'||p ORDER BY ordinal)
        FROM jsonb_array_elements_text(p_config->'presets') WITH ORDINALITY p(p,ordinal))),
    revision=revision+1,updated_at=clock_timestamp() WHERE portal_id=p_portal;
  -- A brand change invalidates the workspace stamp; the next poll receives a fresh catalog.
  INSERT INTO public.reporter_ed_sync(portal_id) VALUES(p_portal) ON CONFLICT DO NOTHING;
  UPDATE public.reporter_ed_sync SET seq=seq+1 WHERE portal_id=p_portal RETURNING seq INTO next_seq;
  INSERT INTO public.reporter_ed_workspace(portal_id,doc,seq)
    SELECT p.id,jsonb_build_object('workspace',jsonb_build_object('id',p.id,'name',p.name,'slug',p.slug,'createdAt',metadata.created_at)),next_seq
      FROM public.portals p WHERE p.id=p_portal
    ON CONFLICT(portal_id) DO UPDATE SET seq=next_seq;
  PERFORM core.reporter_workspace_log('templates.updated',p_portal,NULL,previous,public.reporter_template_configuration(p_portal));
  RETURN public.reporter_template_configuration(p_portal);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_template_authorize(p_portal uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT core.reporter_template_access(p_portal,true)
$$;
CREATE OR REPLACE FUNCTION public.reporter_brand_asset_register(p_portal uuid,p_id uuid,p_file text,p_width integer,p_height integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE asset public.reporter_brand_assets;
BEGIN
  PERFORM core.reporter_template_access(p_portal,true);
  INSERT INTO public.reporter_brand_assets(id,portal_id,file_key,width,height,created_by)
    VALUES(p_id,p_portal,p_file,p_width,p_height,core.context_user_id()) ON CONFLICT(portal_id,file_key) DO NOTHING RETURNING * INTO asset;
  IF asset.id IS NULL THEN SELECT * INTO asset FROM public.reporter_brand_assets WHERE portal_id=p_portal AND file_key=p_file; END IF;
  RETURN jsonb_build_object('id',asset.id,'workspaceId',p_portal,'mime','image/png','width',asset.width,'height',asset.height,'createdAt',asset.created_at);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_brand_asset_file(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.context_portal_id();
BEGIN
  PERFORM core.reporter_template_access(portal,false);
  RETURN (SELECT file_key FROM public.reporter_brand_assets WHERE portal_id=portal AND id=p_id);
END $$;
DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY['core.reporter_template_access(uuid,boolean)','core.reporter_template_immutable()',
    'public.reporter_template_configuration(uuid,text[])','public.reporter_template_save(uuid,bigint,text,jsonb)',
    'public.reporter_template_authorize(uuid)','public.reporter_brand_asset_register(uuid,uuid,text,integer,integer)','public.reporter_brand_asset_file(uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
    IF fn LIKE 'public.%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporter_runtime',fn); END IF;
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.reporter_template_configuration(uuid,text[]),public.reporter_brand_asset_file(uuid) TO reporter_worker;
END $$;
COMMIT;
