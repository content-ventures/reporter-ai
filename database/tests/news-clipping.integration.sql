-- Exercise clipping through the authenticated import API; all fixture changes roll back.
\set ON_ERROR_STOP on
BEGIN;
UPDATE public.portals SET name='Seafood Brasil' WHERE id='00000000-0000-0000-0000-000000000101';
INSERT INTO public.reporter_news_items(id,portal_id,via,guid,url,canonical_url,title,outlet,story_key,published_at,imported_at,updated_at)
  SELECT fixture.id,'00000000-0000-0000-0000-000000000101','rss',fixture.slug,
    'https://older.example/'||fixture.slug,'https://older.example/'||fixture.slug,'Regra de pesca do atum','Older',fixture.story,
    now()-fixture.age,now()-fixture.age,now()-fixture.age
  FROM (VALUES ('10000000-0000-4000-8000-000000000901'::uuid,'archived','atum nova pesca regra',interval '20 days'),
    ('10000000-0000-4000-8000-000000000902','blocked','atum outra pesca regra',interval '1 day'),
    ('10000000-0000-4000-8000-000000000903','legacy','atualiza atum cotas ministerio nacional pesca regra',interval '1 hour')) fixture(id,slug,story,age);
-- Simulate a record persisted before the global exclusion was introduced.
UPDATE public.reporter_news_items SET url='https://seafoodbrasil.com.br/legacy',canonical_url='https://seafoodbrasil.com.br/legacy'
  WHERE id='10000000-0000-4000-8000-000000000902';
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);

DO $$
DECLARE entry jsonb := jsonb_build_object('guid','clipping-test','url','https://publisher.example/clipping',
  'canonicalUrl','https://publisher.example/clipping','title','Ministério atualiza cotas para pesca do atum',
  'outlet','Publisher','body',jsonb_build_array('Resumo.'),'publishedAt',now(),
  'storyKey','atualiza atum cotas ministerio nacional pesca regra','contentKind','search');
  id uuid; result jsonb; outlet jsonb; source_id uuid; previous_config jsonb;
  archived constant uuid := '10000000-0000-4000-8000-000000000901';
  blocked constant uuid := '10000000-0000-4000-8000-000000000902';
  legacy constant uuid := '10000000-0000-4000-8000-000000000903';
