-- Explicit source ratings persist per portal and appear in complete and incremental snapshots.
\set ON_ERROR_STOP on
BEGIN;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
DO $$
DECLARE source jsonb; saved jsonb; view jsonb; source_id uuid; cursor_at timestamptz;
BEGIN
  source := public.reporter_news_source_add('rss','Rating source','https://source-rating.exemplo/feed','https://source-rating.exemplo/feed',60,NULL,NULL,NULL);
  source_id := (source->>'id')::uuid;
  PERFORM set_config('test.rating_source',source_id::text,true);
  IF source ? 'rating' THEN RAISE EXCEPTION 'A new source was rated automatically'; END IF;
  cursor_at := (public.reporter_news_view(NULL,1)->>'at')::timestamptz;
  source := public.reporter_news_source_update(source_id,NULL,NULL,NULL,
    '{"tier":"A1","relevance":"high","rationale":"  Pesquisa própria sobre pescado.  "}');
  saved := source->'rating';
  IF saved->>'tier'<>'A1' OR saved->>'relevance'<>'high' OR saved->>'rationale'<>'Pesquisa própria sobre pescado.'
    OR (saved->>'updatedAt')::timestamptz<cursor_at THEN RAISE EXCEPTION 'Rating roundtrip failed: %',source; END IF;
  view := public.reporter_news_view(cursor_at,1);
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(view->'sources') s WHERE s->>'id'=source_id::text AND s->'rating'=saved) THEN
    RAISE EXCEPTION 'An incremental poll lost the rating';
  END IF;
  source := public.reporter_news_source_update(source_id,'Renamed publication',120,true);
  IF source->'rating'<>saved OR source->>'name'<>'Renamed publication' OR (source->>'paused')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'The existing four-argument update lost the rating';
  END IF;
  source := public.reporter_news_source_update(source_id,NULL,NULL,false,NULL::jsonb);
  IF source->'rating'<>saved THEN RAISE EXCEPTION 'An omitted rating changed its value or timestamp'; END IF;
  cursor_at := (public.reporter_news_view(NULL,1)->>'at')::timestamptz;
  source := public.reporter_news_source_update(source_id,NULL,NULL,NULL,'null'::jsonb);
  IF source ? 'rating' THEN RAISE EXCEPTION 'Explicit clearing kept the rating'; END IF;
  view := public.reporter_news_view(cursor_at,1);
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(view->'sources') s WHERE s->>'id'=source_id::text AND NOT s ? 'rating') THEN
    RAISE EXCEPTION 'Another session kept the cleared rating';
  END IF;
END $$;
SELECT 'PASS source ratings roundtrip, omitted fields and clearing';

DO $$
DECLARE value jsonb; source jsonb; source_id uuid := current_setting('test.rating_source')::uuid;
  valid jsonb := '{"tier":"A2","relevance":"medium","rationale":"Cobertura especializada."}';
