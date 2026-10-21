-- Portuguese reading copies are durable, separate from immutable imported material.
BEGIN;
ALTER TABLE public.reporter_news_items
  ADD COLUMN IF NOT EXISTS translation_status text NOT NULL DEFAULT 'pending' CHECK(translation_status IN ('pending','translated','original','failed')),
  ADD COLUMN IF NOT EXISTS translation_source_language text CHECK(translation_source_language ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8}){0,2}$'),
  ADD COLUMN IF NOT EXISTS translation_title text CHECK(length(translation_title) BETWEEN 1 AND 600),
  ADD COLUMN IF NOT EXISTS translation_excerpt text CHECK(length(translation_excerpt)<=800),
  ADD COLUMN IF NOT EXISTS translation_body text[] CHECK(cardinality(translation_body)<=400 AND length(array_to_string(translation_body,''))<=40000),
  ADD COLUMN IF NOT EXISTS translation_error text CHECK(translation_error ~ '^[A-Z0-9_]{1,64}$'),
  ADD COLUMN IF NOT EXISTS translation_attempts integer NOT NULL DEFAULT 0 CHECK(translation_attempts BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS translation_next_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS translation_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS translation_lease_owner text,
  ADD COLUMN IF NOT EXISTS translation_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS translation_fence uuid;
CREATE INDEX IF NOT EXISTS idx_reporter_news_translation_pending
  ON public.reporter_news_items(portal_id,translation_next_at,id) WHERE translation_status='pending';

-- Existing active material is backfilled by the same queue as newly inserted material.
CREATE OR REPLACE FUNCTION core.reporter_news_translation_active(i public.reporter_news_items) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT i.imported_at>statement_timestamp()-interval '7 days' OR i.status='selected'
    OR i.status='later' AND i.later_until>statement_timestamp() OR i.returned_at>statement_timestamp()-interval '7 days'
    OR i.decided_at>statement_timestamp()-interval '7 days' OR i.translation_requested_at>statement_timestamp()-interval '7 days'
$$;

CREATE OR REPLACE FUNCTION core.reporter_news_translation_pending(p_portal uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(SELECT FROM public.reporter_news_items i WHERE i.portal_id=p_portal AND i.translation_status='pending'
    AND i.translation_next_at<=statement_timestamp() AND coalesce(i.translation_lease_until,'-infinity'::timestamptz)<statement_timestamp()
    AND core.reporter_news_translation_active(i))
$$;

CREATE OR REPLACE FUNCTION public.reporter_news_translation_claim(p_owner text,p_lease_ms integer DEFAULT 120000) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.context_portal_id(); item public.reporter_news_items;
BEGIN
  PERFORM core.reporter_worker_require();
  IF portal IS NULL THEN RAISE EXCEPTION 'Portal context missing' USING ERRCODE='42501'; END IF;
  IF p_owner IS NULL OR p_owner !~ '^[a-zA-Z0-9_-]{8,128}$' OR p_lease_ms IS NULL OR p_lease_ms NOT BETWEEN 15000 AND 180000 THEN
    RAISE EXCEPTION 'NEWS_TRANSLATION_INVALID' USING ERRCODE='22023'; END IF;
  -- A crashed third attempt must become a visible failure instead of staying pending forever.
  UPDATE public.reporter_news_items i SET translation_status='failed',translation_error='RETRY_EXHAUSTED',
    translation_lease_owner=NULL,translation_lease_until=NULL,translation_fence=NULL,updated_at=clock_timestamp()
    WHERE portal_id=portal AND translation_status='pending' AND translation_attempts>=3
      AND coalesce(translation_lease_until,'-infinity'::timestamptz)<clock_timestamp() AND core.reporter_news_translation_active(i);
  SELECT * INTO item FROM public.reporter_news_items i WHERE i.portal_id=portal AND i.translation_status='pending'
    AND i.translation_attempts<3 AND i.translation_next_at<=clock_timestamp()
    AND coalesce(i.translation_lease_until,'-infinity'::timestamptz)<clock_timestamp() AND core.reporter_news_translation_active(i)
    ORDER BY i.translation_next_at,i.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.reporter_news_items SET translation_attempts=translation_attempts+1,translation_lease_owner=p_owner,
    translation_lease_until=clock_timestamp()+make_interval(secs=>p_lease_ms/1000.0),translation_fence=gen_random_uuid()
    WHERE id=item.id AND portal_id=portal RETURNING * INTO item;
  RETURN jsonb_build_object('id',item.id,'title',item.title,'excerpt',item.excerpt,'body',to_jsonb(item.body),
    'fence',item.translation_fence,'attempts',item.translation_attempts);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_news_translation_finish(p_id uuid,p_owner text,p_fence uuid,p_payload jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.context_portal_id(); item public.reporter_news_items; translated boolean; paragraphs text[];
BEGIN
  PERFORM core.reporter_worker_require();
  IF portal IS NULL THEN RAISE EXCEPTION 'Portal context missing' USING ERRCODE='42501'; END IF;
  SELECT * INTO item FROM public.reporter_news_items WHERE id=p_id AND portal_id=portal AND translation_status='pending'
    AND translation_lease_owner=p_owner AND translation_fence=p_fence AND translation_lease_until>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
    OR NOT p_payload ?& ARRAY['sourceLanguage','translated','title','excerpt','body']
    OR p_payload-ARRAY['sourceLanguage','translated','title','excerpt','body']<>'{}'::jsonb
    OR jsonb_typeof(p_payload->'translated') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_payload->'sourceLanguage') IS DISTINCT FROM 'string'
    OR (p_payload->>'sourceLanguage') !~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8}){0,2}$'
    OR jsonb_typeof(p_payload->'title') IS DISTINCT FROM 'string' OR length(btrim(p_payload->>'title')) NOT BETWEEN 1 AND 600
    OR jsonb_typeof(p_payload->'excerpt') IS DISTINCT FROM 'string' OR length(p_payload->>'excerpt')>800
    OR jsonb_typeof(p_payload->'body') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'NEWS_TRANSLATION_INVALID' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(p_payload->'body') b WHERE jsonb_typeof(b) IS DISTINCT FROM 'string') THEN
    RAISE EXCEPTION 'NEWS_TRANSLATION_INVALID' USING ERRCODE='22023'; END IF;
  translated := (p_payload->>'translated')::boolean;
  paragraphs := ARRAY(SELECT jsonb_array_elements_text(p_payload->'body'));
  IF cardinality(paragraphs)<>cardinality(item.body) OR length(array_to_string(paragraphs,''))>40000
    OR NOT translated AND lower(p_payload->>'sourceLanguage') NOT IN ('pt','pt-br') THEN
    RAISE EXCEPTION 'NEWS_TRANSLATION_INVALID' USING ERRCODE='22023'; END IF;
  UPDATE public.reporter_news_items SET translation_status=CASE WHEN translated THEN 'translated' ELSE 'original' END,
    translation_source_language=p_payload->>'sourceLanguage',translation_title=CASE WHEN translated THEN p_payload->>'title' END,
    translation_excerpt=CASE WHEN translated THEN p_payload->>'excerpt' END,translation_body=CASE WHEN translated THEN paragraphs END,
    translation_error=NULL,translation_lease_owner=NULL,translation_lease_until=NULL,translation_fence=NULL,updated_at=clock_timestamp()
    WHERE id=p_id AND portal_id=portal;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_news_translation_fail(p_id uuid,p_owner text,p_fence uuid,p_code text,p_retry_seconds integer DEFAULT 0) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.context_portal_id();
