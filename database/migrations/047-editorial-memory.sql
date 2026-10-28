-- Editorial memory has bounded heads and immutable snapshots. Sources keep their existing IDs.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reporter_memory_clock(
  portal_id uuid PRIMARY KEY REFERENCES public.portals(id),
  seq bigint NOT NULL DEFAULT 0 CHECK(seq>=0), visibility bigint NOT NULL DEFAULT 0 CHECK(visibility>=0)
);
CREATE TABLE IF NOT EXISTS public.reporter_memory_heads(
  portal_id uuid NOT NULL REFERENCES public.portals(id),
  kind text NOT NULL CHECK(kind IN ('material','evidence','check','decision','policy','selection','use','job','block')),
  id text NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
  storage_revision integer NOT NULL CHECK(storage_revision>=0),
  doc jsonb NOT NULL CHECK(jsonb_typeof(doc)='object' AND octet_length(doc::text)<=1048576),
  fingerprint text CHECK(fingerprint IS NULL OR fingerprint ~ '^[a-f0-9]{16}$'),
  parent_kind text, parent_id text,
  source_id text, origin_production_id text,
  seq bigint NOT NULL CHECK(seq>0),
  PRIMARY KEY(portal_id,kind,id),
  FOREIGN KEY(portal_id,parent_kind,parent_id) REFERENCES public.reporter_memory_heads(portal_id,kind,id),
  FOREIGN KEY(portal_id,source_id) REFERENCES public.reporter_ed_sources(portal_id,source_id),
  FOREIGN KEY(portal_id,origin_production_id) REFERENCES public.reporter_ed_productions(portal_id,production_id),
  CHECK((parent_kind IS NULL)=(parent_id IS NULL)),
  CHECK((kind='material' AND parent_kind IS NULL AND source_id IS NOT NULL
    OR kind IN ('evidence','job','block') AND parent_kind='material' AND source_id IS NOT NULL
    OR kind IN ('check','decision','use') AND parent_kind='evidence' AND source_id IS NOT NULL
    OR kind IN ('policy','selection') AND parent_kind IS NULL AND source_id IS NULL) IS TRUE),
  CHECK(kind<>'evidence' OR fingerprint IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.reporter_memory_history(
  portal_id uuid NOT NULL,kind text NOT NULL,id text NOT NULL,storage_revision integer NOT NULL,
  doc jsonb NOT NULL,fingerprint text,parent_kind text,parent_id text,source_id text,origin_production_id text,
  seq bigint NOT NULL,
  PRIMARY KEY(portal_id,kind,id,storage_revision),
  FOREIGN KEY(portal_id,kind,id) REFERENCES public.reporter_memory_heads(portal_id,kind,id)
);
CREATE TABLE IF NOT EXISTS public.reporter_memory_receipts(
  portal_id uuid NOT NULL REFERENCES public.portals(id),actor_id uuid NOT NULL REFERENCES core.users(id),
  request_id text NOT NULL CHECK(length(request_id) BETWEEN 8 AND 128),operation text NOT NULL CHECK(length(operation) BETWEEN 1 AND 80),
  hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),result jsonb NOT NULL CHECK(octet_length(result::text)<=2097152),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(portal_id,actor_id,request_id)
);
CREATE INDEX IF NOT EXISTS reporter_memory_history_snapshot ON public.reporter_memory_history(portal_id,kind,id,seq DESC);
CREATE INDEX IF NOT EXISTS reporter_memory_history_sequence ON public.reporter_memory_history(portal_id,kind,seq);
CREATE INDEX IF NOT EXISTS reporter_memory_heads_parent ON public.reporter_memory_heads(portal_id,parent_kind,parent_id,kind);
CREATE INDEX IF NOT EXISTS reporter_memory_heads_source ON public.reporter_memory_heads(portal_id,source_id);
CREATE INDEX IF NOT EXISTS reporter_memory_evidence_created ON public.reporter_memory_heads(portal_id,(doc->>'createdAt') DESC,id) WHERE kind='evidence';
CREATE INDEX IF NOT EXISTS reporter_memory_evidence_topics ON public.reporter_memory_heads USING gin((doc->'metadata'->'topics')) WHERE kind='evidence';
CREATE INDEX IF NOT EXISTS reporter_memory_evidence_search ON public.reporter_memory_heads USING gin(to_tsvector('simple',coalesce(doc->>'text',doc->>'indicator',''))) WHERE kind='evidence';
DO $$ DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['reporter_memory_clock','reporter_memory_heads','reporter_memory_history','reporter_memory_receipts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,reporter_runtime,reporter_worker',relation);
    EXECUTE format('GRANT SELECT,INSERT ON public.%I TO reporter_executor',relation);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',relation||'_executor',relation);
    EXECUTE format('CREATE POLICY %I ON public.%I TO reporter_executor USING(true) WITH CHECK(true)',relation||'_executor',relation);
  END LOOP;
  GRANT UPDATE ON public.reporter_memory_clock,public.reporter_memory_heads TO reporter_executor;
END $$;

CREATE OR REPLACE FUNCTION core.reporter_memory_portal(p_mode text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('read','write','review') THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF p_mode<>'read' AND nullif(current_setting('app.member_view',true),'') IS NOT NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF current_setting('app.access_mode',true)='job' THEN
    portal:=core.reporter_ed_portal(p_mode<>'read');
    IF NOT core.reporter_worker_workspace_enabled(portal) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  ELSE portal:=core.reporter_require(CASE WHEN p_mode='write' THEN 'reporter.edit' ELSE 'reporter.read' END); END IF;
  RETURN portal;
END $$;
CREATE OR REPLACE FUNCTION core.reporter_memory_is_admin(p_portal uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT p_portal=core.context_portal_id() AND coalesce(core.platform_roles(core.context_user_id(),p_portal) ? 'admin',false)
$$;
CREATE OR REPLACE FUNCTION core.reporter_memory_visible(p_portal uuid,p_production text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT p_production IS NULL OR EXISTS(SELECT FROM public.reporter_ed_productions p WHERE p.portal_id=p_portal AND p.production_id=p_production
    AND (NOT p.doc ? 'restrictedTo' OR p.doc->'restrictedTo'='null'::jsonb OR p.doc->>'ownerId'=core.context_user_id()::text
      OR p.doc->'restrictedTo' ? core.context_user_id()::text OR core.reporter_memory_is_admin(p_portal)))
$$;
CREATE OR REPLACE FUNCTION core.reporter_memory_source_visible(p_portal uuid,p_source text,p_production text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT CASE WHEN p_production IS NOT NULL THEN EXISTS(SELECT FROM public.reporter_ed_productions p
    WHERE p.portal_id=p_portal AND p.production_id=p_production AND p.source_ids @> ARRAY[p_source] AND core.reporter_memory_visible(p_portal,p.production_id))
  ELSE NOT EXISTS(SELECT FROM public.reporter_ed_productions p WHERE p.portal_id=p_portal AND p.source_ids @> ARRAY[p_source])
    OR EXISTS(SELECT FROM public.reporter_ed_productions p WHERE p.portal_id=p_portal AND p.source_ids @> ARRAY[p_source] AND core.reporter_memory_visible(p_portal,p.production_id))
    OR EXISTS(SELECT FROM public.reporter_memory_heads m WHERE m.portal_id=p_portal AND m.kind='material' AND m.source_id=p_source AND m.origin_production_id IS NULL) END
$$;
-- Match the existing editorial lock order so a source edit and an import cannot deadlock.
CREATE OR REPLACE FUNCTION core.reporter_memory_lock(p_portal uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  INSERT INTO public.reporter_ed_sync(portal_id) VALUES(p_portal) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.reporter_ed_sync WHERE portal_id=p_portal FOR UPDATE;
  INSERT INTO public.reporter_memory_clock(portal_id) VALUES(p_portal) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.reporter_memory_clock WHERE portal_id=p_portal FOR UPDATE;
END $$;
-- SQL checks the literal source context; the application additionally checks exact UTF-16 offsets.
CREATE OR REPLACE FUNCTION core.reporter_memory_anchor(p_portal uuid,p_anchor jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  WITH version AS (
    SELECT v->'content'->'segments' AS segments FROM public.reporter_ed_sources s CROSS JOIN LATERAL jsonb_array_elements(s.doc->'versions') v
      WHERE s.portal_id=p_portal AND s.source_id=p_anchor->'source'->>'sourceId'
        AND v->>'number'=p_anchor->'source'->>'sourceVersion' AND v->>'hash'=p_anchor->'source'->>'hash'
  ), spans AS (SELECT span,ordinality AS n FROM jsonb_array_elements(p_anchor->'spans') WITH ORDINALITY s(span,ordinality)), selected AS (
    SELECT segment->>'text' AS text,segment_ordinal,n,min(segment_ordinal) OVER() AS first_ordinal FROM version CROSS JOIN LATERAL jsonb_array_elements(segments) WITH ORDINALITY s(segment,segment_ordinal)
      JOIN spans ON segment->>'id'=span->>'segmentId'
  ) SELECT coalesce(count(*)>0 AND count(*)=(SELECT count(*) FROM spans) AND count(DISTINCT segment_ordinal)=count(*)
    AND max(segment_ordinal)-min(segment_ordinal)+1=count(*) AND bool_and(segment_ordinal=first_ordinal+n-1)
    AND position(nullif(p_anchor->>'excerpt','') IN string_agg(text,E'\n' ORDER BY n))>0,false) FROM selected
$$;
CREATE OR REPLACE FUNCTION public.reporter_memory_context() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read');
BEGIN
  RETURN jsonb_build_object('snapshot',coalesce((SELECT seq FROM public.reporter_memory_clock WHERE portal_id=portal),0)::text,
    'visibility',coalesce((SELECT visibility FROM public.reporter_memory_clock WHERE portal_id=portal),0)::text||':'||
      md5(core.reporter_memory_is_admin(portal)::text||coalesce(current_setting('app.member_view',true),'')));
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_get(p_kind text,p_id text,p_revision integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); value jsonb;
BEGIN
  IF p_revision IS NULL THEN
    SELECT to_jsonb(h)-'portal_id' INTO value FROM public.reporter_memory_heads h
      WHERE h.portal_id=portal AND h.kind=p_kind AND h.id=p_id AND core.reporter_memory_visible(portal,h.origin_production_id)
        AND (h.kind NOT IN ('selection','use') OR core.reporter_memory_visible(portal,h.doc->>'productionId'));
  ELSE
    SELECT to_jsonb(h)-'portal_id' INTO value FROM public.reporter_memory_history h
      WHERE h.portal_id=portal AND h.kind=p_kind AND h.id=p_id AND h.storage_revision=p_revision
        AND core.reporter_memory_visible(portal,h.origin_production_id)
        AND (h.kind NOT IN ('selection','use') OR core.reporter_memory_visible(portal,h.doc->>'productionId'));
  END IF;
  RETURN value;
END $$;
CREATE OR REPLACE FUNCTION public.reporter_memory_scan(p_kind text,p_snapshot bigint,p_after text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('read'); result jsonb;
BEGIN
  IF p_snapshot IS NULL OR p_snapshot<0 OR p_snapshot>coalesce((SELECT seq FROM public.reporter_memory_clock WHERE portal_id=portal),0)
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  WITH latest AS (
    SELECT DISTINCT ON(id) * FROM public.reporter_memory_history WHERE portal_id=portal AND kind=p_kind AND seq<=p_snapshot ORDER BY id,seq DESC
  ) SELECT coalesce(jsonb_agg(value ORDER BY id),'[]') INTO result FROM (
    SELECT id,to_jsonb(h)-'portal_id' AS value FROM latest h WHERE (p_after IS NULL OR id>p_after)
      AND core.reporter_memory_visible(portal,h.origin_production_id)
      AND (h.kind NOT IN ('selection','use') OR core.reporter_memory_visible(portal,h.doc->>'productionId')) ORDER BY id LIMIT p_limit) page;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.reporter_memory_receipt(p_operation text,p_request text,p_hash text,p_result jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid:=core.reporter_memory_portal('review'); actor uuid:=core.context_user_id(); previous public.reporter_memory_receipts;
BEGIN
  IF actor IS NULL OR p_operation IS NULL OR length(p_operation) NOT BETWEEN 1 AND 80 OR p_request IS NULL OR length(p_request) NOT BETWEEN 8 AND 128
    OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  PERFORM core.reporter_memory_lock(portal);
  SELECT * INTO previous FROM public.reporter_memory_receipts WHERE portal_id=portal AND actor_id=actor AND request_id=p_request;
  IF FOUND THEN
    IF previous.hash<>p_hash OR previous.operation<>p_operation THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    RETURN jsonb_build_object('replayed',true,'result',previous.result);
  END IF;
  IF p_result IS NOT NULL THEN INSERT INTO public.reporter_memory_receipts(portal_id,actor_id,request_id,operation,hash,result)
    VALUES(portal,actor,p_request,p_operation,p_hash,p_result); END IF;
  RETURN jsonb_build_object('replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.reporter_memory_put(p_change jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
#variable_conflict use_variable
DECLARE kind text:=p_change->>'kind'; entity text:=p_change->>'id'; document jsonb:=p_change->'doc';
  portal uuid; previous public.reporter_memory_heads; parent public.reporter_memory_heads; saved public.reporter_memory_heads;
  source_id text; production_id text; expected integer; next_seq bigint; latest_check jsonb; policy_revision integer; next_decision integer;
BEGIN
  portal:=core.reporter_memory_portal(CASE WHEN kind='decision' THEN 'review' ELSE 'write' END);
  IF kind IS NULL OR kind NOT IN ('material','evidence','check','decision','policy','selection','use','job','block') OR entity IS NULL OR length(entity) NOT BETWEEN 1 AND 128
    OR jsonb_typeof(document) IS DISTINCT FROM 'object' OR octet_length(document::text)>1048576
    OR document->>'id' IS DISTINCT FROM entity OR document->>'workspaceId' IS DISTINCT FROM portal::text
    OR jsonb_typeof(p_change->'expected') NOT IN ('number','null') OR NOT p_change ? 'expected' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF kind='policy' AND NOT core.reporter_memory_is_admin(portal) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF kind IN ('selection','use') AND NOT core.reporter_memory_visible(portal,document->>'productionId') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF kind='evidence' AND ((document->>'kind') IN ('citation','statistic')) IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  PERFORM core.reporter_memory_lock(portal);
  SELECT * INTO previous FROM public.reporter_memory_heads WHERE portal_id=portal AND reporter_memory_heads.kind=kind AND id=entity;
  expected:=(p_change->>'expected')::integer;
  IF previous.id IS NULL AND expected IS NOT NULL OR previous.id IS NOT NULL AND (expected IS DISTINCT FROM previous.storage_revision OR kind IN ('decision','use')) THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF previous.id IS NOT NULL AND NOT core.reporter_memory_visible(portal,previous.origin_production_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF kind IN ('evidence','job','block','check','decision','use') THEN
    SELECT * INTO parent FROM public.reporter_memory_heads WHERE portal_id=portal AND reporter_memory_heads.kind=p_change->>'parentKind' AND id=p_change->>'parentId';
    IF parent.id IS NULL OR NOT core.reporter_memory_visible(portal,parent.origin_production_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
    source_id:=parent.source_id;production_id:=parent.origin_production_id;
  ELSIF kind='material' THEN
    source_id:=p_change->>'sourceId';production_id:=p_change->>'productionId';
    IF NOT core.reporter_memory_source_visible(portal,source_id,production_id) OR NOT EXISTS(SELECT FROM public.reporter_ed_sources s WHERE s.portal_id=portal AND s.source_id=source_id
      AND EXISTS(SELECT FROM jsonb_array_elements(s.doc->'versions') v WHERE v->>'number'=document->'source'->>'sourceVersion' AND v->>'hash'=document->'source'->>'hash'))
      OR document->'source'->>'sourceId' IS DISTINCT FROM source_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  END IF;
  IF previous.id IS NOT NULL AND (previous.source_id IS DISTINCT FROM source_id OR previous.parent_kind IS DISTINCT FROM p_change->>'parentKind'
    OR previous.parent_id IS DISTINCT FROM p_change->>'parentId' OR kind='evidence' AND previous.doc->'anchor' IS DISTINCT FROM document->'anchor') THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
  IF kind='evidence' AND (document->>'materialId' IS DISTINCT FROM parent.id OR document->'anchor'->'source'->>'sourceId' IS DISTINCT FROM source_id
    OR NOT core.reporter_memory_anchor(portal,document->'anchor') OR document->>'kind'='citation' AND document->>'text' IS DISTINCT FROM document->'anchor'->>'excerpt'
    OR document->>'kind'='statistic' AND (position(nullif(document->'value'->>'raw','') IN document->'anchor'->>'excerpt') IS NULL
      OR position(nullif(document->'value'->>'raw','') IN document->'anchor'->>'excerpt')=0
      OR position(nullif(document->>'unit','') IN document->'anchor'->>'excerpt') IS NULL OR position(nullif(document->>'unit','') IN document->'anchor'->>'excerpt')=0))
    THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF kind IN ('check','decision','use') AND document->'evidence'->>'id' IS DISTINCT FROM parent.id THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF kind='check' AND entity IS DISTINCT FROM parent.id THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
  IF kind='decision' THEN
    SELECT doc INTO latest_check FROM public.reporter_memory_heads WHERE portal_id=portal AND reporter_memory_heads.kind='check' AND parent_id=parent.id;
    SELECT coalesce(max((doc->>'sequence')::integer),0)+1 INTO next_decision FROM public.reporter_memory_heads WHERE portal_id=portal AND reporter_memory_heads.kind='decision' AND parent_id=parent.id;
    SELECT coalesce((SELECT (doc->>'revision')::integer FROM public.reporter_memory_heads WHERE portal_id=portal AND reporter_memory_heads.kind='policy' AND id='editorial-memory'),1) INTO policy_revision;
    IF document->'evidence'->>'hash' IS DISTINCT FROM parent.fingerprint OR document->'evidence'->'revision' IS DISTINCT FROM parent.doc->'revision'
      OR (document->>'sequence')::integer IS DISTINCT FROM next_decision OR (document->>'policyRevision')::integer IS DISTINCT FROM policy_revision
      OR latest_check IS NOT NULL AND (latest_check->'evidence'->>'hash' IS DISTINCT FROM parent.fingerprint OR latest_check->'evidence'->'revision' IS DISTINCT FROM parent.doc->'revision')
      OR document->'check' IS DISTINCT FROM (CASE WHEN latest_check IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('id',latest_check->>'id','revision',latest_check->'revision') END)
      OR length(btrim(coalesce(document->>'reason',''))) NOT BETWEEN 1 AND 2000 OR document->>'action' NOT IN ('accept','reject','request_revision') THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    IF document->>'action'='accept' AND (parent.doc->>'status'<>'active' OR parent.doc->>'kind'='citation' AND (parent.doc->>'authorConfirmed'<>'true' OR nullif(parent.doc->>'personId','') IS NULL)
      OR NOT EXISTS(SELECT FROM public.reporter_ed_sources s WHERE s.portal_id=portal AND s.source_id=source_id AND s.doc->'rights'->>'authorized'='true')) THEN RAISE EXCEPTION 'MEMORY_CONFLICT'; END IF;
    document:=document||jsonb_build_object('personId',core.context_user_id(),'at',clock_timestamp());
  END IF;
  UPDATE public.reporter_memory_clock SET seq=seq+1 WHERE portal_id=portal RETURNING seq INTO next_seq;
  INSERT INTO public.reporter_memory_heads(portal_id,kind,id,storage_revision,doc,fingerprint,parent_kind,parent_id,source_id,origin_production_id,seq)
    VALUES(portal,kind,entity,coalesce(previous.storage_revision,-1)+1,document,p_change->>'fingerprint',p_change->>'parentKind',p_change->>'parentId',source_id,production_id,next_seq)
    ON CONFLICT ON CONSTRAINT reporter_memory_heads_pkey DO UPDATE SET storage_revision=excluded.storage_revision,doc=excluded.doc,fingerprint=excluded.fingerprint,
      parent_kind=excluded.parent_kind,parent_id=excluded.parent_id,source_id=excluded.source_id,origin_production_id=excluded.origin_production_id,seq=excluded.seq RETURNING * INTO saved;
  INSERT INTO public.reporter_memory_history(portal_id,kind,id,storage_revision,doc,fingerprint,parent_kind,parent_id,source_id,origin_production_id,seq)
    VALUES(saved.portal_id,saved.kind,saved.id,saved.storage_revision,saved.doc,saved.fingerprint,saved.parent_kind,saved.parent_id,saved.source_id,saved.origin_production_id,saved.seq);
  IF kind='decision' THEN
    INSERT INTO public.audit_log(portal_id,user_id,action,entity_type,after_data,source,request_id,correlation_id)
      VALUES(portal,core.context_user_id(),'memory.evidence.'||(document->>'action'),'memory_decision',document,'reporter_ai',
        nullif(current_setting('app.request_id',true),'')::uuid,nullif(current_setting('app.correlation_id',true),'')::uuid);
  END IF;
  RETURN to_jsonb(saved)-'portal_id';
END $$;

CREATE OR REPLACE FUNCTION core.reporter_memory_visibility_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='reporter_ed_sources' AND OLD.doc IS DISTINCT FROM NEW.doc OR TG_TABLE_NAME='reporter_ed_productions'
    AND (OLD.doc->'restrictedTo' IS DISTINCT FROM NEW.doc->'restrictedTo' OR OLD.doc->'ownerId' IS DISTINCT FROM NEW.doc->'ownerId') THEN
    UPDATE public.reporter_memory_clock SET visibility=visibility+1 WHERE portal_id=NEW.portal_id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS reporter_memory_source_visibility ON public.reporter_ed_sources;
CREATE TRIGGER reporter_memory_source_visibility AFTER UPDATE ON public.reporter_ed_sources FOR EACH ROW EXECUTE FUNCTION core.reporter_memory_visibility_changed();
DROP TRIGGER IF EXISTS reporter_memory_production_visibility ON public.reporter_ed_productions;
CREATE TRIGGER reporter_memory_production_visibility AFTER UPDATE ON public.reporter_ed_productions FOR EACH ROW EXECUTE FUNCTION core.reporter_memory_visibility_changed();
DO $$ DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['core.reporter_memory_visible(uuid,text)','core.reporter_memory_source_visible(uuid,text,text)','core.reporter_memory_lock(uuid)','core.reporter_memory_anchor(uuid,jsonb)',
    'public.reporter_memory_context()','public.reporter_memory_get(text,text,integer)','public.reporter_memory_scan(text,bigint,text,integer)',
    'public.reporter_memory_receipt(text,text,text,jsonb)','public.reporter_memory_put(jsonb)'] LOOP
    EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO reporter_executor';
    EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC';
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.reporter_memory_context(),public.reporter_memory_get(text,text,integer),public.reporter_memory_scan(text,bigint,text,integer),
    public.reporter_memory_receipt(text,text,text,jsonb),public.reporter_memory_put(jsonb) TO reporter_runtime,reporter_worker;
END $$;
ALTER FUNCTION core.reporter_memory_portal(text) OWNER TO CURRENT_USER;
ALTER FUNCTION core.reporter_memory_is_admin(uuid) OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION core.reporter_memory_portal(text),core.reporter_memory_is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.reporter_memory_portal(text),core.reporter_memory_is_admin(uuid) TO reporter_executor;
ALTER FUNCTION core.reporter_memory_visibility_changed() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION core.reporter_memory_visibility_changed() FROM PUBLIC;
COMMIT;
