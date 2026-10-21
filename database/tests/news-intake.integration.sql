-- F2.1: sources, reads, dedupe by identity and link, the same story grouped, pasted links. All rolls back.
\set ON_ERROR_STOP on
BEGIN;
DELETE FROM public.reporter_news_items WHERE portal_id IN ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000102');
DELETE FROM public.reporter_news_sources WHERE portal_id IN ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000102');
-- Other queues stay idle, so the worker gate below answers for news alone.
UPDATE core.integration_outbox SET available_at=clock_timestamp()+interval '1 day' WHERE processed_at IS NULL;
UPDATE core.storage_objects SET reference=reference-'remote_url' WHERE status='pending' AND reference ? 'remote_url';
DO $$ BEGIN IF to_regclass('public.reporter_ed_runs') IS NOT NULL THEN
  EXECUTE 'UPDATE public.reporter_ed_runs SET available_at=clock_timestamp()+interval ''1 day''';
END IF; END $$;

SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
DO $$
DECLARE source jsonb; claim jsonb; result jsonb; view jsonb; first_id uuid;
  entry jsonb := '{"guid":"tag:litoral,1","url":"https://www.litoral.exemplo/tilapia?utm_source=rss","canonicalUrl":"https://litoral.exemplo/tilapia",
    "title":"Exportação de tilápia cresce 41% no terceiro trimestre","outlet":"Agência Litoral","excerpt":"O Brasil embarcou 4,1 mil toneladas.",
    "body":["O Brasil embarcou 4,1 mil toneladas.","Paraná lidera."],"storyKey":"41 cresce exportacao terceiro tilapia trimestre",
    "publishedAt":"2026-10-19T12:00:00Z"}';
