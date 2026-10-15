-- Synthetic fixtures only; every write, including the queue reset below, rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',message; END IF; END $$;
CREATE FUNCTION pg_temp.expect_error(query text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE query;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=expected THEN RETURN; END IF;
    RAISE EXCEPTION 'Expected %, got %: %',expected,SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION 'Expected error %, query succeeded',expected;
END $$;
SELECT pg_temp.assert_true(current_database()='reporter_ai_local','Reporter database boundary');
-- Start from an idle queue without claiming or losing pre-existing user work.
UPDATE core.integration_outbox SET available_at=clock_timestamp()+interval '1 day' WHERE processed_at IS NULL;
UPDATE core.storage_objects SET reference=reference-'remote_url' WHERE status='pending' AND reference ? 'remote_url';
UPDATE public.reporter_editorial_workspaces SET checkpoint=jsonb_set(checkpoint,'{jobs}','{}') WHERE checkpoint ? 'jobs';

SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true);
SELECT pg_temp.assert_true(NOT public.reporter_worker_pending(),'an idle queue does not wake a drain');
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000031',true);
SELECT pg_temp.assert_true(public.reporter_queue_status('editorial')='{"pending":false,"stalled":false}'::jsonb,'idle editorial status');
SELECT pg_temp.expect_error($q$SELECT public.reporter_queue_status('everything')$q$,'22023');
SELECT public.reporter_intake('00000000-0000-0000-0000-000000000501','queue.flac',100,'audio/flac',
  repeat('d',64),NULL,'queue.test.audio') AS intake \gset
SELECT (:'intake'::jsonb->>'id') AS transcript \gset
SELECT pg_temp.assert_true(public.reporter_queue_status('transcript:'||:'transcript')='{"pending":true,"stalled":false}'::jsonb,
  'fresh work is pending but not stalled');
RESET SESSION AUTHORIZATION;
UPDATE core.integration_outbox SET available_at=clock_timestamp()-interval '2 minutes' WHERE aggregate_id=:'transcript';
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000031',true);
SELECT pg_temp.assert_true(public.reporter_queue_status('transcript:'||:'transcript')='{"pending":true,"stalled":true}'::jsonb,
  'work left unclaimed for over 90 seconds is stalled');
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true);
SELECT pg_temp.assert_true(public.reporter_worker_pending(),'claimable transcription wakes a drain');
SELECT id AS event FROM public.reporter_claim('queue-test-worker-01') \gset
SELECT (public.reporter_start(:'event','queue-test-worker-01')).attempts AS attempt \gset
SELECT pg_temp.assert_true(NOT public.reporter_worker_pending(),'leased work is not claimable');
SELECT public.reporter_transcript_chunk_save(:'event','queue-test-worker-01',:attempt,'whisper-large-v3',0,0,600000,'{"content":"um"}');
SELECT public.reporter_transcript_chunk_save(:'event','queue-test-worker-01',:attempt,'whisper-large-v3',0,0,600000,'{"content":"dois"}');
SELECT pg_temp.assert_true(public.reporter_transcript_chunks_read(:'event','queue-test-worker-01',:attempt,'whisper-large-v3')
  =jsonb_build_array(jsonb_build_object('index',0,'start_ms',0,'duration_ms',600000,'result',jsonb_build_object('content','um'))),
  'the first validated chunk result is kept');
SELECT pg_temp.expect_error(format($q$SELECT public.reporter_transcript_chunk_save(%L,'other-worker-01',%s,'whisper-large-v3',1,600000,600000,'{}')$q$,
  :'event',:attempt),'40001');
SELECT pg_temp.expect_error(format($q$SELECT public.reporter_transcript_chunks_read(%L,'queue-test-worker-01',%s,'whisper-large-v3')$q$,
  :'event',:attempt+1),'40001');
SELECT pg_temp.expect_error(format($q$SELECT public.reporter_transcript_chunk_save(%L,'queue-test-worker-01',%s,'whisper-large-v3',1000,0,1,'{}')$q$,
  :'event',:attempt),'23514');
