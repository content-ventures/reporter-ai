-- All fixtures roll back; exercise actual roles, fencing, budget and shared ingestion.
\set ON_ERROR_STOP on
BEGIN;
DELETE FROM public.reporter_news_search WHERE portal_id IN ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000102');
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
DO $$ DECLARE config jsonb := '{"portalUrl":"https://client.example","sector":"aquicultura","region":"Brasil", "topics":["tilapia"],
  "languages":["pt","en"],"excludedDomains":[],"everyMinutes":60,"dailyLimit":2,"enabled":true}'; result jsonb;
BEGIN
  PERFORM set_config('test.search_config',config::text,true);
  result := public.reporter_news_search_save(0,config,ARRAY['client.example','redirect.example']);
  IF result->>'revision'<>'1' OR result->>'state'<>'queued' OR result->>'usedToday'<>'0' THEN RAISE EXCEPTION 'Search was not queued'; END IF;
  BEGIN
    PERFORM public.reporter_news_search_save(0,config,ARRAY['client.example']);
    RAISE EXCEPTION 'Stale settings were accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  PERFORM public.reporter_news_search_request();
  PERFORM set_config('app.user_id','00000000-0000-0000-0000-000000000012',true);
  IF public.reporter_news_search_view()->>'revision'<>'1' THEN RAISE EXCEPTION 'Reader could not see settings'; END IF;
  BEGIN PERFORM public.reporter_news_search_request(); RAISE EXCEPTION 'Reader started a paid search'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.reporter_news_search_save(1,config,ARRAY['client.example']); RAISE EXCEPTION 'Reader changed settings'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
  result := public.reporter_news_import(jsonb_build_object('guid','search-rss-summary','url','https://publisher.example/search-upgrade',
    'canonicalUrl','https://publisher.example/search-upgrade','title','Aquaculture production update','outlet','Publisher',
    'excerpt','Short summary.','body',jsonb_build_array('Short summary.'),'publishedAt',clock_timestamp()));
  PERFORM set_config('test.search_item',result->>'id',true);
