-- Workspace dispatch leases bound concurrency and rotate eligible clients fairly.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_worker_dispatches(
  portal_id uuid PRIMARY KEY REFERENCES public.portals(id) ON DELETE RESTRICT,
  last_served_at timestamptz NOT NULL DEFAULT '-infinity',
  lease_owner text, lease_until timestamptz, fence uuid,
  turns bigint NOT NULL DEFAULT 0 CHECK(turns>=0),
  CHECK((lease_owner IS NULL)=(lease_until IS NULL)),CHECK((lease_owner IS NULL)=(fence IS NULL))
);
ALTER TABLE public.reporter_worker_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_worker_dispatches FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.reporter_workspace_work_due(p_portal uuid,p_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT p_kind IN ('any','remote') AND core.reporter_remote_claimable_since(p_portal) IS NOT NULL
    OR p_kind IN ('any','outbox') AND (core.reporter_outbox_claimable_since(p_portal) IS NOT NULL
      OR EXISTS(SELECT FROM core.integration_outbox WHERE portal_id=p_portal AND module='reporter_ai' AND processed_at IS NULL
        AND attempts>=8 AND coalesce(lease_until,'-infinity')<=clock_timestamp() AND last_error IS DISTINCT FROM 'ATTEMPTS_EXHAUSTED'))
    OR p_kind IN ('any','editorial','images','fact_check') AND EXISTS(SELECT FROM public.reporter_ed_runs
      WHERE portal_id=p_portal AND job IS NOT NULL AND available_at<=clock_timestamp() AND coalesce(lease_until,'-infinity')<clock_timestamp()
        AND (p_kind IN ('any','editorial') AND status IN ('queued','running','awaiting_input')
          OR p_kind IN ('any','images') AND status='completed' AND job->'images'->>'status'='queued'
          OR p_kind IN ('any','fact_check') AND status='completed' AND job->'factCheck'->>'status'='queued'))
    OR p_kind IN ('any','news') AND EXISTS(SELECT FROM public.reporter_news_sources WHERE portal_id=p_portal AND NOT paused
      AND next_read_at<=clock_timestamp() AND coalesce(lease_until,'-infinity')<clock_timestamp())
    OR p_kind IN ('any','search') AND core.reporter_news_search_due(p_portal)
    OR p_kind IN ('any','translation') AND core.reporter_news_translation_pending(p_portal)
$$;

CREATE OR REPLACE FUNCTION core.reporter_worker_workspace_enabled(p_portal uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(SELECT FROM public.portals p JOIN core.tenants t ON t.id=p.tenant_id
    JOIN public.reporter_workspaces w ON w.portal_id=p.id
    JOIN core.tenant_modules m ON m.tenant_id=t.id AND m.module_key='reporter_ai' AND m.enabled
    JOIN core.portal_modules f ON f.portal_id=p.id AND f.module_key='reporter_ai' AND f.enabled
    WHERE p.id=p_portal AND p.deleted_at IS NULL AND t.status='active' AND p.status IN ('active','archiving') AND w.lifecycle IN ('active','archiving'))
$$;

CREATE OR REPLACE FUNCTION public.reporter_worker_pending() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.context_portal_id();
BEGIN
  PERFORM core.reporter_worker_require();
  IF portal IS NOT NULL THEN RETURN core.reporter_worker_workspace_enabled(portal) AND core.reporter_workspace_work_due(portal,'any'); END IF;
  RETURN EXISTS(SELECT FROM public.reporter_workspaces WHERE core.reporter_worker_workspace_enabled(portal_id) AND core.reporter_workspace_work_due(portal_id,'any'));
END $$;

CREATE OR REPLACE FUNCTION public.reporter_worker_next(p_owner text,p_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE selected uuid; until_time timestamptz:=clock_timestamp()+interval '90 seconds'; next_fence uuid:=gen_random_uuid();
BEGIN
  PERFORM core.reporter_worker_require();
  IF p_owner IS NULL OR p_owner !~ '^[a-zA-Z0-9_-]{8,128}$' OR p_kind IS NULL
    OR p_kind NOT IN ('any','remote','outbox','editorial','images','fact_check','news','search','translation') THEN RAISE EXCEPTION 'Invalid dispatch' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('reporter-workspace-dispatch',0));
  IF (SELECT count(*) FROM public.reporter_worker_dispatches WHERE lease_until>clock_timestamp())>=4 THEN RETURN NULL; END IF;
  INSERT INTO public.reporter_worker_dispatches(portal_id)
    SELECT portal_id FROM public.reporter_workspaces WHERE core.reporter_worker_workspace_enabled(portal_id)
      AND core.reporter_workspace_work_due(portal_id,p_kind) ON CONFLICT DO NOTHING;
  SELECT portal_id INTO selected FROM public.reporter_worker_dispatches
    WHERE coalesce(lease_until,'-infinity')<=clock_timestamp() AND core.reporter_worker_workspace_enabled(portal_id)
      AND core.reporter_workspace_work_due(portal_id,p_kind)
    ORDER BY last_served_at,portal_id LIMIT 1 FOR UPDATE;
  IF selected IS NULL THEN RETURN NULL; END IF;
  UPDATE public.reporter_worker_dispatches SET last_served_at=clock_timestamp(),lease_owner=p_owner,lease_until=until_time,
    fence=next_fence,turns=turns+1 WHERE portal_id=selected;
  RETURN (SELECT jsonb_build_object('portal',p.id,'tenant',p.tenant_id,'dispatch',jsonb_build_object('owner',p_owner,'fence',next_fence)) FROM public.portals p WHERE p.id=selected);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_worker_dispatch_renew(p_portal uuid,p_owner text,p_fence uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  PERFORM core.reporter_worker_require();
  UPDATE public.reporter_worker_dispatches SET lease_until=clock_timestamp()+interval '90 seconds'
    WHERE portal_id=p_portal AND lease_owner=p_owner AND fence=p_fence AND lease_until>clock_timestamp();
  RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_worker_dispatch_release(p_portal uuid,p_owner text,p_fence uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  PERFORM core.reporter_worker_require();
  UPDATE public.reporter_worker_dispatches SET lease_owner=NULL,lease_until=NULL,fence=NULL WHERE portal_id=p_portal AND lease_owner=p_owner AND fence=p_fence;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_claim(p_owner text) RETURNS SETOF core.integration_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.context_portal_id(); exhausted core.integration_outbox;
BEGIN
  PERFORM core.reporter_worker_require();
  IF portal IS NULL THEN RAISE EXCEPTION 'Portal context missing' USING ERRCODE='42501'; END IF;
  IF p_owner IS NULL OR p_owner !~ '^[a-zA-Z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'Invalid lease owner'; END IF;
  FOR exhausted IN SELECT o.* FROM core.integration_outbox o WHERE o.portal_id=portal AND module='reporter_ai'
    AND processed_at IS NULL AND attempts>=8 AND coalesce(lease_until,'-infinity')<=clock_timestamp()
    AND last_error IS DISTINCT FROM 'ATTEMPTS_EXHAUSTED' ORDER BY occurred_at,id LIMIT 10 FOR UPDATE SKIP LOCKED LOOP
    PERFORM core.reporter_finish_row(exhausted,jsonb_build_object('error_code','ATTEMPTS_EXHAUSTED'));
    UPDATE core.integration_outbox SET lease_owner=NULL,lease_until=NULL,last_error='ATTEMPTS_EXHAUSTED' WHERE id=exhausted.id;
  END LOOP;
  RETURN QUERY WITH pending AS (SELECT id FROM core.integration_outbox WHERE portal_id=portal AND module='reporter_ai'
    AND event_type IN ('reporter.transcription.requested','reporter.article_generation.requested','reporter.carousel_generation.requested')
    AND processed_at IS NULL AND attempts<8 AND available_at<=clock_timestamp() AND coalesce(lease_until,'-infinity')<=clock_timestamp()
    ORDER BY available_at,occurred_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
    UPDATE core.integration_outbox o SET lease_owner=p_owner,lease_until=clock_timestamp()+interval '60 seconds',last_error='LEASE_RESERVED'
      FROM pending WHERE o.id=pending.id RETURNING o.*;
END $$;

DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY['core.reporter_workspace_work_due(uuid,text)','core.reporter_worker_workspace_enabled(uuid)',
    'public.reporter_worker_pending()','public.reporter_worker_next(text,text)','public.reporter_worker_dispatch_renew(uuid,text,uuid)',
    'public.reporter_worker_dispatch_release(uuid,text,uuid)','public.reporter_claim(text)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['public.reporter_worker_pending()','public.reporter_worker_next(text,text)',
    'public.reporter_worker_dispatch_renew(uuid,text,uuid)','public.reporter_worker_dispatch_release(uuid,text,uuid)','public.reporter_claim(text)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporter_worker',fn);
  END LOOP;
END $$;
COMMIT;
