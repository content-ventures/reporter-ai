-- Explicit editorial assessments belong to one portal's publication, never to feed activity.
BEGIN;

ALTER TABLE public.reporter_news_sources
  ADD COLUMN IF NOT EXISTS rating_tier text CHECK(rating_tier IN ('A1','A2','B','C')),
  ADD COLUMN IF NOT EXISTS rating_relevance text CHECK(rating_relevance IN ('high','medium','low')),
  ADD COLUMN IF NOT EXISTS rating_rationale text CHECK(rating_rationale=btrim(rating_rationale) AND length(rating_rationale) BETWEEN 1 AND 600),
  ADD COLUMN IF NOT EXISTS rating_updated_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.reporter_news_sources'::regclass
    AND conname='reporter_news_source_rating_complete') THEN
    ALTER TABLE public.reporter_news_sources ADD CONSTRAINT reporter_news_source_rating_complete CHECK(
      num_nonnulls(rating_tier,rating_relevance,rating_rationale,rating_updated_at)=0
      OR (num_nonnulls(rating_tier,rating_relevance,rating_rationale,rating_updated_at)=4
        AND kind<>'google-alerts' AND keyword IS NULL));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION core.reporter_news_source_json(s public.reporter_news_sources) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id',s.id,'kind',s.kind,'name',s.name,'url',s.url,'site',s.site,
    'keyword',s.keyword,'everyMinutes',s.every_minutes,'paused',s.paused,'failures',s.failures,'lastError',s.last_error,
    'lastReadAt',s.last_read_at,'nextReadAt',s.next_read_at,'createdAt',s.created_at,
    'rating',CASE WHEN s.rating_tier IS NOT NULL THEN jsonb_build_object('tier',s.rating_tier,
      'relevance',s.rating_relevance,'rationale',s.rating_rationale,'updatedAt',s.rating_updated_at) END,
    'lastWeek',(SELECT jsonb_agg(c.n ORDER BY d.k DESC) FROM generate_series(0,6) d(k)
      CROSS JOIN LATERAL (SELECT count(*) AS n FROM public.reporter_news_items i WHERE i.source_id=s.id
        AND i.imported_at>clock_timestamp()-(d.k+1)*interval '1 day' AND i.imported_at<=clock_timestamp()-d.k*interval '1 day') c)))
$$;

-- SQL NULL leaves the rating intact; JSON null clears it. Unknown fields and partial ratings fail.
CREATE OR REPLACE FUNCTION public.reporter_news_source_update(p_id uuid,p_name text,p_every integer,p_paused boolean,p_rating jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); source public.reporter_news_sources;
  before public.reporter_news_sources; rationale text;
BEGIN
  SELECT * INTO before FROM public.reporter_news_sources WHERE id=p_id AND portal_id=portal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWS_SOURCE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_rating IS NOT NULL AND p_rating<>'null'::jsonb THEN
    IF jsonb_typeof(p_rating) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'NEWS_SOURCE_RATING_INVALID' USING ERRCODE='22023';
    END IF;
    rationale := btrim(regexp_replace(p_rating->>'rationale','^\s+|\s+$','','g'));
    IF NOT (p_rating ?& ARRAY['tier','relevance','rationale'])
      OR p_rating-ARRAY['tier','relevance','rationale']<>'{}'::jsonb
      OR jsonb_typeof(p_rating->'tier') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_rating->'relevance') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_rating->'rationale') IS DISTINCT FROM 'string'
      OR p_rating->>'tier' NOT IN ('A1','A2','B','C')
      OR p_rating->>'relevance' NOT IN ('high','medium','low')
      OR length(rationale) NOT BETWEEN 1 AND 600 THEN
      RAISE EXCEPTION 'NEWS_SOURCE_RATING_INVALID' USING ERRCODE='22023';
    END IF;
    IF before.kind='google-alerts' OR before.keyword IS NOT NULL THEN
      RAISE EXCEPTION 'NEWS_SOURCE_RATING_UNSUPPORTED' USING ERRCODE='22023';
    END IF;
  END IF;
  UPDATE public.reporter_news_sources SET name=coalesce(nullif(btrim(p_name),''),name),every_minutes=coalesce(p_every,every_minutes),
      paused=coalesce(p_paused,paused),
      next_read_at=CASE WHEN p_paused IS FALSE AND before.paused THEN clock_timestamp()
        WHEN p_every IS NOT NULL AND p_every<>before.every_minutes
          THEN least(next_read_at,coalesce(last_read_at,clock_timestamp())+p_every*interval '1 minute') ELSE next_read_at END,
      rating_tier=CASE WHEN p_rating IS NULL THEN rating_tier ELSE p_rating->>'tier' END,
      rating_relevance=CASE WHEN p_rating IS NULL THEN rating_relevance ELSE p_rating->>'relevance' END,
      rating_rationale=CASE WHEN p_rating IS NULL THEN rating_rationale ELSE rationale END,
      rating_updated_at=CASE WHEN p_rating IS NULL THEN rating_updated_at
        WHEN p_rating='null'::jsonb THEN NULL ELSE clock_timestamp() END,
      updated_at=clock_timestamp()
    WHERE id=p_id AND portal_id=portal RETURNING * INTO source;
  PERFORM core.reporter_audit(portal,'reporter.news_source.updated','news_source',source.id,
    jsonb_build_object('name',source.name,'every_minutes',source.every_minutes,'paused',source.paused)
      || CASE WHEN p_rating IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
        'rating',core.reporter_news_source_json(source)->'rating',
        'previous_rating',core.reporter_news_source_json(before)->'rating') END);
  RETURN core.reporter_news_source_json(source);
END $$;

-- Existing callers that only rename, pause or change frequency preserve the assessment.
CREATE OR REPLACE FUNCTION public.reporter_news_source_update(p_id uuid,p_name text,p_every integer,p_paused boolean) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT public.reporter_news_source_update(p_id,p_name,p_every,p_paused,NULL::jsonb)
$$;

ALTER FUNCTION core.reporter_news_source_json(public.reporter_news_sources) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_source_update(uuid,text,integer,boolean,jsonb) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_source_update(uuid,text,integer,boolean) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_news_source_json(public.reporter_news_sources),
  public.reporter_news_source_update(uuid,text,integer,boolean,jsonb),
  public.reporter_news_source_update(uuid,text,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_news_source_update(uuid,text,integer,boolean,jsonb),
  public.reporter_news_source_update(uuid,text,integer,boolean) TO reporter_runtime;
COMMENT ON FUNCTION public.reporter_news_source_update(uuid,text,integer,boolean,jsonb) IS 'reporter-news-source-ratings-v1';
COMMIT;
