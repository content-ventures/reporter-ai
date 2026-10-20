BEGIN;
-- Files the Drive folder intake brought in: they wait on the board's Material lane until a person
-- turns one into a production through the new-production steps, like any uploaded file.
CREATE TABLE IF NOT EXISTS public.reporter_drive_intakes(
  portal_id uuid NOT NULL REFERENCES public.portals(id),
  transcript_id uuid NOT NULL,
  file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 255),
  format text CHECK(format IS NULL OR format ~ '^[a-z]{1,40}$'),
  recorded_on date,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(portal_id,transcript_id)
);
ALTER TABLE public.reporter_drive_intakes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reporter_drive_intakes FROM PUBLIC;
GRANT SELECT,INSERT ON public.reporter_drive_intakes TO reporter_executor;
DROP POLICY IF EXISTS reporter_drive_intakes_executor ON public.reporter_drive_intakes;
CREATE POLICY reporter_drive_intakes_executor ON public.reporter_drive_intakes TO reporter_executor USING(true) WITH CHECK(true);

-- Called by every sync of a Drive file: the first one records it, the others change nothing.
CREATE OR REPLACE FUNCTION public.reporter_drive_intake_record(p_transcript uuid,p_file_name text,p_format text,p_recorded_on date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.edit');
BEGIN
  IF NOT EXISTS(SELECT FROM public.reporter_transcripts WHERE portal_id=portal AND id=p_transcript) THEN
    RAISE EXCEPTION 'Unknown transcript' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.reporter_drive_intakes(portal_id,transcript_id,file_name,format,recorded_on)
    VALUES(portal,p_transcript,p_file_name,p_format,p_recorded_on) ON CONFLICT(portal_id,transcript_id) DO NOTHING;
END $$;

-- Received files no production uses yet (one of them with p_transcript), newest first.
CREATE OR REPLACE FUNCTION public.reporter_drive_received(p_transcript uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,core,public,pg_temp AS $$
DECLARE portal uuid := core.reporter_require('reporter.read');
BEGIN
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.transcript_id,'fileName',i.file_name,'format',i.format,
      'recordedOn',i.recorded_on,'receivedAt',i.created_at,'size',s.size,'status',t.status,'errorCode',t.error_code) ORDER BY i.created_at DESC)
    FROM public.reporter_drive_intakes i
    JOIN public.reporter_transcripts t ON t.portal_id=i.portal_id AND t.id=i.transcript_id
    JOIN core.storage_objects s ON s.portal_id=t.portal_id AND s.id=t.source_object_id
    WHERE i.portal_id=portal AND (p_transcript IS NULL OR i.transcript_id=p_transcript)
      AND i.created_at>clock_timestamp()-interval '30 days'
      AND NOT EXISTS(SELECT FROM public.reporter_ed_sources e WHERE e.portal_id=portal AND e.doc->>'transcriptId'=i.transcript_id::text)),'[]'::jsonb);
END $$;
ALTER FUNCTION public.reporter_drive_intake_record(uuid,text,text,date) OWNER TO reporter_executor;
ALTER FUNCTION public.reporter_drive_received(uuid) OWNER TO reporter_executor;
REVOKE ALL ON FUNCTION public.reporter_drive_intake_record(uuid,text,text,date),public.reporter_drive_received(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_drive_intake_record(uuid,text,text,date),public.reporter_drive_received(uuid) TO reporter_runtime;
COMMIT;
