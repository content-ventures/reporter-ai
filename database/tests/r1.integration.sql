-- All changes are rolled back. Runs only through the guarded Reporter local runner.
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
SELECT pg_temp.assert_true(current_database()='reporter_ai_local'
  AND shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database')
    LIKE 'Reporter AI standalone local%', 'Reporter database boundary');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM pg_roles WHERE rolname IN ('reporter_runtime','reporter_worker')
  AND (rolsuper OR rolbypassrls OR pg_has_role(rolname,'reporter_executor','MEMBER'))),'least privilege roles');
SELECT pg_temp.assert_true(NOT has_table_privilege('reporter_runtime','public.reporter_articles','UPDATE')
  AND NOT has_table_privilege('reporter_worker','public.reporter_articles','UPDATE'),'no direct mutations');
SELECT pg_temp.assert_true(NOT has_function_privilege('reporter_runtime',
  'core.reporter_finish_row(core.integration_outbox,jsonb)','EXECUTE'),'no internal helper access');
INSERT INTO public.user_roles(user_id,role) VALUES('00000000-0000-0000-0000-000000000021','admin_master');
SELECT pg_temp.assert_true(NOT core.authorize_context('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000021','reporter_ai',false),
  'global roles cannot bypass Reporter membership');
SELECT pg_temp.assert_true(NOT core.authorize_context('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000101',NULL,'reporter_ai',true),'no public access');
SELECT pg_temp.expect_error($q$INSERT INTO public.reporter_transcripts(portal_id,source_object_id,created_by,status)
  VALUES('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000011','ready')$q$,'23514');
\echo PASS roles and initial-state guard

SELECT pg_temp.expect_error($q$INSERT INTO public.reporter_transcripts(portal_id,source_object_id,created_by)
  VALUES('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000021')$q$,'23503');
SELECT pg_temp.assert_true(NOT public.reporter_segments_valid('[{"start_ms":-1,"end_ms":0,"text":"bad"}]')
  AND NOT public.reporter_segments_valid('[{"start_ms":1,"end_ms":0,"text":"bad"}]')
  AND NOT public.reporter_segments_valid('[null]'),'invalid timed segments rejected');
\echo PASS composite references and timed segment validation

INSERT INTO core.modules(key,name) VALUES('wrong_module','Isolation test module');
INSERT INTO core.tenant_modules(tenant_id,module_key,enabled)
  VALUES('00000000-0000-0000-0000-000000000001','wrong_module',true);
INSERT INTO core.portal_modules(tenant_id,portal_id,module_key,enabled)
  VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','wrong_module',true);

SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
SELECT public.reporter_create('transcript','00000000-0000-0000-0000-000000000301',1,'test.transcript','{}') AS transcript \gset
SELECT pg_temp.assert_true(public.reporter_create('transcript','00000000-0000-0000-0000-000000000301',1,
  'test.transcript','{}')=:'transcript'::uuid,'creation idempotency');
SELECT pg_temp.expect_error($q$SELECT public.reporter_create('transcript',
  '00000000-0000-0000-0000-000000000301',1,'test.transcript','{"language":"en"}')$q$,'22023');
SELECT pg_temp.expect_error($q$UPDATE public.reporter_transcripts SET status='ready'$q$,'42501');
SELECT set_config('app.module_key','wrong_module',true);
SELECT pg_temp.assert_true(NOT core.authorize_context(core.context_tenant_id(),core.context_portal_id(),
  core.context_user_id(),'wrong_module',false),'standalone authorization rejects other modules');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.reporter_transcripts)=0,'wrong module read denied');
SELECT pg_temp.expect_error($q$SELECT public.reporter_create('transcript',
  '00000000-0000-0000-0000-000000000301',1,'wrong.module','{}')$q$,'42501');
SELECT set_config('app.module_key','reporter_ai',true);
\echo PASS idempotency and fixed module authorization

RESET SESSION AUTHORIZATION;
UPDATE core.portal_modules SET enabled=false WHERE portal_id='00000000-0000-0000-0000-000000000101';
SET SESSION AUTHORIZATION reporter_runtime;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.reporter_transcripts)=0,'disabled module read denied');
RESET SESSION AUTHORIZATION;
UPDATE core.portal_modules SET enabled=true WHERE portal_id='00000000-0000-0000-0000-000000000101';
UPDATE public.portal_members SET status='disabled' WHERE user_id='00000000-0000-0000-0000-000000000011';
SET SESSION AUTHORIZATION reporter_runtime;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.reporter_transcripts)=0,'disabled membership denied');
RESET SESSION AUTHORIZATION;
UPDATE public.portal_members SET status='active' WHERE user_id='00000000-0000-0000-0000-000000000011';
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.tenant_id','00000000-0000-0000-0000-000000000002',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000102',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000021',true);
SELECT pg_temp.assert_true((SELECT count(*) FROM public.reporter_transcripts)=0,'other portal read denied');
SELECT pg_temp.expect_error($q$SELECT public.reporter_create('transcript',
  '00000000-0000-0000-0000-000000000301',1,'cross.portal','{}')$q$,'23514');
