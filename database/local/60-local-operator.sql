-- One synthetic development operator, never an authenticated production person.
BEGIN;
INSERT INTO core.users(id,name,email) VALUES('00000000-0000-0000-0000-000000000031','Development operator','operator@reporter.local.invalid') ON CONFLICT(id) DO NOTHING;
INSERT INTO core.tenant_members(tenant_id,user_id) VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000031') ON CONFLICT DO NOTHING;
INSERT INTO public.portal_members(tenant_id,portal_id,user_id) VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000031') ON CONFLICT DO NOTHING;
INSERT INTO public.portal_roles(id,portal_id,name) VALUES('00000000-0000-0000-0000-000000000204','00000000-0000-0000-0000-000000000101','Development operator') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.portal_role_permissions(portal_role_id,permission)
  SELECT '00000000-0000-0000-0000-000000000204'::uuid,unnest(ARRAY['reporter.read','reporter.edit','reporter.submit','reporter.review','reporter.retry']) ON CONFLICT DO NOTHING;
INSERT INTO public.portal_user_roles(portal_id,user_id,portal_role_id)
  VALUES('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000204') ON CONFLICT DO NOTHING;
COMMIT;
