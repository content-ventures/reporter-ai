-- F2.1 · Entrada de notícias: the desk's sources and the news they bring. Safe to replay.
-- A repeat is dropped by identity (source + the feed's own id) or by link (canonical address);
-- the same story from another outlet joins the first item as a duplicate (REQ-2.1). The runtime
-- and the worker only EXECUTE these functions; the tables are reachable by the executor alone.
BEGIN;

CREATE TABLE IF NOT EXISTS public.reporter_news_sources(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id uuid NOT NULL REFERENCES public.portals(id),
  kind text NOT NULL CHECK(kind IN ('rss','google-alerts','rss-app')),
  name text NOT NULL CHECK(btrim(name)<>'' AND length(name)<=120),
  url text NOT NULL CHECK(url ~ '^https?://' AND length(url)<=2000),
  canonical_url text NOT NULL CHECK(canonical_url ~ '^https://' AND length(canonical_url)<=2000),
  site text CHECK(site IS NULL OR (site ~ '^https?://' AND length(site)<=2000)),
  keyword text CHECK(keyword IS NULL OR (btrim(keyword)<>'' AND length(keyword)<=200)),
  remote_id text CHECK(remote_id IS NULL OR remote_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  every_minutes integer NOT NULL CHECK(every_minutes IN (15,30,60,120,360)),
  paused boolean NOT NULL DEFAULT false,
  failures integer NOT NULL DEFAULT 0 CHECK(failures>=0),
  last_error text CHECK(last_error IS NULL OR last_error ~ '^[A-Z0-9_]{1,64}$'),
  last_read_at timestamptz,
  next_read_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text CHECK(lease_owner IS NULL OR length(lease_owner)<=128),
  lease_until timestamptz,
  etag text CHECK(etag IS NULL OR length(etag)<=500),
  last_modified text CHECK(last_modified IS NULL OR length(last_modified)<=100),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(portal_id,canonical_url)
);
CREATE INDEX IF NOT EXISTS idx_reporter_news_sources_due ON public.reporter_news_sources(portal_id,next_read_at) WHERE NOT paused;

CREATE TABLE IF NOT EXISTS public.reporter_news_items(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id uuid NOT NULL REFERENCES public.portals(id),
  -- Removing a source never removes the news it brought.
  source_id uuid REFERENCES public.reporter_news_sources(id) ON DELETE SET NULL,
  via text NOT NULL CHECK(via IN ('rss','url')),
  guid text NOT NULL CHECK(length(guid) BETWEEN 1 AND 500),
  url text NOT NULL CHECK(url ~ '^https?://' AND length(url)<=2000),
  canonical_url text NOT NULL CHECK(canonical_url ~ '^https://' AND length(canonical_url)<=2000),
  title text NOT NULL CHECK(btrim(title)<>'' AND length(title)<=300),
  outlet text NOT NULL CHECK(btrim(outlet)<>'' AND length(outlet)<=120),
  excerpt text NOT NULL DEFAULT '' CHECK(length(excerpt)<=400),
  body text[] NOT NULL DEFAULT '{}' CHECK(cardinality(body)<=400 AND length(array_to_string(body,''))<=20000),
  image_url text CHECK(image_url IS NULL OR (image_url ~ '^https?://' AND length(image_url)<=2000)),
  story_key text CHECK(story_key IS NULL OR length(story_key)<=1000),
  -- {source,url,key,publishedAt} of every other outlet that ran the same story, oldest first.
  duplicates jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(duplicates)='array' AND jsonb_array_length(duplicates)<=100),
  published_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  imported_by uuid,
  UNIQUE(portal_id,canonical_url)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reporter_news_items_identity ON public.reporter_news_items(portal_id,source_id,guid) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reporter_news_items_updated ON public.reporter_news_items(portal_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reporter_news_items_story ON public.reporter_news_items(portal_id,story_key,published_at) WHERE story_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reporter_news_items_source ON public.reporter_news_items(source_id,imported_at) WHERE source_id IS NOT NULL;

ALTER TABLE public.reporter_news_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reporter_news_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_news_sources,public.reporter_news_items FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.reporter_news_sources,public.reporter_news_items TO reporter_executor;
DROP POLICY IF EXISTS reporter_news_sources_executor ON public.reporter_news_sources;
CREATE POLICY reporter_news_sources_executor ON public.reporter_news_sources TO reporter_executor USING(true) WITH CHECK(true);
DROP POLICY IF EXISTS reporter_news_items_executor ON public.reporter_news_items;
CREATE POLICY reporter_news_items_executor ON public.reporter_news_items TO reporter_executor USING(true) WITH CHECK(true);

-- The portal of the caller: the worker job, or a member with the permission.
CREATE OR REPLACE FUNCTION core.reporter_news_portal(p_permission text) RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid;
BEGIN
  IF current_setting('app.access_mode',true)='job' THEN
    PERFORM core.reporter_worker_require();
    portal := core.context_portal_id();
    IF portal IS NULL THEN RAISE EXCEPTION 'Portal context missing' USING ERRCODE='42501'; END IF;
    RETURN portal;
  END IF;
  RETURN core.reporter_require(p_permission);
END $$;

-- Check write permission before the server reads a URL or creates a paid external feed.
CREATE OR REPLACE FUNCTION public.reporter_news_require_edit() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  PERFORM core.reporter_require('reporter.edit');
END $$;

-- One source as the screens read it. Counts are rolling 24-hour windows, the last one is "em 24 h".
CREATE OR REPLACE FUNCTION core.reporter_news_source_json(s public.reporter_news_sources) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id',s.id,'kind',s.kind,'name',s.name,'url',s.url,'site',s.site,
    'keyword',s.keyword,'everyMinutes',s.every_minutes,'paused',s.paused,'failures',s.failures,'lastError',s.last_error,
    'lastReadAt',s.last_read_at,'nextReadAt',s.next_read_at,'createdAt',s.created_at,
    'lastWeek',(SELECT jsonb_agg(c.n ORDER BY d.k DESC) FROM generate_series(0,6) d(k)
      CROSS JOIN LATERAL (SELECT count(*) AS n FROM public.reporter_news_items i WHERE i.source_id=s.id
        AND i.imported_at>clock_timestamp()-(d.k+1)*interval '1 day' AND i.imported_at<=clock_timestamp()-d.k*interval '1 day') c)))
$$;

CREATE OR REPLACE FUNCTION core.reporter_news_item_json(i public.reporter_news_items,p_body boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id',i.id,'sourceId',i.source_id,'via',i.via,'url',i.url,'title',i.title,
    'outlet',i.outlet,'excerpt',i.excerpt,'publishedAt',i.published_at,'importedAt',i.imported_at,'updatedAt',i.updated_at,
    'duplicates',i.duplicates,'paragraphs',cardinality(i.body),'body',CASE WHEN p_body THEN to_jsonb(i.body) END))
