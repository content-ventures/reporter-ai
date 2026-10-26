-- Client-managed credentials do not depend on application environment variables.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_integrations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), portal_id uuid NOT NULL REFERENCES public.portals(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK(kind='drive'), owner_user_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true, revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  derivation_secret text NOT NULL CHECK(length(derivation_secret) BETWEEN 32 AND 256),
  created_by uuid NOT NULL REFERENCES core.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_used_at timestamptz,
  UNIQUE(portal_id,kind), FOREIGN KEY(portal_id,owner_user_id) REFERENCES public.portal_members(portal_id,user_id) ON DELETE RESTRICT
);
ALTER TABLE public.reporter_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_integrations FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.reporter_integration_value(i public.reporter_integrations) RETURNS jsonb
LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('id',i.id,'workspaceId',i.portal_id,'kind',i.kind,
  'ownerId',i.owner_user_id,'enabled',i.enabled,'revision',i.revision,'updatedAt',i.updated_at,'lastUsedAt',i.last_used_at) $$;
CREATE OR REPLACE FUNCTION public.reporter_integration_list(p_portal uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  PERFORM core.reporter_membership_manager(p_portal);
  RETURN (SELECT coalesce(jsonb_agg(core.reporter_integration_value(i) ORDER BY kind),'[]') FROM public.reporter_integrations i WHERE portal_id=p_portal);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_integration_save(p_portal uuid,p_owner uuid,p_enabled boolean,p_revision bigint,p_token_hash text,p_derivation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.reporter_membership_manager(p_portal); current public.reporter_integrations; result jsonb; previous jsonb;
BEGIN
  IF p_owner IS NULL OR p_enabled IS NULL OR p_revision IS NULL OR p_revision<0 THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  IF NOT EXISTS(SELECT FROM public.portal_members m JOIN core.users u ON u.id=m.user_id
    JOIN public.portal_user_roles ur ON (ur.portal_id,ur.user_id)=(m.portal_id,m.user_id)
    JOIN public.portal_roles r ON (r.portal_id,r.id)=(ur.portal_id,ur.portal_role_id)
    WHERE m.portal_id=p_portal AND m.user_id=p_owner AND m.status='active' AND NOT m.invite_pending
      AND NOT u.banned AND u.auth_subject IS NOT NULL AND r.name IN ('editor','admin')) THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  SELECT * INTO current FROM public.reporter_integrations WHERE portal_id=p_portal AND kind='drive' FOR UPDATE;
  IF coalesce(current.revision,0)<>p_revision THEN PERFORM core.platform_refuse('CONFLICT'); END IF;
  IF current.id IS NULL THEN
    IF p_token_hash IS NULL OR p_derivation IS NULL THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
    INSERT INTO public.reporter_integrations(portal_id,kind,owner_user_id,enabled,token_hash,derivation_secret,created_by)
      VALUES(p_portal,'drive',p_owner,p_enabled,p_token_hash,p_derivation,actor) RETURNING * INTO current;
  ELSE
    previous:=core.reporter_integration_value(current);
    UPDATE public.reporter_integrations SET owner_user_id=p_owner,enabled=p_enabled,revision=revision+1,
      token_hash=coalesce(p_token_hash,token_hash),updated_at=clock_timestamp() WHERE id=current.id RETURNING * INTO current;
  END IF;
  result:=core.reporter_integration_value(current);
  PERFORM core.reporter_workspace_log('integration.updated',p_portal,NULL,previous,result);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_drive_binding(p_id uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE binding public.reporter_integrations; context jsonb;
BEGIN
  SELECT * INTO binding FROM public.reporter_integrations WHERE id=p_id AND kind='drive' AND enabled AND token_hash=p_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid integration credential' USING ERRCODE='42501'; END IF;
  SELECT to_jsonb(c) INTO context FROM core.users u CROSS JOIN LATERAL public.reporter_service_context(u.email,binding.portal_id) c
    WHERE u.id=binding.owner_user_id AND c.roles && ARRAY['editor','admin'];
  IF context IS NULL THEN RAISE EXCEPTION 'Inactive integration owner' USING ERRCODE='42501'; END IF;
  UPDATE public.reporter_integrations SET last_used_at=clock_timestamp() WHERE id=p_id;
  RETURN jsonb_build_object('context',context,'derivation',binding.derivation_secret);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_drive_source_transcript(p_source uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_require('reporter.edit');
BEGIN
  RETURN (SELECT t.id FROM public.reporter_transcripts t JOIN public.reporter_drive_intakes i ON (i.portal_id,i.transcript_id)=(t.portal_id,t.id)
    WHERE t.portal_id=portal AND t.source_object_id=p_source);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_drive_legacy_binding(p_portal uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE binding uuid;
BEGIN
  SELECT id INTO binding FROM public.reporter_integrations WHERE portal_id=p_portal AND kind='drive';
  IF binding IS NULL THEN RETURN NULL; END IF;
  -- Once adopted, disabling or rotating a binding also closes the legacy credential.
  RETURN public.reporter_drive_binding(binding,p_hash);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_drive_retry_context(p_transcript uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_require('reporter.edit');
BEGIN
  RETURN (SELECT to_jsonb(c) FROM public.reporter_transcripts t JOIN public.reporter_drive_intakes i ON (i.portal_id,i.transcript_id)=(t.portal_id,t.id)
    JOIN core.users u ON u.id=t.created_by CROSS JOIN LATERAL public.reporter_service_context(u.email,portal) c
    WHERE t.id=p_transcript AND t.portal_id=portal AND c.roles && ARRAY['editor','admin']);
END $$;

DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY['core.reporter_integration_value(public.reporter_integrations)','public.reporter_integration_list(uuid)',
    'public.reporter_integration_save(uuid,uuid,boolean,bigint,text,text)','public.reporter_drive_binding(uuid,text)',
    'public.reporter_drive_source_transcript(uuid)','public.reporter_drive_retry_context(uuid)','public.reporter_drive_legacy_binding(uuid,text)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
    IF fn LIKE 'public.%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporter_runtime',fn); END IF;
  END LOOP;
END $$;
COMMIT;
