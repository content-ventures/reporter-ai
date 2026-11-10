BEGIN;

CREATE OR REPLACE FUNCTION public.reporter_news_source_add(p_kind text,p_name text,p_url text,p_canonical text,p_every integer,
  p_site text,p_keyword text,p_remote_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); source public.reporter_news_sources;
  clipping boolean := core.reporter_news_clipping(portal);
BEGIN
  -- One writer at a time per portal keeps the source limit exact.
  PERFORM pg_advisory_xact_lock(hashtextextended('reporter_news_sources:'||portal::text,0));
  IF EXISTS(SELECT FROM public.reporter_news_sources WHERE portal_id=portal AND canonical_url=p_canonical) THEN
    RAISE EXCEPTION 'NEWS_SOURCE_DUPLICATE' USING ERRCODE='23505';
  END IF;
  IF (SELECT count(*) FROM public.reporter_news_sources WHERE portal_id=portal)>=(CASE WHEN clipping THEN 50 ELSE 30 END) THEN
    RAISE EXCEPTION USING MESSAGE=(CASE WHEN clipping THEN 'NEWS_CLIPPING_SOURCE_LIMIT' ELSE 'NEWS_SOURCE_LIMIT' END), ERRCODE='54000';
  END IF;
  INSERT INTO public.reporter_news_sources(portal_id,kind,name,url,canonical_url,site,keyword,remote_id,every_minutes)
    VALUES(portal,p_kind,btrim(p_name),p_url,p_canonical,p_site,nullif(btrim(p_keyword),''),p_remote_id,p_every) RETURNING * INTO source;
  PERFORM core.reporter_audit(portal,'reporter.news_source.added','news_source',source.id,
    jsonb_strip_nulls(jsonb_build_object('kind',source.kind,'name',source.name,'url',source.url,'every_minutes',source.every_minutes)));
  RETURN core.reporter_news_source_json(source);
END $$;

COMMIT;
