-- Migration: add_leads_to_campaign RPC
-- Description: Server-side RPC that validates lead ownership rules before
--   inserting into campaign_leads. Enforces Personal/Team/Open campaign type
--   logic at the database layer so the frontend cannot bypass ownership checks.
--
-- Depends on:
--   get_org_id()            — 20260331200000_jwt_custom_claims.sql
--   is_ancestor_of(UUID,UUID) — 20260331200200_ltree_hierarchy.sql
--   campaigns, leads, campaign_leads tables
--   trg_sync_campaign_total_leads — 20260406100000 (auto-increments total_leads)

-- ============================================================
-- 1. Create the RPC function
-- ============================================================

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
      -- Lead not found or wrong org — skip
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
          -- 'Open Pool' / 'Open' or any other type
          -- Org check was already done in step 3a; nothing extra needed
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

-- ============================================================
-- 2. Grant execute to authenticated users
-- ============================================================
GRANT EXECUTE ON FUNCTION public.add_leads_to_campaign(UUID, UUID[]) TO authenticated;

-- ============================================================
-- 3. Notify PostgREST to reload schema cache
-- ============================================================
NOTIFY pgrst, 'reload schema';
