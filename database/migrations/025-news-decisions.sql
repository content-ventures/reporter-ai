-- Decisions on imported news. Selection keeps material for future writing; it creates no production.
BEGIN;

ALTER TABLE public.reporter_news_items
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','selected','later','discarded')),
  ADD COLUMN IF NOT EXISTS decision_revision integer NOT NULL DEFAULT 0 CHECK(decision_revision>=0),
  ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES core.users(id),
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS later_until timestamptz,
  ADD COLUMN IF NOT EXISTS discard_reason text CHECK(discard_reason IS NULL OR length(btrim(discard_reason)) BETWEEN 1 AND 500),
  ADD COLUMN IF NOT EXISTS returned_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_reporter_news_items_later ON public.reporter_news_items(portal_id,later_until) WHERE status='later';
CREATE INDEX IF NOT EXISTS idx_reporter_news_items_selected ON public.reporter_news_items(portal_id,updated_at) WHERE status='selected';
CREATE INDEX IF NOT EXISTS idx_reporter_news_items_page ON public.reporter_news_items(portal_id,updated_at DESC,id DESC);

CREATE OR REPLACE FUNCTION core.reporter_news_item_json(i public.reporter_news_items,p_body boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id',i.id,'sourceId',i.source_id,'via',i.via,'url',i.url,'title',i.title,
    'outlet',i.outlet,'excerpt',i.excerpt,'publishedAt',i.published_at,'importedAt',i.imported_at,'updatedAt',i.updated_at,
    'duplicates',i.duplicates,'paragraphs',cardinality(i.body),'body',CASE WHEN p_body THEN to_jsonb(i.body) END,
    'status',i.status,'decisionRevision',i.decision_revision,
    'decidedBy',(SELECT name FROM core.users WHERE id=i.decided_by),'decidedAt',i.decided_at,
    'laterUntil',i.later_until,'discardReason',i.discard_reason,'returnedAt',i.returned_at))
$$;

-- A read observes elapsed postponements once, with an explicit automatic audit event. The
-- reader is not named as the decision author; no caller can execute this internal helper directly.
CREATE OR REPLACE FUNCTION core.reporter_news_return_due(p_portal uuid,p_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE before public.reporter_news_items; restored public.reporter_news_items; at_time timestamptz := clock_timestamp();
BEGIN
  FOR before IN SELECT * FROM public.reporter_news_items
    WHERE portal_id=p_portal AND status='later' AND later_until<=at_time AND (p_id IS NULL OR id=p_id)
    ORDER BY id FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.reporter_news_items SET status='new',decision_revision=decision_revision+1,
      decided_by=NULL,decided_at=NULL,later_until=NULL,discard_reason=NULL,returned_at=at_time,updated_at=at_time
      WHERE id=before.id AND portal_id=p_portal RETURNING * INTO restored;
    INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,entity_id,after_data,source,request_id,correlation_id)
      VALUES(p_portal,NULL,'reporter.news.returned','news_item',before.id,
        jsonb_build_object('automatic',true,'revision',restored.decision_revision,'postponedBy',before.decided_by,'dueAt',before.later_until),
        'reporter_ai',nullif(current_setting('app.request_id',true),'')::uuid,
        nullif(current_setting('app.correlation_id',true),'')::uuid);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_news_decide(p_id uuid,p_revision integer,p_action text,p_hours integer DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); item public.reporter_news_items;
  previous_status text; next_status text; at_time timestamptz := clock_timestamp();
