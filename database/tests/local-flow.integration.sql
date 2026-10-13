-- Synthetic fixtures only; all writes, including queue claims, roll back.
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
-- Do not claim pre-existing user jobs. This temporary deferral is rolled back.
UPDATE core.integration_outbox SET available_at=clock_timestamp()+interval '1 day' WHERE processed_at IS NULL;
SELECT pg_temp.assert_true(NOT has_table_privilege('reporter_runtime','core.storage_objects','INSERT')
  AND NOT has_table_privilege('reporter_worker','public.reporter_transcripts','SELECT')
  AND NOT has_function_privilege('reporter_worker','public.reporter_local_state()','EXECUTE'), 'narrow local privileges');
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000031',true);
SELECT pg_temp.expect_error($q$SELECT public.reporter_register_upload(gen_random_uuid(),'bad.txt',0,'text/plain',repeat('a',64))$q$,'22023');
SELECT pg_temp.expect_error($q$SELECT public.reporter_register_upload(gen_random_uuid(),'bad.txt',20,'text/html',repeat('a',64))$q$,'22023');
SELECT public.reporter_register_upload('00000000-0000-0000-0000-000000000405',
  'Podcast-Gestão-espécies-não.mp4',1254772880,'video/mp4',repeat('c',64));
SELECT pg_temp.expect_error($q$SELECT public.reporter_register_upload(gen_random_uuid(),'too-large.mp4',2147483649,'video/mp4',repeat('c',64))$q$,'22023');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT size=1254772880 AND file_name='Podcast-Gestão-espécies-não.mp4'
  FROM core.storage_objects WHERE id='00000000-0000-0000-0000-000000000405'),
  'large video metadata accepts intact UTF-8 filename without changing the 2 GiB ceiling');
SET SESSION AUTHORIZATION reporter_runtime;
SELECT public.reporter_intake('00000000-0000-0000-0000-000000000401','synthetic.txt',27,'text/plain',
  encode(sha256(convert_to('Synthetic editorial source.','UTF8')),'hex'),'Synthetic editorial source.','local.test.txt') AS intake \gset
SELECT (:'intake'::jsonb->>'id') AS transcript \gset
SELECT pg_temp.assert_true(public.reporter_intake('00000000-0000-0000-0000-000000000402','synthetic.txt',27,'text/plain',
  encode(sha256(convert_to('Synthetic editorial source.','UTF8')),'hex'),'Synthetic editorial source.','local.test.txt')=:'intake'::jsonb,
  'same file retry returns original source and aggregate');
SELECT pg_temp.expect_error($q$SELECT public.reporter_intake(gen_random_uuid(),'changed.txt',27,'text/plain',
  encode(sha256(convert_to('Synthetic editorial source.','UTF8')),'hex'),'Synthetic editorial source.','local.test.txt')$q$,'22023');
SELECT pg_temp.assert_true((SELECT status='ready' AND revision=3 AND content='Synthetic editorial source.'
  AND provider='local-import' AND model='plain-text-v1' FROM public.reporter_transcripts WHERE id=:'transcript'), 'TXT import provenance and terminal state');
SELECT pg_temp.assert_true(public.reporter_local_state()->'transcripts' @> jsonb_build_array(jsonb_build_object('id',:'transcript')),
  'local state includes own source');
SELECT pg_temp.expect_error($q$SELECT public.reporter_intake('00000000-0000-0000-0000-000000000403','empty.txt',1,'text/plain',
  repeat('a',64),'','local.test.invalid')$q$,'22023');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM core.storage_objects WHERE id IN
  ('00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-000000000403')),'duplicate and invalid intake leave no catalog residue');
\echo PASS local intake validation, TXT provenance, atomicity and idempotency

SET SESSION AUTHORIZATION reporter_runtime;
SELECT public.reporter_intake('00000000-0000-0000-0000-000000000404','synthetic.flac',100,'audio/flac',
  repeat('b',64),NULL,'local.test.audio') AS audio_intake \gset
SELECT (:'audio_intake'::jsonb->>'id') AS audio_transcript \gset
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true);
SELECT id AS event FROM public.reporter_claim('local-test-worker-01') \gset
SELECT pg_temp.expect_error(format('SELECT public.reporter_worker_input(%L,''local-test-worker-01'',1)',:'event'),'40001');
SELECT public.reporter_start(:'event','local-test-worker-01');
SELECT pg_temp.assert_true(public.reporter_worker_input(:'event','local-test-worker-01',1)->>'key'=
  '00000000-0000-0000-0000-000000000404.source','worker reads only active leased input');
