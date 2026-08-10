-- Production invitations table was missing accepted_at; add it before reconciling stale rows.
ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

-- Reconcile invitations left Pending after the user already joined (profile exists).
UPDATE public.invitations i
SET
  status = 'Accepted',
  accepted_at = COALESCE(i.accepted_at, NOW())
FROM public.profiles p
WHERE i.status = 'Pending'
  AND i.organization_id = p.organization_id
  AND lower(trim(i.email)) = lower(trim(p.email))
  AND p.status IS DISTINCT FROM 'Deleted';
