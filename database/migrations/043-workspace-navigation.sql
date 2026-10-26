-- Navigation receives the actual account; membership roles remain client scoped.
BEGIN;
CREATE OR REPLACE FUNCTION core.reporter_workspace_directory(p_user uuid,p_search text,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE operator boolean:=core.reporter_is_operator(p_user); entries jsonb; total bigint; search text:=left(coalesce(btrim(p_search),''),100);
BEGIN
  WITH available AS (SELECT p.id FROM public.portals p JOIN public.reporter_workspaces w ON w.portal_id=p.id JOIN core.tenants t ON t.id=p.tenant_id
    WHERE p.deleted_at IS NULL AND t.status='active' AND (p.name ILIKE '%'||search||'%' OR p.slug ILIKE '%'||search||'%')
      AND (operator OR EXISTS(SELECT FROM public.portal_members m JOIN core.tenant_members tm ON tm.tenant_id=m.tenant_id AND tm.user_id=m.user_id
        WHERE m.portal_id=p.id AND m.user_id=p_user AND m.status='active' AND NOT m.invite_pending AND tm.status='active' AND (p.status='active' OR p.status='draft' AND core.platform_roles(p_user,p.id) ? 'admin'))))
    SELECT count(*) INTO total FROM available;
  SELECT coalesce(jsonb_agg(value ORDER BY name,id),'[]') INTO entries FROM (
    SELECT p.name,p.id,jsonb_build_object('workspace',core.reporter_workspace_value(p.id),'administrative',operator,
      'enterable',EXISTS(SELECT FROM core.reporter_workspace_context(p_user,p.slug)),'roles',CASE WHEN operator THEN '["admin"]'::jsonb ELSE core.platform_roles(p_user,p.id) END) AS value
    FROM public.portals p JOIN public.reporter_workspaces w ON w.portal_id=p.id JOIN core.tenants t ON t.id=p.tenant_id
    WHERE p.deleted_at IS NULL AND t.status='active' AND (p.name ILIKE '%'||search||'%' OR p.slug ILIKE '%'||search||'%')
      AND (operator OR EXISTS(SELECT FROM public.portal_members m JOIN core.tenant_members tm ON tm.tenant_id=m.tenant_id AND tm.user_id=m.user_id
        WHERE m.portal_id=p.id AND m.user_id=p_user AND m.status='active' AND NOT m.invite_pending AND tm.status='active' AND (p.status='active' OR p.status='draft' AND core.platform_roles(p_user,p.id) ? 'admin')))
    ORDER BY p.name,p.id LIMIT least(greatest(coalesce(p_limit,50),1),100) OFFSET greatest(coalesce(p_offset,0),0)) page;
  RETURN jsonb_build_object('items',entries,'total',total,'offset',greatest(coalesce(p_offset,0),0),'administrative',operator,'account',(SELECT jsonb_strip_nulls(jsonb_build_object('id',id,'name',name,'email',email,'avatarUrl',image)) FROM core.users WHERE id=p_user AND NOT banned));
END $$;

CREATE OR REPLACE FUNCTION public.reporter_navigation_identity() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.context_user_id();
BEGIN
  PERFORM core.reporter_require('reporter.read');
  RETURN jsonb_build_object('accountId',actor,'administrative',core.reporter_is_operator(actor));
END $$;
ALTER FUNCTION public.reporter_navigation_identity() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.reporter_navigation_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_navigation_identity() TO reporter_runtime;
COMMIT;
