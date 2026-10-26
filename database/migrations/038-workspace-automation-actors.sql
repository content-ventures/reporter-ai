-- Scheduled work captures the account that configured it; legacy unknown actors remain explicit services.
BEGIN;
ALTER TABLE public.reporter_news_sources ADD COLUMN IF NOT EXISTS initiated_by uuid REFERENCES core.users(id) ON DELETE RESTRICT;
ALTER TABLE public.reporter_news_search ADD COLUMN IF NOT EXISTS initiated_by uuid REFERENCES core.users(id) ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION core.reporter_news_initiator() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF current_setting('app.access_mode',true) IN ('user','platform_workspace') AND core.context_user_id() IS NOT NULL THEN
    NEW.initiated_by:=core.context_user_id();
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER reporter_news_source_initiator BEFORE INSERT OR UPDATE OF name,url,every_minutes,paused ON public.reporter_news_sources
  FOR EACH ROW EXECUTE FUNCTION core.reporter_news_initiator();
CREATE OR REPLACE TRIGGER reporter_news_search_initiator BEFORE INSERT OR UPDATE OF config,domains ON public.reporter_news_search
  FOR EACH ROW EXECUTE FUNCTION core.reporter_news_initiator();
CREATE OR REPLACE FUNCTION core.reporter_news_import_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF NEW.portal_id=core.context_portal_id() AND current_setting('app.access_mode',true) IN ('job','user','platform_workspace') THEN
    NEW.imported_by:=coalesce(NEW.imported_by,core.context_user_id());
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER reporter_news_import_actor BEFORE INSERT ON public.reporter_news_items
  FOR EACH ROW EXECUTE FUNCTION core.reporter_news_import_actor();

CREATE OR REPLACE FUNCTION core.reporter_workspace_accepts_automation(p_portal uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT EXISTS(SELECT FROM public.reporter_workspaces WHERE portal_id=p_portal AND lifecycle='active')
$$;
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
    remaining=CASE WHEN remaining=0 THEN jsonb_array_length(config->'topics')*jsonb_array_length(config->'languages')*2 ELSE remaining END
    WHERE portal_id=portal RETURNING * INTO s;
  RETURN jsonb_build_object('actor',s.initiated_by,'fence',s.fence,'config',s.config,'domains',s.domains,'queryIndex',s.cursor);
END $$;

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
  RETURN jsonb_build_object('actor',item.imported_by,'id',item.id,'title',item.title,'excerpt',item.excerpt,'body',to_jsonb(item.body),
    'fence',item.translation_fence,'attempts',item.translation_attempts);
END $$;

ALTER FUNCTION core.reporter_workspace_accepts_automation(uuid) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION core.reporter_workspace_accepts_automation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.reporter_workspace_accepts_automation(uuid) TO reporter_executor;
ALTER FUNCTION core.reporter_news_initiator() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION core.reporter_news_initiator() FROM PUBLIC;
ALTER FUNCTION core.reporter_news_import_actor() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION core.reporter_news_import_actor() FROM PUBLIC;
ALTER FUNCTION public.reporter_news_claim(text,uuid) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_search_claim(text) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_news_translation_claim(text,integer) OWNER TO reporter_executor;
COMMIT;