$$;

-- Sources are a small complete snapshot (at most 30), including an empty list after the last
-- source is removed in another session. News remain incremental to keep their larger list cheap.
CREATE OR REPLACE FUNCTION public.reporter_news_view(p_since timestamptz,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); read_at timestamptz := clock_timestamp();
BEGIN
  RETURN jsonb_build_object('at',read_at,
    'sources',coalesce((SELECT jsonb_agg(core.reporter_news_source_json(s) ORDER BY s.created_at,s.id)
      FROM public.reporter_news_sources s WHERE s.portal_id=portal),'[]'::jsonb),
    'items',coalesce((SELECT jsonb_agg(x.item ORDER BY x.updated_at DESC,x.id)
      FROM (SELECT core.reporter_news_item_json(i,false) AS item,i.updated_at,i.id FROM public.reporter_news_items i
        WHERE i.portal_id=portal AND i.imported_at>read_at-interval '7 days' AND (p_since IS NULL OR i.updated_at>p_since)
        ORDER BY i.updated_at DESC,i.id LIMIT least(greatest(coalesce(p_limit,400),1),500)) x),'[]'::jsonb),
    'due',EXISTS(SELECT FROM public.reporter_news_sources WHERE portal_id=portal AND NOT paused AND next_read_at<=read_at
      AND coalesce(lease_until,'-infinity'::timestamptz)<read_at));
