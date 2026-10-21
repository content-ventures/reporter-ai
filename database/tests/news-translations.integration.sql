-- Translation copies never overwrite imported material; all fixtures roll back.
\set ON_ERROR_STOP on
BEGIN;
DELETE FROM public.reporter_news_items WHERE portal_id IN ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000102');
UPDATE public.reporter_news_sources SET next_read_at=clock_timestamp()+interval '1 day';
UPDATE core.integration_outbox SET available_at=clock_timestamp()+interval '1 day' WHERE processed_at IS NULL;
UPDATE core.storage_objects SET reference=reference-'remote_url' WHERE status='pending' AND reference ? 'remote_url';
UPDATE public.reporter_ed_runs SET available_at=clock_timestamp()+interval '1 day';
INSERT INTO public.reporter_news_items(id,portal_id,via,guid,url,canonical_url,title,outlet,excerpt,body,published_at,translation_next_at)
  VALUES('10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000101','url','english',
    'https://news.exemplo/english','https://news.exemplo/english','Shrimp production rises 12%','News','Original excerpt.',
    ARRAY['Production rose 12%.','The source reports 200 tonnes.'],clock_timestamp(),clock_timestamp()-interval '2 minutes'),
  ('10000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000101','url','portuguese',
    'https://news.exemplo/portuguese','https://news.exemplo/portuguese','Produção de camarão cresce','Notícias','Trecho original.',
    ARRAY['Texto em português.'],clock_timestamp(),clock_timestamp()-interval '1 minute'),
  ('10000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000101','url','old',
    'https://news.exemplo/old','https://news.exemplo/old','Archived fish news','News','Old excerpt.',
    ARRAY['Old text.'],clock_timestamp()-interval '30 days',clock_timestamp()),
  ('10000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000102','url','other',
    'https://news.exemplo/other','https://news.exemplo/other','Another portal','News','Excerpt.',
    ARRAY['Other text.'],clock_timestamp(),clock_timestamp()-interval '3 minutes');
UPDATE public.reporter_news_items SET imported_at=clock_timestamp()-interval '30 days'
  WHERE id='10000000-0000-4000-8000-000000000003';

SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
DO $$ BEGIN
  IF public.reporter_news_item('10000000-0000-4000-8000-000000000001')->'translation'->>'status'<>'pending'
    OR (public.reporter_news_view(NULL,400)->>'due')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'New material did not queue and wake'; END IF;
  BEGIN PERFORM public.reporter_news_translation_claim('runtime-cannot-claim');
    RAISE EXCEPTION 'Runtime claimed a paid translation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true);
DO $$ DECLARE first_claim jsonb; second_claim jsonb; BEGIN
  IF NOT public.reporter_worker_pending() THEN RAISE EXCEPTION 'Translations did not wake the worker'; END IF;
  first_claim := public.reporter_news_translation_claim('translation-worker-one');
  IF first_claim->>'id'<>'10000000-0000-4000-8000-000000000001' OR first_claim->>'title'<>'Shrimp production rises 12%'
    OR first_claim->'body'<>'["Production rose 12%.","The source reports 200 tonnes."]'::jsonb THEN
    RAISE EXCEPTION 'Claim did not preserve original material or portal scope'; END IF;
  PERFORM set_config('test.translation_old_fence',first_claim->>'fence',true);
  second_claim := public.reporter_news_translation_claim('translation-worker-two');
  IF second_claim->>'id'<>'10000000-0000-4000-8000-000000000002' THEN RAISE EXCEPTION 'A second worker took the leased item'; END IF;
  IF NOT public.reporter_news_translation_finish((second_claim->>'id')::uuid,'translation-worker-two',(second_claim->>'fence')::uuid,
    '{"sourceLanguage":"pt-BR","translated":false,"title":"Produção de camarão cresce","excerpt":"Trecho original.","body":["Texto em português."]}') THEN
    RAISE EXCEPTION 'Portuguese source did not complete without a translation'; END IF;
  IF public.reporter_worker_pending() OR public.reporter_news_translation_claim('translation-worker-two') IS NOT NULL THEN
    RAISE EXCEPTION 'Leased, archived or other-portal material remained claimable'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_news_items SET translation_lease_until=clock_timestamp()-interval '1 second'
  WHERE id='10000000-0000-4000-8000-000000000001';
