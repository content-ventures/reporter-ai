-- Reporter AI R1 / PostgreSQL 17. Apply once through the approved migration ledger.
-- Requires reporter-foundation.sql from this repository. See database/README.md.
-- Apply reporter-r1-commands.sql in the same deployment before enabling clients.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT FROM unnest(ARRAY['core.users','core.tenants','core.tenant_members',
    'core.modules','core.tenant_modules','core.portal_modules','core.storage_objects',
    'core.integration_outbox','public.portals','public.portal_members','public.portal_roles',
    'public.portal_role_permissions','public.portal_user_roles','public.audit_log',
    'public.event_outbox']) AS dependency WHERE to_regclass(dependency) IS NULL)
    OR to_regprocedure('core.authorize_context(uuid,uuid,uuid,text,boolean)') IS NULL
    OR to_regprocedure('core.context_user_id()') IS NULL
    OR to_regprocedure('core.job_allowed(text[])') IS NULL
    OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname='reporter_runtime')
    OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname='reporter_worker')
  THEN RAISE EXCEPTION 'Reporter foundation/roles/helpers are incomplete'; END IF;
  IF to_regclass('public.reporter_transcripts') IS NOT NULL
    OR to_regclass('public.reporter_articles') IS NOT NULL
    OR to_regclass('public.reporter_carousels') IS NOT NULL
  THEN RAISE EXCEPTION 'Reporter tables already exist: use a reviewed forward migration, never overwrite'; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('reporter_runtime','reporter_worker')
    AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Runtime and worker must not be superuser or BYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='reporter_executor') THEN
    CREATE ROLE reporter_executor NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='reporter_executor' AND (rolcanlogin OR rolsuper OR rolbypassrls))
    OR pg_has_role('reporter_runtime','reporter_executor','MEMBER')
    OR pg_has_role('reporter_worker','reporter_executor','MEMBER') THEN
    RAISE EXCEPTION 'Command executor must be an isolated NOLOGIN role';
  END IF;
END $$;

-- Same-portal source and output references use the Reporter-owned storage catalog.
ALTER TABLE core.storage_objects
  ADD CONSTRAINT uq_storage_objects_portal_id_id UNIQUE (portal_id,id);
INSERT INTO core.modules(key,name) VALUES ('reporter_ai','Reporter AI')
  ON CONFLICT (key) DO NOTHING;
-- Never enable real tenants/portals or grant editorial permissions automatically.

CREATE FUNCTION public.reporter_segments_valid(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE segment jsonb; previous_end numeric := 0;
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value)<>'array' OR octet_length(value::text)>2097152
    OR jsonb_array_length(value)>20000 THEN RETURN false; END IF;
  FOR segment IN SELECT jsonb_array_elements(value) LOOP
    IF jsonb_typeof(segment)<>'object'
      OR NOT (segment ?& ARRAY['start_ms','end_ms','text'])
      OR segment - ARRAY['start_ms','end_ms','text'] <> '{}'
      OR jsonb_typeof(segment->'start_ms')<>'number'
      OR jsonb_typeof(segment->'end_ms')<>'number'
      OR jsonb_typeof(segment->'text')<>'string'
      OR btrim(segment->>'text')='' OR length(segment->>'text')>20000 THEN RETURN false; END IF;
    IF (segment->>'start_ms')::numeric < previous_end
      OR (segment->>'start_ms')::numeric <> trunc((segment->>'start_ms')::numeric)
      OR (segment->>'end_ms')::numeric <> trunc((segment->>'end_ms')::numeric)
      OR (segment->>'end_ms')::numeric < (segment->>'start_ms')::numeric
      THEN RETURN false; END IF;
    previous_end := (segment->>'end_ms')::numeric;
  END LOOP;
  RETURN true;
END $$;

