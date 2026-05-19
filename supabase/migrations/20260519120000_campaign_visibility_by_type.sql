-- Campaign visibility by type: Personal (owner only), Team (assigned agents), Open Pool (org-wide).
-- Tightens campaigns_select and campaign_leads_select for Agents.

-- Personal campaigns: align assigned_agent_ids with owner
UPDATE public.campaigns
SET assigned_agent_ids = jsonb_build_array(user_id::text)
WHERE upper(trim(type)) = 'PERSONAL'
  AND user_id IS NOT NULL
  AND (
    assigned_agent_ids IS NULL
    OR assigned_agent_ids = '[]'::jsonb
    OR NOT (assigned_agent_ids @> jsonb_build_array(user_id::text))
  );

DROP POLICY IF EXISTS campaigns_select ON public.campaigns;

CREATE POLICY campaigns_select ON public.campaigns FOR SELECT TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = ANY (
        ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text]
      )
      OR upper(trim(type)) IN ('OPEN POOL'::text, 'OPEN'::text)
      OR (
        upper(trim(type)) = 'PERSONAL'
        AND user_id = auth.uid()
      )
      OR (
        upper(trim(type)) = 'TEAM'
        AND (auth.uid())::text = ANY (
          ARRAY (
            SELECT jsonb_array_elements_text(campaigns.assigned_agent_ids)
          )
        )
      )
    )
  )
);

DROP POLICY IF EXISTS campaign_leads_select ON public.campaign_leads;

CREATE POLICY campaign_leads_select ON public.campaign_leads FOR SELECT TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = ANY (
        ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text]
      )
      OR (
        public.get_user_role() = 'Agent'::text
        AND (
          EXISTS (
            SELECT 1
            FROM public.campaigns c
            WHERE c.id = campaign_leads.campaign_id
              AND c.organization_id = public.get_org_id()
              AND upper(trim(c.type)) IN ('OPEN POOL'::text, 'OPEN'::text)
          )
          OR EXISTS (
            SELECT 1
            FROM public.campaigns c
            WHERE c.id = campaign_leads.campaign_id
              AND c.organization_id = public.get_org_id()
              AND upper(trim(c.type)) = 'TEAM'
              AND (auth.uid())::text = ANY (
                ARRAY (
                  SELECT jsonb_array_elements_text(c.assigned_agent_ids)
                )
              )
          )
          OR (
            EXISTS (
              SELECT 1
              FROM public.campaigns c
              WHERE c.id = campaign_leads.campaign_id
                AND c.type = 'Personal'::text
                AND c.organization_id = public.get_org_id()
            )
            AND (
              campaign_leads.claimed_by = auth.uid()
              OR campaign_leads.user_id = auth.uid()
            )
          )
        )
      )
    )
  )
);