BEGIN
  PERFORM public.reporter_news_require_edit();
  source := public.reporter_news_source_add('rss','Agência Litoral','https://litoral.exemplo/feed','https://litoral.exemplo/feed',60,NULL,NULL,NULL);
  IF source->>'name'<>'Agência Litoral' OR (source->>'everyMinutes')::int<>60 OR jsonb_array_length(source->'lastWeek')<>7 THEN
    RAISE EXCEPTION 'Source view is wrong: %',source;
  END IF;
  BEGIN
    PERFORM public.reporter_news_source_add('rss','Outra','https://www.litoral.exemplo/feed/','https://litoral.exemplo/feed',60,NULL,NULL,NULL);
    RAISE EXCEPTION 'Duplicate source accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- A member reads one named source; a second lease on it waits.
  claim := public.reporter_news_claim('member-read-0001',(source->>'id')::uuid);
  IF claim IS NULL OR (claim->>'firstRead')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Claim failed: %',claim; END IF;
  IF public.reporter_news_claim('member-read-0002',(source->>'id')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'Double lease'; END IF;
  BEGIN
    PERFORM public.reporter_news_claim('member-read-0003',NULL);
    RAISE EXCEPTION 'A member claimed due sources';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.reporter_news_ingest((source->>'id')::uuid,'someone-else-01','[]',NULL,NULL);
    RAISE EXCEPTION 'Ingest without the lease';
  EXCEPTION WHEN serialization_failure THEN NULL; END;

  result := public.reporter_news_ingest((source->>'id')::uuid,'member-read-0001',jsonb_build_array(entry,
    entry||'{"guid":"tag:litoral,1","url":"https://litoral.exemplo/outra","canonicalUrl":"https://litoral.exemplo/outra"}',
    entry||'{"guid":"tag:litoral,2","url":"https://litoral.exemplo/tilapia/","storyKey":null,"title":"Repetida pelo link"}',
    entry||'{"guid":"tag:litoral,3","url":"https://litoral.exemplo/camarao","canonicalUrl":"https://litoral.exemplo/camarao","title":"Camarão","storyKey":null}',
    entry||'{"guid":"tag:litoral,4","url":"https://litoral.exemplo/ruim","canonicalUrl":"https://litoral.exemplo/ruim","title":" "}'),'"v1"','Mon, 19 Oct 2026 12:00:00 GMT');
  IF result<>'{"inserted":2,"grouped":0}'::jsonb THEN RAISE EXCEPTION 'Identity, link or invalid entry not dropped: %',result; END IF;
  first_id := (SELECT x->>'id' FROM jsonb_array_elements(public.reporter_news_view(NULL,NULL)->'items') x WHERE x->>'title' LIKE 'Exportação%')::uuid;
  PERFORM set_config('test.news_first',first_id::text,false);

  -- Another outlet with the same story joins the first item; the same outlet again changes nothing.
  source := public.reporter_news_source_add('google-alerts','tilápia','https://www.google.com/alerts/feeds/1/2','https://google.com/alerts/feeds/1/2',30,NULL,'tilápia',NULL);
  claim := public.reporter_news_claim('member-read-0004',(source->>'id')::uuid);
  result := public.reporter_news_ingest((source->>'id')::uuid,'member-read-0004',jsonb_build_array(
    entry||'{"guid":"g1","url":"https://g1.exemplo/agro/tilapia","canonicalUrl":"https://g1.exemplo/agro/tilapia","outlet":"g1.exemplo","publishedAt":"2026-10-19T13:00:00Z"}',
    entry||'{"guid":"g2","url":"https://g1.exemplo/agro/tilapia-2","canonicalUrl":"https://g1.exemplo/agro/tilapia-2","outlet":"G1.exemplo","publishedAt":"2026-10-19T13:30:00Z"}'),NULL,NULL);
  IF result<>'{"inserted":0,"grouped":1}'::jsonb THEN RAISE EXCEPTION 'Same story not grouped once: %',result; END IF;
  IF jsonb_array_length(public.reporter_news_item(first_id)->'duplicates')<>1
    OR public.reporter_news_item(first_id)->'duplicates'->0->>'source'<>'g1.exemplo' THEN
    RAISE EXCEPTION 'Duplicate lost its origin';
  END IF;

  -- A pasted link: new, a repeat of a grouped duplicate, and the same story from a third outlet.
  result := public.reporter_news_import(entry||'{"guid":"https://folha.exemplo/peixe","url":"https://folha.exemplo/peixe","canonicalUrl":"https://folha.exemplo/peixe","title":"Peixe","storyKey":null,"outlet":"folha.exemplo"}');
  PERFORM set_config('test.news_pasted',result->>'id',false);
  IF result->>'outcome'<>'inserted' OR public.reporter_news_item((result->>'id')::uuid)->>'via'<>'url' THEN
    RAISE EXCEPTION 'Pasted link not imported: %',result;
  END IF;
  result := public.reporter_news_import(entry||'{"guid":"x","url":"https://g1.exemplo/agro/tilapia","canonicalUrl":"https://g1.exemplo/agro/tilapia","outlet":"g1.exemplo"}');
  IF result->>'outcome'<>'repeat' OR (result->>'id')::uuid<>first_id THEN RAISE EXCEPTION 'Grouped link imported again: %',result; END IF;
  result := public.reporter_news_import(entry||'{"guid":"y","url":"https://valor.exemplo/t","canonicalUrl":"https://valor.exemplo/t","outlet":"valor.exemplo"}');
  IF result->>'outcome'<>'grouped' OR (result->>'id')::uuid<>first_id THEN RAISE EXCEPTION 'Pasted story not grouped: %',result; END IF;
  IF public.reporter_news_lookup('https://valor.exemplo/t')<>first_id OR public.reporter_news_lookup('https://litoral.exemplo/tilapia')<>first_id
    OR public.reporter_news_lookup('https://nada.exemplo/x') IS NOT NULL THEN
    RAISE EXCEPTION 'A link in the queue was not found before reading its page';
  END IF;

  -- The radar's read: everything first, then only what changed.
  view := public.reporter_news_view(NULL,NULL);
  IF jsonb_array_length(view->'items')<>3 OR jsonb_array_length(view->'sources')<>2
    OR (view->'items'->0) ? 'body' OR (SELECT (s->'lastWeek'->>6)::int FROM jsonb_array_elements(view->'sources') s WHERE s->>'kind'='rss')<>2 THEN
    RAISE EXCEPTION 'Radar view is wrong: %',view;
  END IF;
  view := public.reporter_news_view(clock_timestamp()+interval '1 second',NULL);
  IF jsonb_array_length(view->'sources')<>2 OR jsonb_array_length(view->'items')<>0 THEN
    RAISE EXCEPTION 'An idle poll lost its source snapshot or resent news: %',view;
  END IF;
  IF jsonb_array_length(public.reporter_news_item(first_id)->'body')<>2 THEN RAISE EXCEPTION 'Item body missing'; END IF;

  -- Pause, resume, frequency; removing a source keeps its news.
  source := public.reporter_news_source_update((source->>'id')::uuid,NULL,NULL,true);
  IF (source->>'paused')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Pause lost'; END IF;
  source := public.reporter_news_source_update((source->>'id')::uuid,'Alerta tilápia',120,false);
  IF source->>'name'<>'Alerta tilápia' OR (source->>'everyMinutes')::int<>120 OR (source->>'nextReadAt')::timestamptz>clock_timestamp() THEN
    RAISE EXCEPTION 'Resume or frequency lost: %',source;
  END IF;
  view := public.reporter_news_view(NULL,NULL);
  result := public.reporter_news_source_remove((SELECT (x->>'id')::uuid FROM jsonb_array_elements(view->'sources') x WHERE x->>'kind'='rss'));
  IF result->>'kind'<>'rss' OR public.reporter_news_item(first_id) ? 'sourceId' THEN
    RAISE EXCEPTION 'Removing a source removed or kept a link to its news';
  END IF;
  view := public.reporter_news_view((view->>'at')::timestamptz,NULL);
  IF jsonb_array_length(view->'sources')<>1
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(view->'items') i WHERE i->>'id'=first_id::text AND NOT i ? 'sourceId') THEN
    RAISE EXCEPTION 'Another desk did not see the source removal and detached news: %',view;
  END IF;
  -- The final deletion has no surviving source whose updated_at could invalidate a cached list.
  PERFORM public.reporter_news_source_remove((source->>'id')::uuid);
  view := public.reporter_news_view((view->>'at')::timestamptz,NULL);
  IF view->'sources'<>'[]'::jsonb THEN RAISE EXCEPTION 'The last deleted source remained in another desk: %',view; END IF;
  PERFORM public.reporter_news_source_add('rss','Worker source','https://worker.exemplo/feed','https://worker.exemplo/feed',15,NULL,NULL,NULL);