SELECT set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
RESET SESSION AUTHORIZATION;
UPDATE core.storage_objects SET status='pending' WHERE id='00000000-0000-0000-0000-000000000301';
SET SESSION AUTHORIZATION reporter_runtime;
SELECT pg_temp.expect_error($q$SELECT public.reporter_create('transcript',
  '00000000-0000-0000-0000-000000000301',1,'pending.source','{}')$q$,'23514');
RESET SESSION AUTHORIZATION;
UPDATE core.storage_objects SET status='completed' WHERE id='00000000-0000-0000-0000-000000000301';
\echo PASS portal, membership and source isolation

SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','wrong-job',true);
SELECT pg_temp.expect_error($q$SELECT public.reporter_claim('worker-test-01')$q$,'42501');
SELECT set_config('app.job_key','reporter-ai-processing',true);
SELECT id AS transcript_event FROM public.reporter_claim('worker-test-01') \gset
SELECT (public.reporter_start(:'transcript_event','worker-test-01')).attempts AS transcript_attempt \gset
SELECT pg_temp.expect_error(format('SELECT public.reporter_complete(%L,''wrong-worker'',1,''{}'')',:'transcript_event'),'40001');
SELECT public.reporter_renew(:'transcript_event','worker-test-01');
SELECT public.reporter_complete(:'transcript_event','worker-test-01',:transcript_attempt,
  '{"content":"Local synthetic transcript","segments":[{"start_ms":0,"end_ms":1000,"text":"Local text"}],
    "provider":"fixture","model":"fixture-v1","provider_request_id":"fixture-request","duration_ms":1000,"usage_unit":"audio_ms","input_units":1000}');
SELECT pg_temp.expect_error(format('SELECT public.reporter_complete(%L,''worker-test-01'',1,''{}'')',:'transcript_event'),'40001');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.expect_error(format('UPDATE public.reporter_transcripts SET content=''rewrite'',revision=revision+1 WHERE id=%L',:'transcript'),'23514');
SELECT pg_temp.assert_true((SELECT after_data->'processing'->'output_units'='null'::jsonb
  FROM public.audit_log WHERE entity_id=:'transcript' AND action='reporter.transcript.generated'),'unknown usage remains null');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM public.event_outbox WHERE payload::text LIKE '%Local synthetic transcript%'),'no raw content in business events');
\echo PASS processing fencing, atomic measurements and transcript immutability

SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true);
SELECT public.reporter_create('article',:'transcript',3,'test.article','{}') AS article \gset
SELECT pg_temp.assert_true(public.reporter_create('article',:'transcript',3,'test.article','{}')=:'article'::uuid,'article idempotency');
SELECT public.reporter_create('article',:'transcript',3,'test.variant','{}') AS variant \gset
SELECT pg_temp.assert_true(:'variant'::uuid<>:'article'::uuid,'multiple articles from same source');
RESET SESSION AUTHORIZATION;
UPDATE core.integration_outbox SET available_at=clock_timestamp()+interval '1 day' WHERE aggregate_id=:'variant';
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true);
SELECT id AS article_event FROM public.reporter_claim('worker-test-01') \gset
SELECT (public.reporter_start(:'article_event','worker-test-01')).attempts AS article_attempt \gset
SELECT public.reporter_complete(:'article_event','worker-test-01',:article_attempt,
  '{"title":"Synthetic title","content":"Synthetic article","provider":"fixture","model":"fixture-v1","prompt_version":"r1-v1"}');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true);
