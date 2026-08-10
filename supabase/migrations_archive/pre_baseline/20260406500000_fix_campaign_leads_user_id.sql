-- Migration: fix_campaign_leads_user_id
-- Purpose: Hotfix for "column user_id does not exist" error thrown by
--   add_leads_to_campaign RPC when inserting into campaign_leads.
--
-- Root cause: Migration 20260403100000_campaigns_rls.sql added user_id to
--   campaign_leads on remote, but the ALTER TABLE may not have been applied,
--   leaving the column absent. The previously deployed version of
--   add_leads_to_campaign also included user_id in its INSERT column list,
--   causing the runtime error.
--
-- This migration is idempotent:
--   1. Adds user_id to campaign_leads IF NOT EXISTS (safe if already present).
--   2. Backfills user_id from claimed_by for existing rows.
--   3. Sets user_id DEFAULT to auth.uid() for future inserts.
--   4. Recreates add_leads_to_campaign without user_id in the INSERT —
--      matching the canonical body in 20260406200000_add_leads_to_campaign_rpc.sql.

-- -------------------------------------------------------
-- 1. Ensure user_id column exists on campaign_leads
-- -------------------------------------------------------
ALTER TABLE public.campaign_leads
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Backfill from claimed_by where possible
UPDATE public.campaign_leads
  SET user_id = claimed_by::UUID
  WHERE claimed_by IS NOT NULL
    AND user_id IS NULL;

-- Default user_id to auth.uid() on future inserts
ALTER TABLE public.campaign_leads
  ALTER COLUMN user_id SET DEFAULT auth.uid();

-- -------------------------------------------------------
-- 2. Recreate add_leads_to_campaign without user_id in INSERT
--    (corrects any previously deployed version that referenced the column)
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_leads_to_campaign(
  p_campaign_id  UUID,
  p_lead_ids     UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id          UUID;
  v_campaign        RECORD;
  v_lead            RECORD;
  v_lid             UUID;
  v_added           INT := 0;
  v_skipped         INT := 0;
  v_skipped_ids     UUID[] := '{}';
  v_skip_reason     TEXT;
  v_valid_ids       UUID[] := '{}';
BEGIN
  -- --------------------------------------------------------
  -- Step 1: Resolve caller's organization
  -- --------------------------------------------------------
  v_org_id := public.get_org_id();

  -- --------------------------------------------------------
  -- Step 2: Fetch and validate the target campaign
  -- --------------------------------------------------------
  SELECT id, type, user_id, organization_id
    INTO v_campaign
    FROM public.campaigns
   WHERE id = p_campaign_id
     AND organization_id = v_org_id;

  IF v_campaign.id IS NULL THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;

  -- --------------------------------------------------------
  -- Step 3: Loop over lead IDs — validate ownership per type
  -- --------------------------------------------------------
  FOREACH v_lid IN ARRAY p_lead_ids
  LOOP
    v_skip_reason := NULL;

    -- 3a. Fetch the lead (org-scoped)
    SELECT id, first_name, last_name, phone, email, state, age,
           assigned_agent_id, organization_id
      INTO v_lead
      FROM public.leads
     WHERE id = v_lid
       AND organization_id = v_org_id;

    IF v_lead.id IS NULL THEN
      v_skip_reason := 'outside_organization';
    END IF;

    -- 3b. Dedup check — skip if already in campaign_leads for this campaign
    IF v_skip_reason IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.campaign_leads
         WHERE campaign_id = p_campaign_id
           AND lead_id = v_lid
      ) THEN
        v_skip_reason := 'already_in_campaign';
      END IF;
    END IF;

    -- 3c. Ownership validation by campaign type
    IF v_skip_reason IS NULL THEN
      CASE UPPER(v_campaign.type)
        WHEN 'PERSONAL' THEN
          IF v_lead.assigned_agent_id IS NULL
             OR v_lead.assigned_agent_id != v_campaign.user_id THEN
            v_skip_reason := 'not_owned_by_campaign_creator';
          END IF;

        WHEN 'TEAM' THEN
          IF v_lead.assigned_agent_id IS NULL
             OR (
               v_lead.assigned_agent_id != v_campaign.user_id
               AND NOT public.is_ancestor_of(v_campaign.user_id, v_lead.assigned_agent_id)
             ) THEN
            v_skip_reason := 'outside_team_downline';
          END IF;

        ELSE
          -- 'Open Pool' / 'Open' or any other type — org check in step 3a is sufficient
          NULL;
      END CASE;
    END IF;

    -- 3d. Accumulate result
    IF v_skip_reason IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      v_skipped_ids := array_append(v_skipped_ids, v_lid);
    ELSE
      v_valid_ids := array_append(v_valid_ids, v_lid);
    END IF;
  END LOOP;

  -- --------------------------------------------------------
  -- Step 4: Batch INSERT valid leads into campaign_leads
  --   NOTE: user_id is intentionally omitted here; the column
  --   DEFAULT (auth.uid()) handles it automatically.
  -- --------------------------------------------------------
  IF array_length(v_valid_ids, 1) > 0 THEN
    INSERT INTO public.campaign_leads
      (campaign_id, lead_id, first_name, last_name, phone, email, state, age, status, organization_id)
    SELECT
      p_campaign_id,
      l.id,
      l.first_name,
      l.last_name,
      l.phone,
      l.email,
      l.state,
      l.age,
      'Queued',
      v_org_id
    FROM public.leads l
    WHERE l.id = ANY(v_valid_ids)
      AND l.organization_id = v_org_id;

    GET DIAGNOSTICS v_added = ROW_COUNT;
  END IF;

  -- --------------------------------------------------------
  -- Step 5: Return result summary
  -- --------------------------------------------------------
  RETURN jsonb_build_object(
    'added',       v_added,
    'skipped',     v_skipped,
    'skipped_ids', to_jsonb(v_skipped_ids)
  );
END;
$$;

-- -------------------------------------------------------
-- 3. Ensure execute grant is in place
-- -------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.add_leads_to_campaign(UUID, UUID[]) TO authenticated;

-- -------------------------------------------------------
-- 4. Reload PostgREST schema cache
-- -------------------------------------------------------
NOTIFY pgrst, 'reload schema';