SELECT pg_temp.assert_true(public.reporter_yield(:'event','queue-test-worker-01',:attempt),'a budget yield releases the lease');
SELECT pg_temp.assert_true(NOT public.reporter_yield(:'event','queue-test-worker-01',:attempt),'a released job cannot yield again');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT attempts=:attempt-1 AND lease_owner IS NULL AND last_error='YIELDED'
  AND (payload->>'yields')::int=1 AND available_at<=clock_timestamp() FROM core.integration_outbox WHERE id=:'event'),
  'a yield returns the job without spending an attempt');

SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true);
SELECT id AS resumed FROM public.reporter_claim('queue-test-worker-02') \gset
SELECT pg_temp.assert_true(:'resumed'=:'event','the yielded job is claimed again first');
SELECT (public.reporter_start(:'event','queue-test-worker-02')).attempts AS attempt_two \gset
SELECT pg_temp.assert_true(:attempt_two=:attempt,'the resumed invocation runs the same attempt number');
SELECT pg_temp.assert_true(jsonb_array_length(public.reporter_transcript_chunks_read(:'event','queue-test-worker-02',:attempt_two,'whisper-large-v3'))=1,
  'a later invocation resumes from stored chunks');
SELECT pg_temp.assert_true(public.reporter_transcript_chunks_read(:'event','queue-test-worker-02',:attempt_two,'another-model')='[]'::jsonb,
  'another transcription model starts over');
SELECT public.reporter_transcript_chunks_clear(:'transcript');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true(EXISTS(SELECT FROM public.reporter_transcript_chunks WHERE source_object_id='00000000-0000-0000-0000-000000000501'),
  'chunks survive until the transcript is ready');
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true);
SELECT public.reporter_complete(:'event','queue-test-worker-02',:attempt_two,
  '{"content":"Synthetic resumed transcript.","provider":"fixture","model":"test-only","segments":null}');
SELECT public.reporter_transcript_chunks_clear(:'transcript');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM public.reporter_transcript_chunks WHERE source_object_id='00000000-0000-0000-0000-000000000501'),
  'a ready transcript drops its resume chunks');
SELECT pg_temp.assert_true(NOT has_table_privilege('reporter_worker','public.reporter_transcript_chunks','SELECT')
  AND NOT has_table_privilege('reporter_runtime','public.reporter_transcript_chunks','SELECT')
  AND NOT has_function_privilege('reporter_runtime','public.reporter_worker_pending()','EXECUTE')
  AND NOT has_function_privilege('reporter_worker','public.reporter_queue_status(text)','EXECUTE'),'narrow queue privileges');
\echo PASS queue status, stall window and drain gate without worker heartbeats
\echo PASS fenced transcript chunks resume across invocations and yields keep attempts

INSERT INTO public.reporter_editorial_workspaces(portal_id,revision,checkpoint)
  VALUES('00000000-0000-0000-0000-000000000101',1,'{}'::jsonb) ON CONFLICT(portal_id) DO NOTHING;
UPDATE public.reporter_editorial_workspaces SET checkpoint=checkpoint||jsonb_build_object(
  'jobs',jsonb_build_object('queue-test',jsonb_build_object('availableAt',0)),
  'state',coalesce(checkpoint->'state','{}'::jsonb)||jsonb_build_object('runFolds',
    coalesce(checkpoint->'state'->'runFolds','{}'::jsonb)||jsonb_build_object('queue-test',jsonb_build_object('run',jsonb_build_object('status','queued')))))
  WHERE portal_id='00000000-0000-0000-0000-000000000101';
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000031',true);
SELECT pg_temp.assert_true(public.reporter_queue_status('editorial')='{"pending":true,"stalled":true}'::jsonb,
  'an editorial job queued long ago reads as stalled');
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  UPDATE public.reporter_editorial_workspaces SET checkpoint=jsonb_set(checkpoint,'{jobs,queue-test,lease}',
    jsonb_build_object('owner','queue-test','fence','queue-test','until',extract(epoch FROM clock_timestamp())*1000+60000))
    WHERE portal_id='00000000-0000-0000-0000-000000000101';
END $$;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000031',true);
SELECT pg_temp.assert_true(public.reporter_queue_status('editorial')='{"pending":false,"stalled":false}'::jsonb,
  'a live editorial lease is neither pending nor stalled');
RESET SESSION AUTHORIZATION;
\echo PASS editorial queue status follows availability and leases
ROLLBACK;
