BEGIN;
-- The Drive folder intake has no browser session: it acts as one configured member, found by
-- email. Read-only: unlike reporter_session_context it binds no auth subject and edits no user.
CREATE OR REPLACE FUNCTION public.reporter_service_context(p_email text,p_portal uuid)
RETURNS TABLE(tenant_id uuid,portal_id uuid,user_id uuid,workspace_name text,workspace_slug text,user_name text,user_email text,user_image text,roles text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF p_email IS NULL OR btrim(p_email)='' OR length(p_email)>320 OR p_portal IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT p.tenant_id,p.id,u.id,p.name,p.slug,u.name,u.email,u.image,
      coalesce(array_agg(DISTINCT pr.name ORDER BY pr.name) FILTER (WHERE pr.name IS NOT NULL),'{}'::text[])
    FROM core.users u
    JOIN core.tenant_members tm ON tm.user_id=u.id AND tm.status='active'
    JOIN public.portal_members pm ON pm.user_id=u.id AND pm.tenant_id=tm.tenant_id AND pm.status='active'
    JOIN public.portals p ON p.id=pm.portal_id AND p.tenant_id=tm.tenant_id AND p.status='active' AND p.deleted_at IS NULL
    LEFT JOIN public.portal_user_roles pur ON pur.portal_id=p.id AND pur.user_id=u.id
    LEFT JOIN public.portal_roles pr ON pr.id=pur.portal_role_id AND pr.portal_id=p.id
    WHERE lower(u.email)=lower(btrim(p_email)) AND p.id=p_portal AND core.authorize_context(p.tenant_id,p.id,u.id,'reporter_ai',false)
    GROUP BY p.tenant_id,p.id,u.id,p.name,p.slug,u.name,u.email,u.image;
END $$;
-- Owned like reporter_session_context: the NOLOGIN executor has no grant on core.users.
ALTER FUNCTION public.reporter_service_context(text,uuid) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.reporter_service_context(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_service_context(text,uuid) TO reporter_runtime;
COMMENT ON FUNCTION public.reporter_service_context(text,uuid) IS 'reporter-drive-intake-v1';
COMMIT;
