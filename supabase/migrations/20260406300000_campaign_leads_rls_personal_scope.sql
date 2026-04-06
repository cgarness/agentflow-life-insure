-- =============================================================
-- Migration: campaign_leads RLS — Personal Campaign Scoping
-- Purpose: Refine campaign_leads SELECT policy so agents see
--          only their own leads in Personal campaigns, while
--          Team and Open campaigns remain fully visible.
--          Also fixes 'Team Lead' vs 'Team Leader' role string
--          inconsistency in campaigns SELECT/UPDATE/DELETE policies.
-- Depends on: 20260403100000_campaigns_rls.sql
--             20260331200000_jwt_custom_claims.sql
-- =============================================================

-- -------------------------------------------------------
-- 1. Replace campaign_leads SELECT policy
--    Old policy: is_super_admin() OR organization_id = get_org_id()
--    New policy: campaign-type-aware agent scoping
-- -------------------------------------------------------

DROP POLICY IF EXISTS "campaign_leads_select" ON public.campaign_leads;

CREATE POLICY "campaign_leads_select" ON public.campaign_leads
FOR SELECT TO authenticated
USING (
  is_super_admin()
  OR (
    organization_id = get_org_id()
    AND (
      -- Admins and Team Leaders see all campaign leads in their org
      -- NOTE: cover both role string variants that exist in the codebase
      get_user_role() IN ('Admin', 'Team Leader', 'Team Lead')
      OR
      -- Agents: routing depends on campaign type
      (
        get_user_role() = 'Agent'
        AND (
          -- Team or Open campaign: agent sees all leads (needed for queue display)
          EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = campaign_leads.campaign_id
            AND c.type IN ('Team', 'Open', 'Open Pool')
            AND c.organization_id = get_org_id()
          )
          OR
          -- Personal campaign: agent sees only leads they own
          (
            EXISTS (
              SELECT 1 FROM public.campaigns c
              WHERE c.id = campaign_leads.campaign_id
              AND c.type = 'Personal'
              AND c.organization_id = get_org_id()
            )
            AND (
              claimed_by = auth.uid()
              OR user_id = auth.uid()
            )
          )
        )
      )
    )
  )
);

-- -------------------------------------------------------
-- 2. Fix role string inconsistency in campaigns policies
--    Original policies used 'Team Lead' but profiles table
--    stores 'Team Leader'. Cover both variants.
-- -------------------------------------------------------

-- 2a. campaigns SELECT — fix role string only
DROP POLICY IF EXISTS "campaigns_select" ON public.campaigns;

CREATE POLICY "campaigns_select" ON public.campaigns
  FOR SELECT USING (
    is_super_admin()
    OR (
      organization_id = get_org_id()
      AND (
        get_user_role() IN ('Admin', 'Team Leader', 'Team Lead')
        OR user_id = auth.uid()
        OR auth.uid()::text = ANY(
          ARRAY(SELECT jsonb_array_elements_text(assigned_agent_ids::jsonb))
        )
      )
    )
  );

-- 2b. campaigns UPDATE — fix role string only
DROP POLICY IF EXISTS "campaigns_update" ON public.campaigns;

CREATE POLICY "campaigns_update" ON public.campaigns
  FOR UPDATE USING (
    is_super_admin()
    OR (
      organization_id = get_org_id()
      AND (
        get_user_role() IN ('Admin', 'Team Leader', 'Team Lead')
        OR user_id = auth.uid()
      )
    )
  );

-- 2c. campaigns DELETE — fix role string only
DROP POLICY IF EXISTS "campaigns_delete" ON public.campaigns;

CREATE POLICY "campaigns_delete" ON public.campaigns
  FOR DELETE USING (
    is_super_admin()
    OR (
      organization_id = get_org_id()
      AND (
        get_user_role() IN ('Admin', 'Team Leader', 'Team Lead')
        OR user_id = auth.uid()
      )
    )
  );

-- -------------------------------------------------------
-- 3. Refresh PostgREST schema cache
-- -------------------------------------------------------
NOTIFY pgrst, 'reload schema';
