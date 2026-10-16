-- "Meu perfil": each member edits their own display name, cargo and photo. Safe to replay.
-- E-mail, roles and membership are never written here.
BEGIN;

ALTER TABLE core.users ADD COLUMN IF NOT EXISTS title text CHECK(title IS NULL OR length(title) BETWEEN 1 AND 80);
ALTER TABLE core.users ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz;

-- Only the signed-in member's own row. A photo is the server's content-addressed avatar path or
-- nothing; the API squares and re-encodes the bytes before it calls this.
CREATE OR REPLACE FUNCTION public.reporter_update_profile(p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); actor uuid := core.context_user_id();
  next_name text; next_title text; next_image text;
BEGIN
  IF actor IS NULL OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
    OR EXISTS(SELECT FROM jsonb_object_keys(p_patch) key WHERE key NOT IN ('name','title','image')) THEN
    RAISE EXCEPTION 'Invalid profile' USING ERRCODE='22023';
  END IF;
  SELECT name,title,image INTO next_name,next_title,next_image FROM core.users WHERE id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found' USING ERRCODE='42501'; END IF;
  IF p_patch ? 'name' THEN
    next_name := btrim(p_patch->>'name');
    IF next_name IS NULL OR next_name='' OR length(next_name)>80 THEN RAISE EXCEPTION 'Invalid profile name' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_patch ? 'title' THEN
    next_title := nullif(btrim(p_patch->>'title'),'');
    IF length(next_title)>80 THEN RAISE EXCEPTION 'Invalid profile title' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_patch ? 'image' THEN
    next_image := p_patch->>'image';
    IF next_image !~ '^/api/reporter/profile/avatar/[a-f0-9]{64}\.image$' THEN RAISE EXCEPTION 'Invalid profile image' USING ERRCODE='22023'; END IF;
  END IF;
  UPDATE core.users SET name=next_name,title=next_title,image=next_image,
    profile_updated_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=actor;
  PERFORM core.reporter_audit(portal,'reporter.profile.updated','user',actor,
    jsonb_build_object('fields',(SELECT jsonb_agg(key ORDER BY key) FROM jsonb_object_keys(p_patch) key)));
  RETURN jsonb_build_object('name',next_name,'title',next_title,'image',next_image);
END $$;
-- Owned by the table owner like reporter_session_context: the executor has no UPDATE on core.users.
ALTER FUNCTION public.reporter_update_profile(jsonb) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.reporter_update_profile(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_update_profile(jsonb) TO reporter_runtime;

-- The local operator's identity is a server constant; once edited, its profile comes from here.
CREATE OR REPLACE FUNCTION public.reporter_profile() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); result jsonb;
BEGIN
  SELECT jsonb_build_object('name',name,'title',title,'image',image,'updatedAt',profile_updated_at)
    INTO result FROM core.users WHERE id=core.context_user_id() AND portal IS NOT NULL;
  RETURN result;
END $$;
ALTER FUNCTION public.reporter_profile() OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_profile() TO reporter_runtime;

COMMIT;
