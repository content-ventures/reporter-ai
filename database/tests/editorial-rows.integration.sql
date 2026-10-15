-- Editorial rows: scoped loads, stamped commits, deltas, claims. Synthetic rows; all roll back.
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
-- Start from an idle queue without claiming pre-existing user work.
UPDATE core.integration_outbox SET available_at=clock_timestamp()+interval '1 day' WHERE processed_at IS NULL;
UPDATE core.storage_objects SET reference=reference-'remote_url' WHERE status='pending' AND reference ? 'remote_url';
UPDATE public.reporter_ed_runs SET available_at=clock_timestamp()+interval '1 day';
SELECT pg_temp.assert_true(NOT has_table_privilege('reporter_runtime','public.reporter_ed_parts','SELECT')
  AND NOT has_table_privilege('reporter_worker','public.reporter_ed_runs','UPDATE')
  AND NOT has_function_privilege('reporter_runtime','public.reporter_ed_claim(text,integer)','EXECUTE')
  AND NOT has_function_privilege('reporter_worker','public.reporter_ed_changes(bigint)','EXECUTE'),'rows are reachable only through the editorial functions');

SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000031',true),
  set_config('app.editorial_permission','reporter.edit',true);
SELECT (public.reporter_ed_status()->>'seq')::bigint AS start_seq \gset
SELECT public.reporter_ed_commit(jsonb_build_object(
  'receipt',jsonb_build_object('requestId','rows-test-1','hash','h1','result','{"ok":true}'::jsonb),
  'workspace',jsonb_build_object('workspace',jsonb_build_object('id','00000000-0000-0000-0000-000000000101','name','Teste','slug','teste','createdAt','2026-10-15T00:00:00Z'),
    'pipelineHash','rows-pipeline'),
  'pipelines',jsonb_build_array(jsonb_build_object('hash','rows-pipeline','doc',jsonb_build_object('hash','rows-pipeline'))),
  'productions',jsonb_build_array(jsonb_build_object('id','rows-production','doc',jsonb_build_object('id','rows-production','title','Linhas','sourceIds',jsonb_build_array('rows-source')),
    'sourceIds',jsonb_build_array('rows-source'),'archived',false)),
  'sources',jsonb_build_array(jsonb_build_object('id','rows-source','doc',jsonb_build_object('id','rows-source','text','Fonte sintética.'))),
  'parts',jsonb_build_array(jsonb_build_object('kind','piece','id','rows-piece','productionId','rows-production','doc',jsonb_build_object('id','rows-piece')),
    jsonb_build_object('kind','version','id','rows-version','productionId','rows-production','doc',jsonb_build_object('id','rows-version','number',1))),
  'runs',jsonb_build_array(jsonb_build_object('id','rows-run','productionId','rows-production','status','queued','availableAt',0,'attempts',0,
    'job',jsonb_build_object('meta',jsonb_build_object('runId','rows-run'),'kind','article.draft'),'fold',jsonb_build_object('seq',1,'run',jsonb_build_object('status','queued')))),
  'events',jsonb_build_array(jsonb_build_object('runId','rows-run','event',jsonb_build_object('seq',1,'type','run.started'))),
  'items',jsonb_build_array(jsonb_build_object('kind','activity','id','rows-activity','productionId','rows-production','doc',jsonb_build_object('id','rows-activity')))
)) AS first_seq \gset
SELECT pg_temp.assert_true(:first_seq=:start_seq+1,'a commit takes the next change number');
SELECT pg_temp.assert_true((public.reporter_ed_status()->>'seq')::bigint=:first_seq AND octet_length(public.reporter_ed_status()::text)<=128,
  'the poll stamp is small and current');
