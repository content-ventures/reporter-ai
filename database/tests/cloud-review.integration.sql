BEGIN;
INSERT INTO core.users(id,name,email) VALUES('10000000-0000-0000-0000-000000000032','Review acceptance','review-acceptance@reporter.invalid') ON CONFLICT DO NOTHING;
INSERT INTO core.tenant_members(tenant_id,user_id,role) VALUES('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000032','member') ON CONFLICT DO NOTHING;
INSERT INTO public.portal_members(tenant_id,portal_id,user_id,status) VALUES('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000101','10000000-0000-0000-0000-000000000032','active') ON CONFLICT DO NOTHING;
INSERT INTO public.portal_user_roles(portal_id,user_id,portal_role_id) SELECT '10000000-0000-0000-0000-000000000101','10000000-0000-0000-0000-000000000032',id FROM public.portal_roles WHERE portal_id='10000000-0000-0000-0000-000000000101' AND name='approver' ON CONFLICT DO NOTHING;
SET SESSION AUTHORIZATION reporter_runtime;
SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),set_config('app.tenant_id','10000000-0000-0000-0000-000000000001',true),set_config('app.portal_id','10000000-0000-0000-0000-000000000101',true),set_config('app.user_id','10000000-0000-0000-0000-000000000032',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.reporter_ed_load('{"write":true}');
    RAISE EXCEPTION 'Reviewer unexpectedly received editing permission';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.editorial_permission','reporter.review',true);
  PERFORM public.reporter_ed_load('{"write":true}');
  IF jsonb_array_length(public.reporter_workspace_members())<1 THEN RAISE EXCEPTION 'Active reviewers missing from cloud membership'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
SELECT 'PASS cloud reviewer permission and authoritative workspace membership';