SELECT set_config('test.translation_before',clock_timestamp()::text,true);
SET SESSION AUTHORIZATION reporter_worker;
DO $$ DECLARE claim jsonb; payload jsonb := '{"sourceLanguage":"en","translated":true,"title":"Produção de camarão cresce 12%",
  "excerpt":"Trecho traduzido.","body":["A produção cresceu 12%.","A fonte informa 200 toneladas."]}'; BEGIN
  claim := public.reporter_news_translation_claim('translation-worker-new');
  IF (claim->>'attempts')::int<>2 OR claim->>'fence'=current_setting('test.translation_old_fence') THEN RAISE EXCEPTION 'Expired lease was not fenced'; END IF;
  IF public.reporter_news_translation_finish((claim->>'id')::uuid,'translation-worker-one',current_setting('test.translation_old_fence')::uuid,payload)
    OR public.reporter_news_translation_fail((claim->>'id')::uuid,'translation-worker-one',current_setting('test.translation_old_fence')::uuid,'STALE',0) THEN
    RAISE EXCEPTION 'A stale worker changed a reclaimed item'; END IF;
  BEGIN PERFORM public.reporter_news_translation_finish((claim->>'id')::uuid,'translation-worker-new',(claim->>'fence')::uuid,
    payload||'{"body":["Only one paragraph"]}');
    RAISE EXCEPTION 'Incomplete translation was accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.reporter_news_translation_finish((claim->>'id')::uuid,'translation-worker-new',(claim->>'fence')::uuid,
    payload||'{"translated":false,"sourceLanguage":"pt-PT"}');
    RAISE EXCEPTION 'European Portuguese was incorrectly treated as Brazilian Portuguese'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF NOT public.reporter_news_translation_finish((claim->>'id')::uuid,'translation-worker-new',(claim->>'fence')::uuid,payload) THEN
    RAISE EXCEPTION 'Current worker could not save the translation'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true);
DO $$ DECLARE item jsonb; listed jsonb; BEGIN
  item := public.reporter_news_item('10000000-0000-4000-8000-000000000001');
  IF item->>'title'<>'Shrimp production rises 12%' OR item->>'excerpt'<>'Original excerpt.'
    OR item->'body'<>'["Production rose 12%.","The source reports 200 tonnes."]'::jsonb
    OR item->'translation'->>'title'<>'Produção de camarão cresce 12%' OR item->'translation'->>'status'<>'translated'
    OR jsonb_array_length(item->'translation'->'body')<>2 OR (item->>'decisionRevision')::int<>0 THEN
    RAISE EXCEPTION 'Translation overwrote original material or an editorial decision'; END IF;
  SELECT i INTO listed FROM jsonb_array_elements(public.reporter_news_view(current_setting('test.translation_before')::timestamptz,400)->'items') i
    WHERE i->>'id'='10000000-0000-4000-8000-000000000001';
  IF listed IS NULL OR listed ? 'body' OR listed->'translation' ? 'body' OR listed->'translation'->>'status'<>'translated' THEN
    RAISE EXCEPTION 'The poll missed completion or included translated bodies'; END IF;
  item := public.reporter_news_item('10000000-0000-4000-8000-000000000002');
  IF item->'translation'->>'status'<>'original' OR item->'translation' ? 'title' OR item->>'title'<>'Produção de camarão cresce' THEN
    RAISE EXCEPTION 'Portuguese original was unnecessarily replaced'; END IF;
  IF public.reporter_news_translation_retry('10000000-0000-4000-8000-000000000001')->'translation'->>'status'<>'translated' THEN
    RAISE EXCEPTION 'Retry invalidated a cached translation'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_news_items SET translation_status='failed',translation_error='OPENAI_KEY_MISSING'
  WHERE id='10000000-0000-4000-8000-000000000003';
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000012',true);
DO $$ BEGIN
  BEGIN PERFORM public.reporter_news_translation_retry('10000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'Reader retried a paid translation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.tenant_id','00000000-0000-0000-0000-000000000002',true);
  PERFORM set_config('app.portal_id','00000000-0000-0000-0000-000000000102',true);
  PERFORM set_config('app.user_id','00000000-0000-0000-0000-000000000021',true);
  BEGIN PERFORM public.reporter_news_translation_retry('10000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'Another portal retried a translation'; EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true);
  PERFORM set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true);
  PERFORM set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
  IF public.reporter_news_translation_retry('10000000-0000-4000-8000-000000000003')->'translation'->>'status'<>'pending' THEN
    RAISE EXCEPTION 'Editor could not retry old requested material'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true);
