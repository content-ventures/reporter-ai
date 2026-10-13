-- Synthetic local identities and a catalog-only source. No real files/users are imported.
BEGIN;
INSERT INTO core.tenants(id,slug,name) VALUES
  ('00000000-0000-0000-0000-000000000001','reporter-local','Reporter local'),
  ('00000000-0000-0000-0000-000000000002','reporter-isolation','Isolation fixture');
INSERT INTO core.users(id,name,email) VALUES
  ('00000000-0000-0000-0000-000000000011','Local editor','editor@reporter.local.invalid'),
  ('00000000-0000-0000-0000-000000000012','Local reviewer','reviewer@reporter.local.invalid'),
  ('00000000-0000-0000-0000-000000000021','Other portal','other@reporter.local.invalid');
INSERT INTO core.tenant_members(tenant_id,user_id) VALUES
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012'),
  ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000021');
INSERT INTO public.portals(id,tenant_id,name,slug) VALUES
  ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','Reporter local','reporter-local'),
  ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000002','Other portal','reporter-isolation');
INSERT INTO public.portal_members(tenant_id,portal_id,user_id) SELECT tenant_id,
  CASE WHEN tenant_id='00000000-0000-0000-0000-000000000001' THEN '00000000-0000-0000-0000-000000000101'::uuid
    ELSE '00000000-0000-0000-0000-000000000102'::uuid END,user_id FROM core.tenant_members;
INSERT INTO core.tenant_modules(tenant_id,module_key,enabled) SELECT id,'reporter_ai',true FROM core.tenants;
INSERT INTO core.portal_modules(tenant_id,portal_id,module_key,enabled) SELECT tenant_id,id,'reporter_ai',true FROM public.portals;
INSERT INTO public.portal_roles(id,portal_id,name) VALUES
  ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','Local editor'),
  ('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000101','Local reviewer'),
  ('00000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000102','Other portal');
INSERT INTO public.portal_role_permissions(portal_role_id,permission)
  SELECT '00000000-0000-0000-0000-000000000201'::uuid,unnest(ARRAY['reporter.read','reporter.edit','reporter.submit','reporter.retry'])
  UNION ALL SELECT '00000000-0000-0000-0000-000000000202'::uuid,unnest(ARRAY['reporter.read','reporter.review'])
  UNION ALL SELECT '00000000-0000-0000-0000-000000000203'::uuid,unnest(ARRAY['reporter.read','reporter.edit','reporter.submit','reporter.retry']);
INSERT INTO public.portal_user_roles(portal_id,user_id,portal_role_id) VALUES
  ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000201'),
  ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000203');
INSERT INTO core.storage_objects(id,tenant_id,portal_id,owner_user_id,purpose,provider,visibility,key,file_name,size,content_type,status)
VALUES('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000011',
  'reporter-source','s3','private','fixture/no-real-media','fixture.mp3',1024,'audio/mpeg','completed');
COMMIT;
