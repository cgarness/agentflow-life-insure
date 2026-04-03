-- =============================================================
-- Migration: Enable RLS on campaigns & campaign_leads
-- Purpose: Lock down campaign data so agents can only access
--          campaigns within their organization and that they are
--          assigned to (or created). Admins/Super Admins see all
--          campaigns within their org.
-- Depends on: get_org_id(), get_user_role(), is_super_admin()
--             from 20260331200000_jwt_custom_claims.sql
-- =============================================================

-- -------------------------------------------------------
-- 1. Add user_id column to campaigns (FK to auth.users)
-- -------------------------------------------------------
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Backfill user_id from created_by where possible
UPDATE public.campaigns
  SET user_id = created_by::UUID
  WHERE created_by IS NOT NULL
    AND user_id IS NULL;

-- Default user_id to auth.uid() on future inserts
ALTER TABLE public.campaigns
  ALTER COLUMN user_id SET DEFAULT auth.uid();

-- -------------------------------------------------------
-- 2. Add user_id column to campaign_leads (FK to auth.users)
-- -------------------------------------------------------
ALTER TABLE public.campaign_leads
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Backfill user_id from claimed_by where possible
UPDATE public.campaign_leads
  SET user_id = claimed_by::UUID
  WHERE claimed_by IS NOT NULL
    AND user_id IS NULL;

-- Default user_id to auth.uid() on future inserts
ALTER TABLE public.campaign_leads
  ALTER COLUMN user_id SET DEFAULT auth.uid();

-- -------------------------------------------------------
-- 3. Enable RLS on campaigns
-- -------------------------------------------------------
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies to avoid conflicts
DROP POLICY IF EXISTS "campaigns_select" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_insert" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_update" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_delete" ON public.campaigns;

-- SELECT: Super Admins see all. Admins see their org. Agents see campaigns they are assigned to or created.
CREATE POLICY "campaigns_select" ON public.campaigns
  FOR SELECT USING (
    is_super_admin()
    OR (
      organization_id = get_org_id()
      AND (
        get_user_role() IN ('Admin', 'Team Lead')
        OR user_id = auth.uid()
        OR auth.uid()::text = ANY(
          ARRAY(SELECT jsonb_array_elements_text(assigned_agent_ids::jsonb))
        )
      )
    )
  );

-- INSERT: Authenticated users can create campaigns in their own org
CREATE POLICY "campaigns_insert" ON public.campaigns
  FOR INSERT WITH CHECK (
    organization_id = get_org_id()
    AND user_id = auth.uid()
  );

-- UPDATE: Super Admins can update any. Admins update within org. Agents update only their own.
CREATE POLICY "campaigns_update" ON public.campaigns
  FOR UPDATE USING (
    is_super_admin()
    OR (
      organization_id = get_org_id()
      AND (
        get_user_role() IN ('Admin', 'Team Lead')
        OR user_id = auth.uid()
      )
    )
  );

-- DELETE: Only Admins+ within org, or the campaign creator
CREATE POLICY "campaigns_delete" ON public.campaigns
  FOR DELETE USING (
    is_super_admin()
    OR (
      organization_id = get_org_id()
      AND (
        get_user_role() IN ('Admin', 'Team Lead')
        OR user_id = auth.uid()
      )
    )
  );

-- -------------------------------------------------------
-- 4. Enable RLS on campaign_leads
-- -------------------------------------------------------
ALTER TABLE public.campaign_leads ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies to avoid conflicts
DROP POLICY IF EXISTS "campaign_leads_select" ON public.campaign_leads;
DROP POLICY IF EXISTS "campaign_leads_insert" ON public.campaign_leads;
DROP POLICY IF EXISTS "campaign_leads_update" ON public.campaign_leads;
DROP POLICY IF EXISTS "campaign_leads_delete" ON public.campaign_leads;

-- SELECT: Users can see leads in campaigns they have access to (org-scoped)
CREATE POLICY "campaign_leads_select" ON public.campaign_leads
  FOR SELECT USING (
    is_super_admin()
    OR organization_id = get_org_id()
  );

-- INSERT: Users can add leads to campaigns within their org
CREATE POLICY "campaign_leads_insert" ON public.campaign_leads
  FOR INSERT WITH CHECK (
    organization_id = get_org_id()
  );

-- UPDATE: Users can update leads within their org
CREATE POLICY "campaign_leads_update" ON public.campaign_leads
  FOR UPDATE USING (
    is_super_admin()
    OR organization_id = get_org_id()
  );

-- DELETE: Users can remove leads within their org
CREATE POLICY "campaign_leads_delete" ON public.campaign_leads
  FOR DELETE USING (
    is_super_admin()
    OR organization_id = get_org_id()
  );

-- -------------------------------------------------------
-- 5. Refresh PostgREST schema cache
-- -------------------------------------------------------
NOTIFY pgrst, 'reload schema';