SELECT pg_temp.expect_error(format('SELECT public.reporter_progress(%L,''wrong-worker'',1,''transcribing'',1,2)',:'event'),'40001');
SELECT pg_temp.expect_error(format('SELECT public.reporter_progress(%L,''local-test-worker-01'',1,''transcribing'',3,2)',:'event'),'22023');
SELECT public.reporter_progress(:'event','local-test-worker-01',1,'transcribing',1,2);
SELECT public.reporter_defer(:'event','local-test-worker-01',1,'GROQ_RATE_LIMIT',120);
SELECT pg_temp.expect_error(format('SELECT public.reporter_worker_input(%L,''local-test-worker-01'',1)',:'event'),'40001');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT available_at>clock_timestamp()+interval '119 seconds' AND lease_owner IS NULL
  AND payload->'progress'='{"phase":"transcribing","done":1,"total":2}'::jsonb FROM core.integration_outbox WHERE id=:'event'),
  'Retry-After and progress survive lease release');
UPDATE core.integration_outbox SET available_at=clock_timestamp() WHERE id=:'event';
SET SESSION AUTHORIZATION reporter_worker;
SELECT id FROM public.reporter_claim('local-test-worker-02');
SELECT public.reporter_start(:'event','local-test-worker-02');
SELECT pg_temp.expect_error(format('SELECT public.reporter_worker_input(%L,''local-test-worker-01'',1)',:'event'),'40001');
SELECT pg_temp.assert_true(public.reporter_worker_input(:'event','local-test-worker-02',2)->>'provider'='local','new attempt retains input');
SELECT public.reporter_complete(:'event','local-test-worker-02',2,
  '{"content":"Synthetic audio transcript.","provider":"fixture","model":"test-only","segments":null}');
RESET SESSION AUTHORIZATION;
\echo PASS local worker input, progress, provider deferral and attempt fencing

SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true);
SELECT public.reporter_create('article',:'transcript',3,'local.test.article','{}') AS article \gset
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true);
SELECT id AS article_event FROM public.reporter_claim('local-test-worker-02') \gset
SELECT public.reporter_start(:'article_event','local-test-worker-02');
SELECT pg_temp.assert_true(public.reporter_worker_input(:'article_event','local-test-worker-02',1)->>'content'='Synthetic editorial source.',
  'article uses immutable transcript');
SELECT public.reporter_complete(:'article_event','local-test-worker-02',1,
  '{"title":"Synthetic article","content":"Verified synthetic body.","provider":"fixture","model":"test-only","prompt_version":"test-v1"}');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true);
SELECT public.reporter_submit_article(:'article',2);
SELECT public.reporter_review_article(:'article',3,true,NULL);
SELECT public.reporter_create('carousel',:'article',4,'local.test.carousel','{}') AS carousel \gset
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true);
SELECT id AS carousel_event FROM public.reporter_claim('local-test-worker-02') \gset
SELECT public.reporter_start(:'carousel_event','local-test-worker-02');
SELECT pg_temp.assert_true(public.reporter_worker_input(:'carousel_event','local-test-worker-02',1)->>'content'='Verified synthetic body.',
  'carousel uses exact approved article');
SELECT public.reporter_complete(:'carousel_event','local-test-worker-02',1,
  '{"title":"Synthetic carousel","slides":[{"title":"Verified title","body":"Verified body."}],"provider":"fixture","model":"test-only","prompt_version":"test-v1"}');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true);
SELECT public.reporter_ready_carousel(:'carousel',2);
SELECT pg_temp.assert_true((SELECT status='ready' AND article_revision=4 FROM public.reporter_carousels WHERE id=:'carousel'),
  'local operator completes manual editorial review');
SELECT set_config('app.tenant_id','00000000-0000-0000-0000-000000000002',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000102',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000021',true);
SELECT pg_temp.assert_true(NOT public.reporter_local_state()->'transcripts' @> jsonb_build_array(jsonb_build_object('id',:'transcript')),
  'local state does not expose another portal');
RESET SESSION AUTHORIZATION;
\echo PASS local transcript to article to reviewed carousel and state isolation
ROLLBACK;
\echo PASS all local-flow fixtures rolled back