BEGIN
  PERFORM core.reporter_worker_require();
  IF portal IS NULL THEN RAISE EXCEPTION 'Portal context missing' USING ERRCODE='42501'; END IF;
  UPDATE public.reporter_news_items SET translation_status=CASE WHEN p_retry_seconds>0 AND translation_attempts<3 THEN 'pending' ELSE 'failed' END,
    translation_error=CASE WHEN p_code ~ '^[A-Z0-9_]{1,64}$' THEN p_code ELSE 'NEWS_TRANSLATION_FAILED' END,
    translation_next_at=clock_timestamp()+make_interval(secs=>least(greatest(coalesce(p_retry_seconds,0),5),3600)),
    translation_lease_owner=NULL,translation_lease_until=NULL,translation_fence=NULL,updated_at=clock_timestamp()
    WHERE id=p_id AND portal_id=portal AND translation_status='pending' AND translation_lease_owner=p_owner
      AND translation_fence=p_fence AND translation_lease_until>clock_timestamp();
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION core.reporter_news_item_json(i public.reporter_news_items,p_body boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id',i.id,'sourceId',i.source_id,'via',i.via,'url',i.url,'title',i.title,
    'outlet',i.outlet,'excerpt',i.excerpt,'publishedAt',i.published_at,'importedAt',i.imported_at,'updatedAt',i.updated_at,
    'duplicates',i.duplicates,'paragraphs',cardinality(i.body),'body',CASE WHEN p_body THEN to_jsonb(i.body) END,
    'status',i.status,'decisionRevision',i.decision_revision,
    'decidedBy',(SELECT name FROM core.users WHERE id=i.decided_by),'decidedAt',i.decided_at,
    'laterUntil',i.later_until,'discardReason',i.discard_reason,'returnedAt',i.returned_at,
    'translation',jsonb_build_object('status',i.translation_status,'sourceLanguage',i.translation_source_language,'targetLanguage','pt-BR',
      'title',i.translation_title,'excerpt',i.translation_excerpt,'body',CASE WHEN p_body THEN to_jsonb(i.translation_body) END,
      'error',i.translation_error)))