SELECT public.reporter_edit_article(:'article',2,'Edited title','Edited body');
SELECT pg_temp.expect_error(format('SELECT public.reporter_edit_article(%L,2,''Stale'',''Stale'')',:'article'),'40001');
SELECT public.reporter_submit_article(:'article',3);
SELECT pg_temp.expect_error(format('SELECT public.reporter_edit_article(%L,4,''Review edit'',''Body'')',:'article'),'40001');
SELECT pg_temp.expect_error(format('SELECT public.reporter_review_article(%L,4,true,NULL)',:'article'),'42501');
SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000012',true);
SELECT public.reporter_review_article(:'article',4,false,'Please adjust');
SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
SELECT public.reporter_edit_article(:'article',5,'Final title','Final body');
SELECT public.reporter_submit_article(:'article',6);
SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000012',true);
SELECT pg_temp.expect_error(format('SELECT public.reporter_review_article(%L,6,true,NULL)',:'article'),'40001');
SELECT public.reporter_review_article(:'article',7,true,NULL);
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT approved_revision=8 AND revision=8 AND status='approved'
  FROM public.reporter_articles WHERE id=:'article'),'approval exact revision');
SELECT pg_temp.assert_true((SELECT after_data->'snapshot'->>'content'='Final body'
  FROM public.audit_log WHERE entity_id=:'article' AND action='reporter.article.approved'),'approval snapshot');
SELECT pg_temp.expect_error(format('UPDATE public.reporter_articles SET content=''rewrite'',revision=revision+1 WHERE id=%L',:'article'),'23514');
\echo PASS editorial workflow, stale writes, review permission and immutable approval

SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
SELECT pg_temp.expect_error(format('SELECT public.reporter_create(''carousel'',%L,7,''wrong.revision'',''{}'')',:'article'),'40001');
SELECT public.reporter_create('carousel',:'article',8,'test.carousel','{}') AS carousel \gset
SELECT public.reporter_create('carousel',:'article',8,'test.carousel.variant','{}') AS carousel_variant \gset
RESET SESSION AUTHORIZATION;
-- Hold other queued jobs out of this test's next claim; rollback restores them.
UPDATE core.integration_outbox SET available_at=clock_timestamp()+interval '1 day'
  WHERE aggregate_id IN (:'variant',:'carousel_variant');
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true);
SELECT id AS carousel_event FROM public.reporter_claim('worker-test-01') \gset
SELECT (public.reporter_start(:'carousel_event','worker-test-01')).attempts AS carousel_attempt \gset
SELECT pg_temp.expect_error(format('SELECT public.reporter_complete(%L,''worker-test-01'',%s,%L)',
  :'carousel_event',:carousel_attempt,'{"title":"Slides","slides":[null],"provider":"fixture","model":"fixture","prompt_version":"v1"}'),'23514');
SELECT public.reporter_complete(:'carousel_event','worker-test-01',:carousel_attempt,
  '{"title":"Slides","slides":[{"title":"Intro","body":"Synthetic body"}],"provider":"fixture","model":"fixture","prompt_version":"v1"}');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true);
SELECT pg_temp.expect_error(format('SELECT public.reporter_edit_carousel(%L,2,''Slides'',''["primitive"]'')',:'carousel'),'23514');
SELECT pg_temp.expect_error(format('SELECT public.reporter_edit_carousel(%L,2,''Slides'',''[{"body":"ok","url":"bad"}]'')',:'carousel'),'23514');
SELECT public.reporter_ready_carousel(:'carousel',2);
SELECT public.reporter_edit_carousel(:'carousel',3,'Revised slides','[{"body":"New body"}]');
SELECT pg_temp.assert_true((SELECT status='draft' AND ready_at IS NULL AND output_object_id IS NULL
  AND revision=4 FROM public.reporter_carousels WHERE id=:'carousel'),'ready edit invalidation');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.expect_error(format('UPDATE public.reporter_carousels SET article_revision=7,revision=revision+1 WHERE id=%L',:'carousel'),'23514');
\echo PASS exact approved input, slide validation and carousel readiness

-- Atomic audit failure: the failing command must not leave an approved article.
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true);
RESET SESSION AUTHORIZATION;
UPDATE core.integration_outbox SET available_at=clock_timestamp() WHERE aggregate_id=:'variant';
SET SESSION AUTHORIZATION reporter_worker;
SELECT id AS variant_event FROM public.reporter_claim('worker-test-01') \gset
SELECT (public.reporter_start(:'variant_event','worker-test-01')).attempts AS variant_attempt \gset
SELECT public.reporter_complete(:'variant_event','worker-test-01',:variant_attempt,
  '{"title":"Variant","content":"Variant body","provider":"fixture","model":"fixture","prompt_version":"v1"}');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true);
