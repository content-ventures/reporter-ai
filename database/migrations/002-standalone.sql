-- Forward-only conversion of the existing Reporter local database.
-- Role renames preserve object grants and SCRAM credentials. No data is deleted.
BEGIN;
DO $$
DECLARE old_role text; new_role text;
BEGIN
  IF current_database()<>'reporter_ai_local'
    OR coalesce(shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database'),'')
      NOT IN ('Reporter AI local fixture; not the approved Media On baseline',
              'Reporter AI standalone local; foundation and R1 commands v2')
    OR to_regprocedure('public.reporter_complete(uuid,text,integer,jsonb)') IS NULL
    OR EXISTS(SELECT FROM pg_database WHERE datname NOT IN ('reporter_ai_local','postgres','template0','template1'))
  THEN RAISE EXCEPTION 'Migration requires the isolated Reporter local database'; END IF;
  FOR old_role,new_role IN VALUES ('mediaon_runtime','reporter_runtime'),('mediaon_worker','reporter_worker') LOOP
    IF EXISTS(SELECT FROM pg_roles WHERE rolname=old_role) THEN
      IF EXISTS(SELECT FROM pg_roles WHERE rolname=new_role)
        OR EXISTS(SELECT FROM pg_authid WHERE rolname=old_role AND (rolsuper OR rolbypassrls
          OR rolpassword IS NULL OR rolpassword NOT LIKE 'SCRAM-SHA-256$%'))
        OR EXISTS(SELECT FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname=old_role)
      THEN RAISE EXCEPTION 'Unexpected role state; refusing conversion'; END IF;
      EXECUTE format('ALTER ROLE %I RENAME TO %I',old_role,new_role);
    END IF;
    IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=new_role AND NOT rolsuper AND NOT rolbypassrls)
    THEN RAISE EXCEPTION 'Reporter login is missing or overprivileged'; END IF;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION core.authorize_context(p_tenant uuid,p_portal uuid,p_user uuid,p_module text,p_public boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  -- Reporter is private. Public access and global roles never bypass membership.
  IF p_public OR p_tenant IS NULL OR p_portal IS NULL OR p_user IS NULL OR p_module<>'reporter_ai'
    OR p_module IS NULL THEN RETURN false; END IF;
  RETURN EXISTS(
    SELECT FROM core.tenants t
    JOIN public.portals p ON p.tenant_id=t.id
    JOIN core.tenant_members tm ON tm.tenant_id=t.id AND tm.user_id=p_user
    JOIN public.portal_members pm ON pm.tenant_id=t.id AND pm.portal_id=p.id AND pm.user_id=p_user
    JOIN core.users u ON u.id=p_user
    JOIN core.tenant_modules m ON m.tenant_id=t.id AND m.module_key=p_module
    JOIN core.portal_modules f ON f.tenant_id=t.id AND f.portal_id=p.id AND f.module_key=p_module
    WHERE t.id=p_tenant AND p.id=p_portal AND t.status='active' AND p.status='active'
      AND p.deleted_at IS NULL AND tm.status='active' AND pm.status='active'
      AND (NOT u.banned OR u.ban_expires<=now()) AND m.enabled AND f.enabled
  );
END $$;
CREATE OR REPLACE FUNCTION core.job_allowed(p_keys text[]) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT session_user='reporter_worker' AND current_setting('app.access_mode',true)='job'
    AND current_setting('app.job_key',true)=ANY(p_keys)
$$;
COMMENT ON FUNCTION public.reporter_create(text,uuid,integer,text,jsonb) IS 'reporter-r1-v2';
COMMENT ON DATABASE reporter_ai_local IS 'Reporter AI standalone local; foundation and R1 commands v2';
COMMIT;
