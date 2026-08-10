-- =============================================================
-- Fix: Missing status column in organizations table.
-- The super_admin_dashboard_snapshot() RPC expects this column.
-- =============================================================

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

-- Ensure it's one of the expected values
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_status_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_status_check 
  CHECK (status IN ('active', 'suspended', 'archived'));

COMMENT ON COLUMN public.organizations.status IS 
  'The platform-level status of the agency (active, suspended, archived).';