$$;

CREATE OR REPLACE FUNCTION public.reporter_news_translation_retry(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); item public.reporter_news_items;
BEGIN
  SELECT * INTO item FROM public.reporter_news_items WHERE id=p_id AND portal_id=portal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWS_ITEM_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF item.translation_status='failed' THEN
    UPDATE public.reporter_news_items SET translation_status='pending',translation_attempts=0,translation_error=NULL,
      translation_next_at=clock_timestamp(),translation_requested_at=clock_timestamp(),translation_lease_owner=NULL,
      translation_lease_until=NULL,translation_fence=NULL,updated_at=clock_timestamp()
      WHERE id=p_id AND portal_id=portal RETURNING * INTO item;
    PERFORM core.reporter_audit(portal,'reporter.news_translation.retried','news_item',p_id,'{}'::jsonb);
  END IF;
  RETURN core.reporter_news_item_json(item,true);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_worker_pending() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.context_portal_id();
BEGIN
  PERFORM core.reporter_worker_require();
  IF portal IS NULL THEN RAISE EXCEPTION 'Portal context missing' USING ERRCODE='42501'; END IF;
  RETURN core.reporter_outbox_claimable_since(portal) IS NOT NULL OR core.reporter_remote_claimable_since(portal) IS NOT NULL
    OR core.reporter_editorial_claimable_since(portal) IS NOT NULL OR core.reporter_news_translation_pending(portal)
    OR EXISTS(SELECT FROM public.reporter_news_sources WHERE portal_id=portal AND NOT paused
      AND next_read_at<=clock_timestamp() AND coalesce(lease_until,'-infinity'::timestamptz)<clock_timestamp());
END $$;

-- Reading an old pending item prepares its Portuguese copy without calling a provider here.
-- It does not reset attempts or leases; the worker still owns execution and completion.
CREATE OR REPLACE FUNCTION public.reporter_news_item(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); item public.reporter_news_items;
BEGIN
  PERFORM core.reporter_news_return_due(portal,p_id);
  UPDATE public.reporter_news_items i SET translation_requested_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE i.id=p_id AND i.portal_id=portal AND i.translation_status='pending'
      AND core.reporter_news_translation_active(i) IS NOT TRUE;
  SELECT * INTO item FROM public.reporter_news_items WHERE id=p_id AND portal_id=portal;
  RETURN CASE WHEN FOUND THEN core.reporter_news_item_json(item,true) END;
END $$;

