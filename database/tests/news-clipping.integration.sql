-- Exercise clipping through the authenticated import API; all fixture changes roll back.
\set ON_ERROR_STOP on
BEGIN;
UPDATE public.portals SET name='Seafood Brasil' WHERE id='00000000-0000-0000-0000-000000000101';
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
  id uuid; result jsonb; outlet jsonb;
BEGIN
  IF (public.reporter_news_search_view()->>'clipping') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Seafood policy not active'; END IF;
  result := public.reporter_news_search_save(0,'{"portalUrl":"https://seafoodbrasil.com.br","sector":"Pesca",
    "region":"Brasil","topics":["Pesca"],"languages":["pt"],"excludedDomains":[],"everyMinutes":60,
    "dailyLimit":36,"enabled":true,"windowHours":48}',ARRAY['seafoodbrasil.com.br']);
  IF result#>>'{config,windowHours}' IS DISTINCT FROM '48' THEN RAISE EXCEPTION 'Window was not persisted'; END IF;
  BEGIN
    PERFORM public.reporter_news_import(entry);
    RAISE EXCEPTION 'Missing segment was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  entry := entry || '{"clippingSegment":"institutional"}';
  id := (public.reporter_news_import(entry)->>'id')::uuid;
  BEGIN
    PERFORM public.reporter_news_import(entry || '{"url":"https://sub.seafoodbrasil.com.br/block","canonicalUrl":"https://sub.seafoodbrasil.com.br/block"}');
    RAISE EXCEPTION 'Blocked domain was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  result := public.reporter_news_import(entry || '{"url":"https://www.gov.br/mpa/official","canonicalUrl":"https://www.gov.br/mpa/official",
    "outlet":"MPA","contentKind":"article","storyKey":"atualiza atum cotas ministerio nacional pesca regra setor"}');
  IF result->>'outcome' IS DISTINCT FROM 'grouped' OR (result->>'id')::uuid IS DISTINCT FROM id
    THEN RAISE EXCEPTION 'Similar coverage did not retain the story identity'; END IF;
  result := public.reporter_news_item(id);
  IF result->>'clippingSegment' IS DISTINCT FROM 'institutional' OR result->>'contentKind' IS DISTINCT FROM 'search'
    OR coalesce((result#>>'{duplicates,0,quality}')::int,0) <= (result->>'sourceQuality')::int
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
RESET SESSION AUTHORIZATION;
SELECT 'PASS Seafood clipping segment, global exclusion, window, similarity and official source';
ROLLBACK;
