-- Image URLs accompany the existing source material; all fixtures roll back.
\set ON_ERROR_STOP on
BEGIN;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
DO $$
DECLARE payload jsonb; placed jsonb; item jsonb; listed jsonb; cursor_at timestamptz := clock_timestamp();
BEGIN
  payload := jsonb_build_object('guid','news-image','url','https://news-images.exemplo/photo',
    'canonicalUrl','https://news-images.exemplo/photo','title','Original fish news','outlet','Image publisher',
    'excerpt','Original lead.','body',jsonb_build_array('Original paragraph.'),'publishedAt',clock_timestamp(),
    'image','https://news-images.exemplo/original.jpg');
  placed := public.reporter_news_import(payload);
  PERFORM set_config('test.news_image_id',placed->>'id',true);
  item := public.reporter_news_item((placed->>'id')::uuid);
  SELECT value INTO listed FROM jsonb_array_elements(public.reporter_news_view(cursor_at,400)->'items')
    WHERE value->>'id'=placed->>'id';
  IF item->>'imageUrl' IS DISTINCT FROM payload->>'image' OR listed->>'imageUrl' IS DISTINCT FROM item->>'imageUrl'
    OR item->'body' IS DISTINCT FROM payload->'body' OR listed ? 'body' OR listed->>'paragraphs'<>'1'
    OR item->'translation'->>'status'<>'pending' THEN RAISE EXCEPTION 'News image or body projection failed'; END IF;
  placed := public.reporter_news_import((payload-'image')||jsonb_build_object('guid','news-no-image',
    'url','https://news-images.exemplo/no-photo','canonicalUrl','https://news-images.exemplo/no-photo'));
  item := public.reporter_news_item((placed->>'id')::uuid);
  SELECT value INTO listed FROM jsonb_array_elements(public.reporter_news_view(cursor_at,400)->'items')
    WHERE value->>'id'=placed->>'id';
  IF item ? 'imageUrl' OR listed ? 'imageUrl' THEN RAISE EXCEPTION 'Missing image was not omitted'; END IF;
  PERFORM public.reporter_news_decide(current_setting('test.news_image_id')::uuid,0,'select',NULL,NULL);
END $$;
SELECT 'PASS news images in complete details and incremental summaries, absent images omitted';

RESET SESSION AUTHORIZATION;
UPDATE public.reporter_news_items SET translation_status='translated',translation_source_language='en',
  translation_title='Notícia original de pescado',translation_excerpt='Resumo traduzido.',
  translation_body=ARRAY['Parágrafo traduzido.'],updated_at=clock_timestamp()
  WHERE id=current_setting('test.news_image_id')::uuid;
SET SESSION AUTHORIZATION reporter_runtime;
DO $$ DECLARE item jsonb; listed jsonb; BEGIN
  item := public.reporter_news_item(current_setting('test.news_image_id')::uuid);
  SELECT value INTO listed FROM jsonb_array_elements(public.reporter_news_view(NULL,400)->'items')
    WHERE value->>'id'=current_setting('test.news_image_id');
  IF item->>'imageUrl'<>'https://news-images.exemplo/original.jpg' OR listed->>'imageUrl' IS DISTINCT FROM item->>'imageUrl'
    OR item->>'title'<>'Original fish news' OR item->'body'<>'["Original paragraph."]'::jsonb
    OR item->'translation'->>'title'<>'Notícia original de pescado'
    OR item->'translation'->'body'<>'["Parágrafo traduzido."]'::jsonb OR listed->'translation' ? 'body'
    OR item->>'status'<>'selected' OR item->>'decisionRevision'<>'1' OR NOT item ?& ARRAY['decidedAt','decidedBy','updatedAt']
    THEN RAISE EXCEPTION 'Image exposure changed translation, original or decision fields'; END IF;
  PERFORM set_config('app.user_id','00000000-0000-0000-0000-000000000012',true);
  IF public.reporter_news_item(current_setting('test.news_image_id')::uuid)->>'imageUrl' IS DISTINCT FROM item->>'imageUrl' THEN
    RAISE EXCEPTION 'A reader could not see the original image'; END IF;
  PERFORM set_config('app.tenant_id','00000000-0000-0000-0000-000000000002',true);
  PERFORM set_config('app.portal_id','00000000-0000-0000-0000-000000000102',true);
  PERFORM set_config('app.user_id','00000000-0000-0000-0000-000000000021',true);
  IF public.reporter_news_item(current_setting('test.news_image_id')::uuid) IS NOT NULL
    OR EXISTS(SELECT FROM jsonb_array_elements(public.reporter_news_view(NULL,400)->'items')
      WHERE value->>'id'=current_setting('test.news_image_id')) THEN RAISE EXCEPTION 'News image leaked to another portal'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF has_function_privilege('reporter_runtime','core.reporter_news_item_json(public.reporter_news_items,boolean)','EXECUTE')
    OR has_table_privilege('reporter_runtime','public.reporter_news_items','SELECT')
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.reporter_news_items'::regclass) THEN
    RAISE EXCEPTION 'Image projection changed news access controls'; END IF;
END $$;
SELECT 'PASS news images preserve translations, editorial decisions and portal isolation';
ROLLBACK;
