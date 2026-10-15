-- Migration 016: a document becomes rows once, in order, and exports back unchanged. All rolls back.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(value boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',message; END IF; END $$;
CREATE TEMPORARY TABLE import_fixture(doc jsonb) ON COMMIT DROP;
INSERT INTO import_fixture VALUES($doc${
  "state": {
    "workspace": {"id": "00000000-0000-0000-0000-000000000102", "name": "Importação", "slug": "importacao", "createdAt": "2026-10-01T00:00:00Z"},
    "people": [{"id": "import-person-1", "name": "Ana"}, {"id": "import-person-2", "name": "Bruno"}],
    "members": [{"workspaceId": "00000000-0000-0000-0000-000000000102", "personId": "import-person-1", "roles": ["editor"]}],
    "sessionPersonId": "import-person-1",
    "sources": [{"id": "import-source", "text": "Fonte sintética."}],
    "productions": [
      {"production": {"id": "import-production-a", "title": "A", "sourceIds": ["import-source"]},
       "pieces": [{"id": "import-piece-a"}], "versions": [{"id": "import-version-a1"}, {"id": "import-version-a2"}], "decisions": [],
       "reviewRequests": [], "runs": [{"id": "import-run-done", "status": "completed"}, {"id": "import-run-live", "status": "running"}],
       "suggestions": [], "deliveries": []},
      {"production": {"id": "import-production-b", "title": "B", "sourceIds": [], "archivedAt": "2026-10-02T00:00:00Z"},
       "pieces": [{"id": "import-piece-b"}], "versions": [], "decisions": [{"id": "import-decision-b"}], "reviewRequests": [],
       "runs": [], "suggestions": [], "deliveries": []}
    ],
    "activity": [{"id": "import-activity", "productionId": "import-production-a", "type": "production.created"}],
    "feedback": [{"id": "import-feedback", "target": {"pieceId": "import-piece-b"}}],
    "history": [],
    "runFolds": {
      "import-run-done": {"seq": 3, "run": {"id": "import-run-done", "productionId": "import-production-a", "status": "completed",
        "createdAt": "2026-10-03T10:00:00Z", "endedAt": "2026-10-03T10:05:00Z"}},
      "import-run-live": {"seq": 2, "run": {"id": "import-run-live", "productionId": "import-production-a", "status": "running",
        "createdAt": "2026-10-04T10:00:00Z"}},
      "import-run-orphan": {"seq": 1, "run": {"id": "import-run-orphan", "productionId": "missing-production", "status": "queued"}}
    }
  },
  "jobs": {
    "import-run-done": {"meta": {"runId": "import-run-done", "productionId": "import-production-a"}, "kind": "article.draft", "input": {},
      "events": [{"seq": 1, "type": "run.started"}], "attempts": 1, "availableAt": 0, "pipeline": {"hash": "import-pipeline-old", "revision": 1}},
    "import-run-live": {"meta": {"runId": "import-run-live", "productionId": "import-production-a"}, "kind": "article.draft", "input": {},
      "events": [{"seq": 1, "type": "run.started"}, {"seq": 2, "type": "step.started"}], "attempts": 2, "availableAt": 1760000000000,
      "lease": {"owner": "old-worker", "until": 1760000060000, "fence": "old-fence"}, "pipeline": {"hash": "import-pipeline", "revision": 2}}
  },
  "pipeline": {"hash": "import-pipeline", "revision": 2},
  "pipelineHistory": [{"hash": "import-pipeline-old", "revision": 1}, {"hash": "import-pipeline", "revision": 2}],
  "visuals": {"images": [{"id": "import-image-new", "createdAt": "2026-10-05T00:00:00Z"}, {"id": "import-image-old", "createdAt": "2026-10-01T00:00:00Z"}],
    "banners": [{"id": "import-banner", "updatedAt": "2026-10-05T00:00:00Z"}]},
  "citations": [{"id": "import-citation", "productionId": "import-production-a"}],
  "imageAssets": [{"productionId": "import-production-a", "asset": {"id": "import-asset"}, "fileKey": "import-file"}],
  "receipts": {"import-request": {"hash": "import-hash", "result": {"ok": true}}}
}$doc$);

-- Only the owner can stage an old document: the retired table refuses every other write.
ALTER TABLE public.reporter_editorial_workspaces DISABLE TRIGGER reporter_editorial_retired;
INSERT INTO public.reporter_editorial_workspaces(portal_id,revision,checkpoint)
  SELECT '00000000-0000-0000-0000-000000000102',7,doc FROM import_fixture
  ON CONFLICT(portal_id) DO UPDATE SET checkpoint=excluded.checkpoint;
ALTER TABLE public.reporter_editorial_workspaces ENABLE TRIGGER reporter_editorial_retired;
UPDATE public.reporter_ed_sync SET migrated_at=NULL WHERE portal_id='00000000-0000-0000-0000-000000000102';
SELECT core.reporter_ed_import_checkpoint('00000000-0000-0000-0000-000000000102') AS counts \gset
SELECT pg_temp.assert_true((:'counts'::jsonb-'seq')='{"pipelines":2,"productions":2,"parts":7,"sources":1,"runs":2,"orphanRuns":1,
  "events":2,"items":10,"receipts":1}'::jsonb,'every collection is copied once and an orphan run is reported: '||:'counts');
SELECT pg_temp.assert_true(core.reporter_ed_import_checkpoint('00000000-0000-0000-0000-000000000102')='{"skipped":true}'::jsonb,
  'importing twice is a no-op');
SELECT pg_temp.assert_true((SELECT seq=(:'counts'::jsonb->>'seq')::bigint AND floor_seq=seq AND migrated_at IS NOT NULL
  FROM public.reporter_ed_sync WHERE portal_id='00000000-0000-0000-0000-000000000102'),'browsers below the import number reload a snapshot');

DO $$
DECLARE portal uuid := '00000000-0000-0000-0000-000000000102'; fixture jsonb := (SELECT f.doc FROM import_fixture f); exported jsonb;
BEGIN
  PERFORM pg_temp.assert_true((SELECT array_agg(production_id ORDER BY ordinal)=ARRAY['import-production-a','import-production-b']
    AND bool_and(archived=(production_id='import-production-b')) FROM public.reporter_ed_productions WHERE portal_id=portal),
    'productions keep their order and archive flag');
  PERFORM pg_temp.assert_true((SELECT lease_owner='old-worker' AND lease_fence='old-fence' AND attempts=2
    AND job->>'pipelineHash'='import-pipeline' AND NOT job ?| ARRAY['events','lease','pipeline','attempts']
    FROM public.reporter_ed_runs WHERE portal_id=portal AND run_id='import-run-live'),'a live job keeps its lease, attempts and pipeline hash');
  PERFORM pg_temp.assert_true((SELECT count(*)=2 AND bool_and(run_id='import-run-live') FROM public.reporter_ed_run_events WHERE portal_id=portal),
    'only active runs bring their event stream');
  PERFORM pg_temp.assert_true((SELECT production_id='import-production-b' FROM public.reporter_ed_items
    WHERE portal_id=portal AND kind='feedback' AND item_id='import-feedback'),'feedback finds its production through the piece it is about');
  PERFORM pg_temp.assert_true((SELECT doc->>'pipelineHash'='import-pipeline' AND doc->'historyHashes'='["import-pipeline-old","import-pipeline"]'
    FROM public.reporter_ed_workspace WHERE portal_id=portal),'the workspace row names the active pipeline and its history');
  exported := core.reporter_ed_export_checkpoint(portal);
  PERFORM pg_temp.assert_true((exported->'state')-'runFolds'=(fixture->'state')-'runFolds'
    AND exported->'state'->'runFolds'=(fixture->'state'->'runFolds')-'import-run-orphan'
    AND exported->'jobs'->'import-run-live'=fixture->'jobs'->'import-run-live'
    AND (exported->'jobs'->'import-run-done')-'events'=(fixture->'jobs'->'import-run-done')-'events'
    AND exported-ARRAY['state','jobs']=fixture-ARRAY['state','jobs'],'the rows export back to the same document: '||exported::text);
END $$;

-- A queued job left in the retired document no longer wakes the worker; only runs do.
UPDATE public.reporter_ed_runs SET available_at=clock_timestamp()+interval '1 day' WHERE portal_id='00000000-0000-0000-0000-000000000102';
SELECT pg_temp.assert_true(core.reporter_editorial_claimable_since('00000000-0000-0000-0000-000000000102') IS NULL,
  'the queue gate reads runs, not the retired document');

SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000031',true);
DO $$
DECLARE current jsonb := public.reporter_editorial_load(true);
BEGIN
  BEGIN
    PERFORM public.reporter_editorial_save((current->>'revision')::bigint,jsonb_build_object('state',jsonb_build_object(
      'workspace',jsonb_build_object('id','00000000-0000-0000-0000-000000000101'),'sessionPersonId','00000000-0000-0000-0000-000000000031'),'jobs','{}'::jsonb));
    RAISE EXCEPTION 'The retired document accepted an old app write';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN PERFORM core.reporter_ed_import_checkpoint('00000000-0000-0000-0000-000000000101'); RAISE EXCEPTION 'Runtime ran the import';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  BEGIN DELETE FROM public.reporter_editorial_workspaces; RAISE EXCEPTION 'The owner erased the retired document';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
\echo PASS a document becomes ordered rows once and exports back unchanged
\echo PASS the retired document refuses old app and direct writes and no longer feeds the queue
ROLLBACK;