BEGIN
  IF (public.reporter_news_search_view()->>'clipping') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Seafood policy not active'; END IF;
  result := public.reporter_news_search_save(0,'{"portalUrl":"https://seafoodbrasil.com.br","sector":"Pesca",
    "region":"Brasil","topics":["Pesca"],"languages":["pt"],"excludedDomains":[],"everyMinutes":60,
    "dailyLimit":36,"enabled":true,"windowHours":48}',ARRAY['seafoodbrasil.com.br']);
  IF result#>>'{config,windowHours}' IS DISTINCT FROM '48' THEN RAISE EXCEPTION 'Window was not persisted'; END IF;
  previous_config := result->'config';
  IF public.reporter_news_view(NULL,100)->'items' @> jsonb_build_array(jsonb_build_object('id',archived)) THEN
    RAISE EXCEPTION 'Normal Radar poll loaded the archive'; END IF;
  result := public.reporter_news_page(NULL,NULL,NULL,NULL,100,720);
  IF NOT result->'items' @> jsonb_build_array(jsonb_build_object('id',archived)) THEN
    RAISE EXCEPTION 'Wider Radar window omitted an archived story'; END IF;
  IF result->'items' @> jsonb_build_array(jsonb_build_object('id',blocked)) OR public.reporter_news_item(blocked) IS NOT NULL
    OR public.reporter_news_lookup('https://seafoodbrasil.com.br/legacy') IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy excluded source was returned'; END IF;
  source_id := (public.reporter_news_source_add('rss','Archive Feed','https://feed.example/rss','https://feed.example/rss',60,NULL,NULL,NULL)->>'id')::uuid;
  PERFORM public.reporter_news_claim('clipping-read-first',source_id);
  PERFORM public.reporter_news_ingest(source_id,'clipping-read-first','[]','v1','Tue, 10 Nov 2026 10:00:00 GMT');
  result := public.reporter_news_claim('clipping-read-old',source_id);
  IF result->>'etag' IS DISTINCT FROM 'v1' THEN RAISE EXCEPTION 'Feed validators were not retained'; END IF;
  PERFORM public.reporter_news_search_save(1,previous_config||'{"windowHours":720}',ARRAY['seafoodbrasil.com.br']);
  BEGIN
    PERFORM public.reporter_news_ingest(source_id,'clipping-read-old','[]','v1',NULL);
    RAISE EXCEPTION 'A stale read could restore the validators';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  result := public.reporter_news_claim('clipping-read-new',source_id);
  IF result->>'windowHours' IS DISTINCT FROM '720' OR result ? 'etag' OR result ? 'lastModified' THEN
    RAISE EXCEPTION 'The wider feed window reused an older cached read'; END IF;
  BEGIN
    PERFORM public.reporter_news_import(entry);
    RAISE EXCEPTION 'Missing segment was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  entry := entry || '{"clippingSegment":"institutional"}';
  result := public.reporter_news_import(entry);
  id := (result->>'id')::uuid;
  IF id IS DISTINCT FROM legacy OR result->>'outcome' IS DISTINCT FROM 'grouped'
    OR public.reporter_news_item(id)->>'clippingSegment' IS DISTINCT FROM 'institutional' THEN
    RAISE EXCEPTION 'A newly grouped source did not classify the existing story'; END IF;
  BEGIN
    PERFORM public.reporter_news_import(entry || '{"url":"https://sub.seafoodbrasil.com.br/block","canonicalUrl":"https://sub.seafoodbrasil.com.br/block"}');
    RAISE EXCEPTION 'Blocked domain was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  result := public.reporter_news_import(entry || '{"url":"https://www.gov.br/mpa/official","canonicalUrl":"https://www.gov.br/mpa/official",
    "outlet":"MPA","contentKind":"article","storyKey":"atualiza atum cotas ministerio nacional pesca regra setor"}');
  IF result->>'outcome' IS DISTINCT FROM 'grouped' OR (result->>'id')::uuid IS DISTINCT FROM id
    THEN RAISE EXCEPTION 'Similar coverage did not retain the story identity'; END IF;
  result := public.reporter_news_item(id);
  IF result->>'clippingSegment' IS DISTINCT FROM 'institutional' OR result->>'contentKind' IS DISTINCT FROM 'feed'
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(result->'duplicates') source
      WHERE source->>'source'='MPA' AND (source->>'quality')::int>(result->>'sourceQuality')::int)
    THEN RAISE EXCEPTION 'Segment, partial text label or preferred official reference was lost'; END IF;
  result := public.reporter_news_import(entry || '{"url":"https://another.example/different-year","canonicalUrl":"https://another.example/different-year",
    "outlet":"Another","storyKey":"2027 atualiza atum cotas ministerio nacional pesca regra"}');
  IF result->>'outcome' IS DISTINCT FROM 'inserted' OR (result->>'id')::uuid IS NOT DISTINCT FROM id
    THEN RAISE EXCEPTION 'The similarity check grouped a distinct numeric development'; END IF;

  entry := entry || '{"guid":"fish-focus-opening","url":"https://fishfocus.co.uk/shetland-msp-opens-scotlands-biggest-salmon-farm/",
    "canonicalUrl":"https://fishfocus.co.uk/shetland-msp-opens-scotlands-biggest-salmon-farm/","outlet":"Fish Focus",
    "title":"Shetland MSP opens Scotland’s biggest salmon farm","storyKey":"biggest farm msp opens salmon scotland shetland",
    "clippingSegment":"aquaculture"}';
  id := (public.reporter_news_import(entry)->>'id')::uuid;
  FOR outlet IN SELECT value FROM jsonb_array_elements('[
    {"outlet":"Shetland News","url":"https://www.shetnews.co.uk/2026/11/09/scottish-sea-farms-opens-scotlands/",
      "title":"Scotland’s largest salmon farm opens in Shetland","storyKey":"farm largest opens salmon scotland shetland"},
    {"outlet":"SalmonBusiness","url":"https://www.salmonbusiness.com/scottish-sea-farms-opens-uks-largest-salmon-farm-in-shetland/",
      "title":"Scottish Sea Farms: opens UK’s largest salmon farm in Shetland","storyKey":"farm farms largest opens salmon scottish sea shetland"}
  ]') LOOP
    result := public.reporter_news_import(entry || outlet || jsonb_build_object('canonicalUrl',outlet->>'url'));
    IF result->>'outcome' IS DISTINCT FROM 'grouped' OR (result->>'id')::uuid IS DISTINCT FROM id
      THEN RAISE EXCEPTION 'The Shetland opening did not group across outlets'; END IF;
  END LOOP;
  result := public.reporter_news_import(entry || '{"url":"https://another.example/orkney-opening","canonicalUrl":"https://another.example/orkney-opening",
    "outlet":"Another","title":"Scotland’s largest salmon farm opens in Orkney","storyKey":"farm largest opens orkney salmon scotland"}');
  IF result->>'outcome' IS DISTINCT FROM 'inserted' OR (result->>'id')::uuid IS NOT DISTINCT FROM id
    THEN RAISE EXCEPTION 'The similarity check grouped separate farm openings'; END IF;
