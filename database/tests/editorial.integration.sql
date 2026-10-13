BEGIN;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
 set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
 set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
 set_config('app.user_id','00000000-0000-0000-0000-000000000031',true);
DO $$
DECLARE current jsonb := public.reporter_editorial_load(true); revision bigint; saved bigint; payload jsonb;
BEGIN
  revision := (current->>'revision')::bigint;
  payload := jsonb_build_object('state',jsonb_build_object('workspace',jsonb_build_object('id','00000000-0000-0000-0000-000000000101'),
    'sessionPersonId','00000000-0000-0000-0000-000000000031'),'jobs','{}'::jsonb);
  saved := public.reporter_editorial_save(revision,payload);
  IF saved<>revision+1 THEN RAISE EXCEPTION 'Revision did not advance exactly once'; END IF;
  BEGIN PERFORM public.reporter_editorial_save(revision,payload); RAISE EXCEPTION 'Stale revision accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.reporter_editorial_workspaces SET checkpoint=''{}'''; RAISE EXCEPTION 'Direct write accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.reporter_editorial_save(saved,jsonb_set(payload,'{state,workspace,id}','"00000000-0000-0000-0000-000000000102"')); RAISE EXCEPTION 'Foreign portal accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT 'PASS editorial checkpoint persistence, optimistic concurrency, direct-write denial and portal isolation';
ROLLBACK;