DO $$ DECLARE claim jsonb; BEGIN
  claim := public.reporter_news_translation_claim('translation-worker-retry');
  IF claim->>'id'<>'10000000-0000-4000-8000-000000000003' OR (claim->>'attempts')::int<>1 THEN RAISE EXCEPTION 'Explicit old retry was not claimable'; END IF;
  PERFORM public.reporter_news_translation_fail((claim->>'id')::uuid,'translation-worker-retry',(claim->>'fence')::uuid,'OPENAI_KEY_MISSING',0);
  IF public.reporter_worker_pending() THEN RAISE EXCEPTION 'Missing provider key kept a retry loop alive'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true);
SELECT public.reporter_news_translation_retry('10000000-0000-4000-8000-000000000003');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true);
DO $$ DECLARE claim jsonb; BEGIN
  claim := public.reporter_news_translation_claim('translation-worker-defer');
  PERFORM public.reporter_news_translation_fail((claim->>'id')::uuid,'translation-worker-defer',(claim->>'fence')::uuid,'OPENAI_RATE_LIMIT',10);
  IF public.reporter_worker_pending() OR public.reporter_news_translation_claim('translation-worker-defer') IS NOT NULL THEN
    RAISE EXCEPTION 'A transient failure did not defer the next request'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_news_items SET translation_next_at=clock_timestamp()-interval '1 second'
  WHERE id='10000000-0000-4000-8000-000000000003';
SET SESSION AUTHORIZATION reporter_worker;
DO $$ DECLARE claim jsonb; BEGIN
  claim := public.reporter_news_translation_claim('translation-worker-defer');
  IF (claim->>'attempts')::int<>2 THEN RAISE EXCEPTION 'Retry attempts did not persist'; END IF;
  PERFORM public.reporter_news_translation_fail((claim->>'id')::uuid,'translation-worker-defer',(claim->>'fence')::uuid,'OPENAI_UNAVAILABLE',5);
END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_news_items SET translation_next_at=clock_timestamp()-interval '1 second'
  WHERE id='10000000-0000-4000-8000-000000000003';
SET SESSION AUTHORIZATION reporter_worker;
DO $$ DECLARE claim jsonb; BEGIN
  claim := public.reporter_news_translation_claim('translation-worker-crash');
  IF (claim->>'attempts')::int<>3 THEN RAISE EXCEPTION 'Third attempt was not counted'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.reporter_news_items SET translation_lease_until=clock_timestamp()-interval '1 second'
  WHERE id='10000000-0000-4000-8000-000000000003';