BEGIN
  FOR value IN SELECT * FROM jsonb_array_elements(jsonb_build_array('{}'::jsonb,'[]'::jsonb,'1'::jsonb,'"A1"'::jsonb,
    valid-'tier',valid||'{"tier":"A"}',valid||'{"relevance":"urgent"}',valid||'{"rationale":"  "}',
    valid||jsonb_build_object('rationale',E'\n\t'),valid||jsonb_build_object('rationale',repeat('x',601)),
    valid||'{"rationale":42}',valid||'{"relevance":null}',valid||'{"updatedAt":"2026-10-21"}')) LOOP
    BEGIN
      PERFORM public.reporter_news_source_update(source_id,NULL,NULL,NULL,value);
      RAISE EXCEPTION 'Invalid rating accepted: %',value;
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  source := public.reporter_news_source_update(source_id,NULL,NULL,NULL,NULL::jsonb);
  IF source ? 'rating' THEN RAISE EXCEPTION 'An invalid write changed the rating'; END IF;
  source := public.reporter_news_source_add('google-alerts','Alerts','https://source-rating.exemplo/alerts','https://source-rating.exemplo/alerts',60,NULL,NULL,NULL);
  BEGIN
    PERFORM public.reporter_news_source_update((source->>'id')::uuid,NULL,NULL,NULL,valid);
    RAISE EXCEPTION 'Google Alerts received a publication rating';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM<>'NEWS_SOURCE_RATING_UNSUPPORTED' THEN RAISE; END IF;
  END;
  PERFORM public.reporter_news_source_update((source->>'id')::uuid,NULL,NULL,NULL,'null'::jsonb);
  source := public.reporter_news_source_add('rss-app','Keyword','https://source-rating.exemplo/keyword','https://source-rating.exemplo/keyword',60,NULL,'pescado',NULL);
  BEGIN
    PERFORM public.reporter_news_source_update((source->>'id')::uuid,NULL,NULL,NULL,valid);
    RAISE EXCEPTION 'A keyword feed received a publication rating';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM<>'NEWS_SOURCE_RATING_UNSUPPORTED' THEN RAISE; END IF;
  END;
  PERFORM public.reporter_news_source_update((source->>'id')::uuid,NULL,NULL,NULL,'null'::jsonb);
END $$;
SELECT 'PASS source rating validation and aggregator exclusion';

SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000012',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.reporter_news_source_update(current_setting('test.rating_source')::uuid,NULL,NULL,NULL,
      '{"tier":"C","relevance":"low","rationale":"A reader cannot save this."}');
    RAISE EXCEPTION 'A reader rated a source';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.reporter_news_source_update(current_setting('test.rating_source')::uuid,NULL,NULL,NULL,'null'::jsonb);
    RAISE EXCEPTION 'A reader cleared a source rating';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.tenant_id','00000000-0000-0000-0000-000000000002',true);
  PERFORM set_config('app.portal_id','00000000-0000-0000-0000-000000000102',true);
  PERFORM set_config('app.user_id','00000000-0000-0000-0000-000000000021',true);
  BEGIN
    PERFORM public.reporter_news_source_update(current_setting('test.rating_source')::uuid,NULL,NULL,NULL,
      '{"tier":"B","relevance":"medium","rationale":"Another portal cannot save this."}');
    RAISE EXCEPTION 'Another portal rated a source';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  IF EXISTS(SELECT FROM jsonb_array_elements(public.reporter_news_view(NULL,1)->'sources') s
    WHERE s->>'id'=current_setting('test.rating_source')) THEN RAISE EXCEPTION 'Another portal read the source'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF has_function_privilege('reporter_worker','public.reporter_news_source_update(uuid,text,integer,boolean,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Worker can change editorial ratings';
  END IF;
END $$;
SELECT 'PASS source rating permissions and portal isolation';

DO $$ BEGIN
  IF EXISTS(SELECT FROM public.reporter_news_sources WHERE id=current_setting('test.rating_source')::uuid
    AND num_nonnulls(rating_tier,rating_relevance,rating_rationale,rating_updated_at)<>0) THEN
    RAISE EXCEPTION 'Clearing left stored rating fields';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE entity_id=current_setting('test.rating_source')::uuid
    AND action='reporter.news_source.updated' AND user_id='00000000-0000-0000-0000-000000000011'
    AND after_data ? 'rating')<>2 THEN RAISE EXCEPTION 'Rating changes were not audited exactly once'; END IF;
  IF NOT EXISTS(SELECT FROM public.audit_log WHERE entity_id=current_setting('test.rating_source')::uuid
    AND after_data->'rating'='null'::jsonb AND after_data->'previous_rating'->>'tier'='A1') THEN
    RAISE EXCEPTION 'Clearing lost the prior editorial assessment in the audit';
  END IF;
END $$;
SELECT 'PASS source rating persistence and audit';
ROLLBACK;
