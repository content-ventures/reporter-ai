-- Emergency return to the single editorial document that migration 016 retired, for an app
-- and worker rolled back to a release that still reads it. Run once with psql as the database
-- owner, with the worker stopped. In one transaction every imported portal's rows are written
-- back into its document and then cleared, so replaying 016 later imports that document again.
\set ON_ERROR_STOP on
BEGIN;
-- No editorial command may commit rows while they are being exported.
LOCK TABLE public.reporter_ed_sync IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMPORARY TABLE rollback_portals ON COMMIT DROP AS
  SELECT portal_id FROM public.reporter_ed_sync WHERE migrated_at IS NOT NULL;

DROP TRIGGER IF EXISTS reporter_editorial_retired ON public.reporter_editorial_workspaces;
INSERT INTO public.reporter_editorial_workspaces(portal_id,revision,checkpoint)
  SELECT portal_id,1,core.reporter_ed_export_checkpoint(portal_id) FROM rollback_portals
  ON CONFLICT(portal_id) DO UPDATE SET revision=public.reporter_editorial_workspaces.revision+1,
    checkpoint=excluded.checkpoint,updated_at=clock_timestamp();

DELETE FROM public.reporter_ed_run_events WHERE portal_id IN (SELECT portal_id FROM rollback_portals);
DELETE FROM public.reporter_ed_runs WHERE portal_id IN (SELECT portal_id FROM rollback_portals);
DELETE FROM public.reporter_ed_parts WHERE portal_id IN (SELECT portal_id FROM rollback_portals);
DELETE FROM public.reporter_ed_productions WHERE portal_id IN (SELECT portal_id FROM rollback_portals);
DELETE FROM public.reporter_ed_sources WHERE portal_id IN (SELECT portal_id FROM rollback_portals);
DELETE FROM public.reporter_ed_items WHERE portal_id IN (SELECT portal_id FROM rollback_portals);
DELETE FROM public.reporter_ed_receipts WHERE portal_id IN (SELECT portal_id FROM rollback_portals);
DELETE FROM public.reporter_ed_pipelines WHERE portal_id IN (SELECT portal_id FROM rollback_portals);
DELETE FROM public.reporter_ed_workspace WHERE portal_id IN (SELECT portal_id FROM rollback_portals);
-- Browsers on the rows-era app reload a snapshot if they reconnect before the app rolls back.
UPDATE public.reporter_ed_sync SET migrated_at=NULL,floor_seq=seq WHERE portal_id IN (SELECT portal_id FROM rollback_portals);

-- The queue gate counts the document's jobs again, as migration 015 defined it.
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
SELECT 'ROLLED BACK '||count(*)||' portal(s) to the editorial document' FROM rollback_portals;
COMMIT;
