-- Durable news decisions, stale editors, cross-portal access and server-owned postponement expiry.
\set ON_ERROR_STOP on
BEGIN;
DELETE FROM public.reporter_news_items WHERE portal_id IN ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000102');
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
DO $$
DECLARE imported jsonb; item jsonb; first_id uuid; second_id uuid;
  entry jsonb := '{"guid":"decision-one","url":"https://portal.exemplo/decision-one","canonicalUrl":"https://portal.exemplo/decision-one",
    "title":"Material para uma notícia futura","outlet":"Portal","excerpt":"Trecho recebido.",
    "body":["O texto recebido continua integralmente disponível.","Uma segunda informação com sua origem."],
    "publishedAt":"2026-10-21T12:00:00Z"}';
BEGIN
  imported := public.reporter_news_import(entry);
  first_id := (imported->>'id')::uuid;
  PERFORM set_config('test.news_selected',first_id::text,true);
  item := public.reporter_news_decide(first_id,0,'select');
  IF item->>'status'<>'selected' OR (item->>'decisionRevision')::int<>1 OR item->>'decidedBy' IS NULL
    OR item->>'decidedAt' IS NULL OR item->'body'<>entry->'body' THEN
    RAISE EXCEPTION 'Selection lost its revision, author or source text: %',item;
  END IF;
  -- Another editor acts from the prior revision: no decision may be overwritten silently.
  BEGIN
    PERFORM public.reporter_news_decide(first_id,0,'discard',NULL,'Uma decisão antiga');
    RAISE EXCEPTION 'Stale decision was accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  item := public.reporter_news_item(first_id);
  IF item->>'status'<>'selected' OR (item->>'decisionRevision')::int<>1 THEN RAISE EXCEPTION 'Stale decision changed the item'; END IF;
  item := public.reporter_news_decide(first_id,1,'postpone',2);
  IF item->>'status'<>'later' OR (item->>'decisionRevision')::int<>2
    OR (item->>'laterUntil')::timestamptz<clock_timestamp()+interval '119 minutes' THEN
    RAISE EXCEPTION 'Postponement was not saved: %',item;
  END IF;
  item := public.reporter_news_decide(first_id,2,'discard',NULL,'  Fora do foco desta pauta  ');
  IF item->>'status'<>'discarded' OR item->>'discardReason'<>'Fora do foco desta pauta'
    OR item ? 'laterUntil' THEN RAISE EXCEPTION 'Discard reason or previous postponement is wrong: %',item; END IF;
  item := public.reporter_news_decide(first_id,3,'restore');
  IF item->>'status'<>'new' OR (item->>'decisionRevision')::int<>4 OR item ? 'discardReason'
    OR item ? 'decidedBy' OR item ? 'decidedAt' OR item->>'returnedAt' IS NULL THEN
    RAISE EXCEPTION 'Restore did not reset the current decision: %',item;
  END IF;
  BEGIN
    PERFORM public.reporter_news_decide(first_id,4,'discard',NULL,'  ');
    RAISE EXCEPTION 'Empty reason accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.reporter_news_decide(first_id,4,'postpone',721);
    RAISE EXCEPTION 'Unbounded postponement accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.reporter_news_decide(first_id,4,'select',1);
    RAISE EXCEPTION 'Extra decision arguments accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.reporter_news_decide('00000000-0000-0000-0000-000000000099',0,'select');
    RAISE EXCEPTION 'Missing news item accepted';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM public.reporter_news_decide(first_id,4,'select');

  imported := public.reporter_news_import(entry||'{"guid":"decision-two","url":"https://portal.exemplo/decision-two","canonicalUrl":"https://portal.exemplo/decision-two"}');
  second_id := (imported->>'id')::uuid;
  PERFORM set_config('test.news_later',second_id::text,true);
  PERFORM public.reporter_news_decide(second_id,0,'postpone',72);
  imported := public.reporter_news_import(entry||'{"guid":"decision-three","url":"https://portal.exemplo/decision-three","canonicalUrl":"https://portal.exemplo/decision-three"}');
  PERFORM set_config('test.news_old',(imported->>'id'),true);
END $$;
RESET SESSION AUTHORIZATION;

