-- Migration: agent_state_licenses_rls_patch
-- Date: 2026-05-22
-- Goal: Update RLS policies for agent_state_licenses to allow normal Agents CRUD access on their own rows, while retaining cross-org Super Admin permissions.

-- Drop existing policies
DROP POLICY IF EXISTS agent_state_licenses_select ON public.agent_state_licenses;
DROP POLICY IF EXISTS agent_state_licenses_insert ON public.agent_state_licenses;
DROP POLICY IF EXISTS agent_state_licenses_update ON public.agent_state_licenses;
DROP POLICY IF EXISTS agent_state_licenses_delete ON public.agent_state_licenses;

-- SELECT policy: Users can see their own licenses, or Admins/Team Leaders can see all licenses in the organization.
-- Super Admins can see all licenses across all organizations (cross-org bypass).
CREATE POLICY agent_state_licenses_select
  ON public.agent_state_licenses
  FOR SELECT
  USING (
    (organization_id = public.get_org_id() AND (
      agent_id = auth.uid()
      OR public.get_user_role() IN ('Admin', 'Team Leader')
    ))
    OR public.is_super_admin()
  );

-- INSERT policy: Agents can insert their own license rows, Admins/Team Leaders can insert for anyone in the organization.
-- Super Admins can insert for any organization (cross-org bypass).
CREATE POLICY agent_state_licenses_insert
  ON public.agent_state_licenses
  FOR INSERT
  WITH CHECK (
    organization_id = public.get_org_id()
    AND (
      agent_id = auth.uid()
      OR public.get_user_role() IN ('Admin', 'Team Leader')
      OR public.is_super_admin()
    )
  );

-- UPDATE policy: Agents can update their own rows, Admins/Team Leaders can update any row in the organization.
-- Super Admins can update any row across all organizations (cross-org bypass).
CREATE POLICY agent_state_licenses_update
  ON public.agent_state_licenses
  FOR UPDATE
  USING (
    (organization_id = public.get_org_id() AND (
      agent_id = auth.uid()
      OR public.get_user_role() IN ('Admin', 'Team Leader')
    ))
    OR public.is_super_admin()
  )
  WITH CHECK (
    (organization_id = public.get_org_id() AND (
      agent_id = auth.uid()
      OR public.get_user_role() IN ('Admin', 'Team Leader')
    ))
    OR public.is_super_admin()
  );

-- DELETE policy: Agents can delete their own rows, Admins/Team Leaders can delete any row in the organization.
-- Super Admins can delete any row across all organizations (cross-org bypass).
CREATE POLICY agent_state_licenses_delete
  ON public.agent_state_licenses
  FOR DELETE
  USING (
    (organization_id = public.get_org_id() AND (
      agent_id = auth.uid()
      OR public.get_user_role() IN ('Admin', 'Team Leader')
    ))
    OR public.is_super_admin()
  );

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