BEGIN
  IF p_revision IS NULL OR p_revision<0 OR p_revision>=2147483647 OR p_action IS NULL
    OR p_action NOT IN ('select','restore','postpone','discard')
    OR (p_action='postpone' AND (p_hours IS NULL OR p_hours NOT BETWEEN 1 AND 720))
    OR (p_action<>'postpone' AND p_hours IS NOT NULL)
    OR (p_action='discard' AND (p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500))
    OR (p_action<>'discard' AND p_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'NEWS_DECISION_INVALID' USING ERRCODE='22023';
  END IF;
  PERFORM core.reporter_news_return_due(portal,p_id);
  SELECT * INTO item FROM public.reporter_news_items WHERE id=p_id AND portal_id=portal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWS_ITEM_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF item.decision_revision<>p_revision THEN RAISE EXCEPTION 'NEWS_DECISION_CONFLICT' USING ERRCODE='40001'; END IF;
  previous_status := item.status;
  next_status := CASE p_action WHEN 'select' THEN 'selected' WHEN 'restore' THEN 'new' WHEN 'postpone' THEN 'later' ELSE 'discarded' END;
  UPDATE public.reporter_news_items SET status=next_status,decision_revision=decision_revision+1,
    decided_by=CASE WHEN p_action='restore' THEN NULL ELSE core.context_user_id() END,
    decided_at=CASE WHEN p_action='restore' THEN NULL ELSE at_time END,
    later_until=CASE WHEN p_action='postpone' THEN at_time+p_hours*interval '1 hour' END,
    discard_reason=CASE WHEN p_action='discard' THEN btrim(p_reason) END,
    returned_at=CASE WHEN p_action='restore' THEN at_time END,updated_at=at_time
    WHERE id=p_id AND portal_id=portal RETURNING * INTO item;
  PERFORM core.reporter_audit(portal,'reporter.news.decided','news_item',item.id,
    jsonb_strip_nulls(jsonb_build_object('action',p_action,'previousStatus',previous_status,'status',item.status,
      'revision',item.decision_revision,'laterUntil',item.later_until,'reason',item.discard_reason)));
  RETURN core.reporter_news_item_json(item,true);
END $$;

-- A fixed upper bound and both ordering keys let the desk drain every page before advancing
-- its poll cursor. Keep timestamp precision in next: PostgreSQL can distinguish microseconds.
CREATE OR REPLACE FUNCTION public.reporter_news_page(p_since timestamptz,p_after_at timestamptz,p_after_id uuid,p_until timestamptz,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); read_at timestamptz;
  page_size integer := least(greatest(coalesce(p_limit,400),1),500); items jsonb; next_page jsonb;
BEGIN
  IF (p_after_at IS NULL)<>(p_after_id IS NULL) OR (p_after_at IS NULL)<>(p_until IS NULL)
    OR p_after_at>p_until OR NOT isfinite(p_after_at) OR NOT isfinite(p_until) THEN
    RAISE EXCEPTION 'NEWS_PAGE_CURSOR_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_until IS NULL THEN PERFORM core.reporter_news_return_due(portal); END IF;
  read_at := coalesce(p_until,clock_timestamp());
  WITH candidates AS MATERIALIZED (
    SELECT i AS stored,i.updated_at,i.id FROM public.reporter_news_items i
      WHERE i.portal_id=portal
        AND (i.imported_at>read_at-interval '7 days' OR i.status='selected'
          OR i.status='later' AND i.later_until>read_at OR i.returned_at>read_at-interval '7 days'
          OR i.decided_at>read_at-interval '7 days')
        AND (p_since IS NULL OR i.updated_at>p_since) AND i.updated_at<=read_at
        AND (p_after_at IS NULL OR (i.updated_at,i.id)<(p_after_at,p_after_id))
      ORDER BY i.updated_at DESC,i.id DESC LIMIT page_size+1
  ), page AS (
    SELECT * FROM candidates ORDER BY updated_at DESC,id DESC LIMIT page_size
  )
  SELECT coalesce(jsonb_agg(core.reporter_news_item_json(p.stored,false) ORDER BY p.updated_at DESC,p.id DESC),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM candidates)>page_size THEN
      (SELECT jsonb_build_object('updatedAt',updated_at,'id',id,'until',read_at)
        FROM page ORDER BY updated_at,id LIMIT 1) END
    INTO items,next_page FROM page p;
  RETURN jsonb_strip_nulls(jsonb_build_object('at',read_at,
    'sources',coalesce((SELECT jsonb_agg(core.reporter_news_source_json(s) ORDER BY s.created_at,s.id)
      FROM public.reporter_news_sources s WHERE s.portal_id=portal),'[]'::jsonb),
    'items',items,'next',next_page,
    'due',EXISTS(SELECT FROM public.reporter_news_sources WHERE portal_id=portal AND NOT paused AND next_read_at<=read_at
      AND coalesce(lease_until,'-infinity'::timestamptz)<read_at)));
END $$;

CREATE OR REPLACE FUNCTION public.reporter_news_view(p_since timestamptz,p_limit integer) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT public.reporter_news_page(p_since,NULL,NULL,NULL,p_limit)
$$;

CREATE OR REPLACE FUNCTION public.reporter_news_item(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); item public.reporter_news_items;
BEGIN
  PERFORM core.reporter_news_return_due(portal,p_id);
  SELECT * INTO item FROM public.reporter_news_items WHERE id=p_id AND portal_id=portal;
  RETURN CASE WHEN FOUND THEN core.reporter_news_item_json(item,true) END;
END $$;

ALTER FUNCTION core.reporter_news_item_json(public.reporter_news_items,boolean) OWNER TO reporter_executor;
ALTER FUNCTION core.reporter_news_return_due(uuid,uuid) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_decide(uuid,integer,text,integer,text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_page(timestamptz,timestamptz,uuid,timestamptz,integer) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_view(timestamptz,integer) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_item(uuid) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_news_item_json(public.reporter_news_items,boolean),core.reporter_news_return_due(uuid,uuid),
  public.reporter_news_decide(uuid,integer,text,integer,text),public.reporter_news_page(timestamptz,timestamptz,uuid,timestamptz,integer),
  public.reporter_news_view(timestamptz,integer),public.reporter_news_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_news_decide(uuid,integer,text,integer,text),
  public.reporter_news_page(timestamptz,timestamptz,uuid,timestamptz,integer),public.reporter_news_view(timestamptz,integer),
  public.reporter_news_item(uuid) TO reporter_runtime;
COMMENT ON FUNCTION public.reporter_news_decide(uuid,integer,text,integer,text) IS 'reporter-news-decisions-v1';
COMMIT;
