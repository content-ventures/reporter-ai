BEGIN;

SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true);
SELECT public.reporter_worker_register('integration-worker','https://worker.example');
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);
SELECT (public.reporter_prepare_cloud_upload(
  '550e8400-e29b-41d4-a716-446655440001','podcast-pescado.mp3',16777216,'audio/mpeg',
  'incoming/00000000-0000-0000-0000-000000000101/550e8400-e29b-41d4-a716-446655440001.mp3',
  encode(sha256(convert_to(repeat('t',32),'UTF8')),'hex'),'cloud-upload-test'
)->>'id') AS transcript \gset
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION reporter_worker;
SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true);
SELECT public.reporter_cloud_upload_input('550e8400-e29b-41d4-a716-446655440001',repeat('t',32));
SELECT public.reporter_cloud_upload_set_id('550e8400-e29b-41d4-a716-446655440001',repeat('t',32),'multipart-integration-id');
SELECT public.reporter_complete_cloud_upload('reporter-source-media',
  'incoming/00000000-0000-0000-0000-000000000101/550e8400-e29b-41d4-a716-446655440001.mp3',
  16777216,'audio/mpeg','"integration-etag"');
SELECT public.reporter_complete_cloud_upload('reporter-source-media',
  'incoming/00000000-0000-0000-0000-000000000101/550e8400-e29b-41d4-a716-446655440001.mp3',
  16777216,'audio/mpeg','"integration-etag"');
RESET SESSION AUTHORIZATION;

DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM core.storage_objects WHERE id='550e8400-e29b-41d4-a716-446655440001'
      AND provider='s3' AND visibility='private' AND store_id='reporter-source-media'
      AND status='completed' AND reference='{}'::jsonb) THEN
    RAISE EXCEPTION 'private cloud source was not sealed';
  END IF;
  IF NOT EXISTS(SELECT FROM public.reporter_transcripts WHERE source_object_id='550e8400-e29b-41d4-a716-446655440001' AND status='queued') THEN
    RAISE EXCEPTION 'cloud transcript was not queued';
  END IF;
  IF (SELECT count(*) FROM core.integration_outbox o JOIN public.reporter_transcripts t ON t.id::text=o.aggregate_id
      WHERE t.source_object_id='550e8400-e29b-41d4-a716-446655440001'
        AND o.event_type='reporter.transcription.requested' AND o.processed_at IS NULL)<>1 THEN
    RAISE EXCEPTION 'cloud transcription was not enqueued exactly once';
  END IF;
END $$;

SELECT 'PASS private multipart registration and idempotent transcription enqueue';
ROLLBACK;