END $$;

DO $$
DECLARE slot integer; address text;
BEGIN
  FOR slot IN (jsonb_array_length(public.reporter_news_view(NULL,1)->'sources')+1)..50 LOOP
    address := 'https://capacity.example/seafood/'||slot;
    PERFORM public.reporter_news_source_add('rss','Fixture source',address,address,60,NULL,NULL,NULL);
  END LOOP;
  BEGIN
    PERFORM public.reporter_news_source_add('rss','Extra source','https://capacity.example/extra','https://capacity.example/extra',60,NULL,NULL,NULL);
    RAISE EXCEPTION 'The clipping workspace exceeded its 50-source limit';
  EXCEPTION WHEN program_limit_exceeded THEN
    IF SQLERRM <> 'NEWS_CLIPPING_SOURCE_LIMIT' THEN RAISE; END IF;
  END;

  PERFORM set_config('app.tenant_id','00000000-0000-0000-0000-000000000002',true);
  PERFORM set_config('app.portal_id','00000000-0000-0000-0000-000000000102',true);
  PERFORM set_config('app.user_id','00000000-0000-0000-0000-000000000021',true);
  FOR slot IN (jsonb_array_length(public.reporter_news_view(NULL,1)->'sources')+1)..30 LOOP
    address := 'https://capacity.example/other/'||slot;
    PERFORM public.reporter_news_source_add('rss','Fixture source',address,address,60,NULL,NULL,NULL);
  END LOOP;
  BEGIN
    PERFORM public.reporter_news_source_add('rss','Extra source','https://capacity.example/extra','https://capacity.example/extra',60,NULL,NULL,NULL);
    RAISE EXCEPTION 'The standard workspace exceeded its 30-source limit';
  EXCEPTION WHEN program_limit_exceeded THEN
    IF SQLERRM <> 'NEWS_SOURCE_LIMIT' THEN RAISE; END IF;
  END;
END $$;
RESET SESSION AUTHORIZATION;
SELECT 'PASS Seafood clipping segment, global exclusion, window, similarity and official source';
SELECT 'PASS Seafood clipping supports 50 feeds while standard workspaces retain 30';
ROLLBACK;