-- Explicit safety ceilings, not approved Harness/product limits; see README.
CREATE FUNCTION public.reporter_slides_valid(value jsonb, allow_empty boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE slide jsonb;
BEGIN
  IF value IS NULL OR jsonb_typeof(value)<>'array' THEN RETURN false; END IF;
  IF octet_length(value::text)>1048576
    OR jsonb_array_length(value)>20
    OR (NOT allow_empty AND jsonb_array_length(value)=0) THEN RETURN false; END IF;
  FOR slide IN SELECT jsonb_array_elements(value) LOOP
    IF jsonb_typeof(slide)<>'object' OR NOT (slide ? 'body')
      OR slide - ARRAY['title','body'] <> '{}'
      OR jsonb_typeof(slide->'body')<>'string'
      OR btrim(slide->>'body')='' OR length(slide->>'body')>20000
      OR (slide ? 'title' AND (jsonb_typeof(slide->'title')<>'string'
        OR btrim(slide->>'title')='' OR length(slide->>'title')>500))
      THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

CREATE TABLE public.reporter_transcripts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  portal_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  source_object_id uuid NOT NULL,
  created_by uuid NOT NULL,
  language text NOT NULL DEFAULT 'pt-BR',
  content text,
  segments jsonb,
  status text NOT NULL DEFAULT 'queued',
  generation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_request_id text,
  provider text,
  model text,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_reporter_transcripts PRIMARY KEY(id),
  CONSTRAINT uq_reporter_transcripts_portal_id_id UNIQUE(portal_id,id),
  CONSTRAINT fk_reporter_transcripts_portal FOREIGN KEY(portal_id) REFERENCES public.portals(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reporter_transcripts_source_object FOREIGN KEY(portal_id,source_object_id)
    REFERENCES core.storage_objects(portal_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_reporter_transcripts_creator FOREIGN KEY(created_by) REFERENCES core.users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_reporter_transcripts_revision CHECK(revision>0),
  CONSTRAINT ck_reporter_transcripts_language CHECK(btrim(language)<>'' AND length(language)<=35),
  CONSTRAINT ck_reporter_transcripts_status CHECK(status IN ('queued','processing','ready','failed')),
  CONSTRAINT ck_reporter_transcripts_segments CHECK(public.reporter_segments_valid(segments)),
  CONSTRAINT ck_reporter_transcripts_result CHECK(
    (status='queued' AND content IS NULL AND segments IS NULL AND error_code IS NULL
      AND started_at IS NULL AND completed_at IS NULL)
    OR (status='processing' AND content IS NULL AND segments IS NULL AND error_code IS NULL
      AND started_at IS NOT NULL AND completed_at IS NULL)
    OR (status='ready' AND content IS NOT NULL AND btrim(content)<>''
      AND provider IS NOT NULL AND btrim(provider)<>'' AND model IS NOT NULL AND btrim(model)<>''
      AND started_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at>=started_at AND error_code IS NULL)
    OR (status='failed' AND content IS NULL AND segments IS NULL
      AND error_code IS NOT NULL AND btrim(error_code)<>''
      AND started_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at>=started_at)
  )
);

CREATE TABLE public.reporter_articles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  portal_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  source_kind text NOT NULL DEFAULT 'transcript',
  transcript_id uuid,
  source_object_id uuid,
  source_metadata jsonb NOT NULL DEFAULT '{}',
  title text,
  content text,
  status text NOT NULL DEFAULT 'generating',
  author_id uuid NOT NULL,
  approver_id uuid,
  approved_revision integer,
  review_comment text,
  generation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_request_id text,
  provider text,
  model text,
  error_code text,
  prompt_version text,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_reporter_articles PRIMARY KEY(id),
  CONSTRAINT uq_reporter_articles_portal_id_id UNIQUE(portal_id,id),
  CONSTRAINT uq_reporter_articles_approved_revision UNIQUE(portal_id,id,approved_revision),
  CONSTRAINT fk_reporter_articles_portal FOREIGN KEY(portal_id) REFERENCES public.portals(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reporter_articles_transcript FOREIGN KEY(portal_id,transcript_id)
    REFERENCES public.reporter_transcripts(portal_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_reporter_articles_source_object FOREIGN KEY(portal_id,source_object_id)
    REFERENCES core.storage_objects(portal_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_reporter_articles_author FOREIGN KEY(author_id) REFERENCES core.users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reporter_articles_approver FOREIGN KEY(approver_id) REFERENCES core.users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_reporter_articles_revision CHECK(revision>0),
  CONSTRAINT ck_reporter_articles_source CHECK(
    jsonb_typeof(source_metadata)='object' AND octet_length(source_metadata::text)<=16384 AND (
      (source_kind='transcript' AND transcript_id IS NOT NULL AND source_object_id IS NULL)
      OR (source_kind IN ('url','text') AND transcript_id IS NULL AND source_object_id IS NOT NULL))),
  CONSTRAINT ck_reporter_articles_status CHECK(status IN ('generating','draft','in_review','changes_requested','approved','failed')),
  CONSTRAINT ck_reporter_articles_content CHECK(
    ((status IN ('generating','failed') AND title IS NULL AND content IS NULL)
      OR (status NOT IN ('generating','failed') AND title IS NOT NULL AND btrim(title)<>''
        AND content IS NOT NULL AND btrim(content)<>'' AND provider IS NOT NULL AND btrim(provider)<>''
        AND model IS NOT NULL AND btrim(model)<>'' AND prompt_version IS NOT NULL AND btrim(prompt_version)<>''))
    AND (title IS NULL OR length(title)<=500)
    AND (content IS NULL OR octet_length(content)<=2097152)
    AND ((status='failed' AND error_code IS NOT NULL AND btrim(error_code)<>'')
      OR (status<>'failed' AND error_code IS NULL))),
  CONSTRAINT ck_reporter_articles_review_state CHECK(
    (status='approved' AND approver_id IS NOT NULL AND approved_revision IS NOT NULL AND approved_revision=revision
      AND submitted_at IS NOT NULL AND approved_at IS NOT NULL AND approved_at>=submitted_at)
    OR (status='changes_requested' AND approver_id IS NOT NULL AND approved_revision IS NULL
      AND submitted_at IS NOT NULL AND review_comment IS NOT NULL AND btrim(review_comment)<>''
      AND approved_at IS NULL)
    OR (status='in_review' AND approver_id IS NULL AND approved_revision IS NULL
      AND submitted_at IS NOT NULL AND approved_at IS NULL)
    OR (status IN ('generating','draft','failed') AND approver_id IS NULL
      AND approved_revision IS NULL AND submitted_at IS NULL AND approved_at IS NULL))
);

CREATE TABLE public.reporter_carousels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  portal_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  article_id uuid NOT NULL,
  article_revision integer NOT NULL,
  title text,
  slides jsonb NOT NULL DEFAULT '[]',
  slides_schema_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'generating',
  created_by uuid NOT NULL,
  generation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider_request_id text,
  provider text,
  model text,
  error_code text,
  prompt_version text,
  ready_at timestamptz,
  output_object_id uuid,
  output_revision integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_reporter_carousels PRIMARY KEY(id),
  CONSTRAINT uq_reporter_carousels_portal_id_id UNIQUE(portal_id,id),
  CONSTRAINT fk_reporter_carousels_portal FOREIGN KEY(portal_id) REFERENCES public.portals(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reporter_carousels_article FOREIGN KEY(portal_id,article_id,article_revision)
    REFERENCES public.reporter_articles(portal_id,id,approved_revision) ON DELETE RESTRICT,
  CONSTRAINT fk_reporter_carousels_creator FOREIGN KEY(created_by) REFERENCES core.users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reporter_carousels_output_object FOREIGN KEY(portal_id,output_object_id)
    REFERENCES core.storage_objects(portal_id,id) ON DELETE RESTRICT,
  CONSTRAINT ck_reporter_carousels_revision CHECK(revision>0 AND article_revision>0),
  CONSTRAINT ck_reporter_carousels_status CHECK(status IN ('generating','draft','ready','failed')),
  CONSTRAINT ck_reporter_carousels_slides CHECK(slides_schema_version=1
    AND public.reporter_slides_valid(slides,status IN ('generating','failed'))),
  CONSTRAINT ck_reporter_carousels_content CHECK(
    (status IN ('generating','failed') AND title IS NULL AND slides='[]')
    OR (status IN ('draft','ready') AND title IS NOT NULL AND btrim(title)<>'' AND length(title)<=500
      AND provider IS NOT NULL AND btrim(provider)<>'' AND model IS NOT NULL AND btrim(model)<>''
      AND prompt_version IS NOT NULL AND btrim(prompt_version)<>'')),
  CONSTRAINT ck_reporter_carousels_failure CHECK(
    (status='failed' AND error_code IS NOT NULL AND btrim(error_code)<>'')
    OR (status<>'failed' AND error_code IS NULL)),
  CONSTRAINT ck_reporter_carousels_ready CHECK(
    (status='ready' AND ready_at IS NOT NULL) OR (status<>'ready' AND ready_at IS NULL)),
  -- Reserved nullable fields match the visual contract, but export is disabled in R1.
  -- Enabling export requires a separate reviewed migration and exact-revision publishing command.
  CONSTRAINT ck_reporter_carousels_export_disabled CHECK(output_object_id IS NULL AND output_revision IS NULL)
);

CREATE INDEX idx_reporter_transcripts_portal_created ON public.reporter_transcripts(portal_id,created_at DESC);
CREATE INDEX idx_reporter_transcripts_portal_status_updated ON public.reporter_transcripts(portal_id,status,updated_at DESC);
CREATE INDEX idx_reporter_transcripts_source_object ON public.reporter_transcripts(portal_id,source_object_id);
CREATE INDEX idx_reporter_articles_portal_created ON public.reporter_articles(portal_id,created_at DESC);
CREATE INDEX idx_reporter_articles_portal_status_updated ON public.reporter_articles(portal_id,status,updated_at DESC);
CREATE INDEX idx_reporter_articles_review_queue ON public.reporter_articles(portal_id,submitted_at,id) WHERE status='in_review';
CREATE INDEX idx_reporter_articles_transcript ON public.reporter_articles(portal_id,transcript_id) WHERE transcript_id IS NOT NULL;
CREATE INDEX idx_reporter_articles_source_object ON public.reporter_articles(portal_id,source_object_id) WHERE source_object_id IS NOT NULL;
CREATE INDEX idx_reporter_carousels_portal_created ON public.reporter_carousels(portal_id,created_at DESC);
CREATE INDEX idx_reporter_carousels_portal_status_updated ON public.reporter_carousels(portal_id,status,updated_at DESC);
CREATE INDEX idx_reporter_carousels_article_revision ON public.reporter_carousels(portal_id,article_id,article_revision);

CREATE FUNCTION public.reporter_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old_row jsonb; new_row jsonb; immutable_fields text[]; valid_transition boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 OR (TG_TABLE_NAME='reporter_transcripts' AND NEW.status<>'queued')
      OR (TG_TABLE_NAME<>'reporter_transcripts' AND NEW.status<>'generating') THEN
      RAISE EXCEPTION 'Invalid initial state/revision' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='approved' OR (TG_TABLE_NAME='reporter_transcripts' AND OLD.status='ready') THEN
    RAISE EXCEPTION 'Approved articles and ready transcripts are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Expected next revision' USING ERRCODE='40001'; END IF;
  immutable_fields := ARRAY['id','portal_id','created_at'];
  IF TG_TABLE_NAME='reporter_transcripts' THEN
    immutable_fields := immutable_fields || ARRAY['source_object_id','created_by','language'];
    valid_transition := OLD.status=NEW.status OR
      (OLD.status='queued' AND NEW.status='processing') OR
      (OLD.status='processing' AND NEW.status IN ('ready','failed')) OR
      (OLD.status='failed' AND NEW.status='queued');
  ELSIF TG_TABLE_NAME='reporter_articles' THEN
    immutable_fields := immutable_fields || ARRAY['source_kind','transcript_id','source_object_id','source_metadata','author_id'];
    valid_transition := OLD.status=NEW.status OR
      (OLD.status='generating' AND NEW.status IN ('draft','failed')) OR
      (OLD.status='failed' AND NEW.status='generating') OR
      (OLD.status='draft' AND NEW.status='in_review') OR
      (OLD.status='in_review' AND NEW.status IN ('approved','changes_requested')) OR
      (OLD.status='changes_requested' AND NEW.status='draft');
    IF OLD.status='in_review' AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.content IS DISTINCT FROM OLD.content) THEN
      RAISE EXCEPTION 'Review content is frozen' USING ERRCODE='23514';
    END IF;
  ELSE
    immutable_fields := immutable_fields || ARRAY['article_id','article_revision','created_by','slides_schema_version'];
    valid_transition := OLD.status=NEW.status OR
      (OLD.status='generating' AND NEW.status IN ('draft','failed')) OR
      (OLD.status='failed' AND NEW.status='generating') OR
      (OLD.status='draft' AND NEW.status='ready') OR
      (OLD.status='ready' AND NEW.status='draft');
    IF OLD.status='ready' AND NEW.status<>'draft' THEN
      RAISE EXCEPTION 'Return carousel to draft before editing' USING ERRCODE='23514';
    END IF;
  END IF;
  old_row := to_jsonb(OLD); new_row := to_jsonb(NEW);
  IF EXISTS (SELECT FROM unnest(immutable_fields) key WHERE old_row->key IS DISTINCT FROM new_row->key) THEN
    RAISE EXCEPTION 'Scope, attribution and provenance are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.generation_id IS DISTINCT FROM OLD.generation_id
    AND NOT (OLD.status='failed' AND NEW.status IN ('queued','generating')) THEN
    RAISE EXCEPTION 'Generation can only change on an explicit failed retry' USING ERRCODE='23514';
  END IF;
  IF OLD.status NOT IN ('queued','processing','generating','failed') AND EXISTS (
    SELECT FROM unnest(ARRAY['generation_id','provider_request_id','provider','model','prompt_version']) key
      WHERE old_row->key IS DISTINCT FROM new_row->key) THEN
    RAISE EXCEPTION 'Generation metadata is frozen after processing' USING ERRCODE='23514';
  END IF;
  IF NOT valid_transition THEN RAISE EXCEPTION 'Invalid state transition' USING ERRCODE='23514'; END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;

-- Fixed module + explicit action. Never accept app.permissions supplied by the client.
CREATE FUNCTION core.reporter_allowed(p_portal uuid, p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT coalesce(current_setting('app.access_mode',true)='user'
    AND current_setting('app.module_key',true)='reporter_ai'
    AND p_portal=core.context_portal_id()
    AND core.authorize_context(core.context_tenant_id(),p_portal,core.context_user_id(),'reporter_ai',false)
    AND EXISTS(SELECT FROM public.portal_user_roles ur
      JOIN public.portal_roles r ON r.id=ur.portal_role_id AND r.portal_id=ur.portal_id
      JOIN public.portal_role_permissions rp ON rp.portal_role_id=r.id
      WHERE ur.portal_id=p_portal AND ur.user_id=core.context_user_id()
        AND rp.permission=p_permission),false)
$$;

-- A function owner must retain CREATE on its schema. The role is NOLOGIN and is
-- never granted to either application login; runtime/worker receive USAGE only.
GRANT USAGE,CREATE ON SCHEMA public,core TO reporter_executor;
GRANT USAGE ON SCHEMA public,core TO reporter_runtime,reporter_worker;
GRANT SELECT ON core.users,core.tenants,core.tenant_members,core.tenant_modules,core.portal_modules,
  public.portals,public.portal_members,public.portal_roles,public.portal_role_permissions,
  public.portal_user_roles,core.storage_objects TO reporter_executor;
GRANT SELECT,INSERT,UPDATE ON core.integration_outbox TO reporter_executor;
-- PostgreSQL row locking requires UPDATE privilege even for FOR SHARE.
GRANT UPDATE(id) ON core.storage_objects TO reporter_executor;
GRANT INSERT ON public.audit_log,public.event_outbox TO reporter_executor;
GRANT EXECUTE ON FUNCTION core.context_tenant_id(),core.context_portal_id(),core.context_user_id(),
  core.authorize_context(uuid,uuid,uuid,text,boolean),core.job_allowed(text[]) TO reporter_executor;

DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['core.users','core.tenants','core.tenant_members','core.tenant_modules',
    'core.portal_modules','public.portals','public.portal_members','public.portal_roles',
    'public.portal_role_permissions','public.portal_user_roles','core.storage_objects'] LOOP
    EXECUTE format('CREATE POLICY reporter_executor_read ON %s FOR SELECT TO reporter_executor USING(true)',relation);
  END LOOP;
  CREATE POLICY reporter_executor_transport ON core.integration_outbox TO reporter_executor USING(true) WITH CHECK(true);
  CREATE POLICY reporter_executor_storage_lock ON core.storage_objects FOR UPDATE TO reporter_executor USING(true) WITH CHECK(false);
  CREATE POLICY reporter_executor_audit ON public.audit_log FOR INSERT TO reporter_executor WITH CHECK(true);
  CREATE POLICY reporter_executor_events ON public.event_outbox FOR INSERT TO reporter_executor WITH CHECK(true);
  -- Prevent direct runtime writes bypassing the narrow processing commands.
  CREATE POLICY reporter_transport_runtime_boundary ON core.integration_outbox AS RESTRICTIVE
    TO reporter_runtime USING(module<>'reporter_ai') WITH CHECK(module<>'reporter_ai');
  FOREACH relation IN ARRAY ARRAY['public.reporter_transcripts','public.reporter_articles','public.reporter_carousels'] LOOP
    EXECUTE format('CREATE TRIGGER reporter_guard BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION public.reporter_guard()',relation);
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY',relation);
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC,reporter_runtime,reporter_worker',relation);
    EXECUTE format('GRANT SELECT ON %s TO reporter_runtime',relation);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %s TO reporter_executor',relation);
    EXECUTE format('CREATE POLICY reporter_read ON %s FOR SELECT TO reporter_runtime USING(core.reporter_allowed(portal_id,''reporter.read''))',relation);
    EXECUTE format('CREATE POLICY reporter_commands ON %s TO reporter_executor USING(true) WITH CHECK(true)',relation);
  END LOOP;
END $$;

ALTER FUNCTION core.reporter_allowed(uuid,text) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION core.reporter_allowed(uuid,text),public.reporter_guard(),
  public.reporter_slides_valid(jsonb,boolean),public.reporter_segments_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.reporter_allowed(uuid,text),public.reporter_slides_valid(jsonb,boolean),
  public.reporter_segments_valid(jsonb) TO reporter_runtime,reporter_executor;
-- NOLOGIN executor is never granted to runtime/worker. Only reviewed functions use it.
COMMENT ON TABLE public.reporter_transcripts IS 'R1 immutable completed transcript; media bytes remain in object storage.';
COMMENT ON TABLE public.reporter_articles IS 'R1 editable draft and immutable approved revision with atomic editorial audit.';
COMMENT ON TABLE public.reporter_carousels IS 'R1 structured slides from an exact approved article revision; export disabled.';
COMMIT;