END $$;
RESET SESSION AUTHORIZATION;
-- Model a summary already ingested from an RSS feed, with an older translation in flight.
UPDATE public.reporter_news_items SET via='rss',translation_status='pending',translation_lease_owner='old-translator',
  translation_lease_until=clock_timestamp()+interval '2 minutes',translation_fence='10000000-0000-4000-8000-000000000009'
  WHERE id=current_setting('test.search_item')::uuid;
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true);
DO $$ DECLARE claim jsonb; items jsonb; result boolean; BEGIN
  claim := public.reporter_news_search_claim('search-worker-one');
  IF claim IS NULL OR claim->>'queryIndex'<>'0' THEN RAISE EXCEPTION 'Search not claimable'; END IF;
  PERFORM set_config('test.search_fence',claim->>'fence',true);
  IF public.reporter_news_search_claim('search-worker-two') IS NOT NULL THEN RAISE EXCEPTION 'Concurrent search acquired same lease'; END IF;
  items := jsonb_build_array(
    jsonb_build_object('guid','new-search-story','url','https://publisher.example/new-search-story','canonicalUrl','https://publisher.example/new-search-story',
      'title','Shrimp exports change in October','outlet','Publisher','excerpt','Reported increase.',
      'body',jsonb_build_array('Reported increase.'),'publishedAt',clock_timestamp(),'contentKind','search'),
    jsonb_build_object('guid','upgrade','url','https://publisher.example/search-upgrade','canonicalUrl','https://publisher.example/search-upgrade',
      'title','Aquaculture production update','outlet','Publisher','excerpt','Full page lead.',
      'body',jsonb_build_array('Full page lead.','Longer factual material extracted from the page.'),'publishedAt',clock_timestamp(),'contentKind','article'),
    jsonb_build_object('guid','client','url','https://sub.client.example/self','canonicalUrl','https://sub.client.example/self',
      'title','Client material must stay outside intake','outlet','Client','body',jsonb_build_array('Client content.'),'publishedAt',clock_timestamp()));
  PERFORM set_config('test.search_items',items::text,true);
  IF public.reporter_news_search_finish('search-worker-two',(claim->>'fence')::uuid,items,'tilapia') THEN RAISE EXCEPTION 'Wrong owner committed'; END IF;
  result := public.reporter_news_search_finish('search-worker-one',(claim->>'fence')::uuid,items,'tilapia');
  IF NOT result THEN RAISE EXCEPTION 'Valid collection failed'; END IF;
  IF public.reporter_news_search_finish('search-worker-one',(claim->>'fence')::uuid,items,'tilapia') THEN RAISE EXCEPTION 'Repeated completion committed'; END IF;
  IF public.reporter_news_translation_finish(current_setting('test.search_item')::uuid,'old-translator','10000000-0000-4000-8000-000000000009',
    '{"sourceLanguage":"en","translated":true,"title":"Texto antigo","excerpt":"Antigo","body":["Antigo"]}') THEN RAISE EXCEPTION 'Stale translation replaced enriched body'; END IF;
  claim := public.reporter_news_search_claim('search-worker-two');
  IF claim->>'queryIndex'<>'1' THEN RAISE EXCEPTION 'Query rotation skipped a language'; END IF;
  PERFORM public.reporter_news_search_finish('search-worker-two',(claim->>'fence')::uuid,items,'tilapia news');
  IF public.reporter_news_search_claim('search-worker-three') IS NOT NULL THEN RAISE EXCEPTION 'Budget allowed third request'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.reporter_news_items WHERE portal_id='00000000-0000-0000-0000-000000000101' AND url='https://publisher.example/new-search-story')<>1
    OR EXISTS(SELECT FROM public.reporter_news_items WHERE url='https://sub.client.example/self') THEN RAISE EXCEPTION 'Deduplication or exclusion failed'; END IF;
  IF NOT EXISTS(SELECT FROM public.reporter_news_items WHERE id=current_setting('test.search_item')::uuid AND search_content_kind='article'
    AND content_revision=1 AND cardinality(body)=2 AND translation_status='pending' AND translation_fence IS NULL) THEN RAISE EXCEPTION 'Summary was not enriched safely'; END IF;
END $$;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true);
DO $$ DECLARE view jsonb; BEGIN
  view := public.reporter_news_search_view();
  IF view->>'state'<>'limited' OR view->>'usedToday'<>'2' THEN RAISE EXCEPTION 'Budget not persisted'; END IF;
  BEGIN PERFORM public.reporter_news_search_request(); RAISE EXCEPTION 'Manual request bypassed budget'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  view := public.reporter_news_search_save(1,current_setting('test.search_config')::jsonb,ARRAY['client.example','redirect.example']);
  IF view->>'usedToday'<>'2' THEN RAISE EXCEPTION 'Saving settings reset the daily budget'; END IF;
  PERFORM set_config('app.tenant_id','00000000-0000-0000-0000-000000000002',true);
  PERFORM set_config('app.portal_id','00000000-0000-0000-0000-000000000102',true);
  PERFORM set_config('app.user_id','00000000-0000-0000-0000-000000000021',true);
  IF public.reporter_news_search_view()->>'revision'<>'0' THEN RAISE EXCEPTION 'Settings leaked across portals'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF has_table_privilege('reporter_runtime','public.reporter_news_search','SELECT')
    OR has_function_privilege('reporter_runtime','public.reporter_news_search_claim(text)','EXECUTE')
    OR has_function_privilege('reporter_worker','public.reporter_news_search_save(integer,jsonb,text[])','EXECUTE') THEN RAISE EXCEPTION 'Search grants are too broad'; END IF;
END $$;
SELECT 'PASS news search permissions, budget, fencing, deduplication, enrichment and portal isolation';
ROLLBACK;
