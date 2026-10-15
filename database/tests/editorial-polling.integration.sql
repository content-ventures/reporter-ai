BEGIN;
INSERT INTO public.reporter_editorial_workspaces(portal_id,revision,checkpoint)
  VALUES('00000000-0000-0000-0000-000000000101',42,jsonb_build_object('large',repeat('x',1048576)))
  ON CONFLICT(portal_id) DO UPDATE SET revision=42,checkpoint=excluded.checkpoint;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000031',true);
DO $$
DECLARE result jsonb := public.reporter_editorial_status();
BEGIN
  IF (result->>'revision')::bigint<>42 OR length(result->>'membersHash')<>32
    OR octet_length(result::text)>128 OR result ? 'checkpoint' THEN
    RAISE EXCEPTION 'Polling read the full checkpoint or lost its revision';
  END IF;
  IF octet_length(public.reporter_editorial_load(false)::text)<1048576 THEN
    RAISE EXCEPTION 'Large checkpoint fixture missing';
  END IF;
  PERFORM set_config('test.polling_members',result->>'membersHash',true);
END $$;
RESET SESSION AUTHORIZATION;
UPDATE core.users SET name='Polling identity change' WHERE id='00000000-0000-0000-0000-000000000031';
SET SESSION AUTHORIZATION reporter_runtime;
DO $$
BEGIN
  IF public.reporter_editorial_status()->>'membersHash'=current_setting('test.polling_members') THEN
    RAISE EXCEPTION 'Membership updates would leave the browser stale';
  END IF;
  PERFORM set_config('app.portal_id','00000000-0000-0000-0000-000000000102',true);
  BEGIN
    PERFORM public.reporter_editorial_status(); RAISE EXCEPTION 'Foreign portal accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true);
END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_editorial_workspaces SET checkpoint=jsonb_build_object(
  'jobs',jsonb_build_object('test',jsonb_build_object('availableAt',0)),
  'state',jsonb_build_object('runFolds',jsonb_build_object('test',jsonb_build_object('run',jsonb_build_object('status','queued')))))
  WHERE portal_id='00000000-0000-0000-0000-000000000101';
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true);
DO $$ BEGIN
  IF NOT public.reporter_editorial_pending() THEN RAISE EXCEPTION 'Queued job was missed'; END IF;
  BEGIN
    PERFORM public.reporter_editorial_status(); RAISE EXCEPTION 'Worker bypassed user authorization';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$
DECLARE available numeric := extract(epoch FROM clock_timestamp())*1000+3600000;
BEGIN
  UPDATE public.reporter_editorial_workspaces SET checkpoint=jsonb_set(checkpoint,'{jobs,test,availableAt}',to_jsonb(available))
    WHERE portal_id='00000000-0000-0000-0000-000000000101';
END $$;
SET SESSION AUTHORIZATION reporter_worker;
DO $$ BEGIN IF public.reporter_editorial_pending() THEN RAISE EXCEPTION 'Deferred job appeared claimable'; END IF; END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_editorial_workspaces SET checkpoint=jsonb_set(jsonb_set(checkpoint,'{jobs,test,availableAt}','0'),
  '{jobs,test,lease}',jsonb_build_object('owner','other','fence','test','until',extract(epoch FROM clock_timestamp())*1000+3600000))
  WHERE portal_id='00000000-0000-0000-0000-000000000101';
SET SESSION AUTHORIZATION reporter_worker;
DO $$ BEGIN IF public.reporter_editorial_pending() THEN RAISE EXCEPTION 'Live lease appeared claimable'; END IF; END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_editorial_workspaces SET checkpoint=jsonb_set(checkpoint,'{jobs,test,lease,until}','0')
  WHERE portal_id='00000000-0000-0000-0000-000000000101';
SET SESSION AUTHORIZATION reporter_worker;
DO $$ BEGIN IF NOT public.reporter_editorial_pending() THEN RAISE EXCEPTION 'Expired lease was missed'; END IF; END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_editorial_workspaces SET checkpoint=jsonb_set(checkpoint,'{jobs,test,lease}','null')
  WHERE portal_id='00000000-0000-0000-0000-000000000101';
SET SESSION AUTHORIZATION reporter_worker;
DO $$ BEGIN IF NOT public.reporter_editorial_pending() THEN RAISE EXCEPTION 'Null lease hid a queued job'; END IF; END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_editorial_workspaces SET checkpoint=jsonb_set(checkpoint,'{state,runFolds,test,run,status}','"completed"')
  WHERE portal_id='00000000-0000-0000-0000-000000000101';
SET SESSION AUTHORIZATION reporter_worker;
DO $$ BEGIN IF public.reporter_editorial_pending() THEN RAISE EXCEPTION 'Completed job appeared claimable'; END IF; END $$;
RESET SESSION AUTHORIZATION;
SELECT 'PASS bounded polling metadata, identity invalidation and portal authorization';
SELECT 'PASS worker pending check respects job availability, lease expiry and completion';
ROLLBACK;
