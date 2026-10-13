-- Keep identity binding behind one narrow security-definer function.
-- The migration owner already owns the application tables; runtime receives EXECUTE only.
BEGIN;

ALTER FUNCTION public.reporter_session_context(text,text,text,text,boolean,uuid)
  OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.reporter_session_context(text,text,text,text,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporter_session_context(text,text,text,text,boolean,uuid)
  TO reporter_runtime;

COMMENT ON FUNCTION public.reporter_session_context(text,text,text,text,boolean,uuid)
  IS 'reporter-neon-cloud-v2';

COMMIT;
