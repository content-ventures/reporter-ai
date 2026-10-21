-- Expose the original image already stored by ingestion in both news summaries and details.
-- Translation changes display text only; the image remains the publication's original URL.
BEGIN;
CREATE OR REPLACE FUNCTION core.reporter_news_item_json(i public.reporter_news_items,p_body boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id',i.id,'sourceId',i.source_id,'via',i.via,'url',i.url,'title',i.title,
    'outlet',i.outlet,'excerpt',i.excerpt,'imageUrl',i.image_url,'publishedAt',i.published_at,'importedAt',i.imported_at,'updatedAt',i.updated_at,
    'duplicates',i.duplicates,'paragraphs',cardinality(i.body),'body',CASE WHEN p_body THEN to_jsonb(i.body) END,
    'status',i.status,'decisionRevision',i.decision_revision,
    'decidedBy',(SELECT name FROM core.users WHERE id=i.decided_by),'decidedAt',i.decided_at,
    'laterUntil',i.later_until,'discardReason',i.discard_reason,'returnedAt',i.returned_at,
    'translation',jsonb_build_object('status',i.translation_status,'sourceLanguage',i.translation_source_language,'targetLanguage','pt-BR',
      'title',i.translation_title,'excerpt',i.translation_excerpt,'body',CASE WHEN p_body THEN to_jsonb(i.translation_body) END,
      'error',i.translation_error)))
$$;
ALTER FUNCTION core.reporter_news_item_json(public.reporter_news_items,boolean) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_news_item_json(public.reporter_news_items,boolean) FROM PUBLIC;
COMMIT;
