-- One-time data cleanup (2026-04-25): remove empty test / duplicate signup organizations.
-- Kept: Family First Life - Chris Garcia (a0000000-0000-0000-0000-000000000001),
--       John's Agency — chrisgarness702@gmail.com (fe376eca-36b4-4e79-923e-49df41fcf4f9).
-- Safe on fresh DBs: DELETE affects 0 rows if these UUIDs never existed.

DELETE FROM public.organizations
WHERE id IN (
  '02c3280c-11f6-4aa0-a2c4-31cee3d268d6'::uuid,
  '4624ad65-2220-47b2-97fe-e379f1cea32c'::uuid,
  'a0600000-0000-0000-0000-000000000001'::uuid,
  '4d4e0002-e5ec-4bdd-ace1-82328129a164'::uuid,
  '04c1cc46-46d5-485a-82fe-bb2c42e011c4'::uuid,
  '10ae2f75-3c1e-492d-9f10-5746efeaf663'::uuid,
  'b895ad7e-8087-4e07-a8ea-5f6c5d350b0a'::uuid,
  '381a8d9d-03ee-46cf-8a3e-f7245328ff46'::uuid,
  '0f991648-dd62-406b-94ff-740d5e45b2c2'::uuid
);

NOTIFY pgrst, 'reload schema';