END $$;

CREATE OR REPLACE FUNCTION public.reporter_news_item(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); item public.reporter_news_items;
BEGIN
  SELECT * INTO item FROM public.reporter_news_items WHERE id=p_id AND portal_id=portal;
  RETURN CASE WHEN FOUND THEN core.reporter_news_item_json(item,true) END;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_news_source_add(p_kind text,p_name text,p_url text,p_canonical text,p_every integer,
  p_site text,p_keyword text,p_remote_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); source public.reporter_news_sources;
BEGIN
  -- One writer at a time per portal keeps the source limit exact.
  PERFORM pg_advisory_xact_lock(hashtextextended('reporter_news_sources:'||portal::text,0));
  IF EXISTS(SELECT FROM public.reporter_news_sources WHERE portal_id=portal AND canonical_url=p_canonical) THEN
    RAISE EXCEPTION 'NEWS_SOURCE_DUPLICATE' USING ERRCODE='23505';
  END IF;
  IF (SELECT count(*) FROM public.reporter_news_sources WHERE portal_id=portal)>=30 THEN
    RAISE EXCEPTION 'NEWS_SOURCE_LIMIT' USING ERRCODE='54000';
  END IF;
  INSERT INTO public.reporter_news_sources(portal_id,kind,name,url,canonical_url,site,keyword,remote_id,every_minutes)
    VALUES(portal,p_kind,btrim(p_name),p_url,p_canonical,p_site,nullif(btrim(p_keyword),''),p_remote_id,p_every) RETURNING * INTO source;
  PERFORM core.reporter_audit(portal,'reporter.news_source.added','news_source',source.id,
    jsonb_strip_nulls(jsonb_build_object('kind',source.kind,'name',source.name,'url',source.url,'every_minutes',source.every_minutes)));
  RETURN core.reporter_news_source_json(source);
END $$;

-- Name, frequency and pause. Resuming makes the source due at once.
CREATE OR REPLACE FUNCTION public.reporter_news_source_update(p_id uuid,p_name text,p_every integer,p_paused boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); source public.reporter_news_sources; before public.reporter_news_sources;
BEGIN
  SELECT * INTO before FROM public.reporter_news_sources WHERE id=p_id AND portal_id=portal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWS_SOURCE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  UPDATE public.reporter_news_sources SET name=coalesce(nullif(btrim(p_name),''),name),every_minutes=coalesce(p_every,every_minutes),
      paused=coalesce(p_paused,paused),
      next_read_at=CASE WHEN p_paused IS FALSE AND before.paused THEN clock_timestamp()
        WHEN p_every IS NOT NULL AND p_every<>before.every_minutes
          THEN least(next_read_at,coalesce(last_read_at,clock_timestamp())+p_every*interval '1 minute') ELSE next_read_at END,
      updated_at=clock_timestamp()
    WHERE id=p_id RETURNING * INTO source;
  PERFORM core.reporter_audit(portal,'reporter.news_source.updated','news_source',source.id,
    jsonb_build_object('name',source.name,'every_minutes',source.every_minutes,'paused',source.paused));
  RETURN core.reporter_news_source_json(source);
END $$;

-- Returns what the caller needs to release outside (an RSS.app feed); the news stay.
CREATE OR REPLACE FUNCTION public.reporter_news_source_remove(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); source public.reporter_news_sources;
BEGIN
  -- Match ingestion's source-then-item lock order while a feed is being read.
  SELECT * INTO source FROM public.reporter_news_sources WHERE id=p_id AND portal_id=portal FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- The foreign key clears source_id; advance the items' cursor so other desks see that change.
  UPDATE public.reporter_news_items SET updated_at=clock_timestamp() WHERE source_id=p_id AND portal_id=portal;
  DELETE FROM public.reporter_news_sources WHERE id=p_id AND portal_id=portal;
  PERFORM core.reporter_audit(portal,'reporter.news_source.removed','news_source',source.id,
    jsonb_build_object('kind',source.kind,'name',source.name,'url',source.url));
  RETURN jsonb_strip_nulls(jsonb_build_object('id',source.id,'kind',source.kind,'remoteId',source.remote_id));
