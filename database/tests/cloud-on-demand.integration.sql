-- Cloud intake without any worker heartbeat. Synthetic fixtures; every write rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',message; END IF; END $$;
DELETE FROM public.reporter_worker_heartbeats;
UPDATE core.integration_outbox SET available_at=clock_timestamp()+interval '1 day' WHERE processed_at IS NULL;

SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
SELECT public.reporter_prepare_cloud_upload(
  '550e8400-e29b-41d4-a716-446655440011','sem-worker.mp3',1048576,'audio/mpeg',
  'incoming/00000000-0000-0000-0000-000000000101/550e8400-e29b-41d4-a716-446655440011.mp3',
  encode(sha256(convert_to(repeat('w',32),'UTF8')),'hex'),'on-demand-upload-test') AS prepared \gset
SELECT pg_temp.assert_true(:'prepared'::jsonb ? 'source_id' AND :'prepared'::jsonb->'upload_endpoint'='null'::jsonb,
  'an upload is accepted with no worker heartbeat and no registered endpoint');
SELECT pg_temp.assert_true(public.reporter_worker_online(),'an idle queue reads as online for older application releases');
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true);
SELECT public.reporter_complete_cloud_upload('reporter-source-media',
  'incoming/00000000-0000-0000-0000-000000000101/550e8400-e29b-41d4-a716-446655440011.mp3',
  1048576,'audio/mpeg','"on-demand-etag"');
SELECT pg_temp.assert_true(public.reporter_worker_pending(),'the sealed upload wakes a drain');
RESET SESSION AUTHORIZATION;
UPDATE core.integration_outbox SET available_at=clock_timestamp()-interval '2 minutes'
  WHERE aggregate_id=(:'prepared'::jsonb->>'id') AND event_type='reporter.transcription.requested';
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
SELECT pg_temp.assert_true(NOT public.reporter_worker_online(),'a stalled queue reads as offline for older application releases');
RESET SESSION AUTHORIZATION;
SELECT 'PASS cloud intake without worker heartbeats and stall-based online status';
ROLLBACK;
