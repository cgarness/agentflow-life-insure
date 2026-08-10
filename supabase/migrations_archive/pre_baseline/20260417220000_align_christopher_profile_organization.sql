-- One-time data repair: Christopher Garness profile was missing organization_id (or had a
-- different value) while other agency users shared the same org — hierarchy and RLS rely
-- on organization_id matching the tenant.
--
-- Source org: Chris Garness (admin). Target: Christopher Garness (team leader).
-- Emails match production screenshots (fflagent.com); safe no-op if rows are missing.

UPDATE public.profiles AS p
SET
  organization_id = ref.organization_id,
  updated_at = now()
FROM (
  SELECT organization_id
  FROM public.profiles
  WHERE lower(email) = lower('cgarness.ffl@gmail.com')
    AND organization_id IS NOT NULL
  LIMIT 1
) AS ref
WHERE lower(p.email) = lower('chris@fflagent.com')
  AND ref.organization_id IS NOT NULL
  AND (
    p.organization_id IS DISTINCT FROM ref.organization_id
    OR p.organization_id IS NULL
  );
