-- Account photos are shared identity metadata; client files remain workspace owned.
BEGIN;
CREATE OR REPLACE FUNCTION public.reporter_avatar_access(p_subject text,p_email text,p_verified boolean,p_target uuid,p_portal uuid,p_file text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE viewer uuid;
BEGIN
  IF p_subject IS NULL THEN
    viewer:=core.platform_operator();
    IF viewer<>'00000000-0000-0000-0000-000000000031'::uuid OR NOT EXISTS(SELECT FROM core.users WHERE id=viewer AND email='operator@reporter.local.invalid') THEN RETURN false; END IF;
  ELSE
    IF p_verified IS NOT TRUE THEN RETURN false; END IF;
    SELECT id INTO viewer FROM core.users WHERE auth_subject=p_subject AND lower(email)=lower(p_email) AND NOT banned;
  END IF;
  IF viewer IS NULL OR p_file IS NULL OR p_file !~ '^[a-f0-9]{64}\.image$' THEN RETURN false; END IF;
  RETURN EXISTS(SELECT FROM core.users target WHERE target.id=p_target
    AND (target.image='/api/reporter/avatars/'||target.id::text||'/'||p_portal::text||'/'||p_file
      OR target.image='/api/reporter/profile/avatar/'||p_file
        AND p_portal IN ('10000000-0000-0000-0000-000000000101'::uuid,'00000000-0000-0000-0000-000000000101'::uuid)
        AND EXISTS(SELECT FROM public.portal_members WHERE user_id=target.id AND portal_id=p_portal))
    AND (viewer=p_target OR core.reporter_is_operator(viewer) OR EXISTS(
      SELECT FROM public.portal_members a JOIN public.portal_members b ON b.portal_id=a.portal_id
      WHERE a.user_id=viewer AND b.user_id=p_target AND a.status='active' AND b.status='active' AND NOT a.invite_pending AND NOT b.invite_pending
        AND core.authorize_context(a.tenant_id,a.portal_id,viewer,'reporter_ai',false))));
END $$;

CREATE OR REPLACE FUNCTION public.reporter_update_profile(p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_require('reporter.read'); actor uuid:=core.context_user_id(); next_name text; next_title text; next_image text;
BEGIN
  IF actor IS NULL OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_patch) key WHERE key NOT IN ('name','title','image')) THEN
    RAISE EXCEPTION 'Invalid profile' USING ERRCODE='22023';
  END IF;
  SELECT name,title,image INTO next_name,next_title,next_image FROM core.users WHERE id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found' USING ERRCODE='42501'; END IF;
  IF p_patch ? 'name' THEN
    next_name:=btrim(p_patch->>'name');
    IF next_name IS NULL OR length(next_name) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Invalid profile name' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_patch ? 'title' THEN
    next_title:=nullif(btrim(p_patch->>'title'),'');
    IF length(next_title)>80 THEN RAISE EXCEPTION 'Invalid profile title' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_patch ? 'image' THEN
    next_image:=p_patch->>'image';
    IF next_image IS NOT NULL AND next_image !~ '^/api/reporter/profile/avatar/[a-f0-9]{64}\.image$'
      AND next_image !~ ('^/api/reporter/avatars/'||actor::text||'/'||portal::text||'/[a-f0-9]{64}\.image$') THEN
      RAISE EXCEPTION 'Invalid profile image' USING ERRCODE='22023';
    END IF;
  END IF;
  UPDATE core.users SET name=next_name,title=next_title,image=next_image,profile_updated_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=actor;
  PERFORM core.reporter_audit(portal,'reporter.profile.updated','user',actor,jsonb_build_object('fields',(SELECT jsonb_agg(key ORDER BY key) FROM jsonb_object_keys(p_patch) key)));
  RETURN jsonb_build_object('name',next_name,'title',next_title,'image',next_image);
END $$;
ALTER FUNCTION public.reporter_update_profile(jsonb) OWNER TO CURRENT_USER;
ALTER FUNCTION public.reporter_avatar_access(text,text,boolean,uuid,uuid,text) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.reporter_avatar_access(text,text,boolean,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_avatar_access(text,text,boolean,uuid,uuid,text) TO reporter_runtime;
COMMIT;
