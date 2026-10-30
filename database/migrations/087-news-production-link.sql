-- Bind an editorial news decision to one article production in the same PostgreSQL transaction.
BEGIN;

ALTER TABLE public.reporter_news_items
  ADD COLUMN IF NOT EXISTS production_id text,
  ADD COLUMN IF NOT EXISTS covered_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.reporter_news_items'::regclass
    AND conname='reporter_news_items_production_fk') THEN
    ALTER TABLE public.reporter_news_items ADD CONSTRAINT reporter_news_items_production_fk
      FOREIGN KEY(portal_id,production_id) REFERENCES public.reporter_ed_productions(portal_id,production_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.reporter_news_items'::regclass
    AND conname='reporter_news_items_status_flow3_check') THEN
    ALTER TABLE public.reporter_news_items DROP CONSTRAINT IF EXISTS reporter_news_items_status_check;
    ALTER TABLE public.reporter_news_items ADD CONSTRAINT reporter_news_items_status_flow3_check
      CHECK(status IN ('new','selected','covered','later','discarded'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reporter_news_items_production
  ON public.reporter_news_items(portal_id,production_id) WHERE production_id IS NOT NULL;

CREATE OR REPLACE FUNCTION core.reporter_news_item_json(i public.reporter_news_items,p_body boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id',i.id,'sourceId',i.source_id,'via',i.via,'url',i.url,'title',i.title,
    'outlet',i.outlet,'excerpt',i.excerpt,'imageUrl',i.image_url,'publishedAt',i.published_at,'importedAt',i.imported_at,'updatedAt',i.updated_at,
    'contentKind',coalesce(i.search_content_kind,CASE WHEN i.via='rss' THEN 'feed' ELSE 'article' END),'contentRevision',i.content_revision,
    'discoveredAt',i.discovered_at,'duplicates',i.duplicates,'paragraphs',cardinality(i.body),'body',CASE WHEN p_body THEN to_jsonb(i.body) END,
    'status',i.status,'decisionRevision',i.decision_revision,'decidedBy',(SELECT name FROM core.users WHERE id=i.decided_by),
    'decidedAt',i.decided_at,'laterUntil',i.later_until,'discardReason',i.discard_reason,'returnedAt',i.returned_at,
    'translation',jsonb_build_object('status',i.translation_status,'sourceLanguage',i.translation_source_language,'targetLanguage','pt-BR',
      'title',i.translation_title,'excerpt',i.translation_excerpt,'body',CASE WHEN p_body THEN to_jsonb(i.translation_body) END,'error',i.translation_error),
    'productionId',i.production_id,'coveredAt',i.covered_at))
$$;

CREATE OR REPLACE FUNCTION public.reporter_news_cover_begin(p_id uuid)
RETURNS TABLE(production_id text,can_create boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); item public.reporter_news_items;
BEGIN
  SELECT * INTO item FROM public.reporter_news_items WHERE id=p_id AND portal_id=portal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWS_ITEM_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  RETURN QUERY SELECT item.production_id,item.status='selected' AND item.production_id IS NULL;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_news_cover_finish(p_id uuid,p_production_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); item public.reporter_news_items; at_time timestamptz := clock_timestamp();
BEGIN
  IF p_production_id IS NULL OR length(btrim(p_production_id)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'NEWS_COVER_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT * INTO item FROM public.reporter_news_items WHERE id=p_id AND portal_id=portal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWS_ITEM_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF item.status<>'selected' OR item.production_id IS NOT NULL THEN
    RAISE EXCEPTION 'NEWS_COVER_CONFLICT' USING ERRCODE='40001';
  END IF;
  UPDATE public.reporter_news_items SET status='covered',production_id=p_production_id,covered_at=at_time,
    decided_by=core.context_user_id(),decided_at=at_time,decision_revision=decision_revision+1,updated_at=at_time
    WHERE id=p_id AND portal_id=portal RETURNING * INTO item;
  PERFORM core.reporter_audit(portal,'reporter.news.covered','news_item',p_id,
    jsonb_build_object('revision',item.decision_revision,'productionId',p_production_id,'coveredAt',at_time));
END $$;

ALTER FUNCTION core.reporter_news_item_json(public.reporter_news_items,boolean) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_cover_begin(uuid) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_cover_finish(uuid,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_news_item_json(public.reporter_news_items,boolean),
  public.reporter_news_cover_begin(uuid),public.reporter_news_cover_finish(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_news_cover_begin(uuid),public.reporter_news_cover_finish(uuid,text) TO reporter_runtime;
COMMENT ON FUNCTION public.reporter_news_cover_begin(uuid) IS 'reporter-news-cover-begin-v1';
COMMENT ON FUNCTION public.reporter_news_cover_finish(uuid,text) IS 'reporter-news-cover-finish-v1';
COMMIT;