-- Import age alone must not hide material selected for future writing or still postponed.
UPDATE public.reporter_news_items SET imported_at=clock_timestamp()-interval '30 days',
  decided_at=CASE WHEN decided_at IS NOT NULL THEN clock_timestamp()-interval '8 days' END,
  updated_at=clock_timestamp()-interval '8 days',returned_at=NULL
  WHERE portal_id='00000000-0000-0000-0000-000000000101';
SET SESSION AUTHORIZATION reporter_runtime;
DO $$
DECLARE view jsonb;
BEGIN
  view := public.reporter_news_view(NULL,400);
  IF jsonb_array_length(view->'items')<>2
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(view->'items') i WHERE i->>'id'=current_setting('test.news_selected') AND i->>'status'='selected')
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(view->'items') i WHERE i->>'id'=current_setting('test.news_later') AND i->>'status'='later') THEN
    RAISE EXCEPTION 'Retained material disappeared outside the import window: %',view;
  END IF;
  IF jsonb_array_length(public.reporter_news_item(current_setting('test.news_selected')::uuid)->'body')<>2 THEN
    RAISE EXCEPTION 'Selected material no longer has its body';
  END IF;
END $$;
RESET SESSION AUTHORIZATION;

-- Clock expiry is a single automatic transition, also when a reviewer is the next reader.
UPDATE public.reporter_news_items SET later_until=clock_timestamp()-interval '1 second'
  WHERE id=current_setting('test.news_later')::uuid;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000012',true);
