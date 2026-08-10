-- Queue / Campaign Behavior — Build 4: Campaign Card Stats Consistency
--
-- Read-only, org-scoped aggregate for the Campaigns page card stats
-- (Total / Called / Contacted / Converted). Replaces the four stored
-- `campaigns.leads_*` columns as the card's data source: `leads_contacted`
-- and `leads_converted` are NOT trigger-maintained (always 0), and even the
-- maintained `total_leads` / `leads_called` can drift over time.
--
-- Definitions mirror the trusted Dialer model:
--   total_leads     = COUNT(campaign_leads in campaign) — keeps terminal/DNC/
--                     converted rows that remain in the campaign.
--   called_leads    = campaign_leads with call_attempts > 0 (Skip never counts).
--   contacted_leads = DISTINCT campaign leads with >=1 contacted OUTBOUND call:
--                       duration > 45 (Twilio-backed) OR disposition
--                       counts_as_contacted = true, excluding the system/locked
--                       "No Answer" disposition. Disposition match prefers
--                       calls.disposition_id (UUID FK) and falls back to
--                       lowercased disposition_name (org-scoped) for legacy rows.
--   converted_leads = DISTINCT campaign leads with >=1 "converting" OUTBOUND
--                     call, where the call's disposition maps to a
--                     pipeline_stages row with convert_to_client = true.
--                     UNIQUE PER LEAD — never per policy. NOT derived from
--                     COUNT(wins): wins are policy-level production metrics (a
--                     client may hold multiple policies) and belong in Reports,
--                     not the card's Converted stat.
--   policies_sold   = COUNT(wins) for the campaign — returned as a separate,
--                     forward-compat field for future Reports; NOT Converted and
--                     not rendered on the card in Build 4.
--
-- Calls are scoped to the campaign via calls.campaign_lead_id -> campaign_leads
-- (the queue entity), which has identical coverage to calls.campaign_id and
-- ties each call to a specific lead so the DISTINCT counts are per-lead. Only
-- OUTBOUND calls count (campaign cards reflect outbound dialing performance);
-- the predicate mirrors `report-utils.isCallsRowOutboundDirection`
-- (direction IN ('outbound','outgoing')). Campaign-linked calls in prod are
-- 100% 'outbound' (0 inbound, 0 null), so this excludes nothing today; a future
-- null/inbound row is conservatively excluded (same as the trusted Dialer stats).
--
-- Security: SECURITY DEFINER so it can read campaign-wide rows, but:
--   * org-scoped to public.get_org_id() (no cross-org; Super Admin does NOT
--     bypass org scoping here), AND
--   * campaign-access-scoped to the SAME rules as the frontend helper
--     `canUserAccessCampaign` (src/lib/campaign-assignee-scope.ts):
--       - Open Pool        → visible to everyone in org
--       - Personal         → owner only (user_id = auth.uid())
--       - Team             → visible if auth.uid() is in assigned_agent_ids
--       - view-all (Admin / Team Leader / Super Admin) → ALSO all Team campaigns
--         in org, but NEVER another agent's Personal campaign.
-- A campaign id the caller cannot access simply yields no row (the access
-- predicate is an AND inside the scoped CTE — `p_campaign_ids` can only narrow,
-- never widen). Aggregate counts only; no PII.
-- NOTE: this is intentionally STRICTER than the `campaigns_select` RLS policy
-- (which lets Admin/Team Leader see other agents' Personal campaigns); the card
-- mirrors the app's own visibility helper per product requirement.

CREATE OR REPLACE FUNCTION public.get_campaign_card_stats(
  p_campaign_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  campaign_id      uuid,
  total_leads      integer,
  called_leads     integer,
  contacted_leads  integer,
  converted_leads  integer,
  policies_sold    integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Resolve caller identity / org / view-all ONCE (single evaluation).
  WITH me AS (
    SELECT
      public.get_org_id() AS org_id,
      auth.uid()          AS uid,
      (
        public.get_user_role() = ANY (ARRAY['Admin', 'Team Leader', 'Team Lead'])
        OR public.is_super_admin()
      )                   AS view_all
  ),
  -- Campaigns the caller may see: org-scoped AND access-scoped to the frontend
  -- `canUserAccessCampaign` rules. `p_campaign_ids` can only narrow this set.
  camp AS (
    SELECT c.id, c.organization_id
    FROM public.campaigns c
    CROSS JOIN me
    WHERE me.org_id IS NOT NULL
      AND c.organization_id = me.org_id
      AND (p_campaign_ids IS NULL OR c.id = ANY (p_campaign_ids))
      AND (
            -- Open Pool: visible to everyone in the org
            upper(btrim(c.type)) = ANY (ARRAY['OPEN POOL', 'OPEN'])
            -- Personal: owner only
         OR (upper(btrim(c.type)) = 'PERSONAL' AND c.user_id = me.uid)
            -- Team: member of assigned_agent_ids
         OR (upper(btrim(c.type)) = 'TEAM'
             AND me.uid::text = ANY (
               ARRAY(SELECT jsonb_array_elements_text(coalesce(c.assigned_agent_ids, '[]'::jsonb)))
             ))
            -- view-all (Admin / Team Leader / Super Admin): all Team campaigns,
            -- but NOT another agent's Personal campaign
         OR (me.view_all AND upper(btrim(c.type)) = 'TEAM')
      )
  ),
  -- One row per (campaign_lead, OUTBOUND call) with resolved disposition flags.
  call_facts AS (
    SELECT
      cl.campaign_id            AS campaign_id,
      cl.id                     AS campaign_lead_id,
      -- Contacted: prefer disposition_id; legacy rows fall back to name.
      -- The system/locked "No Answer" disposition is never contacted.
      CASE
        WHEN lower(coalesce(di.name, dn.name, ca.disposition_name, '')) = 'no answer'
          THEN false
        WHEN coalesce(ca.duration, 0) > 45
          THEN true
        WHEN coalesce(di.counts_as_contacted, false)
          THEN true
        WHEN ca.disposition_id IS NULL AND coalesce(dn.counts_as_contacted, false)
          THEN true
        ELSE false
      END AS is_contacted,
      -- Converting: disposition's pipeline stage has convert_to_client = true.
      CASE
        WHEN coalesce(psi.convert_to_client, false)
          THEN true
        WHEN ca.disposition_id IS NULL AND coalesce(psn.convert_to_client, false)
          THEN true
        ELSE false
      END AS is_converting
    FROM camp
    JOIN public.campaign_leads cl ON cl.campaign_id = camp.id
    JOIN public.calls ca
      ON ca.campaign_lead_id = cl.id
     -- Outbound only (mirrors isCallsRowOutboundDirection); excludes inbound.
     AND lower(coalesce(ca.direction, '')) = ANY (ARRAY['outbound', 'outgoing'])
    -- Preferred: resolve disposition by UUID FK.
    LEFT JOIN public.dispositions di     ON di.id = ca.disposition_id
    LEFT JOIN public.pipeline_stages psi ON psi.id = di.pipeline_stage_id
    -- Legacy fallback: resolve by lowercased name within the org (id-less rows).
    LEFT JOIN public.dispositions dn
      ON ca.disposition_id IS NULL
     AND lower(dn.name) = lower(ca.disposition_name)
     AND dn.organization_id = camp.organization_id
    LEFT JOIN public.pipeline_stages psn ON psn.id = dn.pipeline_stage_id
  )
  SELECT
    camp.id AS campaign_id,
    (SELECT count(*)::int
       FROM public.campaign_leads cl
      WHERE cl.campaign_id = camp.id)                                    AS total_leads,
    (SELECT count(*)::int
       FROM public.campaign_leads cl
      WHERE cl.campaign_id = camp.id
        AND coalesce(cl.call_attempts, 0) > 0)                          AS called_leads,
    (SELECT count(DISTINCT cf.campaign_lead_id)::int
       FROM call_facts cf
      WHERE cf.campaign_id = camp.id
        AND cf.is_contacted)                                            AS contacted_leads,
    (SELECT count(DISTINCT cf.campaign_lead_id)::int
       FROM call_facts cf
      WHERE cf.campaign_id = camp.id
        AND cf.is_converting)                                           AS converted_leads,
    (SELECT count(*)::int
       FROM public.wins w
      WHERE w.campaign_id = camp.id
        AND w.organization_id = camp.organization_id)                  AS policies_sold
  FROM camp;
$$;

REVOKE ALL ON FUNCTION public.get_campaign_card_stats(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_card_stats(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
