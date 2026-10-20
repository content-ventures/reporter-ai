-- Fact checks of citations: one row per citation id, kept apart from the citation so a recheck
-- or an editor's verdict never collides with the citation's editorial revision. After an article
-- is generated, its citations are checked in the background on the text run's durable job, like
-- the optional images: the run stays completed and the text never waits. Replayable.
BEGIN;

ALTER TABLE public.reporter_ed_items DROP CONSTRAINT IF EXISTS reporter_ed_items_kind_check;
ALTER TABLE public.reporter_ed_items ADD CONSTRAINT reporter_ed_items_kind_check
  CHECK(kind IN ('person','member','activity','feedback','image_asset','citation','library_image','banner','fact_check'));

CREATE INDEX IF NOT EXISTS reporter_ed_fact_check_claim_idx ON public.reporter_ed_runs(portal_id,available_at)
  WHERE status='completed' AND job->'factCheck'->>'status'='queued';

CREATE OR REPLACE FUNCTION core.reporter_editorial_claimable_since(p_portal uuid)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT min(greatest(available_at,coalesce(lease_until,'-infinity'::timestamptz))) FROM public.reporter_ed_runs
    WHERE portal_id=p_portal AND job IS NOT NULL AND available_at<=clock_timestamp()
      AND (lease_until IS NULL OR lease_until<clock_timestamp())
      AND (status IN ('queued','running','awaiting_input')
        OR status='completed' AND (job->'images'->>'status'='queued' OR job->'factCheck'->>'status'='queued'))
$$;

CREATE OR REPLACE FUNCTION public.reporter_ed_fact_check_claim(p_owner text,p_lease_ms integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_ed_portal(true); claimed public.reporter_ed_runs;
BEGIN
  IF current_setting('app.access_mode',true) IS DISTINCT FROM 'job' THEN RAISE EXCEPTION 'Worker only' USING ERRCODE='42501'; END IF;
  IF p_owner IS NULL OR p_owner !~ '^[a-zA-Z0-9_-]{8,128}$' OR p_lease_ms NOT BETWEEN 1000 AND 900000 THEN
    RAISE EXCEPTION 'Invalid claim' USING ERRCODE='22023'; END IF;
  SELECT * INTO claimed FROM public.reporter_ed_runs
    WHERE portal_id=portal AND status='completed' AND job->'factCheck'->>'status'='queued'
      AND available_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
    ORDER BY available_at,created_at,run_id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.reporter_ed_runs SET lease_owner=p_owner,lease_until=clock_timestamp()+make_interval(secs=>p_lease_ms/1000.0),
      lease_fence=gen_random_uuid()::text,
      job=jsonb_set(job,'{factCheck,attempts}',to_jsonb(coalesce((job->'factCheck'->>'attempts')::integer,0)+1))
    WHERE portal_id=portal AND run_id=claimed.run_id RETURNING * INTO claimed;
  RETURN jsonb_build_object('runId',claimed.run_id,'productionId',claimed.production_id,'fence',claimed.lease_fence);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_ed_fact_check_renew(p_run text,p_owner text,p_fence text,p_lease_ms integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_ed_portal(true);
BEGIN
  IF current_setting('app.access_mode',true) IS DISTINCT FROM 'job' THEN RAISE EXCEPTION 'Worker only' USING ERRCODE='42501'; END IF;
  UPDATE public.reporter_ed_runs SET lease_until=clock_timestamp()+make_interval(secs=>p_lease_ms/1000.0)
    WHERE portal_id=portal AND run_id=p_run AND lease_owner=p_owner AND lease_fence=p_fence
      AND lease_until>clock_timestamp() AND status='completed' AND job->'factCheck'->>'status'='queued'
      AND p_lease_ms BETWEEN 1000 AND 900000;
  RETURN FOUND;
END $$;

ALTER FUNCTION core.reporter_editorial_claimable_since(uuid) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_ed_fact_check_claim(text,integer) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_ed_fact_check_renew(text,text,text,integer) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_editorial_claimable_since(uuid),public.reporter_ed_fact_check_claim(text,integer),
  public.reporter_ed_fact_check_renew(text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_ed_fact_check_claim(text,integer),public.reporter_ed_fact_check_renew(text,text,text,integer) TO reporter_worker;
COMMIT;