END $$;

-- A reviewer reads but never writes; another portal sees nothing.
SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000012',true);
DO $$
BEGIN
  IF jsonb_array_length(public.reporter_news_view(NULL,NULL)->'items')<>3 THEN RAISE EXCEPTION 'Reviewer cannot read the radar'; END IF;
  BEGIN
    PERFORM public.reporter_news_require_edit();
    RAISE EXCEPTION 'Reviewer passed the preflight write permission check';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.reporter_news_source_add('rss','X','https://x.exemplo/feed','https://x.exemplo/feed',60,NULL,NULL,NULL);
    RAISE EXCEPTION 'Reviewer added a source';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.tenant_id','00000000-0000-0000-0000-000000000002',true);
  PERFORM set_config('app.portal_id','00000000-0000-0000-0000-000000000102',true);
  PERFORM set_config('app.user_id','00000000-0000-0000-0000-000000000021',true);
  IF jsonb_array_length(public.reporter_news_view(NULL,NULL)->'items')<>0
    OR public.reporter_news_item(current_setting('test.news_first')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'Another portal read the news';
  END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$
BEGIN
  IF (SELECT imported_by FROM public.reporter_news_items WHERE id=current_setting('test.news_pasted')::uuid)<>'00000000-0000-0000-0000-000000000011'
    OR (SELECT count(*) FROM public.audit_log WHERE action LIKE 'reporter.news%' AND user_id='00000000-0000-0000-0000-000000000011')<5 THEN
    RAISE EXCEPTION 'Pasted link or source changes were not attributed';
  END IF;
END $$;

-- The worker wakes for a due source, reads the most overdue one and backs off after a failure.
-- Translation is tested separately; this gate assertion isolates the source queue.
UPDATE public.reporter_news_items SET translation_status='original' WHERE portal_id='00000000-0000-0000-0000-000000000101';
UPDATE public.reporter_news_sources SET next_read_at=clock_timestamp()-interval '1 minute' WHERE portal_id='00000000-0000-0000-0000-000000000101';
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true);
DO $$
DECLARE claim jsonb; source jsonb;
BEGIN
  IF NOT public.reporter_worker_pending() THEN RAISE EXCEPTION 'Due source did not wake the worker'; END IF;
  claim := public.reporter_news_claim('reporter-neon-worker-1');
  IF claim IS NULL THEN RAISE EXCEPTION 'Worker found nothing due'; END IF;
  IF public.reporter_worker_pending() THEN RAISE EXCEPTION 'A leased source still counts as due'; END IF;
  source := public.reporter_news_failed((claim->>'id')::uuid,'reporter-neon-worker-1','NEWS_TIMEOUT');
  IF (source->>'failures')::int<>1 OR source->>'lastError'<>'NEWS_TIMEOUT' OR (source->>'nextReadAt')::timestamptz<clock_timestamp()+interval '14 minutes' THEN
    RAISE EXCEPTION 'Failure not recorded: %',source;
  END IF;
  IF public.reporter_worker_pending() THEN RAISE EXCEPTION 'A failed source retried at once'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
\echo PASS a read keeps one item per identity and link and skips an invalid entry
\echo PASS the same story from another outlet keeps its origin as a duplicate
\echo PASS a pasted link imports once and lands on the story already in the queue
\echo PASS the radar polls only what changed and reads the text on demand
\echo PASS sources pause, resume and leave without their news
\echo PASS reviewers only read and other portals see nothing
\echo PASS pasted links and source changes are attributed
\echo PASS the worker reads due sources and backs off after a failure
