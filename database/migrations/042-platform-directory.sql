-- Bound global projections and name every workspace in the activity ledger.
BEGIN;
CREATE OR REPLACE FUNCTION core.reporter_pending_people() RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF to_regclass('neon_auth."user"') IS NOT NULL THEN
    RETURN QUERY EXECUTE $q$ SELECT jsonb_strip_nulls(jsonb_build_object('id','auth:'||a.id::text,'name',a.name,'email',lower(a.email),
      'avatarUrl',a.image,'status','pending','roles','[]'::jsonb,'operator',false,'createdAt',a."createdAt"))
    FROM neon_auth."user" a WHERE lower(a.email) NOT LIKE '%.invalid'
      AND NOT EXISTS(SELECT FROM core.users u WHERE u.auth_subject=a.id::text OR lower(u.email)=lower(a.email)) $q$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_platform_directory_page(p_search text,p_status text,p_portal uuid,p_person text,p_limit integer,p_offset integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE items jsonb; total bigint; counts jsonb; workspaces jsonb; workspace_total bigint;
  search text:=left(coalesce(p_search,''),100); page_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
BEGIN
  PERFORM core.platform_operator();
  IF p_status IS NOT NULL AND p_status NOT IN ('active','invited','pending','suspended') THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  WITH accounts AS (
    SELECT core.platform_person(u.id) AS doc FROM core.users u
    WHERE EXISTS(SELECT FROM core.tenant_members tm WHERE tm.user_id=u.id)
      AND (p_portal IS NULL OR EXISTS(SELECT FROM public.portal_members m WHERE m.user_id=u.id AND m.portal_id=p_portal))
      AND (p_person IS NULL OR u.id::text=p_person) AND (u.name ILIKE '%'||search||'%' OR u.email ILIKE '%'||search||'%')
    UNION ALL SELECT doc FROM core.reporter_pending_people() doc WHERE p_portal IS NULL
      AND (p_person IS NULL OR doc->>'id'=p_person) AND (doc->>'name' ILIKE '%'||search||'%' OR doc->>'email' ILIKE '%'||search||'%')
  ), selected AS (SELECT doc FROM accounts WHERE p_status IS NULL OR doc->>'status'=p_status)
  SELECT (SELECT count(*) FROM selected),
    (SELECT jsonb_build_object('all',count(*),'active',count(*) FILTER(WHERE doc->>'status'='active'),
      'invited',count(*) FILTER(WHERE doc->>'status'='invited'),'pending',count(*) FILTER(WHERE doc->>'status'='pending'),
      'suspended',count(*) FILTER(WHERE doc->>'status'='suspended')) FROM accounts),
    (SELECT coalesce(jsonb_agg(doc ORDER BY doc->>'createdAt' DESC,doc->>'id'),'[]') FROM
      (SELECT doc FROM selected ORDER BY doc->>'createdAt' DESC,doc->>'id' LIMIT page_limit OFFSET greatest(coalesce(p_offset,0),0)) page)
  INTO total,counts,items;
  SELECT count(*) INTO workspace_total FROM public.portals WHERE deleted_at IS NULL AND status IN ('draft','active');
  SELECT coalesce(jsonb_agg(value ORDER BY name,id),'[]') INTO workspaces FROM
    (SELECT id,name,jsonb_build_object('id',id,'name',name,'slug',slug) AS value FROM public.portals
      WHERE deleted_at IS NULL AND status IN ('draft','active') ORDER BY name,id LIMIT 100) page;
  RETURN jsonb_build_object('people',items,'total',total,'counts',counts,'offset',greatest(coalesce(p_offset,0),0),
    'workspaces',workspaces,'workspaceTotal',workspace_total);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_platform_directory() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT public.reporter_platform_directory_page('',NULL,NULL,NULL,50,0)
$$;

CREATE OR REPLACE FUNCTION public.reporter_platform_log_page(p_limit integer,p_offset integer,p_portal uuid,p_person uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE items jsonb; total bigint;
BEGIN
  PERFORM core.platform_operator();
  SELECT count(*) INTO total FROM public.audit_log l WHERE source IN ('platform','reporter_ai')
    AND (p_portal IS NULL OR l.portal_id=p_portal) AND (p_person IS NULL OR l.user_id=p_person OR l.entity_type='user' AND l.entity_id=p_person);
  SELECT coalesce(jsonb_agg(entry ORDER BY at DESC,id DESC),'[]') INTO items FROM (
    SELECT l.created_at AS at,l.id,jsonb_strip_nulls(jsonb_build_object('id',l.id,'at',l.created_at,
      'action',CASE WHEN l.source='platform' THEN substr(l.action,10) ELSE l.action END,
      'actor',CASE WHEN a.id IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object('id',a.id,'name',a.name,'avatarUrl',a.image)) END,
      'target',CASE WHEN t.id IS NOT NULL THEN jsonb_build_object('id',t.id,'name',t.name,'email',t.email) END,
      'workspace',CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('id',p.id,'name',p.name,'slug',p.slug) END,
      'roles',coalesce(l.after_data->'roles',l.after_data->'after'->'roles'))) AS entry
    FROM public.audit_log l LEFT JOIN core.users a ON a.id=l.user_id
    LEFT JOIN core.users t ON l.entity_type='user' AND t.id=l.entity_id LEFT JOIN public.portals p ON p.id=l.portal_id
    WHERE l.source IN ('platform','reporter_ai') AND (p_portal IS NULL OR l.portal_id=p_portal)
      AND (p_person IS NULL OR l.user_id=p_person OR l.entity_type='user' AND l.entity_id=p_person)
    ORDER BY l.created_at DESC,l.id DESC LIMIT least(greatest(coalesce(p_limit,50),1),200) OFFSET greatest(coalesce(p_offset,0),0)) page;
  RETURN jsonb_build_object('items',items,'total',total);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_platform_usage(p_from date,p_portal uuid,p_person uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE since timestamptz; facts jsonb; signins jsonb := '[]'::jsonb; storage numeric;
BEGIN
  PERFORM core.platform_operator();
  IF p_from IS NULL OR p_from < current_date-400 OR p_from > current_date THEN RAISE EXCEPTION 'Invalid period' USING ERRCODE='22023'; END IF;
  since := p_from::timestamp AT TIME ZONE 'UTC';

  WITH runs AS (
    SELECT to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,r.portal_id::text AS workspace,
      CASE WHEN r.fold->'run'->>'createdBy' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN r.fold->'run'->>'createdBy' END AS person,
      coalesce(nullif(r.fold->'run'->'model'->>'alias',''),r.job->'provider'->>'model','—') AS model,r.status,
      coalesce(round((r.fold->'run'->'usage'->>'inputTokens')::numeric),0) AS input_tokens,
      coalesce(round((r.fold->'run'->'usage'->>'outputTokens')::numeric),0) AS output_tokens
    FROM public.reporter_ed_runs r WHERE r.created_at>=since AND r.status IN ('completed','failed') AND (p_portal IS NULL OR r.portal_id=p_portal) AND (p_person IS NULL OR r.fold->'run'->>'createdBy'=p_person::text)
  ), productions AS (
    SELECT to_char((p.doc->>'createdAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,p.portal_id::text AS workspace,
      CASE WHEN p.doc->>'createdBy' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p.doc->>'createdBy' END AS person
    FROM public.reporter_ed_productions p
    WHERE p.doc->>'createdAt' IS NOT NULL AND (p.doc->>'createdAt')::timestamptz>=since AND (p_portal IS NULL OR p.portal_id=p_portal) AND (p_person IS NULL OR p.doc->>'createdBy'=p_person::text)
  ), decisions AS (
    SELECT to_char((d.doc->>'at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,d.portal_id::text AS workspace,
      CASE WHEN d.doc->>'by' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN d.doc->>'by' END AS person,
      d.doc->>'decision' AS decision
    FROM public.reporter_ed_parts d
    WHERE d.kind='decision' AND NOT d.deleted AND d.doc->>'at' IS NOT NULL AND (d.doc->>'at')::timestamptz>=since AND (p_portal IS NULL OR d.portal_id=p_portal) AND (p_person IS NULL OR d.doc->>'by'=p_person::text)
  ), audio AS (
    -- Transcription as the provider billed it (audio milliseconds of each finished transcript).
    SELECT to_char(l.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,t.created_by::text AS person,l.portal_id::text AS workspace,
      coalesce(l.after_data->'processing'->>'model',t.model,'—') AS model,
      sum(coalesce((l.after_data->'processing'->>'input_units')::numeric,0))/1000 AS seconds
    FROM public.audit_log l LEFT JOIN public.reporter_transcripts t ON t.id=l.entity_id
    WHERE l.action='reporter.transcript.generated' AND l.created_at>=since AND l.portal_id IS NOT NULL
      AND l.after_data->'processing'->>'usage_unit'='audio_ms' AND (p_portal IS NULL OR l.portal_id=p_portal) AND (p_person IS NULL OR t.created_by=p_person)
    GROUP BY 1,2,3,4
  ), active AS (
    -- Active on a day: acted, generated, created or decided (sign-ins are added below).
    SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,user_id::text AS person,portal_id::text AS workspace
      FROM public.audit_log WHERE created_at>=since AND user_id IS NOT NULL AND portal_id IS NOT NULL AND source<>'platform' AND (p_portal IS NULL OR portal_id=p_portal) AND (p_person IS NULL OR user_id=p_person)
    UNION SELECT day,person,workspace FROM runs WHERE person IS NOT NULL
    UNION SELECT day,person,workspace FROM productions WHERE person IS NOT NULL
    UNION SELECT day,person,workspace FROM decisions WHERE person IS NOT NULL
  )
  SELECT jsonb_build_object(
    'generations',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'personId',person,'workspaceId',workspace,'model',model,
        'completed',completed,'failed',failed,'inputTokens',input_tokens,'outputTokens',output_tokens)),'[]'::jsonb)
      FROM (SELECT day,person,workspace,model,count(*) FILTER (WHERE status='completed') AS completed,
        count(*) FILTER (WHERE status='failed') AS failed,sum(input_tokens) AS input_tokens,sum(output_tokens) AS output_tokens
        FROM runs GROUP BY day,person,workspace,model) g),
    'productions',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'personId',person,'workspaceId',workspace,'count',total)),'[]'::jsonb)
      FROM (SELECT day,person,workspace,count(*) AS total FROM productions GROUP BY day,person,workspace) g),
    'approvals',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'personId',person,'workspaceId',workspace,'count',total)),'[]'::jsonb)
      FROM (SELECT day,person,workspace,count(*) AS total FROM decisions WHERE decision='approved' GROUP BY day,person,workspace) g),
    'audio',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'personId',person,'workspaceId',workspace,'model',model,'seconds',seconds)),'[]'::jsonb) FROM audio),
    'activeDays',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',day,'personId',person,'workspaceId',workspace)),'[]'::jsonb) FROM active))
  INTO facts;

  IF to_regclass('neon_auth.session') IS NOT NULL THEN
    EXECUTE $q$
      SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('day',to_char(s."createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD'),
        'personId',u.id::text,'workspaceId',pm.portal_id::text)),'[]'::jsonb)
      FROM neon_auth.session s JOIN core.users u ON u.auth_subject=s."userId"::text
      JOIN public.portal_members pm ON pm.user_id=u.id
      WHERE s."createdAt">=$1 AND ($2::uuid IS NULL OR pm.portal_id=$2) AND ($3::uuid IS NULL OR u.id=$3)$q$ INTO signins USING since,p_portal,p_person;
    SELECT coalesce(jsonb_agg(DISTINCT entry),'[]'::jsonb) INTO signins
      FROM jsonb_array_elements((facts->'activeDays')||signins) entry;
    facts := jsonb_set(facts,'{activeDays}',signins);
  END IF;

  SELECT (SELECT coalesce(sum(size),0) FROM core.storage_objects WHERE status='completed' AND (p_portal IS NULL OR portal_id=p_portal) AND (p_person IS NULL OR owner_user_id=p_person))
    + (SELECT coalesce(sum(coalesce((doc->'asset'->>'bytes')::numeric,(doc->>'bytes')::numeric,0)),0)
       FROM public.reporter_ed_items WHERE kind IN ('image_asset','library_image') AND NOT deleted AND (p_portal IS NULL OR portal_id=p_portal) AND (p_person IS NULL OR coalesce(doc->'asset'->>'createdBy',doc->>'createdBy')=p_person::text)) INTO storage;
  RETURN facts||jsonb_build_object('storageBytes',storage,'storageIncomplete',p_person IS NOT NULL);
END $$;

DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY['core.reporter_pending_people()',
    'public.reporter_platform_directory_page(text,text,uuid,text,integer,integer)','public.reporter_platform_log_page(integer,integer,uuid,uuid)','public.reporter_platform_usage(date,uuid,uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',fn); EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.reporter_platform_directory_page(text,text,uuid,text,integer,integer),
    public.reporter_platform_log_page(integer,integer,uuid,uuid),public.reporter_platform_usage(date,uuid,uuid) TO reporter_runtime;
END $$;
COMMIT;
