-- Seafood clipping is additive. Preserve existing news IDs, decisions and source provenance.
BEGIN;
ALTER TABLE public.reporter_news_items ADD COLUMN IF NOT EXISTS clipping_segment text
  CHECK(clipping_segment IN ('aquaculture','fishing','industry','retail','food-service','institutional'));
CREATE INDEX IF NOT EXISTS idx_reporter_news_clipping_story
  ON public.reporter_news_items(portal_id,clipping_segment,published_at) WHERE clipping_segment IS NOT NULL;

CREATE OR REPLACE FUNCTION core.reporter_news_clipping(p_portal uuid,p_config jsonb DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT coalesce(coalesce(p_config,(SELECT config FROM public.reporter_news_search WHERE portal_id=p_portal))->>'portalUrl'
    ~* '^https?://([a-z0-9-]+[.])*seafoodbrasil[.]com[.]br[.]*([:/?#]|$)',false)
    OR EXISTS(SELECT FROM public.portals p LEFT JOIN public.reporter_workspaces w ON w.portal_id=p.id
      WHERE p.id=p_portal AND (w.pilot OR p.slug IN ('seafood-brasil','seafoodbrasil') OR lower(btrim(p.name))='seafood brasil'))
$$;
REVOKE ALL ON FUNCTION core.reporter_news_clipping(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.reporter_news_clipping(uuid,jsonb) TO reporter_executor;

CREATE OR REPLACE FUNCTION core.reporter_news_rotation(p_portal uuid,p_config jsonb) RETURNS integer
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT CASE WHEN core.reporter_news_clipping(p_portal,p_config) THEN 36
    ELSE jsonb_array_length(p_config->'topics') * jsonb_array_length(p_config->'languages') * 2 END
$$;

CREATE OR REPLACE FUNCTION core.reporter_news_clipping_blocked(p_url text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT coalesce(rtrim(substring(lower(p_url) FROM '^https?://([^/:?#]+)'),'.') ~ '(^|[.])seafoodbrasil[.]com[.]br$',false)
$$;

CREATE OR REPLACE FUNCTION core.reporter_news_story_similar(a text,b text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
  WITH keys AS (SELECT string_to_array(a,' ') AS left_words, string_to_array(b,' ') AS right_words),
  shared AS (SELECT count(*) AS size FROM (SELECT unnest(left_words) FROM keys INTERSECT SELECT unnest(right_words) FROM keys) words),
  aliases(word,canonical) AS (VALUES ('biggest','largest'),('opens','open'),('opened','open'),('opening','open'),
    ('farms','farm'),('scottish','scotland')),
  normalized AS (
    SELECT ARRAY(SELECT DISTINCT coalesce(canonical,token) FROM unnest(left_words) token LEFT JOIN aliases ON word=token) AS left_words,
      ARRAY(SELECT DISTINCT coalesce(canonical,token) FROM unnest(right_words) token LEFT JOIN aliases ON word=token) AS right_words
    FROM keys
  ), openings AS (
    SELECT cardinality(left_words) AS left_size,cardinality(right_words) AS right_size,
      ARRAY(SELECT unnest(left_words) INTERSECT SELECT unnest(right_words)) AS common
    FROM normalized
  )
  SELECT ARRAY(SELECT word FROM unnest(keys.left_words) word WHERE word ~ '[0-9]')
      = ARRAY(SELECT word FROM unnest(right_words) word WHERE word ~ '[0-9]')
    AND (size >= 5 AND size*5 >= 4*(cardinality(keys.left_words)+cardinality(keys.right_words)-size)
      -- Reworded farm openings also need a shared distinguishing word beyond the action, subject and country.
      OR common @> ARRAY['farm','largest','open'] AND cardinality(common) >= 6
        AND cardinality(common)*4 >= 3*greatest(left_size,right_size)
        AND EXISTS(SELECT FROM unnest(common) token WHERE length(token)>=7
          AND token NOT IN ('capacity','largest','officially','scotland','seafood','aquaculture')))
  FROM keys CROSS JOIN shared CROSS JOIN openings
$$;

CREATE OR REPLACE FUNCTION core.reporter_news_reference_quality(p_url text,p_chars integer,p_kind text,p_segment text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT CASE WHEN p_segment IS NOT NULL AND
    lower(substring(p_url FROM '^https?://([^/:?#]+)')) ~ '(^|[.])(gov[.]br|fao[.]org|europa[.]eu|woah[.]org|gov)$' THEN 50000 ELSE 0 END
    + CASE WHEN p_kind='article' THEN 21000 ELSE 0 END + least(coalesce(p_chars,0),20000)
$$;

REVOKE ALL ON FUNCTION core.reporter_news_rotation(uuid,jsonb),core.reporter_news_clipping_blocked(text),
  core.reporter_news_story_similar(text,text),core.reporter_news_reference_quality(text,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.reporter_news_rotation(uuid,jsonb),core.reporter_news_clipping_blocked(text),
  core.reporter_news_story_similar(text,text),core.reporter_news_reference_quality(text,integer,text,text) TO reporter_executor;


CREATE OR REPLACE FUNCTION public.reporter_news_search_view() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_news_portal('reporter.read'); result jsonb;
BEGIN
  SELECT core.reporter_news_search_json(s)||jsonb_build_object('domains',s.domains) INTO result
    FROM public.reporter_news_search s WHERE portal_id=portal;
  RETURN coalesce(result,'{"revision":0,"state":"idle","usedToday":0,"lastAdded":0}'::jsonb)||jsonb_build_object('clipping',core.reporter_news_clipping(portal));
END $$;

CREATE OR REPLACE FUNCTION public.reporter_news_search_save(p_revision integer,p_config jsonb,p_domains text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); current public.reporter_news_search; total integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('news-search:'||portal::text,0));
  SELECT * INTO current FROM public.reporter_news_search WHERE portal_id=portal FOR UPDATE;
  IF p_revision IS DISTINCT FROM coalesce(current.revision,0) THEN RAISE EXCEPTION 'NEWS_SEARCH_CONFLICT' USING ERRCODE='40001'; END IF;
  IF p_config IS NULL OR jsonb_typeof(p_config)<>'object'
    OR NOT p_config ?& ARRAY['portalUrl','sector','region','topics','languages','excludedDomains','everyMinutes','dailyLimit','enabled']
    OR p_config-ARRAY['portalUrl','sector','region','topics','languages','excludedDomains','everyMinutes','dailyLimit','enabled','windowHours']<>'{}'
    OR p_config ? 'windowHours' AND (jsonb_typeof(p_config->'windowHours') IS DISTINCT FROM 'number'
      OR p_config->>'windowHours' NOT IN ('24','48','72','168','720','8760'))
    OR jsonb_typeof(p_config->'topics') IS DISTINCT FROM 'array' OR jsonb_typeof(p_config->'languages') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_config->'excludedDomains') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_config->'sector') IS DISTINCT FROM 'string' OR jsonb_typeof(p_config->'region') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_config->'everyMinutes') IS DISTINCT FROM 'number' OR jsonb_typeof(p_config->'dailyLimit') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_config->'enabled') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_config->'portalUrl') IS DISTINCT FROM 'string' OR p_config->>'portalUrl' !~ '^https?://'
    OR length(p_config->>'portalUrl')>2000 OR length(p_config->>'sector') NOT BETWEEN 1 AND 160 OR length(p_config->>'region')>100
    OR (p_config->>'everyMinutes')::int NOT IN (60,120,360) OR (p_config->>'dailyLimit')::int NOT BETWEEN 1 AND 48
    OR cardinality(p_domains) NOT BETWEEN 1 AND 24 THEN RAISE EXCEPTION 'NEWS_SEARCH_INVALID' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_config->'topics') NOT BETWEEN 1 AND 6 OR jsonb_array_length(p_config->'languages') NOT BETWEEN 1 AND 3
    OR jsonb_array_length(p_config->'excludedDomains')>20
    OR EXISTS(SELECT FROM jsonb_array_elements(p_config->'topics') t WHERE jsonb_typeof(t)<>'string' OR length(btrim(t#>>'{}')) NOT BETWEEN 1 AND 160)
    OR EXISTS(SELECT FROM jsonb_array_elements_text(p_config->'languages') l WHERE l NOT IN ('pt','en','es'))
    OR EXISTS(SELECT FROM unnest(p_domains) d WHERE d !~ '^[a-z0-9][a-z0-9.-]*\.[a-z0-9.-]+$')
    THEN RAISE EXCEPTION 'NEWS_SEARCH_INVALID' USING ERRCODE='22023'; END IF;
  total := core.reporter_news_rotation(portal,p_config);
  INSERT INTO public.reporter_news_search(portal_id,config,domains,remaining) VALUES(portal,p_config,p_domains,CASE WHEN (p_config->>'enabled')::boolean THEN total ELSE 0 END)
    ON CONFLICT(portal_id) DO UPDATE SET config=p_config,domains=p_domains,revision=reporter_news_search.revision+1,
      remaining=CASE WHEN (p_config->>'enabled')::boolean THEN total ELSE 0 END,cursor=0,next_at=clock_timestamp(),
      failures=0,last_error=NULL,lease_owner=NULL,lease_until=NULL,fence=NULL,updated_at=clock_timestamp();
  PERFORM core.reporter_audit(portal,'reporter.news_search.saved','portal',portal,jsonb_build_object('revision',coalesce(current.revision,0)+1));
  RETURN public.reporter_news_search_view();
END $$;

CREATE OR REPLACE FUNCTION public.reporter_news_search_request() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit'); s public.reporter_news_search;
BEGIN
  SELECT * INTO s FROM public.reporter_news_search WHERE portal_id=portal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWS_SEARCH_MISSING' USING ERRCODE='22023'; END IF;
  IF NOT (s.config->>'enabled')::boolean THEN RAISE EXCEPTION 'NEWS_SEARCH_PAUSED' USING ERRCODE='22023'; END IF;
  IF s.budget_day=(now() AT TIME ZONE 'UTC')::date AND s.used_today>=(s.config->>'dailyLimit')::int THEN
    RAISE EXCEPTION 'NEWS_SEARCH_LIMIT' USING ERRCODE='22023'; END IF;
  -- Repeated clicks join existing work. They never reset a lease, cursor or retry wait.
  IF s.remaining=0 AND coalesce(s.lease_until,'-infinity')<clock_timestamp() THEN
    UPDATE public.reporter_news_search SET remaining=core.reporter_news_rotation(portal,config),
      next_at=greatest(clock_timestamp(),coalesce(last_run_at,'-infinity')+interval '1 minute'),last_error=NULL,failures=0 WHERE portal_id=portal;
    PERFORM core.reporter_audit(portal,'reporter.news_search.requested','portal',portal,'{}');
  END IF;
  RETURN public.reporter_news_search_view();
END $$;

CREATE OR REPLACE FUNCTION public.reporter_news_claim(p_owner text,p_source uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_news_portal('reporter.edit'); source public.reporter_news_sources;
BEGIN
  IF p_owner IS NULL OR length(p_owner) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'Invalid lease owner' USING ERRCODE='22023'; END IF;
  IF p_source IS NULL THEN
    IF NOT core.reporter_workspace_accepts_automation(portal) THEN RETURN NULL; END IF;
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
  RETURN jsonb_strip_nulls(jsonb_build_object('actor',source.initiated_by,'id',source.id,'kind',source.kind,'name',source.name,'url',source.url,
    'clipping',core.reporter_news_clipping(portal),
    'windowHours',(SELECT config->'windowHours' FROM public.reporter_news_search WHERE portal_id=portal),
    'keyword',source.keyword,'etag',source.etag,'lastModified',source.last_modified,'firstRead',source.last_read_at IS NULL));
END $$;

CREATE OR REPLACE FUNCTION public.reporter_news_search_claim(p_owner text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_news_portal('reporter.edit'); s public.reporter_news_search;
BEGIN
  IF NOT core.reporter_workspace_accepts_automation(portal) THEN RETURN NULL; END IF;
  PERFORM core.reporter_worker_require();
  IF p_owner IS NULL OR p_owner !~ '^[a-zA-Z0-9_-]{8,128}$' THEN RAISE EXCEPTION 'NEWS_SEARCH_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM public.reporter_news_search WHERE portal_id=portal AND core.reporter_news_search_due(portal) FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.reporter_news_search SET lease_owner=p_owner,lease_until=clock_timestamp()+interval '2 minutes',fence=gen_random_uuid(),
    used_today=CASE WHEN budget_day=(now() AT TIME ZONE 'UTC')::date THEN used_today+1 ELSE 1 END,
    budget_day=(now() AT TIME ZONE 'UTC')::date,
    remaining=CASE WHEN remaining=0 THEN core.reporter_news_rotation(portal,config) ELSE remaining END
    WHERE portal_id=portal RETURNING * INTO s;
  RETURN jsonb_build_object('actor',s.initiated_by,'clipping',core.reporter_news_clipping(portal,s.config),'fence',s.fence,'config',s.config,'domains',s.domains,'queryIndex',s.cursor);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_news_search_finish(p_owner text,p_fence uuid,p_items jsonb,p_query text,p_error text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_news_portal('reporter.edit'); s public.reporter_news_search; entry jsonb; placed record; added integer := 0;
BEGIN
  PERFORM core.reporter_worker_require();
  SELECT * INTO s FROM public.reporter_news_search WHERE portal_id=portal AND lease_owner=p_owner AND fence=p_fence
    AND lease_until>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)>10 OR length(p_query)>380
    OR p_error IS NOT NULL AND p_error !~ '^[A-Z0-9_]{1,64}$' THEN RAISE EXCEPTION 'NEWS_SEARCH_INVALID' USING ERRCODE='22023'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF core.reporter_news_excluded(portal,entry->>'url') THEN CONTINUE; END IF;
    SELECT * INTO placed FROM core.reporter_news_place(portal,NULL,'tavily',entry);
    IF placed.item_id IS NULL THEN CONTINUE; END IF;
    IF placed.outcome='inserted' THEN added := added+1; END IF;
    UPDATE public.reporter_news_items SET search_query=p_query,discovered_at=clock_timestamp(),
      search_content_kind=CASE WHEN placed.outcome='inserted' THEN coalesce(entry->>'contentKind','search') ELSE search_content_kind END,
      image_url=CASE WHEN canonical_url=entry->>'canonicalUrl' THEN coalesce(image_url,entry->>'image') ELSE image_url END,
      updated_at=clock_timestamp()
      WHERE id=placed.item_id AND portal_id=portal;
    -- A rediscovered RSS summary may gain page text. Fence any old translation in flight.
    IF placed.outcome='repeat' AND entry->>'contentKind'='article' THEN
      UPDATE public.reporter_news_items SET body=ARRAY(SELECT jsonb_array_elements_text(entry->'body')),
        excerpt=entry->>'excerpt',search_content_kind='article',content_revision=content_revision+1,
        translation_status='pending',translation_attempts=0,translation_next_at=clock_timestamp(),translation_requested_at=clock_timestamp(),
        translation_title=NULL,translation_excerpt=NULL,translation_body=NULL,translation_source_language=NULL,translation_error=NULL,
        translation_lease_owner=NULL,translation_lease_until=NULL,translation_fence=NULL,updated_at=clock_timestamp()
        WHERE id=placed.item_id AND portal_id=portal AND via<>'url' AND coalesce(search_content_kind,'feed')<>'article'
          AND canonical_url=entry->>'canonicalUrl' AND length(array_to_string(body,''))<length((entry->'body')::text);
    END IF;
  END LOOP;
  UPDATE public.reporter_news_search SET lease_owner=NULL,lease_until=NULL,fence=NULL,last_run_at=clock_timestamp(),last_error=p_error,
    last_added=added,failures=CASE WHEN p_error IS NULL THEN 0 ELSE failures+1 END,
    cursor=CASE WHEN p_error IS NULL OR failures>=2 THEN (cursor+1)%(core.reporter_news_rotation(portal,config)) ELSE cursor END,
    remaining=CASE WHEN p_error IS NOT NULL AND failures<2 THEN remaining ELSE greatest(0,remaining-1) END,
    next_at=clock_timestamp()+CASE WHEN p_error IS NOT NULL AND failures<2 THEN interval '5 minutes'
      WHEN remaining>1 THEN interval '0 seconds' ELSE make_interval(mins=>(config->>'everyMinutes')::int) END,
    updated_at=clock_timestamp() WHERE portal_id=portal;
  PERFORM core.reporter_audit(portal,'reporter.news_search.finished','portal',portal,jsonb_build_object('added',added,'error',p_error));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION core.reporter_news_excluded(p_portal uuid,p_url text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT core.reporter_news_clipping_blocked(p_url) OR EXISTS(SELECT FROM public.reporter_news_search s CROSS JOIN unnest(s.domains) d WHERE s.portal_id=p_portal
    AND (rtrim(lower(substring(p_url FROM '^https?://([^/:?#]+)')),'.')=d
      OR rtrim(lower(substring(p_url FROM '^https?://([^/:?#]+)')),'.') LIKE '%.'||d))
$$;

CREATE OR REPLACE FUNCTION core.reporter_news_place(p_portal uuid,p_source uuid,p_via text,p_entry jsonb)
RETURNS TABLE(item_id uuid,outcome text)
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE existing public.reporter_news_items; published timestamptz := (p_entry->>'publishedAt')::timestamptz; new_id uuid;
  clipping boolean := core.reporter_news_clipping(p_portal);
  segment text := CASE WHEN clipping THEN p_entry->>'clippingSegment' END;
BEGIN
  IF core.reporter_news_excluded(p_portal,p_entry->>'url') THEN RETURN; END IF;
  IF clipping AND (segment IS NULL OR segment NOT IN ('aquaculture','fishing','industry','retail','food-service','institutional')
    OR p_entry->>'clippingExcluded'='true') THEN RETURN; END IF;
  -- Feeds and pasted links may arrive together. Serialize the identity/story decision so two
  -- new outlets cannot both create the first row, or lose a duplicate added by the other read.
  PERFORM pg_advisory_xact_lock(hashtextextended('reporter_news_items:'||p_portal::text,0));
  SELECT * INTO existing FROM public.reporter_news_items WHERE portal_id=p_portal
    AND (canonical_url=p_entry->>'canonicalUrl' OR (p_source IS NOT NULL AND source_id=p_source AND guid=p_entry->>'guid')
      OR duplicates @> jsonb_build_array(jsonb_build_object('key',p_entry->>'canonicalUrl')))
    LIMIT 1;
  IF FOUND THEN RETURN QUERY SELECT existing.id,'repeat'::text; RETURN; END IF;
  IF p_entry->>'storyKey' IS NOT NULL THEN
    SELECT * INTO existing FROM public.reporter_news_items WHERE portal_id=p_portal AND (story_key=p_entry->>'storyKey' OR
      clipping AND clipping_segment=segment AND core.reporter_news_story_similar(story_key,p_entry->>'storyKey'))
      AND published_at BETWEEN published-interval '72 hours' AND published+interval '72 hours'
      AND lower(outlet)<>lower(p_entry->>'outlet')
      ORDER BY (story_key=p_entry->>'storyKey') DESC NULLS LAST,published_at,id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      IF jsonb_array_length(existing.duplicates)<100
        AND NOT EXISTS(SELECT FROM jsonb_array_elements(existing.duplicates) d WHERE lower(d->>'source')=lower(p_entry->>'outlet')) THEN
        UPDATE public.reporter_news_items SET updated_at=clock_timestamp(),
          duplicates=(SELECT jsonb_agg(d ORDER BY d->>'publishedAt') FROM jsonb_array_elements(existing.duplicates||jsonb_build_array(
            jsonb_build_object('source',p_entry->>'outlet','url',p_entry->>'url','key',p_entry->>'canonicalUrl','publishedAt',published,
              'quality',CASE WHEN clipping THEN core.reporter_news_reference_quality(p_entry->>'url',
                length(array_to_string(ARRAY(SELECT jsonb_array_elements_text(p_entry->'body')),' ')),coalesce(p_entry->>'contentKind',CASE WHEN p_via='url' THEN 'article' END),segment) END))) d)
          WHERE id=existing.id;
        RETURN QUERY SELECT existing.id,'grouped'::text; RETURN;
      END IF;
      RETURN QUERY SELECT existing.id,'repeat'::text; RETURN;
    END IF;
  END IF;
  BEGIN
    INSERT INTO public.reporter_news_items(portal_id,source_id,via,guid,url,canonical_url,title,outlet,excerpt,body,image_url,
        story_key,published_at,imported_by,clipping_segment,search_content_kind)
      VALUES(p_portal,p_source,p_via,p_entry->>'guid',p_entry->>'url',p_entry->>'canonicalUrl',p_entry->>'title',p_entry->>'outlet',
        coalesce(p_entry->>'excerpt',''),coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_entry->'body','[]'::jsonb))),'{}'),
        p_entry->>'image',p_entry->>'storyKey',published,CASE WHEN p_via='url' THEN core.context_user_id() END,segment,p_entry->>'contentKind')
      ON CONFLICT DO NOTHING RETURNING id INTO new_id;
  EXCEPTION WHEN check_violation OR not_null_violation THEN
    -- An entry the rules refuse is skipped; the rest of the read goes on.
    RETURN;
  END;
  IF new_id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT new_id,'inserted'::text;
END $$;

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
    'clippingSegment',i.clipping_segment,
    'sourceQuality',CASE WHEN i.clipping_segment IS NOT NULL THEN core.reporter_news_reference_quality(i.url,
      length(array_to_string(i.body,' ')),coalesce(i.search_content_kind,CASE WHEN i.via='url' THEN 'article' END),i.clipping_segment) END,
    'productionId',i.production_id,'coveredAt',i.covered_at))
$$;

COMMIT;
