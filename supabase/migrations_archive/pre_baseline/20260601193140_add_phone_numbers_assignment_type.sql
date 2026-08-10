-- Phone Number Assignment Model — Pass 1 of 3 (schema foundation only).
--
-- Adds phone_numbers.assignment_type to distinguish shared "agency" pool numbers
-- from user-owned "personal" numbers. This pass does NOT change outbound caller-ID
-- selection; enforcement (excluding personal numbers from automatic outbound
-- selection, owner-only manual select) lands in Pass 2.
--
-- Invariant: a phone number's outbound role is controlled by assignment_type,
-- NOT by assigned_to alone and NOT by is_direct_line.
--   - agency   = shared outbound pool number.
--   - personal = user-owned number; assigned_to is required; cannot be org default.
-- assigned_to alone never implies personal — existing assigned_to rows stay agency.
--
-- Safe/idempotent: ADD COLUMN IF NOT EXISTS + DROP/ADD CONSTRAINT IF EXISTS.
-- The NOT NULL DEFAULT 'agency' backfills every existing row to 'agency' implicitly;
-- this migration does NOT update assigned_to, is_default, is_direct_line, status,
-- number_groups, or any other data.

ALTER TABLE public.phone_numbers
  ADD COLUMN IF NOT EXISTS assignment_type text NOT NULL DEFAULT 'agency';

-- Allowed values: agency | personal
ALTER TABLE public.phone_numbers
  DROP CONSTRAINT IF EXISTS phone_numbers_assignment_type_check;
ALTER TABLE public.phone_numbers
  ADD CONSTRAINT phone_numbers_assignment_type_check
  CHECK (assignment_type IN ('agency', 'personal'));

-- Personal numbers must have an owner (assigned_to).
ALTER TABLE public.phone_numbers
  DROP CONSTRAINT IF EXISTS phone_numbers_personal_requires_owner_check;
ALTER TABLE public.phone_numbers
  ADD CONSTRAINT phone_numbers_personal_requires_owner_check
  CHECK (assignment_type <> 'personal' OR assigned_to IS NOT NULL);

-- Personal numbers cannot be the org default number.
ALTER TABLE public.phone_numbers
  DROP CONSTRAINT IF EXISTS phone_numbers_personal_not_default_check;
ALTER TABLE public.phone_numbers
  ADD CONSTRAINT phone_numbers_personal_not_default_check
  CHECK (assignment_type <> 'personal' OR COALESCE(is_default, false) = false);

NOTIFY pgrst, 'reload schema';
