-- Keep the score and reasons the editor saw beside durable decisions for later calibration.
BEGIN;

CREATE TABLE IF NOT EXISTS public.reporter_news_score_feedback(
  portal_id uuid NOT NULL REFERENCES public.portals(id) ON DELETE CASCADE,
  news_item_id uuid NOT NULL REFERENCES public.reporter_news_items(id) ON DELETE CASCADE,
  decision_revision integer NOT NULL CHECK(decision_revision>0),
  action text NOT NULL CHECK(action IN ('select','postpone','discard')),
  score integer NOT NULL CHECK(score BETWEEN 0 AND 100),
  topic text NOT NULL CHECK(length(btrim(topic)) BETWEEN 1 AND 160),
  map_version integer NOT NULL CHECK(map_version>=0),
  reasons jsonb NOT NULL CHECK(jsonb_typeof(reasons)='array' AND jsonb_array_length(reasons)<=12),
  actor_id uuid NOT NULL REFERENCES core.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(portal_id,news_item_id,decision_revision)
);

REVOKE ALL ON public.reporter_news_score_feedback FROM PUBLIC,reporter_runtime,reporter_executor;
GRANT SELECT,INSERT ON public.reporter_news_score_feedback TO reporter_executor;

CREATE OR REPLACE FUNCTION public.reporter_news_score_feedback(p_id uuid,p_revision integer,p_action text,p_snapshot jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); item public.reporter_news_items;
BEGIN
  IF p_revision IS NULL OR p_revision<0 OR p_revision>=2147483647
    OR p_action IS NULL OR p_action NOT IN ('select','postpone','discard')
    OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
    OR octet_length(p_snapshot::text)>16000
    OR p_snapshot-ARRAY['score','topic','mapVersion','reasons']<>'{}'::jsonb
    OR jsonb_typeof(p_snapshot->'score') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_snapshot->'topic') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_snapshot->'mapVersion') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_snapshot->'reasons') IS DISTINCT FROM 'array'
    OR (p_snapshot->>'score') !~ '^([0-9]|[1-9][0-9]|100)$'
    OR (p_snapshot->>'mapVersion') !~ '^[0-9]{1,10}$'
    OR length(btrim(p_snapshot->>'topic')) NOT BETWEEN 1 AND 160
    OR coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p_snapshot->'reasons')='array' THEN p_snapshot->'reasons' ELSE '[]'::jsonb END),13)>12
    OR (CASE WHEN (p_snapshot->>'mapVersion') ~ '^[0-9]{1,10}$'
      THEN (p_snapshot->>'mapVersion')::numeric>2147483647 ELSE false END) THEN
    RAISE EXCEPTION 'NEWS_SCORE_FEEDBACK_INVALID' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(p_snapshot->'reasons') r
    WHERE jsonb_typeof(r)<>'object' OR r-ARRAY['criterion','effect','detail']<>'{}'::jsonb
      OR jsonb_typeof(r->'criterion') IS DISTINCT FROM 'string'
      OR jsonb_typeof(r->'effect') IS DISTINCT FROM 'string'
      OR jsonb_typeof(r->'detail') IS DISTINCT FROM 'string'
      OR r->>'effect' NOT IN ('up','down')
      OR length(btrim(r->>'criterion')) NOT BETWEEN 1 AND 80
      OR length(btrim(r->>'detail')) NOT BETWEEN 1 AND 300) THEN
    RAISE EXCEPTION 'NEWS_SCORE_FEEDBACK_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT * INTO item FROM public.reporter_news_items WHERE id=p_id AND portal_id=portal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWS_ITEM_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF item.decision_revision<>p_revision+1 OR item.decided_by IS DISTINCT FROM core.context_user_id()
    OR (p_action='select' AND item.status<>'selected')
    OR (p_action='postpone' AND item.status<>'later')
    OR (p_action='discard' AND item.status<>'discarded') THEN
    RAISE EXCEPTION 'NEWS_SCORE_FEEDBACK_CONFLICT' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.reporter_news_score_feedback(portal_id,news_item_id,decision_revision,action,score,topic,map_version,reasons,actor_id)
    VALUES(portal,p_id,item.decision_revision,p_action,(p_snapshot->>'score')::integer,btrim(p_snapshot->>'topic'),
      (p_snapshot->>'mapVersion')::integer,p_snapshot->'reasons',core.context_user_id());
  PERFORM core.reporter_audit(portal,'reporter.news.score_feedback','news_item',p_id,
    jsonb_build_object('action',p_action,'revision',item.decision_revision,'score',(p_snapshot->>'score')::integer,
      'topic',btrim(p_snapshot->>'topic'),'mapVersion',(p_snapshot->>'mapVersion')::integer));
END $$;

ALTER FUNCTION public.reporter_news_score_feedback(uuid,integer,text,jsonb) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_news_score_feedback(uuid,integer,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_news_score_feedback(uuid,integer,text,jsonb) TO reporter_runtime;
COMMENT ON FUNCTION public.reporter_news_score_feedback(uuid,integer,text,jsonb) IS 'reporter-news-score-feedback-v1';
COMMIT;
