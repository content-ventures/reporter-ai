-- Browser deltas, worker claims and compaction for the editorial rows. Safe to replay.
BEGIN;

-- The poll stamp: change number, delta floor and a members hash. It never reads editorial rows.
-- The hash covers the self-edited profile (title: 005 in the cloud, 017 locally).
CREATE OR REPLACE FUNCTION public.reporter_ed_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); result jsonb;
BEGIN
  SELECT jsonb_build_object('seq',coalesce(s.seq,0),'floor',coalesce(s.floor_seq,0),'membersHash',md5(
    jsonb_build_object('name',p.name,'slug',p.slug,'members',coalesce((
      SELECT jsonb_agg(member ORDER BY member->>'id') FROM (
        SELECT jsonb_build_object('id',u.id,'name',u.name,'title',u.title,'email',u.email,'image',u.image,
          'portalStatus',pm.status,'tenantStatus',tm.status,'roles',coalesce((
            SELECT jsonb_agg(pr.name ORDER BY pr.name) FROM public.portal_user_roles pur
            JOIN public.portal_roles pr ON pr.id=pur.portal_role_id AND pr.portal_id=portal
            WHERE pur.portal_id=portal AND pur.user_id=u.id),'[]'::jsonb)) AS member
        FROM public.portal_members pm JOIN core.users u ON u.id=pm.user_id
        JOIN core.tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=u.id
        WHERE pm.portal_id=portal
      ) members),'[]'::jsonb))::text)) INTO result
    FROM public.portals p LEFT JOIN public.reporter_ed_sync s ON s.portal_id=p.id
    WHERE p.id=portal;
  RETURN result;
END $$;

-- Rows stamped after the browser's number, as the browser sees them: run folds and job
-- metadata, never job internals. Deleted parts and items arrive as tombstones.
CREATE OR REPLACE FUNCTION public.reporter_ed_changes(p_since bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); sync public.reporter_ed_sync;
BEGIN
  SELECT * INTO sync FROM public.reporter_ed_sync WHERE portal_id=portal;
  IF p_since IS NULL OR p_since<coalesce(sync.floor_seq,0) THEN RAISE EXCEPTION 'Delta below floor' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('seq',coalesce(sync.seq,0),
    'workspace',(SELECT doc FROM public.reporter_ed_workspace WHERE portal_id=portal AND seq>p_since),
    'productions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',production_id,'ordinal',ordinal,'doc',doc,
      'sourceIds',to_jsonb(source_ids),'archived',archived) ORDER BY ordinal)
      FROM public.reporter_ed_productions WHERE portal_id=portal AND seq>p_since),'[]'),
    'parts',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',kind,'id',part_id,'productionId',production_id,
      'ordinal',ordinal,'doc',doc,'deleted',deleted) ORDER BY ordinal)
      FROM public.reporter_ed_parts WHERE portal_id=portal AND seq>p_since),'[]'),
    'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('id',source_id,'ordinal',ordinal,'doc',doc) ORDER BY ordinal)
      FROM public.reporter_ed_sources WHERE portal_id=portal AND seq>p_since),'[]'),
    'runs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',run_id,'productionId',production_id,'status',status,
      'job',jsonb_build_object('meta',job->'meta','kind',job->'kind'),'fold',fold) ORDER BY created_at,run_id)
      FROM public.reporter_ed_runs WHERE portal_id=portal AND seq>p_since),'[]'),
    'events',coalesce((SELECT jsonb_agg(jsonb_build_object('runId',run_id,'event',event) ORDER BY run_id,event_seq)
      FROM public.reporter_ed_run_events WHERE portal_id=portal AND seq>p_since),'[]'),
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',kind,'id',item_id,'productionId',production_id,
      'ordinal',ordinal,'doc',doc,'deleted',deleted) ORDER BY ordinal)
      FROM public.reporter_ed_items WHERE portal_id=portal AND seq>p_since
        AND kind IN ('person','member','activity','feedback','image_asset')),'[]'));
END $$;

-- Claimable runs come from the claim index; the worker gate and the stall signal both use it.
-- Until a portal's checkpoint is migrated (016), its legacy queued jobs still count too.
CREATE OR REPLACE FUNCTION core.reporter_editorial_claimable_since(p_portal uuid)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT least(
    (SELECT min(greatest(available_at,coalesce(lease_until,'-infinity'::timestamptz))) FROM public.reporter_ed_runs
      WHERE portal_id=p_portal AND status IN ('queued','running','awaiting_input') AND job IS NOT NULL
        AND available_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())),
    (SELECT min(to_timestamp(greatest((job.value->>'availableAt')::numeric,
        CASE WHEN jsonb_typeof(job.value->'lease')='object' THEN (job.value->'lease'->>'until')::numeric ELSE 0 END)/1000))
      FROM public.reporter_editorial_workspaces w
      CROSS JOIN LATERAL jsonb_each(coalesce(w.checkpoint->'jobs','{}'::jsonb)) job
      WHERE w.portal_id=p_portal
        AND w.checkpoint->'state'->'runFolds'->job.key->'run'->>'status' IN ('queued','running','awaiting_input')
        AND (job.value->>'availableAt')::numeric<=extract(epoch FROM clock_timestamp())*1000
        AND (jsonb_typeof(job.value->'lease') IS DISTINCT FROM 'object'
          OR (job.value->'lease'->>'until')::numeric<extract(epoch FROM clock_timestamp())*1000)))