SELECT public.reporter_submit_article(:'variant',2);
RESET SESSION AUTHORIZATION;
CREATE FUNCTION pg_temp.reject_approval_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.action='reporter.article.approved' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER test_reject_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_approval_audit();
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000012',true);
SELECT pg_temp.expect_error(format('SELECT public.reporter_review_article(%L,3,true,NULL)',:'variant'),'P0001');
SELECT pg_temp.assert_true((SELECT status='in_review' AND revision=3 AND approved_revision IS NULL
  FROM public.reporter_articles WHERE id=:'variant'),'audit failure rolls back approval');
RESET SESSION AUTHORIZATION;
DROP TRIGGER test_reject_audit ON public.audit_log;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM public.event_outbox
  WHERE entity_id=:'variant' AND event_type='reporter.article.approved'),'no partial business event');
\echo PASS approval and audit atomicity on failure

-- Expired leases, dead-letter recovery, explicit retry and stale old generation.
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
SELECT public.reporter_create('transcript','00000000-0000-0000-0000-000000000301',1,'test.recovery','{}') AS recovery \gset
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true);
SELECT id AS recovery_event FROM public.reporter_claim('worker-test-01') \gset
SELECT (public.reporter_start(:'recovery_event','worker-test-01')).attempts AS recovery_attempt \gset
RESET SESSION AUTHORIZATION;
UPDATE core.integration_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=:'recovery_event';
SET SESSION AUTHORIZATION reporter_worker;
SELECT pg_temp.expect_error(format('SELECT public.reporter_complete(%L,''worker-test-01'',1,''{}'')',:'recovery_event'),'40001');
SELECT id FROM public.reporter_claim('worker-test-02');
SELECT (public.reporter_start(:'recovery_event','worker-test-02')).attempts AS second_attempt \gset
SELECT pg_temp.assert_true(:second_attempt=2,'automatic retry increments attempts, preserves generation');
SELECT pg_temp.expect_error(format('SELECT public.reporter_complete(%L,''worker-test-01'',1,''{}'')',:'recovery_event'),'40001');
SELECT public.reporter_release(:'recovery_event','worker-test-02',:second_attempt,'PROVIDER_TIMEOUT');
RESET SESSION AUTHORIZATION;
UPDATE core.integration_outbox SET attempts=8,lease_until=NULL,lease_owner=NULL WHERE id=:'recovery_event';
SET SESSION AUTHORIZATION reporter_worker;
SELECT id FROM public.reporter_claim('worker-test-03');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT status='failed' AND error_code='ATTEMPTS_EXHAUSTED' AND revision=3
  FROM public.reporter_transcripts WHERE id=:'recovery'),'dead letter transitions aggregate to failed');
SELECT pg_temp.assert_true((SELECT processed_at IS NULL AND last_error='ATTEMPTS_EXHAUSTED'
  FROM core.integration_outbox WHERE id=:'recovery_event'),'dead letter remains inspectable');
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true);
SELECT public.reporter_retry('transcript',:'recovery',3,'test.retry') AS retry_generation \gset
SELECT pg_temp.assert_true(public.reporter_retry('transcript',:'recovery',3,'test.retry')=:'retry_generation'::uuid,'retry idempotency');
SELECT pg_temp.assert_true((SELECT status='queued' AND revision=4 AND generation_id=:'retry_generation'::uuid
  FROM public.reporter_transcripts WHERE id=:'recovery'),'new generation after explicit retry');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true);
SELECT pg_temp.expect_error(format('SELECT public.reporter_complete(%L,''worker-test-02'',2,''{}'')',:'recovery_event'),'40001');
RESET SESSION AUTHORIZATION;
\echo PASS lease expiry, automatic retry, exhausted work and new-generation fencing

UPDATE core.integration_outbox SET available_at=clock_timestamp()+interval '1 day'
  WHERE aggregate_id=:'recovery' AND processed_at IS NULL;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true);
SELECT public.reporter_create('transcript','00000000-0000-0000-0000-000000000301',1,'test.removed-source','{}') AS removed_source \gset
RESET SESSION AUTHORIZATION;
UPDATE core.storage_objects SET status='deleted' WHERE id='00000000-0000-0000-0000-000000000301';
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true);
SELECT id AS removed_event FROM public.reporter_claim('worker-test-04') \gset
SELECT pg_temp.assert_true((public.reporter_start(:'removed_event','worker-test-04')).processed_at IS NOT NULL,
  'unavailable source finalized before provider work');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT status='failed' AND error_code='INPUT_UNAVAILABLE'
  FROM public.reporter_transcripts WHERE id=:'removed_source'),'input revalidated at execution');
\echo PASS source revalidation between enqueue and execution
ROLLBACK;
\echo PASS all integration fixtures rolled back
