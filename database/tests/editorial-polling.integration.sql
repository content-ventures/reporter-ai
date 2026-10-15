-- Polls read a small authorized stamp, never editorial rows; the worker gate follows runs. All rolls back.
\set ON_ERROR_STOP on
BEGIN;
-- Start from an idle queue without claiming pre-existing user work.
UPDATE core.integration_outbox SET available_at=clock_timestamp()+interval '1 day' WHERE processed_at IS NULL;
UPDATE core.storage_objects SET reference=reference-'remote_url' WHERE status='pending' AND reference ? 'remote_url';
UPDATE public.reporter_ed_runs SET available_at=clock_timestamp()+interval '1 day';
INSERT INTO public.reporter_ed_sync(portal_id,seq) VALUES('00000000-0000-0000-0000-000000000101',42)
  ON CONFLICT(portal_id) DO UPDATE SET seq=42,floor_seq=0;
INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,seq)
  VALUES('00000000-0000-0000-0000-000000000101','polling-production','{"id":"polling-production"}',42);
INSERT INTO public.reporter_ed_runs(portal_id,run_id,production_id,status,available_at,job,fold,seq)
  VALUES('00000000-0000-0000-0000-000000000101','polling-run','polling-production','queued',clock_timestamp()-interval '1 second',
    '{"meta":{"runId":"polling-run"},"kind":"article.draft"}','{"seq":1,"run":{"status":"queued"}}',42);
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000031',true);
DO $$
DECLARE result jsonb := public.reporter_ed_status();
BEGIN
  IF (result->>'seq')::bigint<>42 OR length(result->>'membersHash')<>32 OR octet_length(result::text)>128 THEN
    RAISE EXCEPTION 'Polling lost its change number or read more than the stamp: %',result;
  END IF;
  PERFORM set_config('test.polling_members',result->>'membersHash',true);
END $$;
RESET SESSION AUTHORIZATION;
UPDATE core.users SET name='Polling identity change' WHERE id='00000000-0000-0000-0000-000000000031';
SET SESSION AUTHORIZATION reporter_runtime;
DO $$
BEGIN
  IF public.reporter_ed_status()->>'membersHash'=current_setting('test.polling_members') THEN
    RAISE EXCEPTION 'Membership updates would leave the browser stale';
  END IF;
  PERFORM set_config('app.portal_id','00000000-0000-0000-0000-000000000102',true);
  BEGIN
    PERFORM public.reporter_ed_status(); RAISE EXCEPTION 'Foreign portal accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true);
END $$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true);
DO $$
BEGIN
  IF NOT public.reporter_worker_pending() THEN RAISE EXCEPTION 'Queued run was missed'; END IF;
  BEGIN
    PERFORM public.reporter_ed_status(); RAISE EXCEPTION 'Worker bypassed user authorization';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_ed_runs SET available_at=clock_timestamp()+interval '1 minute' WHERE run_id='polling-run';
SET SESSION AUTHORIZATION reporter_worker;
DO $$ BEGIN IF public.reporter_worker_pending() THEN RAISE EXCEPTION 'Deferred run appeared claimable'; END IF; END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_ed_runs SET available_at=clock_timestamp()-interval '1 minute',lease_owner='polling-worker',
  lease_until=clock_timestamp()+interval '1 minute',lease_fence='polling-fence' WHERE run_id='polling-run';
SET SESSION AUTHORIZATION reporter_worker;
DO $$ BEGIN IF public.reporter_worker_pending() THEN RAISE EXCEPTION 'Live lease appeared claimable'; END IF; END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_ed_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id='polling-run';
SET SESSION AUTHORIZATION reporter_worker;
DO $$ BEGIN IF NOT public.reporter_worker_pending() THEN RAISE EXCEPTION 'Expired lease was missed'; END IF; END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_ed_runs SET lease_owner=NULL,lease_until=NULL,lease_fence=NULL WHERE run_id='polling-run';
SET SESSION AUTHORIZATION reporter_worker;
DO $$ BEGIN IF NOT public.reporter_worker_pending() THEN RAISE EXCEPTION 'A released lease hid a queued run'; END IF; END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_ed_runs SET status='completed' WHERE run_id='polling-run';
SET SESSION AUTHORIZATION reporter_worker;
DO $$ BEGIN IF public.reporter_worker_pending() THEN RAISE EXCEPTION 'Completed run appeared claimable'; END IF; END $$;
RESET SESSION AUTHORIZATION;
\echo PASS bounded polling metadata, identity invalidation and portal authorization
\echo PASS worker pending check respects run availability, lease expiry and completion
ROLLBACK;