SET SESSION AUTHORIZATION reporter_worker;
DO $$ BEGIN
  IF NOT public.reporter_worker_pending() THEN RAISE EXCEPTION 'Expired final lease did not wake cleanup'; END IF;
  IF public.reporter_news_translation_claim('translation-worker-final') IS NOT NULL OR public.reporter_worker_pending() THEN
    RAISE EXCEPTION 'Worker attempted more than three translations'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM public.reporter_news_items WHERE id='10000000-0000-4000-8000-000000000003'
    AND translation_status='failed' AND translation_attempts=3 AND translation_error='RETRY_EXHAUSTED' AND title='Archived fish news') THEN
    RAISE EXCEPTION 'Crashed final attempt was not visibly failed'; END IF;
  IF has_function_privilege('reporter_worker','public.reporter_news_translation_retry(uuid)','EXECUTE')
    OR has_function_privilege('reporter_runtime','public.reporter_news_translation_finish(uuid,text,uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Translation grants exceed worker and editor responsibilities'; END IF;
END $$;
-- A retried old item remains in incremental polls until its result arrives.
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true);
SELECT public.reporter_news_translation_retry('10000000-0000-4000-8000-000000000003');
SELECT set_config('test.translation_before',clock_timestamp()::text,true);
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true);
DO $$ DECLARE claim jsonb; BEGIN
  claim := public.reporter_news_translation_claim('translation-worker-archive');
  IF claim->>'id' IS DISTINCT FROM '10000000-0000-4000-8000-000000000003' THEN RAISE EXCEPTION 'Old retry was not claimed'; END IF;
  PERFORM public.reporter_news_translation_finish((claim->>'id')::uuid,'translation-worker-archive',(claim->>'fence')::uuid,
    '{"sourceLanguage":"en","translated":true,"title":"Notícia arquivada sobre peixes","excerpt":"Trecho antigo.","body":["Texto antigo."]}');
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true);
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(public.reporter_news_view(current_setting('test.translation_before')::timestamptz,400)->'items') i
    WHERE i->>'id'='10000000-0000-4000-8000-000000000003' AND i->'translation'->>'status'='translated') THEN
    RAISE EXCEPTION 'An old explicit retry completed but disappeared from the poll'; END IF;
END $$;
RESET SESSION AUTHORIZATION;

-- Opening old pending material prepares a copy once, preserving attempts and existing leases.
INSERT INTO public.reporter_news_items(id,portal_id,via,guid,url,canonical_url,title,outlet,excerpt,body,published_at,imported_at,
  translation_attempts,translation_lease_owner,translation_lease_until,translation_fence)
  VALUES('10000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000101','url','old-opened',
    'https://news.exemplo/old-opened','https://news.exemplo/old-opened','Opened old source','News','Old source.',ARRAY['Old source.'],
    clock_timestamp()-interval '30 days',clock_timestamp()-interval '30 days',1,'existing-translation-owner',
    clock_timestamp()+interval '1 minute','10000000-0000-4000-8000-000000000099');
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000012',true);
SELECT public.reporter_news_item('10000000-0000-4000-8000-000000000005');
SELECT public.reporter_news_item('10000000-0000-4000-8000-000000000005');
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM public.reporter_news_items WHERE id='10000000-0000-4000-8000-000000000005'
    AND translation_requested_at IS NOT NULL AND translation_attempts=1 AND translation_lease_owner='existing-translation-owner'
    AND translation_fence='10000000-0000-4000-8000-000000000099' AND translation_status='pending') THEN
    RAISE EXCEPTION 'Reading an old pending item failed to prepare it or reset its live lease'; END IF;
END $$;
UPDATE public.reporter_news_items SET translation_lease_until=clock_timestamp()-interval '1 second'
  WHERE id='10000000-0000-4000-8000-000000000005';
SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true);
DO $$ DECLARE claim jsonb; BEGIN
  claim := public.reporter_news_translation_claim('translation-worker-opened');
  IF claim->>'id' IS DISTINCT FROM '10000000-0000-4000-8000-000000000005' OR (claim->>'attempts')::int<>2 THEN
    RAISE EXCEPTION 'An old item requested by reading was not claimable'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
\echo PASS translations preserve original material and editorial decisions
\echo PASS Portuguese originals finish without a duplicate translated copy
\echo PASS translation claims are leased, fenced and scoped to the portal
\echo PASS translation retries defer, stop on missing keys and allow at most three attempts
\echo PASS only editors retry translations and other portals cannot access them
\echo PASS active backfill wakes workers and completion reaches polls without full bodies