-- Preserve pagination and source deletion semantics while also waking queued translations.
CREATE OR REPLACE FUNCTION public.reporter_news_page(p_since timestamptz,p_after_at timestamptz,p_after_id uuid,p_until timestamptz,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); read_at timestamptz;
  page_size integer := least(greatest(coalesce(p_limit,400),1),500); items jsonb; next_page jsonb;
BEGIN
  IF (p_after_at IS NULL)<>(p_after_id IS NULL) OR (p_after_at IS NULL)<>(p_until IS NULL)
    OR p_after_at>p_until OR NOT isfinite(p_after_at) OR NOT isfinite(p_until) THEN
    RAISE EXCEPTION 'NEWS_PAGE_CURSOR_INVALID' USING ERRCODE='22023'; END IF;
  IF p_until IS NULL THEN PERFORM core.reporter_news_return_due(portal); END IF;
  read_at := coalesce(p_until,clock_timestamp());
  WITH candidates AS MATERIALIZED (
    SELECT i AS stored,i.updated_at,i.id FROM public.reporter_news_items i WHERE i.portal_id=portal
      AND (i.imported_at>read_at-interval '7 days' OR i.status='selected' OR i.status='later' AND i.later_until>read_at
        OR i.returned_at>read_at-interval '7 days' OR i.decided_at>read_at-interval '7 days'
        OR i.translation_requested_at>read_at-interval '7 days')
      AND (p_since IS NULL OR i.updated_at>p_since) AND i.updated_at<=read_at
      AND (p_after_at IS NULL OR (i.updated_at,i.id)<(p_after_at,p_after_id))
      ORDER BY i.updated_at DESC,i.id DESC LIMIT page_size+1
  ), page AS (SELECT * FROM candidates ORDER BY updated_at DESC,id DESC LIMIT page_size)
  SELECT coalesce(jsonb_agg(core.reporter_news_item_json(p.stored,false) ORDER BY p.updated_at DESC,p.id DESC),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM candidates)>page_size THEN (SELECT jsonb_build_object('updatedAt',updated_at,'id',id,'until',read_at)
      FROM page ORDER BY updated_at,id LIMIT 1) END INTO items,next_page FROM page p;
  RETURN jsonb_strip_nulls(jsonb_build_object('at',read_at,
    'sources',coalesce((SELECT jsonb_agg(core.reporter_news_source_json(s) ORDER BY s.created_at,s.id)
      FROM public.reporter_news_sources s WHERE s.portal_id=portal),'[]'::jsonb),'items',items,'next',next_page,
    'due',core.reporter_news_translation_pending(portal) OR EXISTS(SELECT FROM public.reporter_news_sources
      WHERE portal_id=portal AND NOT paused AND next_read_at<=read_at AND coalesce(lease_until,'-infinity'::timestamptz)<read_at)));
END $$;

ALTER FUNCTION core.reporter_news_translation_active(public.reporter_news_items) OWNER TO reporter_executor;
ALTER FUNCTION core.reporter_news_translation_pending(uuid) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_translation_claim(text,integer) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_translation_finish(uuid,text,uuid,jsonb) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_translation_fail(uuid,text,uuid,text,integer) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_translation_retry(uuid) OWNER TO reporter_executor;
ALTER FUNCTION core.reporter_news_item_json(public.reporter_news_items,boolean) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_worker_pending() OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_item(uuid) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_page(timestamptz,timestamptz,uuid,timestamptz,integer) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_news_translation_active(public.reporter_news_items),core.reporter_news_translation_pending(uuid),
  public.reporter_news_translation_claim(text,integer),public.reporter_news_translation_finish(uuid,text,uuid,jsonb),
  public.reporter_news_translation_fail(uuid,text,uuid,text,integer),public.reporter_news_translation_retry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_news_translation_claim(text,integer),public.reporter_news_translation_finish(uuid,text,uuid,jsonb),
  public.reporter_news_translation_fail(uuid,text,uuid,text,integer) TO reporter_worker;
GRANT EXECUTE ON FUNCTION public.reporter_news_translation_retry(uuid) TO reporter_runtime;
COMMIT;
