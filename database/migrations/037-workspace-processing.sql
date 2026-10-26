-- Workspace operation budgets bound automatic dispatches without changing pilot defaults.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_worker_usage(
  portal_id uuid NOT NULL REFERENCES public.portals(id) ON DELETE RESTRICT, day date NOT NULL,
  starts integer NOT NULL DEFAULT 0 CHECK(starts>=0), PRIMARY KEY(portal_id,day)
);
ALTER TABLE public.reporter_worker_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_worker_usage FROM PUBLIC;
CREATE OR REPLACE FUNCTION core.reporter_worker_budget_open(p_portal uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT coalesce(u.starts,0)<coalesce((w.settings->'processing'->>'dailyLimit')::int,2147483647)
    FROM public.reporter_workspaces w LEFT JOIN public.reporter_worker_usage u
      ON u.portal_id=w.portal_id AND u.day=(clock_timestamp() AT TIME ZONE 'UTC')::date WHERE w.portal_id=p_portal
$$;
CREATE OR REPLACE FUNCTION core.reporter_worker_count_turn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF NEW.fence IS NOT NULL AND NEW.fence IS DISTINCT FROM OLD.fence THEN
    INSERT INTO public.reporter_worker_usage(portal_id,day,starts) VALUES(NEW.portal_id,(clock_timestamp() AT TIME ZONE 'UTC')::date,1)
      ON CONFLICT(portal_id,day) DO UPDATE SET starts=reporter_worker_usage.starts+1;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER reporter_worker_count_turn AFTER UPDATE ON public.reporter_worker_dispatches
  FOR EACH ROW EXECUTE FUNCTION core.reporter_worker_count_turn();
CREATE OR REPLACE FUNCTION core.reporter_workspace_pending(p_portal uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(SELECT FROM public.reporter_ed_runs WHERE portal_id=p_portal AND job IS NOT NULL
    AND (status IN ('queued','running','awaiting_input') OR job->'images'->>'status'='queued' OR job->'factCheck'->>'status'='queued'))
    OR EXISTS(SELECT FROM public.reporter_transcripts WHERE portal_id=p_portal AND status IN ('queued','processing'))
    OR EXISTS(SELECT FROM core.integration_outbox WHERE portal_id=p_portal AND processed_at IS NULL AND module='reporter_ai'
      AND event_type IN ('reporter.transcription.requested','reporter.article_generation.requested','reporter.carousel_generation.requested')
      AND (attempts<8 OR last_error IS DISTINCT FROM 'ATTEMPTS_EXHAUSTED'))
    OR EXISTS(SELECT FROM public.reporter_worker_dispatches WHERE portal_id=p_portal AND lease_until>clock_timestamp())
    OR EXISTS(SELECT FROM public.reporter_news_sources WHERE portal_id=p_portal AND lease_until>clock_timestamp())
    OR EXISTS(SELECT FROM public.reporter_news_search WHERE portal_id=p_portal AND lease_until>clock_timestamp())
    OR EXISTS(SELECT FROM public.reporter_news_items i WHERE portal_id=p_portal AND translation_status='pending' AND core.reporter_news_translation_active(i))
$$;
CREATE OR REPLACE FUNCTION core.reporter_workspace_archive_due(p_portal uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(SELECT FROM public.reporter_workspaces WHERE portal_id=p_portal AND lifecycle='archiving') AND
    (NOT core.reporter_workspace_pending(p_portal) OR EXISTS(SELECT FROM public.reporter_transcripts t JOIN core.storage_objects s
      ON (s.portal_id,s.id)=(t.portal_id,t.source_object_id) WHERE t.portal_id=p_portal AND t.status='queued' AND s.status='pending'
      AND (s.reference->>'upload_expires_at')::timestamptz<clock_timestamp()))
$$;
CREATE OR REPLACE FUNCTION public.reporter_worker_archive_maintenance() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.context_portal_id(); expired uuid[]; expired_id uuid;
BEGIN
  PERFORM core.reporter_worker_require();
  IF portal IS NULL THEN RAISE EXCEPTION 'Portal context missing' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT FROM public.reporter_workspaces WHERE portal_id=portal AND lifecycle='archiving') THEN RETURN false; END IF;
  SELECT array_agg(t.id) INTO expired FROM (SELECT t.id FROM public.reporter_transcripts t JOIN core.storage_objects s
    ON (s.portal_id,s.id)=(t.portal_id,t.source_object_id) WHERE t.portal_id=portal AND t.status='queued' AND s.status='pending'
    AND (s.reference->>'upload_expires_at')::timestamptz<clock_timestamp() ORDER BY t.id LIMIT 25 FOR UPDATE OF t) t;
  IF expired IS NOT NULL THEN
    UPDATE public.reporter_transcripts SET status='processing',started_at=clock_timestamp(),revision=revision+1 WHERE id=ANY(expired) AND portal_id=portal;
    UPDATE public.reporter_transcripts SET status='failed',completed_at=clock_timestamp(),error_code='UPLOAD_EXPIRED',revision=revision+1 WHERE id=ANY(expired) AND portal_id=portal;
    FOREACH expired_id IN ARRAY expired LOOP PERFORM core.reporter_audit(portal,'reporter.source.expired','transcript',expired_id,'{}'); END LOOP;
  END IF;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_worker_dispatch_release(p_portal uuid,p_owner text,p_fence uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  PERFORM core.reporter_worker_require();
  UPDATE public.reporter_worker_dispatches SET lease_owner=NULL,lease_until=NULL,fence=NULL WHERE portal_id=p_portal AND lease_owner=p_owner AND fence=p_fence;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.reporter_workspaces WHERE portal_id=p_portal AND lifecycle='archiving' FOR UPDATE;
  IF FOUND AND NOT core.reporter_workspace_pending(p_portal) THEN
    UPDATE public.reporter_workspaces SET lifecycle='archived',revision=revision+1,updated_at=clock_timestamp() WHERE portal_id=p_portal;
    UPDATE public.portals SET status='archived' WHERE id=p_portal;
    PERFORM core.reporter_audit(p_portal,'reporter.workspace.archived','workspace',p_portal,'{"status":"archived"}');
  END IF;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION core.reporter_workspace_work_due(p_portal uuid,p_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT (p_kind='any' AND core.reporter_workspace_archive_due(p_portal)) OR core.reporter_worker_budget_open(p_portal) AND (p_kind IN ('any','remote') AND core.reporter_remote_claimable_since(p_portal) IS NOT NULL
    OR p_kind IN ('any','outbox') AND (core.reporter_outbox_claimable_since(p_portal) IS NOT NULL
      OR EXISTS(SELECT FROM core.integration_outbox WHERE portal_id=p_portal AND module='reporter_ai' AND processed_at IS NULL
        AND attempts>=8 AND coalesce(lease_until,'-infinity')<=clock_timestamp() AND last_error IS DISTINCT FROM 'ATTEMPTS_EXHAUSTED'))
    OR p_kind IN ('any','editorial','images','fact_check') AND EXISTS(SELECT FROM public.reporter_ed_runs
      WHERE portal_id=p_portal AND job IS NOT NULL AND available_at<=clock_timestamp() AND coalesce(lease_until,'-infinity')<clock_timestamp()
        AND (p_kind IN ('any','editorial') AND status IN ('queued','running','awaiting_input')
          OR p_kind IN ('any','images') AND status='completed' AND job->'images'->>'status'='queued'
          OR p_kind IN ('any','fact_check') AND status='completed' AND job->'factCheck'->>'status'='queued'))
    OR p_kind IN ('any','news') AND EXISTS(SELECT FROM public.reporter_workspaces WHERE portal_id=p_portal AND lifecycle='active') AND EXISTS(SELECT FROM public.reporter_news_sources WHERE portal_id=p_portal AND NOT paused
      AND next_read_at<=clock_timestamp() AND coalesce(lease_until,'-infinity')<clock_timestamp())
    OR p_kind IN ('any','search') AND EXISTS(SELECT FROM public.reporter_workspaces WHERE portal_id=p_portal AND lifecycle='active') AND core.reporter_news_search_due(p_portal)
    OR p_kind IN ('any','translation') AND core.reporter_news_translation_pending(p_portal))
$$;
CREATE OR REPLACE FUNCTION core.reporter_processing_value(p_portal uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_build_object('workspaceId',w.portal_id,'revision',w.revision,'dailyLimit',(w.settings->'processing'->>'dailyLimit')::int,
    'usedToday',coalesce(u.starts,0),'state',CASE WHEN core.reporter_worker_budget_open(p_portal) THEN 'ready' ELSE 'limited' END,
    'resetsAt',(date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC')
    FROM public.reporter_workspaces w LEFT JOIN public.reporter_worker_usage u
      ON u.portal_id=w.portal_id AND u.day=(clock_timestamp() AT TIME ZONE 'UTC')::date WHERE w.portal_id=p_portal
$$;
CREATE OR REPLACE FUNCTION public.reporter_processing_view(p_portal uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF current_setting('app.access_mode',true)='platform' THEN PERFORM core.platform_operator();
  ELSIF core.reporter_require('reporter.read') IS DISTINCT FROM p_portal THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  RETURN core.reporter_processing_value(p_portal);
END $$;
CREATE OR REPLACE FUNCTION public.reporter_processing_save(p_portal uuid,p_revision bigint,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE actor uuid:=core.reporter_membership_manager(p_portal); current public.reporter_workspaces; previous jsonb;
BEGIN
  IF p_limit IS NOT NULL AND p_limit NOT BETWEEN 1 AND 10000 THEN PERFORM core.platform_refuse('INVALID_STATE'); END IF;
  SELECT * INTO current FROM public.reporter_workspaces WHERE portal_id=p_portal FOR UPDATE;
  IF p_revision IS NULL OR current.revision<>p_revision THEN PERFORM core.platform_refuse('CONFLICT'); END IF;
  previous:=core.reporter_processing_value(p_portal);
  UPDATE public.reporter_workspaces SET settings=jsonb_set(settings,'{processing}',jsonb_build_object('dailyLimit',p_limit)),
    revision=revision+1,updated_at=clock_timestamp() WHERE portal_id=p_portal;
  PERFORM core.reporter_workspace_log('processing.updated',p_portal,NULL,previous,core.reporter_processing_value(p_portal));
  RETURN core.reporter_processing_value(p_portal);
END $$;
DO $$ DECLARE fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY['core.reporter_worker_budget_open(uuid)','core.reporter_worker_count_turn()',
    'core.reporter_workspace_pending(uuid)','core.reporter_workspace_archive_due(uuid)',
    'public.reporter_worker_archive_maintenance()','public.reporter_worker_dispatch_release(uuid,text,uuid)',
    'core.reporter_workspace_work_due(uuid,text)','core.reporter_processing_value(uuid)',
    'public.reporter_processing_view(uuid)','public.reporter_processing_save(uuid,bigint,integer)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO CURRENT_USER',fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
    IF fn LIKE 'public.reporter_processing_%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporter_runtime',fn);
    ELSIF fn LIKE 'public.%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporter_worker',fn); END IF;
  END LOOP;
END $$;
COMMIT;
