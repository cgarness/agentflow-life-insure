-- =============================================================
-- Migration: Tighten RLS on telnyx_settings
-- Purpose: Replace the overly-broad "all authenticated users"
--          policy with org-scoped, role-gated policies.
--          The platform-default row (00000000-...) remains
--          readable as a fallback for edge functions.
-- Depends on: get_org_id(), get_user_role(), is_super_admin()
-- =============================================================

-- 1. Drop the existing overly-broad policy
DROP POLICY IF EXISTS "Authenticated users can manage telnyx settings" ON telnyx_settings;

-- 2. SELECT: Users can read their org's settings OR the platform default row
CREATE POLICY "telnyx_settings_select" ON telnyx_settings
  FOR SELECT USING (
    is_super_admin()
    OR organization_id::uuid = get_org_id()
    OR id = '00000000-0000-0000-0000-000000000001'
  );

-- 3. INSERT: Only Admins can create settings for their own org
CREATE POLICY "telnyx_settings_insert" ON telnyx_settings
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (
      organization_id::uuid = get_org_id()
      AND get_user_role() = 'Admin'
    )
  );

-- 4. UPDATE: Only Admins can update their own org's settings
CREATE POLICY "telnyx_settings_update" ON telnyx_settings
  FOR UPDATE USING (
    is_super_admin()
    OR (
      organization_id::uuid = get_org_id()
      AND get_user_role() = 'Admin'
    )
  );

-- 5. DELETE: Only Admins can delete their own org's settings
CREATE POLICY "telnyx_settings_delete" ON telnyx_settings
  FOR DELETE USING (
    is_super_admin()
    OR (
      organization_id::uuid = get_org_id()
      AND get_user_role() = 'Admin'
    )
  );

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