SELECT pg_temp.expect_error($q$SELECT public.reporter_ed_commit('{"receipt":{"requestId":"rows-test-1","hash":"h1"}}')$q$,'40001');
SELECT pg_temp.expect_error($q$SELECT public.reporter_ed_commit('{"parts":[{"kind":"piece","id":"rows-piece","productionId":"elsewhere","doc":{}}]}')$q$,'22023');
DO $$ DECLARE loaded jsonb := public.reporter_ed_load('{"entities":["rows-version"],"events":"active","items":{"activity":"production"},"receipt":"rows-test-1"}');
BEGIN
  PERFORM pg_temp.assert_true(jsonb_array_length(loaded->'productions')=1 AND jsonb_array_length(loaded->'parts')=2
    AND jsonb_array_length(loaded->'sources')=1 AND jsonb_array_length(loaded->'runs')=1 AND jsonb_array_length(loaded->'events')=1
    AND jsonb_array_length(loaded->'items')=1 AND loaded->'receipt'->>'hash'='h1','an entity id loads its production, sources, runs, events and items');
  loaded := public.reporter_ed_load('{"entities":["rows-version"],"parts":["piece"]}');
  PERFORM pg_temp.assert_true(jsonb_array_length(loaded->'parts')=1 AND loaded->'parts'->0->>'kind'='piece','a scope can load only some part kinds');
  loaded := public.reporter_ed_load('{"productions":["rows-production"],"part_ids":["rows-version"],"runs":[],"pipelines":false}');
  PERFORM pg_temp.assert_true(jsonb_array_length(loaded->'parts')=1 AND loaded->'parts'->0->>'id'='rows-version'
    AND jsonb_array_length(loaded->'runs')=0 AND jsonb_array_length(loaded->'pipelines')=0
    AND jsonb_array_length(public.reporter_ed_load('{"productions":["rows-production"]}')->'pipelines')=1
    AND jsonb_array_length(public.reporter_ed_load('{"runs":["rows-run"]}')->'runs')=1,
    'a progress scope names exact parts and runs and skips the pipeline snapshots');
END $$;
SELECT set_config('test.first',:'first_seq',true);
SELECT public.reporter_ed_commit('{"parts":[{"kind":"version","id":"rows-version","productionId":"rows-production","doc":null,"deleted":true}]}') AS second_seq \gset
DO $$ DECLARE changes jsonb;
BEGIN
  changes := public.reporter_ed_changes(current_setting('test.first')::bigint);
  PERFORM pg_temp.assert_true(jsonb_array_length(changes->'parts')=1 AND (changes->'parts'->0->>'deleted')::boolean
    AND jsonb_array_length(changes->'productions')=0 AND jsonb_array_length(changes->'events')=0,'a delta holds only rows stamped after the client number');
  PERFORM pg_temp.assert_true(NOT (changes->'runs' @> '[{"job":{"input":{}}}]') AND jsonb_array_length(public.reporter_ed_load('{"entities":["rows-version"]}')->'parts')=1,
    'deleted parts are tombstones, never loaded into commands');
END $$;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true);
SELECT pg_temp.assert_true(public.reporter_worker_pending(),'a queued run wakes a drain');
SELECT public.reporter_ed_claim('rows-worker-01',60000) AS claim \gset
SELECT pg_temp.assert_true(:'claim'::jsonb->>'runId'='rows-run' AND (:'claim'::jsonb->>'attempts')::int=1,'a claimable run is leased once');
SELECT pg_temp.assert_true(public.reporter_ed_claim('rows-worker-02',60000) IS NULL,'a leased run is not claimed twice');
SELECT pg_temp.assert_true(NOT public.reporter_worker_pending(),'a leased run does not wake a drain');
SELECT pg_temp.assert_true(public.reporter_ed_renew('rows-run','rows-worker-01',:'claim'::jsonb->'lease'->>'fence',60000),'the holder renews its lease');
SELECT pg_temp.assert_true(NOT public.reporter_ed_renew('rows-run','rows-worker-01','stale-fence',60000),'a stale fence cannot renew');
SELECT pg_temp.expect_error($q$SELECT public.reporter_ed_status()$q$,'42501');
RESET SESSION AUTHORIZATION;
SELECT pg_temp.assert_true((SELECT seq FROM public.reporter_ed_runs WHERE run_id='rows-run')=:first_seq,'leases are not stamped as browser changes');

SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.portal_id','00000000-0000-0000-0000-000000000102',true),set_config('app.access_mode','user',true);
SELECT pg_temp.expect_error($q$SELECT public.reporter_ed_load('{"productions":"all"}')$q$,'42501');
SELECT pg_temp.expect_error($q$SELECT public.reporter_ed_changes(0)$q$,'42501');
RESET SESSION AUTHORIZATION;
\echo PASS run claims are leased once, fenced and invisible to the browser stamp
\echo PASS another portal can neither load nor read deltas
\echo PASS stamped commits, scoped loads, tombstone deltas and command receipts
ROLLBACK;
