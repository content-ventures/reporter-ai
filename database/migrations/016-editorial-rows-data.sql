-- Copies each portal's editorial document into rows once; from then on rows are authoritative.
-- The document stays in place, read-only, for database/rollback/editorial-rows.sql. Safe to replay.
BEGIN;

CREATE OR REPLACE FUNCTION core.reporter_ed_array(p_value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT CASE WHEN jsonb_typeof(p_value)='array' THEN p_value ELSE '[]'::jsonb END
$$;

-- A malformed timestamp in an old document must not stop the release: it reads as missing.
CREATE OR REPLACE FUNCTION core.reporter_ed_time(p_value text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
BEGIN
  RETURN p_value::timestamptz;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

-- One entry per key, the first in document order, as the import keeps them.
CREATE OR REPLACE FUNCTION core.reporter_ed_firsts(p_list jsonb,p_key text[]) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,core AS $$
  SELECT coalesce(jsonb_agg(entry ORDER BY ord),'[]'::jsonb) FROM (
    SELECT DISTINCT ON (entry#>>p_key) entry,ord FROM jsonb_array_elements(core.reporter_ed_array(p_list)) WITH ORDINALITY AS list(entry,ord)
    WHERE jsonb_typeof(entry)='object' AND length(entry#>>p_key) BETWEEN 1 AND 256 ORDER BY entry#>>p_key,ord) firsts
$$;
CREATE OR REPLACE FUNCTION core.reporter_ed_newest(p_list jsonb,p_field text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(jsonb_agg(entry ORDER BY entry->>p_field DESC,ord),'[]'::jsonb) FROM jsonb_array_elements(p_list) WITH ORDINALITY AS list(entry,ord)
$$;
-- What must survive the import: content in order, run folds and jobs without their transient
-- bookkeeping (lease, attempts, events of finished runs), and runs only of known productions.
CREATE OR REPLACE FUNCTION core.reporter_ed_document_normal(p_doc jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,core AS $$
  WITH document AS (SELECT CASE WHEN jsonb_typeof(p_doc->'state')='object' THEN p_doc->'state' ELSE '{}'::jsonb END AS state,
      CASE WHEN jsonb_typeof(p_doc->'jobs')='object' THEN p_doc->'jobs' ELSE '{}'::jsonb END AS jobs),
    productions AS (SELECT coalesce(jsonb_agg(jsonb_build_object('production',entry->'production',
        'pieces',core.reporter_ed_array(entry->'pieces'),'versions',core.reporter_ed_array(entry->'versions'),
        'decisions',core.reporter_ed_array(entry->'decisions'),'reviewRequests',core.reporter_ed_array(entry->'reviewRequests'),
        'runs',core.reporter_ed_array(entry->'runs'),'suggestions',core.reporter_ed_array(entry->'suggestions'),
        'deliveries',core.reporter_ed_array(entry->'deliveries')) ORDER BY ord),'[]'::jsonb) AS list,
        coalesce(array_agg(entry->'production'->>'id'),'{}') AS ids
      FROM document,jsonb_array_elements(core.reporter_ed_array(document.state->'productions')) WITH ORDINALITY AS list(entry,ord)
      WHERE length(entry->'production'->>'id') BETWEEN 1 AND 128),
    runs AS (SELECT fold.key,fold.value,document.jobs->fold.key AS job FROM document,productions,
        jsonb_each(CASE WHEN jsonb_typeof(document.state->'runFolds')='object' THEN document.state->'runFolds' ELSE '{}'::jsonb END) AS fold
      WHERE fold.value->'run'->>'status' IS NOT NULL
        AND coalesce(document.jobs->fold.key->'meta'->>'productionId',fold.value->'run'->>'productionId')=ANY(productions.ids))
  SELECT jsonb_build_object('workspace',document.state->'workspace','productions',productions.list,
    'sources',core.reporter_ed_firsts(document.state->'sources','{id}'),'people',core.reporter_ed_firsts(document.state->'people','{id}'),
    'members',core.reporter_ed_firsts(document.state->'members','{personId}'),'activity',core.reporter_ed_firsts(document.state->'activity','{id}'),
    'feedback',core.reporter_ed_firsts(document.state->'feedback','{id}'),'citations',core.reporter_ed_firsts(p_doc->'citations','{id}'),
    'imageAssets',core.reporter_ed_firsts(p_doc->'imageAssets','{asset,id}'),
    'images',core.reporter_ed_newest(core.reporter_ed_firsts(p_doc->'visuals'->'images','{id}'),'createdAt'),
    'banners',core.reporter_ed_newest(core.reporter_ed_firsts(p_doc->'visuals'->'banners','{id}'),'updatedAt'),
    'runFolds',(SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM runs),
    'jobs',(SELECT coalesce(jsonb_object_agg(key,job-ARRAY['events','attempts','availableAt','lease','pipeline']),'{}'::jsonb)
      FROM runs WHERE jsonb_typeof(job)='object'),
    'pipeline',p_doc->'pipeline','pipelineHistory',core.reporter_ed_array(p_doc->'pipelineHistory'),
    'receipts',(SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(CASE WHEN jsonb_typeof(p_doc->'receipts')='object'
      THEN p_doc->'receipts' ELSE '{}'::jsonb END) WHERE length(key) BETWEEN 1 AND 128 AND value->>'hash' IS NOT NULL))
  FROM document,productions
$$;

-- The same split as splitCheckpoint in src/runtime/editorial-sync.ts, in document order so the
-- rows keep it. Rows the new app already wrote win; finished runs keep their fold, not events.
-- The rows are then exported back: an import that would lose content stops the migration.
CREATE OR REPLACE FUNCTION core.reporter_ed_import_checkpoint(p_portal uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE
  cp jsonb; next_seq bigint; state jsonb; jobs jsonb; counts jsonb := '{}'::jsonb; total integer; had_rows boolean;
  expected jsonb; actual jsonb; lost text;
BEGIN
  INSERT INTO public.reporter_ed_sync(portal_id) VALUES(p_portal) ON CONFLICT DO NOTHING;
  SELECT seq+1 INTO next_seq FROM public.reporter_ed_sync WHERE portal_id=p_portal AND migrated_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('skipped',true); END IF;
  SELECT checkpoint INTO cp FROM public.reporter_editorial_workspaces WHERE portal_id=p_portal;
  state := CASE WHEN jsonb_typeof(cp->'state')='object' THEN cp->'state' END;
  jobs := CASE WHEN jsonb_typeof(cp->'jobs')='object' THEN cp->'jobs' ELSE '{}'::jsonb END;
  had_rows := EXISTS(SELECT 1 FROM public.reporter_ed_productions WHERE portal_id=p_portal)
    OR EXISTS(SELECT 1 FROM public.reporter_ed_items WHERE portal_id=p_portal);
  IF state IS NOT NULL THEN
    INSERT INTO public.reporter_ed_pipelines(portal_id,hash,doc)
      SELECT p_portal,pipeline->>'hash',pipeline FROM (
        SELECT cp->'pipeline' AS pipeline
        UNION ALL SELECT value FROM jsonb_array_elements(core.reporter_ed_array(cp->'pipelineHistory'))
        UNION ALL SELECT value->'pipeline' FROM jsonb_each(jobs)) found
      WHERE jsonb_typeof(pipeline)='object' AND length(pipeline->>'hash') BETWEEN 1 AND 128
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS total = ROW_COUNT; counts := counts||jsonb_build_object('pipelines',total);

    INSERT INTO public.reporter_ed_workspace(portal_id,doc,seq)
      SELECT p_portal,jsonb_build_object('workspace',state->'workspace','historyHashes',coalesce((SELECT jsonb_agg(entry->'hash' ORDER BY ord)
          FROM jsonb_array_elements(core.reporter_ed_array(cp->'pipelineHistory')) WITH ORDINALITY AS history(entry,ord)),'[]'::jsonb))
        ||CASE WHEN cp->'pipeline'->>'hash' IS NOT NULL THEN jsonb_build_object('pipelineHash',cp->'pipeline'->>'hash') ELSE '{}'::jsonb END,next_seq
      WHERE jsonb_typeof(state->'workspace')='object'
      ON CONFLICT DO NOTHING;

    INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,source_ids,archived,seq)
      SELECT p_portal,entry->'production'->>'id',entry->'production',
        ARRAY(SELECT jsonb_array_elements_text(core.reporter_ed_array(entry->'production'->'sourceIds'))),
        coalesce(jsonb_typeof(entry->'production'->'archivedAt'),'null')<>'null',next_seq
      FROM jsonb_array_elements(core.reporter_ed_array(state->'productions')) WITH ORDINALITY AS production(entry,ord)
      WHERE length(entry->'production'->>'id') BETWEEN 1 AND 128
      ORDER BY ord ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS total = ROW_COUNT; counts := counts||jsonb_build_object('productions',total);

    INSERT INTO public.reporter_ed_parts(portal_id,kind,part_id,production_id,doc,seq)
      SELECT p_portal,kinds.kind,part->>'id',entry->'production'->>'id',part,next_seq
      FROM jsonb_array_elements(core.reporter_ed_array(state->'productions')) WITH ORDINALITY AS production(entry,ord)
      CROSS JOIN (VALUES(1,'piece','pieces'),(2,'version','versions'),(3,'decision','decisions'),(4,'review','reviewRequests'),
        (5,'run','runs'),(6,'suggestion','suggestions'),(7,'delivery','deliveries')) AS kinds(position,kind,field)
      CROSS JOIN LATERAL jsonb_array_elements(core.reporter_ed_array(entry->kinds.field)) WITH ORDINALITY AS parts(part,part_ord)
      WHERE length(part->>'id') BETWEEN 1 AND 128 AND EXISTS(SELECT 1 FROM public.reporter_ed_productions p
        WHERE p.portal_id=p_portal AND p.production_id=entry->'production'->>'id')
      ORDER BY ord,kinds.position,part_ord ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS total = ROW_COUNT; counts := counts||jsonb_build_object('parts',total);

    INSERT INTO public.reporter_ed_sources(portal_id,source_id,doc,seq)
      SELECT p_portal,source->>'id',source,next_seq
      FROM jsonb_array_elements(core.reporter_ed_array(state->'sources')) WITH ORDINALITY AS sources(source,ord)
      WHERE jsonb_typeof(source)='object' AND length(source->>'id') BETWEEN 1 AND 128
      ORDER BY ord ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS total = ROW_COUNT; counts := counts||jsonb_build_object('sources',total);

    -- A run belongs to the production its job or fold names; one without it is reported, not kept.
    INSERT INTO public.reporter_ed_runs(portal_id,run_id,production_id,status,available_at,lease_owner,lease_until,lease_fence,
        attempts,job,fold,created_at,finished_at,seq)
      SELECT p_portal,fold.key,production_id,fold.value->'run'->>'status',
        CASE WHEN job IS NULL THEN clock_timestamp() ELSE to_timestamp(coalesce((job->>'availableAt')::numeric,0)/1000) END,
        CASE WHEN leased THEN job->'lease'->>'owner' END,
        CASE WHEN leased THEN to_timestamp((job->'lease'->>'until')::numeric/1000) END,
        CASE WHEN leased THEN job->'lease'->>'fence' END,
        greatest(coalesce((job->>'attempts')::int,0),0),
        CASE WHEN job IS NOT NULL THEN (job-ARRAY['events','attempts','availableAt','lease','pipeline'])
          ||CASE WHEN job->'pipeline'->>'hash' IS NOT NULL THEN jsonb_build_object('pipelineHash',job->'pipeline'->>'hash') ELSE '{}'::jsonb END END,
        fold.value,
        coalesce(core.reporter_ed_time(fold.value->'run'->>'createdAt'),clock_timestamp()),
        CASE WHEN fold.value->'run'->>'status' IN ('completed','failed','cancelled')
          THEN coalesce(core.reporter_ed_time(fold.value->'run'->>'endedAt'),clock_timestamp()) END,
        next_seq
      FROM jsonb_each(CASE WHEN jsonb_typeof(state->'runFolds')='object' THEN state->'runFolds' ELSE '{}'::jsonb END) AS fold
      CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(jobs->fold.key)='object' THEN jobs->fold.key END AS job) found_job
      CROSS JOIN LATERAL (SELECT coalesce(job->'meta'->>'productionId',fold.value->'run'->>'productionId') AS production_id,
        jsonb_typeof(job->'lease')='object' AND job->'lease'->>'owner' IS NOT NULL AND jsonb_typeof(job->'lease'->'until')='number' AS leased) owner
      WHERE length(fold.key) BETWEEN 1 AND 128 AND fold.value->'run'->>'status' IS NOT NULL
        AND EXISTS(SELECT 1 FROM public.reporter_ed_productions p WHERE p.portal_id=p_portal AND p.production_id=owner.production_id)
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS total = ROW_COUNT;
    counts := counts||jsonb_build_object('runs',total,'orphanRuns',(SELECT count(*) FROM jsonb_object_keys(
      CASE WHEN jsonb_typeof(state->'runFolds')='object' THEN state->'runFolds' ELSE '{}'::jsonb END) AS fold(key)
      WHERE NOT EXISTS(SELECT 1 FROM public.reporter_ed_runs r WHERE r.portal_id=p_portal AND r.run_id=fold.key)));

    INSERT INTO public.reporter_ed_run_events(portal_id,run_id,event_seq,event,seq)
      SELECT p_portal,r.run_id,(event->>'seq')::int,event,next_seq
      FROM public.reporter_ed_runs r CROSS JOIN LATERAL jsonb_array_elements(core.reporter_ed_array(jobs->r.run_id->'events')) AS events(event)
      WHERE r.portal_id=p_portal AND r.status IN ('queued','running','awaiting_input')
        AND jsonb_typeof(event->'seq')='number' AND (event->>'seq')::numeric BETWEEN 1 AND 2147483647
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS total = ROW_COUNT; counts := counts||jsonb_build_object('events',total);

    -- Feedback names its production directly or through the entity it is about.
    INSERT INTO public.reporter_ed_items(portal_id,kind,item_id,production_id,doc,seq)
      SELECT p_portal,kind,item_id,CASE
          WHEN kind IN ('activity','image_asset','citation') THEN doc->>'productionId'
          WHEN kind='feedback' THEN coalesce(items.doc->'target'->>'productionId',(SELECT p.production_id FROM public.reporter_ed_parts p
            WHERE p.portal_id=p_portal AND p.part_id IN (items.doc->'target'->>'pieceId',items.doc->'target'->>'versionId',
              items.doc->'target'->>'runId',items.doc->'target'->>'suggestionId')
            ORDER BY p.ordinal LIMIT 1)) END,
        doc,next_seq
      FROM (
        SELECT kinds.position,kinds.kind,entries.ord,entries.doc,CASE kinds.kind WHEN 'member' THEN entries.doc->>'personId'
            WHEN 'image_asset' THEN entries.doc->'asset'->>'id' ELSE entries.doc->>'id' END AS item_id
        FROM (VALUES(1,'person',state->'people'),(2,'member',state->'members'),(3,'activity',state->'activity'),(4,'feedback',state->'feedback'),
          (5,'image_asset',cp->'imageAssets'),(6,'citation',cp->'citations'),(7,'library_image',cp->'visuals'->'images'),
          (8,'banner',cp->'visuals'->'banners')) AS kinds(position,kind,list)
        CROSS JOIN LATERAL jsonb_array_elements(core.reporter_ed_array(kinds.list)) WITH ORDINALITY AS entries(doc,ord)
      ) items
      WHERE jsonb_typeof(doc)='object' AND length(item_id) BETWEEN 1 AND 256
      ORDER BY position,ord ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS total = ROW_COUNT; counts := counts||jsonb_build_object('items',total);

    -- Receipts keep an ambiguous retry of a pre-migration command idempotent; they expire in 7 days.
    INSERT INTO public.reporter_ed_receipts(portal_id,request_id,hash,result)
      SELECT p_portal,receipt.key,receipt.value->>'hash',receipt.value
      FROM jsonb_each(CASE WHEN jsonb_typeof(cp->'receipts')='object' THEN cp->'receipts' ELSE '{}'::jsonb END) AS receipt
      WHERE length(receipt.key) BETWEEN 1 AND 128 AND receipt.value->>'hash' IS NOT NULL
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS total = ROW_COUNT; counts := counts||jsonb_build_object('receipts',total);

    expected := core.reporter_ed_document_normal(cp);
    actual := core.reporter_ed_document_normal(core.reporter_ed_export_checkpoint(p_portal));
    -- Rows the new app wrote first may add content; they must never hide the document's.
    SELECT string_agg(section,', ' ORDER BY section) INTO lost FROM jsonb_object_keys(expected) AS section
      WHERE CASE WHEN had_rows THEN NOT coalesce(actual->section,'null'::jsonb) @> coalesce(expected->section,'null'::jsonb)
        ELSE actual->section IS DISTINCT FROM expected->section END;
    IF lost IS NOT NULL THEN
      RAISE EXCEPTION 'Editorial rows of portal % would not reproduce its document',p_portal
        USING ERRCODE='22000',DETAIL='Differing sections: '||lost;
    END IF;
  END IF;
  -- Browsers holding an older number reload a snapshot of the imported rows.
  UPDATE public.reporter_ed_sync SET seq=next_seq,floor_seq=next_seq,migrated_at=clock_timestamp() WHERE portal_id=p_portal;
  RETURN counts||jsonb_build_object('seq',next_seq);
END $$;

-- The inverse, for the rollback script: the document the legacy app reads, rebuilt from rows.
CREATE OR REPLACE FUNCTION core.reporter_ed_export_items(p_portal uuid,p_kind text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT coalesce(jsonb_agg(doc ORDER BY CASE p_kind WHEN 'library_image' THEN doc->>'createdAt' WHEN 'banner' THEN doc->>'updatedAt' END DESC,ordinal),'[]'::jsonb)
  FROM public.reporter_ed_items WHERE portal_id=p_portal AND kind=p_kind AND NOT deleted
$$;
CREATE OR REPLACE FUNCTION core.reporter_ed_export_checkpoint(p_portal uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE workspace jsonb; exported jsonb;
BEGIN
  SELECT doc INTO workspace FROM public.reporter_ed_workspace WHERE portal_id=p_portal;
  exported := jsonb_build_object(
    'state',jsonb_build_object(
      'workspace',workspace->'workspace',
      'people',core.reporter_ed_export_items(p_portal,'person'),
      'members',core.reporter_ed_export_items(p_portal,'member'),
      'sessionPersonId',core.reporter_ed_export_items(p_portal,'member')->0->>'personId',
      'sources',(SELECT coalesce(jsonb_agg(doc ORDER BY ordinal),'[]'::jsonb) FROM public.reporter_ed_sources WHERE portal_id=p_portal),
      'productions',(SELECT coalesce(jsonb_agg(jsonb_build_object('production',p.doc,
          'pieces',parts->'piece','versions',parts->'version','decisions',parts->'decision','reviewRequests',parts->'review',
          'runs',parts->'run','suggestions',parts->'suggestion','deliveries',parts->'delivery') ORDER BY p.ordinal),'[]'::jsonb)
        FROM public.reporter_ed_productions p CROSS JOIN LATERAL (SELECT jsonb_build_object(
          'piece','[]'::jsonb,'version','[]'::jsonb,'decision','[]'::jsonb,'review','[]'::jsonb,'run','[]'::jsonb,'suggestion','[]'::jsonb,'delivery','[]'::jsonb)
          ||coalesce((SELECT jsonb_object_agg(kind,docs) FROM (SELECT kind,jsonb_agg(doc ORDER BY ordinal) AS docs FROM public.reporter_ed_parts
            WHERE portal_id=p_portal AND production_id=p.production_id AND NOT deleted GROUP BY kind) grouped),'{}'::jsonb) AS parts) owned
        WHERE p.portal_id=p_portal),
      'activity',core.reporter_ed_export_items(p_portal,'activity'),
      'feedback',core.reporter_ed_export_items(p_portal,'feedback'),
      'history','[]'::jsonb,
      'runFolds',(SELECT coalesce(jsonb_object_agg(run_id,fold),'{}'::jsonb) FROM public.reporter_ed_runs WHERE portal_id=p_portal)),
    'jobs',(SELECT coalesce(jsonb_object_agg(r.run_id,(r.job-'pipelineHash')||jsonb_build_object(
        'events',coalesce((SELECT jsonb_agg(e.event ORDER BY e.event_seq) FROM public.reporter_ed_run_events e
          WHERE e.portal_id=p_portal AND e.run_id=r.run_id),'[]'::jsonb),
        'attempts',r.attempts,'availableAt',(extract(epoch FROM r.available_at)*1000)::bigint)
        ||CASE WHEN r.lease_owner IS NOT NULL THEN jsonb_build_object('lease',jsonb_build_object('owner',r.lease_owner,
          'until',(extract(epoch FROM r.lease_until)*1000)::bigint,'fence',r.lease_fence)) ELSE '{}'::jsonb END
        ||coalesce((SELECT jsonb_build_object('pipeline',doc) FROM public.reporter_ed_pipelines
          WHERE portal_id=p_portal AND hash=r.job->>'pipelineHash'),'{}'::jsonb)),'{}'::jsonb)
      FROM public.reporter_ed_runs r WHERE r.portal_id=p_portal AND r.job IS NOT NULL),
    'imageAssets',core.reporter_ed_export_items(p_portal,'image_asset'),
    'citations',core.reporter_ed_export_items(p_portal,'citation'),
    'visuals',jsonb_build_object('images',core.reporter_ed_export_items(p_portal,'library_image'),
      'banners',core.reporter_ed_export_items(p_portal,'banner')),
    'receipts',(SELECT coalesce(jsonb_object_agg(r.request_id,r.result),'{}'::jsonb) FROM public.reporter_ed_receipts r WHERE r.portal_id=p_portal));
  RETURN exported
    ||coalesce((SELECT jsonb_build_object('pipeline',doc) FROM public.reporter_ed_pipelines WHERE portal_id=p_portal AND hash=workspace->>'pipelineHash'),'{}'::jsonb)
    ||jsonb_build_object('pipelineHistory',coalesce((SELECT jsonb_agg(p.doc ORDER BY history.ord)
      FROM jsonb_array_elements_text(core.reporter_ed_array(workspace->'historyHashes')) WITH ORDINALITY AS history(hash,ord)
      JOIN public.reporter_ed_pipelines p ON p.portal_id=p_portal AND p.hash=history.hash),'[]'::jsonb));
END $$;

-- The legacy document is retired: any write (an old app instance, a direct edit) is refused,
-- so nothing can land where the new app no longer reads. Replaying 004 keeps this trigger.
CREATE OR REPLACE FUNCTION core.reporter_editorial_retired() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'The editorial document is retired; editorial rows are authoritative' USING ERRCODE='55000';
END $$;
DROP TRIGGER IF EXISTS reporter_editorial_retired ON public.reporter_editorial_workspaces;
CREATE TRIGGER reporter_editorial_retired BEFORE INSERT OR UPDATE OR DELETE ON public.reporter_editorial_workspaces
  FOR EACH ROW EXECUTE FUNCTION core.reporter_editorial_retired();

-- With every document imported, only runs can be claimed.
CREATE OR REPLACE FUNCTION core.reporter_editorial_claimable_since(p_portal uuid)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path=pg_catalog,core,public,pg_temp AS $$
  SELECT min(greatest(available_at,coalesce(lease_until,'-infinity'::timestamptz))) FROM public.reporter_ed_runs
    WHERE portal_id=p_portal AND status IN ('queued','running','awaiting_input') AND job IS NOT NULL
      AND available_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
$$;

REVOKE ALL ON FUNCTION core.reporter_ed_array(jsonb),core.reporter_ed_time(text),core.reporter_ed_import_checkpoint(uuid),
  core.reporter_ed_firsts(jsonb,text[]),core.reporter_ed_newest(jsonb,text),core.reporter_ed_document_normal(jsonb),
  core.reporter_ed_export_items(uuid,text),core.reporter_ed_export_checkpoint(uuid),core.reporter_editorial_retired() FROM PUBLIC;

SELECT core.reporter_ed_import_checkpoint(w.portal_id) FROM public.reporter_editorial_workspaces w
  WHERE NOT EXISTS(SELECT 1 FROM public.reporter_ed_sync s WHERE s.portal_id=w.portal_id AND s.migrated_at IS NOT NULL)
  ORDER BY w.portal_id;
COMMIT;
