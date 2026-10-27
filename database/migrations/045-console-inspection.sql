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
COMMIT;