END $$;

-- Leases one source for a read: the worker takes the most overdue one, a member a named one
-- ("Tentar de novo", a new source). NULL when nothing is due or another read holds it.
CREATE OR REPLACE FUNCTION public.reporter_news_claim(p_owner text,p_source uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_news_portal('reporter.edit'); source public.reporter_news_sources;
BEGIN
  IF p_owner IS NULL OR length(p_owner) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'Invalid lease owner' USING ERRCODE='22023'; END IF;
  IF p_source IS NULL THEN
    IF current_setting('app.access_mode',true) IS DISTINCT FROM 'job' THEN
      RAISE EXCEPTION 'Only the worker reads due sources' USING ERRCODE='42501';
    END IF;
    SELECT * INTO source FROM public.reporter_news_sources WHERE portal_id=portal AND NOT paused
      AND next_read_at<=clock_timestamp() AND coalesce(lease_until,'-infinity'::timestamptz)<clock_timestamp()
      ORDER BY next_read_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  ELSE
    SELECT * INTO source FROM public.reporter_news_sources WHERE id=p_source AND portal_id=portal
      AND coalesce(lease_until,'-infinity'::timestamptz)<clock_timestamp() FOR UPDATE SKIP LOCKED;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.reporter_news_sources SET lease_owner=p_owner,lease_until=clock_timestamp()+interval '2 minutes' WHERE id=source.id;
  RETURN jsonb_strip_nulls(jsonb_build_object('id',source.id,'kind',source.kind,'name',source.name,'url',source.url,
    'keyword',source.keyword,'etag',source.etag,'lastModified',source.last_modified,'firstRead',source.last_read_at IS NULL));
END $$;

-- Adds one normalized entry, or groups it as another outlet's version of a story already in the
-- queue. Returns the item it landed on and how: 'inserted', 'grouped' or 'repeat' (nothing changed).
CREATE OR REPLACE FUNCTION core.reporter_news_place(p_portal uuid,p_source uuid,p_via text,p_entry jsonb)
RETURNS TABLE(item_id uuid,outcome text)
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE existing public.reporter_news_items; published timestamptz := (p_entry->>'publishedAt')::timestamptz; new_id uuid;
BEGIN
  -- Feeds and pasted links may arrive together. Serialize the identity/story decision so two
  -- new outlets cannot both create the first row, or lose a duplicate added by the other read.
  PERFORM pg_advisory_xact_lock(hashtextextended('reporter_news_items:'||p_portal::text,0));
  SELECT * INTO existing FROM public.reporter_news_items WHERE portal_id=p_portal
    AND (canonical_url=p_entry->>'canonicalUrl' OR (p_source IS NOT NULL AND source_id=p_source AND guid=p_entry->>'guid')
      OR duplicates @> jsonb_build_array(jsonb_build_object('key',p_entry->>'canonicalUrl')))
    LIMIT 1;
  IF FOUND THEN RETURN QUERY SELECT existing.id,'repeat'::text; RETURN; END IF;
  IF p_entry->>'storyKey' IS NOT NULL THEN
    SELECT * INTO existing FROM public.reporter_news_items WHERE portal_id=p_portal AND story_key=p_entry->>'storyKey'
      AND published_at BETWEEN published-interval '72 hours' AND published+interval '72 hours'
      AND lower(outlet)<>lower(p_entry->>'outlet')
      ORDER BY published_at,id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      IF jsonb_array_length(existing.duplicates)<100
        AND NOT EXISTS(SELECT FROM jsonb_array_elements(existing.duplicates) d WHERE lower(d->>'source')=lower(p_entry->>'outlet')) THEN
        UPDATE public.reporter_news_items SET updated_at=clock_timestamp(),
          duplicates=(SELECT jsonb_agg(d ORDER BY d->>'publishedAt') FROM jsonb_array_elements(existing.duplicates||jsonb_build_array(
            jsonb_build_object('source',p_entry->>'outlet','url',p_entry->>'url','key',p_entry->>'canonicalUrl','publishedAt',published))) d)
          WHERE id=existing.id;
        RETURN QUERY SELECT existing.id,'grouped'::text; RETURN;
      END IF;
      RETURN QUERY SELECT existing.id,'repeat'::text; RETURN;
    END IF;
  END IF;
  BEGIN
    INSERT INTO public.reporter_news_items(portal_id,source_id,via,guid,url,canonical_url,title,outlet,excerpt,body,image_url,
        story_key,published_at,imported_by)
      VALUES(p_portal,p_source,p_via,p_entry->>'guid',p_entry->>'url',p_entry->>'canonicalUrl',p_entry->>'title',p_entry->>'outlet',
        coalesce(p_entry->>'excerpt',''),coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_entry->'body','[]'::jsonb))),'{}'),
        p_entry->>'image',p_entry->>'storyKey',published,CASE WHEN p_via='url' THEN core.context_user_id() END)
      ON CONFLICT DO NOTHING RETURNING id INTO new_id;
  EXCEPTION WHEN check_violation OR not_null_violation THEN
    -- An entry the rules refuse is skipped; the rest of the read goes on.
    RETURN;
  END;
  IF new_id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT new_id,'inserted'::text;
