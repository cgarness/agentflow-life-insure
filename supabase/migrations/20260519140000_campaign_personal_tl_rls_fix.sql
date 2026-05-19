-- Team Leaders must not SELECT other agents' Personal campaigns (dialer + campaigns list).
-- Admins retain full org campaign visibility for management.

-- Backfill Personal owner from created_by when user_id was wrong or null
UPDATE public.campaigns
SET user_id = created_by::uuid
WHERE upper(trim(type)) = 'PERSONAL'
  AND created_by IS NOT NULL
  AND (user_id IS NULL OR user_id IS DISTINCT FROM created_by::uuid);

UPDATE public.campaigns
SET assigned_agent_ids = jsonb_build_array(user_id::text)
WHERE upper(trim(type)) = 'PERSONAL'
  AND user_id IS NOT NULL;

DROP POLICY IF EXISTS campaigns_select ON public.campaigns;

CREATE POLICY campaigns_select ON public.campaigns FOR SELECT TO authenticated
USING (
  public.super_admin_own_org(organization_id)
  OR (
    organization_id = public.get_org_id()
    AND (
      public.get_user_role() = 'Admin'::text
      OR (
        public.get_user_role() = ANY (
          ARRAY['Team Leader'::text, 'Team Lead'::text]
        )
        AND (
          upper(trim(type)) IN ('OPEN POOL'::text, 'OPEN'::text, 'TEAM'::text)
          OR (
            upper(trim(type)) = 'PERSONAL'
            AND user_id = auth.uid()
          )
        )
      )
      OR (
        public.get_user_role() = 'Agent'::text
        AND (
          upper(trim(type)) IN ('OPEN POOL'::text, 'OPEN'::text)
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
    )
  )
);