$$;

-- Leases are worker bookkeeping, not browser state: claims and renewals are not stamped.
CREATE OR REPLACE FUNCTION public.reporter_ed_claim(p_owner text,p_lease_ms integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_ed_portal(true); claimed public.reporter_ed_runs;
BEGIN
  IF current_setting('app.access_mode',true) IS DISTINCT FROM 'job' THEN RAISE EXCEPTION 'Worker only' USING ERRCODE='42501'; END IF;
  IF p_owner IS NULL OR p_owner !~ '^[a-zA-Z0-9_-]{8,128}$' OR p_lease_ms NOT BETWEEN 1000 AND 900000 THEN
    RAISE EXCEPTION 'Invalid claim' USING ERRCODE='22023'; END IF;
  SELECT * INTO claimed FROM public.reporter_ed_runs
    WHERE portal_id=portal AND status IN ('queued','running','awaiting_input') AND job IS NOT NULL
      AND available_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
    ORDER BY available_at,created_at,run_id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.reporter_ed_runs SET lease_owner=p_owner,lease_until=clock_timestamp()+make_interval(secs=>p_lease_ms/1000.0),
      lease_fence=gen_random_uuid()::text,attempts=attempts+1
    WHERE portal_id=portal AND run_id=claimed.run_id RETURNING * INTO claimed;
  RETURN jsonb_build_object('runId',claimed.run_id,'productionId',claimed.production_id,'attempts',claimed.attempts,
    'lease',jsonb_build_object('owner',claimed.lease_owner,'until',(extract(epoch FROM claimed.lease_until)*1000)::bigint,'fence',claimed.lease_fence));
END $$;

CREATE OR REPLACE FUNCTION public.reporter_ed_renew(p_run text,p_owner text,p_fence text,p_lease_ms integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_ed_portal(true);
BEGIN
  IF current_setting('app.access_mode',true) IS DISTINCT FROM 'job' THEN RAISE EXCEPTION 'Worker only' USING ERRCODE='42501'; END IF;
  UPDATE public.reporter_ed_runs SET lease_until=clock_timestamp()+make_interval(secs=>p_lease_ms/1000.0)
    WHERE portal_id=portal AND run_id=p_run AND lease_owner=p_owner AND lease_fence=p_fence
      AND lease_until>clock_timestamp() AND status IN ('queued','running','awaiting_input')
      AND p_lease_ms BETWEEN 1000 AND 900000;
  RETURN FOUND;
END $$;

-- Bounded housekeeping: finished runs keep their fold, not their event stream; command
-- receipts expire; old tombstones go and the delta floor rises past them.
CREATE OR REPLACE FUNCTION public.reporter_ed_compact() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_ed_portal(true); events integer; receipts integer; tombstones integer; floor bigint;
BEGIN
  IF current_setting('app.access_mode',true) IS DISTINCT FROM 'job' THEN RAISE EXCEPTION 'Worker only' USING ERRCODE='42501'; END IF;
  DELETE FROM public.reporter_ed_run_events e USING public.reporter_ed_runs r
    WHERE e.portal_id=portal AND (r.portal_id,r.run_id)=(e.portal_id,e.run_id)
      AND r.finished_at<clock_timestamp()-interval '1 hour';
  GET DIAGNOSTICS events = ROW_COUNT;
  DELETE FROM public.reporter_ed_receipts WHERE portal_id=portal AND created_at<clock_timestamp()-interval '7 days';
  GET DIAGNOSTICS receipts = ROW_COUNT;
  SELECT max(seq) INTO floor FROM (
    SELECT seq FROM public.reporter_ed_parts WHERE portal_id=portal AND deleted
    UNION ALL SELECT seq FROM public.reporter_ed_items WHERE portal_id=portal AND deleted) old
    WHERE seq<(SELECT seq FROM public.reporter_ed_sync WHERE portal_id=portal)-100000;
  DELETE FROM public.reporter_ed_parts WHERE portal_id=portal AND deleted AND seq<=floor;
  GET DIAGNOSTICS tombstones = ROW_COUNT;
  DELETE FROM public.reporter_ed_items WHERE portal_id=portal AND deleted AND seq<=floor;
  IF floor IS NOT NULL THEN UPDATE public.reporter_ed_sync SET floor_seq=greatest(floor_seq,floor) WHERE portal_id=portal; END IF;
  RETURN jsonb_build_object('events',events,'receipts',receipts,'tombstones',tombstones);
END $$;

ALTER FUNCTION public.reporter_ed_status() OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_ed_changes(bigint) OWNER TO reporter_executor;
ALTER FUNCTION core.reporter_editorial_claimable_since(uuid) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_ed_claim(text,integer) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_ed_renew(text,text,text,integer) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_ed_compact() OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_ed_status(),public.reporter_ed_changes(bigint),core.reporter_editorial_claimable_since(uuid),
  public.reporter_ed_claim(text,integer),public.reporter_ed_renew(text,text,text,integer),public.reporter_ed_compact() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_ed_status(),public.reporter_ed_changes(bigint) TO reporter_runtime;
GRANT EXECUTE ON FUNCTION public.reporter_ed_claim(text,integer),public.reporter_ed_renew(text,text,text,integer),
  public.reporter_ed_compact() TO reporter_worker;
COMMENT ON FUNCTION public.reporter_ed_status() IS 'reporter-editorial-rows-v1';
COMMIT;
