-- The product is "Reporter IA": rename the seeded cloud workspace and its admin role description.
-- Only the rows created by 005 change, and only while they still carry an old spelling. Safe to replay.
BEGIN;

UPDATE core.tenants SET name = 'Reporter IA'
WHERE id = '10000000-0000-0000-0000-000000000001' AND name IN ('Repórter AI', 'Reporter AI');

UPDATE public.portals SET name = 'Reporter IA'
WHERE id = '10000000-0000-0000-0000-000000000101' AND name IN ('Repórter AI', 'Reporter AI');

UPDATE public.portal_roles SET description = 'Administração do Reporter IA'
WHERE id = '10000000-0000-0000-0000-000000000201' AND description = 'Administração do Reporter AI';

COMMIT;