END $$;

-- A successful read: the entries (normalized, newest first) and the feed's cache validators.
CREATE OR REPLACE FUNCTION public.reporter_news_ingest(p_source uuid,p_owner text,p_items jsonb,p_etag text,p_last_modified text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_news_portal('reporter.edit'); source public.reporter_news_sources; entry jsonb;
  placed record; inserted integer := 0; grouped integer := 0;
BEGIN
  SELECT * INTO source FROM public.reporter_news_sources WHERE id=p_source AND portal_id=portal AND lease_owner=p_owner
    AND lease_until>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lease unavailable' USING ERRCODE='40001'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)>50 THEN
    RAISE EXCEPTION 'Invalid news batch' USING ERRCODE='22023';
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO placed FROM core.reporter_news_place(portal,source.id,'rss',entry);
    IF placed.outcome='inserted' THEN inserted := inserted+1; ELSIF placed.outcome='grouped' THEN grouped := grouped+1; END IF;
  END LOOP;
  UPDATE public.reporter_news_sources SET last_read_at=clock_timestamp(),failures=0,last_error=NULL,
      next_read_at=clock_timestamp()+every_minutes*interval '1 minute',lease_owner=NULL,lease_until=NULL,
      etag=left(p_etag,500),last_modified=left(p_last_modified,100),updated_at=clock_timestamp()
    WHERE id=source.id;
  RETURN jsonb_build_object('inserted',inserted,'grouped',grouped);
END $$;

-- A failed read keeps the code only; the next try waits for the source's own interval.
CREATE OR REPLACE FUNCTION public.reporter_news_failed(p_source uuid,p_owner text,p_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_news_portal('reporter.edit'); source public.reporter_news_sources;
BEGIN
  UPDATE public.reporter_news_sources SET failures=failures+1,
      last_error=CASE WHEN p_code ~ '^[A-Z0-9_]{1,64}$' THEN p_code ELSE 'UNAVAILABLE' END,
      next_read_at=clock_timestamp()+greatest(every_minutes,15)*interval '1 minute',lease_owner=NULL,lease_until=NULL,
      updated_at=clock_timestamp()
    WHERE id=p_source AND portal_id=portal AND lease_owner=p_owner RETURNING * INTO source;
  RETURN CASE WHEN FOUND THEN core.reporter_news_source_json(source) END;
END $$;

-- "Colar link" checks the queue before reading the page: a link already there opens its story.
CREATE OR REPLACE FUNCTION public.reporter_news_lookup(p_canonical text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read'); found uuid;
BEGIN
  SELECT id INTO found FROM public.reporter_news_items WHERE portal_id=portal
    AND (canonical_url=p_canonical OR duplicates @> jsonb_build_array(jsonb_build_object('key',p_canonical))) LIMIT 1;
  RETURN found;
END $$;

-- "Colar link": the page as one news item, or the item already in the queue with that story.
CREATE OR REPLACE FUNCTION public.reporter_news_import(p_item jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); placed record;
BEGIN
  IF jsonb_typeof(p_item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid news item' USING ERRCODE='22023'; END IF;
  SELECT * INTO placed FROM core.reporter_news_place(portal,NULL,'url',p_item);
  IF placed.item_id IS NULL THEN RAISE EXCEPTION 'NEWS_PAGE_INVALID' USING ERRCODE='22023'; END IF;
  IF placed.outcome='inserted' THEN
    PERFORM core.reporter_audit(portal,'reporter.news.imported','news_item',placed.item_id,jsonb_build_object('url',p_item->>'url'));
  END IF;
  RETURN jsonb_build_object('id',placed.item_id,'outcome',placed.outcome);
END $$;

-- The worker's cheap gate now also wakes for sources whose read is due.
CREATE OR REPLACE FUNCTION public.reporter_worker_pending() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := nullif(current_setting('app.portal_id',true),'')::uuid;
BEGIN
  PERFORM core.reporter_worker_require();
  IF portal IS NULL THEN RAISE EXCEPTION 'Portal context missing' USING ERRCODE='42501'; END IF;
  RETURN core.reporter_outbox_claimable_since(portal) IS NOT NULL
    OR core.reporter_remote_claimable_since(portal) IS NOT NULL
    OR core.reporter_editorial_claimable_since(portal) IS NOT NULL
    OR EXISTS(SELECT FROM public.reporter_news_sources WHERE portal_id=portal AND NOT paused
      AND next_read_at<=clock_timestamp() AND coalesce(lease_until,'-infinity'::timestamptz)<clock_timestamp());
END $$;

ALTER FUNCTION core.reporter_news_portal(text) OWNER TO reporter_executor;
ALTER FUNCTION core.reporter_news_source_json(public.reporter_news_sources) OWNER TO reporter_executor;
ALTER FUNCTION core.reporter_news_item_json(public.reporter_news_items,boolean) OWNER TO reporter_executor;
ALTER FUNCTION core.reporter_news_place(uuid,uuid,text,jsonb) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_require_edit() OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_view(timestamptz,integer) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_item(uuid) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_source_add(text,text,text,text,integer,text,text,text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_source_update(uuid,text,integer,boolean) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_source_remove(uuid) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_claim(text,uuid) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_ingest(uuid,text,jsonb,text,text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_failed(uuid,text,text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_import(jsonb) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_lookup(text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_worker_pending() OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_news_portal(text),core.reporter_news_source_json(public.reporter_news_sources),
  core.reporter_news_item_json(public.reporter_news_items,boolean),core.reporter_news_place(uuid,uuid,text,jsonb),
  public.reporter_news_require_edit(),
  public.reporter_news_view(timestamptz,integer),public.reporter_news_item(uuid),
  public.reporter_news_source_add(text,text,text,text,integer,text,text,text),public.reporter_news_source_update(uuid,text,integer,boolean),
  public.reporter_news_source_remove(uuid),public.reporter_news_claim(text,uuid),public.reporter_news_ingest(uuid,text,jsonb,text,text),
  public.reporter_news_failed(uuid,text,text),public.reporter_news_import(jsonb),public.reporter_news_lookup(text),
  public.reporter_worker_pending() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_news_require_edit(),public.reporter_news_view(timestamptz,integer),public.reporter_news_item(uuid),
  public.reporter_news_source_add(text,text,text,text,integer,text,text,text),public.reporter_news_source_update(uuid,text,integer,boolean),
  public.reporter_news_source_remove(uuid),public.reporter_news_import(jsonb),public.reporter_news_lookup(text) TO reporter_runtime;
GRANT EXECUTE ON FUNCTION public.reporter_news_claim(text,uuid),public.reporter_news_ingest(uuid,text,jsonb,text,text),
  public.reporter_news_failed(uuid,text,text) TO reporter_runtime,reporter_worker;
GRANT EXECUTE ON FUNCTION public.reporter_worker_pending() TO reporter_worker;
COMMENT ON FUNCTION public.reporter_news_view(timestamptz,integer) IS 'reporter-news-intake-v1';
COMMIT;
