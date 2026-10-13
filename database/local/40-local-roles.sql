-- Local only: read container env without embedding credentials in committed SQL.
\getenv runtime_password REPORTER_RUNTIME_PASSWORD
\getenv worker_password REPORTER_WORKER_PASSWORD
SELECT format('ALTER ROLE reporter_runtime LOGIN PASSWORD %L', :'runtime_password') \gexec
SELECT format('ALTER ROLE reporter_worker LOGIN PASSWORD %L', :'worker_password') \gexec
GRANT CONNECT ON DATABASE reporter_ai_local TO reporter_runtime,reporter_worker;
COMMENT ON FUNCTION public.reporter_create(text,uuid,integer,text,jsonb) IS 'reporter-r1-v2';
COMMENT ON DATABASE reporter_ai_local IS 'Reporter AI standalone local; foundation and R1 commands v2';