DO $$
DECLARE item jsonb; view jsonb;
BEGIN
  item := public.reporter_news_item(current_setting('test.news_later')::uuid);
  IF item->>'status'<>'new' OR (item->>'decisionRevision')::int<>2 OR item ? 'decidedBy'
    OR item ? 'decidedAt' OR item ? 'laterUntil' OR item->>'returnedAt' IS NULL THEN
    RAISE EXCEPTION 'A due postponement was not returned by the server: %',item;
  END IF;
  view := public.reporter_news_view(clock_timestamp()-interval '1 minute',400);
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(view->'items') i WHERE i->>'id'=current_setting('test.news_later') AND i->>'status'='new') THEN
    RAISE EXCEPTION 'The incremental view omitted returned old material';
  END IF;
  IF (public.reporter_news_item(current_setting('test.news_later')::uuid)->>'decisionRevision')::int<>2 THEN
    RAISE EXCEPTION 'Repeating a read repeated the automatic return';
  END IF;
  BEGIN
    PERFORM public.reporter_news_decide(current_setting('test.news_selected')::uuid,5,'discard',NULL,'Leitor sem escrita');
    RAISE EXCEPTION 'Reviewer changed a news decision';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.tenant_id','00000000-0000-0000-0000-000000000002',true);
  PERFORM set_config('app.portal_id','00000000-0000-0000-0000-000000000102',true);
  PERFORM set_config('app.user_id','00000000-0000-0000-0000-000000000021',true);
  IF public.reporter_news_item(current_setting('test.news_selected')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'Another portal read selected material'; END IF;
  BEGIN
    PERFORM public.reporter_news_decide(current_setting('test.news_selected')::uuid,5,'select');
    RAISE EXCEPTION 'Another portal changed selected material';
  EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.audit_log WHERE entity_id=current_setting('test.news_selected')::uuid
      AND action='reporter.news.decided' AND user_id='00000000-0000-0000-0000-000000000011')<>5 THEN
    RAISE EXCEPTION 'Human decisions do not have exactly one attributed audit each';
  END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE entity_id=current_setting('test.news_later')::uuid
      AND action='reporter.news.returned' AND user_id IS NULL AND after_data->>'automatic'='true')<>1 THEN
    RAISE EXCEPTION 'Automatic return lacks one system audit';
  END IF;
  IF has_function_privilege('reporter_worker','public.reporter_news_decide(uuid,integer,text,integer,text)','EXECUTE')
    OR has_function_privilege('reporter_worker','public.reporter_news_page(timestamptz,timestamptz,uuid,timestamptz,integer)','EXECUTE')
    OR has_function_privilege('reporter_runtime','core.reporter_news_return_due(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Decision or expiry helper grants are too broad';
  END IF;
END $$;

-- Multiple full pages, with the exact same microsecond timestamp, must not hide older selections
-- or lose a backlog of changes. A record arriving during pagination belongs to the following poll.
SELECT set_config('test.news_bulk_at',(date_trunc('second',clock_timestamp())-interval '5 minutes'+interval '0.123456 seconds')::text,true);
INSERT INTO public.reporter_news_items(portal_id,via,guid,url,canonical_url,title,outlet,excerpt,body,published_at,imported_at,updated_at)
  SELECT '00000000-0000-0000-0000-000000000101','url','page-'||n,
    'https://portal.exemplo/page-'||n,'https://portal.exemplo/page-'||n,'Notícia da página '||n,'Portal','Trecho.','{Texto.}',
    current_setting('test.news_bulk_at')::timestamptz,current_setting('test.news_bulk_at')::timestamptz,current_setting('test.news_bulk_at')::timestamptz
  FROM generate_series(1,805) n;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
DO $$
DECLARE page jsonb; cursor jsonb; snapshot_at timestamptz; since_at timestamptz; arriving_id text;
  seen text[]; pages integer; mode integer;
BEGIN
  FOR mode IN 1..2 LOOP
    cursor := NULL; seen := '{}'; pages := 0;
    since_at := CASE WHEN mode=2 THEN current_setting('test.news_bulk_at')::timestamptz-interval '1 second' END;
    LOOP
      page := public.reporter_news_page(since_at,(cursor->>'updatedAt')::timestamptz,
        (cursor->>'id')::uuid,(cursor->>'until')::timestamptz,400);
      pages := pages+1;
      IF pages>3 OR jsonb_array_length(page->'items')>400 THEN RAISE EXCEPTION 'Pagination did not remain bounded'; END IF;
      IF pages=1 THEN
        snapshot_at := (page->>'at')::timestamptz;
        IF mode=1 THEN
          arriving_id := public.reporter_news_import(jsonb_build_object('guid','arriving-during-page',
            'url','https://portal.exemplo/arriving-during-page','canonicalUrl','https://portal.exemplo/arriving-during-page',
            'title','Chegou durante a paginação','outlet','Portal','excerpt','Trecho.','body',jsonb_build_array('Texto.'),
            'publishedAt',clock_timestamp()))->>'id';
        END IF;
      END IF;
      IF (page->>'at')::timestamptz<>snapshot_at THEN RAISE EXCEPTION 'A continuation changed the poll snapshot'; END IF;
      seen := seen||ARRAY(SELECT i->>'id' FROM jsonb_array_elements(page->'items') i);
      cursor := page->'next';
      IF cursor IS NULL THEN EXIT; END IF;
      IF (cursor->>'updatedAt')::timestamptz<>current_setting('test.news_bulk_at')::timestamptz THEN
        RAISE EXCEPTION 'The cursor lost the exact microsecond timestamp: %',cursor;
      END IF;
    END LOOP;
    IF pages<>3 OR cardinality(seen)<>807 OR (SELECT count(DISTINCT id) FROM unnest(seen) id)<>807 THEN
      RAISE EXCEPTION 'A full or incremental poll skipped/repeated records: mode %, pages %, records %',mode,pages,cardinality(seen);
    END IF;
    IF mode=1 AND (NOT current_setting('test.news_selected')=ANY(seen) OR arriving_id=ANY(seen)) THEN
      RAISE EXCEPTION 'Initial pagination lost retained material or included a later arrival';
    END IF;
    IF mode=2 AND (current_setting('test.news_selected')=ANY(seen) OR NOT arriving_id=ANY(seen)) THEN
      RAISE EXCEPTION 'Incremental pagination omitted a later arrival or ignored since';
    END IF;
  END LOOP;
  BEGIN
    PERFORM public.reporter_news_page(NULL,clock_timestamp(),NULL,NULL,400);
    RAISE EXCEPTION 'An incomplete page cursor was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
\echo PASS news decisions preserve source material, author and revision
\echo PASS stale and invalid decisions cannot overwrite the current choice
\echo PASS selected and postponed material survives the import window
\echo PASS postponements return once on the server with an automatic audit
\echo PASS news decisions enforce writer permissions and portal isolation
\echo PASS full and incremental news pagination retains every item across equal timestamps
