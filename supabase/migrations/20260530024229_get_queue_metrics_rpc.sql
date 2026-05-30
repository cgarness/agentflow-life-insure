-- Queue / Campaign Build 3 — get_queue_metrics RPC
--
-- Why: Team/Open Queue tab metrics cannot be computed accurately from the client.
-- The dialer_lead_locks SELECT policy only exposes a regular agent's OWN locks
-- (locked_by = auth.uid()), so org-wide locked/active-agent counts are invisible.
-- This SECURITY DEFINER, read-only RPC returns aggregate counts only (no lead PII)
-- and mirrors the eligibility predicate of the canonical claim RPC
-- public.get_next_queue_lead so "available to me now" matches what the agent
-- would actually be served next.
--
-- Notes:
-- * Aggregate counts only — never returns lead rows or PII.
-- * Org-scoped via public.get_org_id(); current-agent fields via auth.uid().
-- * TEAM campaigns require the caller to be in assigned_agent_ids (mirrors the
--   claim RPC gate); otherwise counts that depend on the agent return 0.
-- * Manager queue_filters ARE applied so "Available To You Now" reflects what the
--   agent can actually be served (Build 3 decision D4 reversed). The function
--   reads campaigns.queue_filters itself and applies the SAME supported keys as
--   get_next_queue_lead: status, state (campaign_leads.state then leads.state),
--   lead_source, max_attempts. UNSUPPORTED (intentionally, matching the claim
--   RPC which has NO score filter per product spec): min_score / max_score —
--   these are ignored by BOTH functions, so metrics do not mislead vs. claims.
--   Filters apply to eligible_leads / available_leads / retry_blocked_leads /
--   callback_waiting_leads / next_eligible_at. total_leads (raw campaign total)
--   and locked_leads / active_agents (physical lock state) are NOT filtered.
-- * Terminal statuses excluded: DNC, Completed, Removed, Failed.

CREATE OR REPLACE FUNCTION public.get_queue_metrics(p_campaign_id uuid)
RETURNS TABLE (
  total_leads                  integer,
  eligible_leads               integer,
  locked_leads                 integer,
  active_agents                integer,
  available_leads              integer,
  suppressed_for_current_agent integer,
  retry_blocked_leads          integer,
  callback_waiting_leads       integer,
  next_eligible_at             timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org            uuid := public.get_org_id();
  v_uid            uuid := auth.uid();
  v_campaign       RECORD;
  v_ctype          text;
  -- Manager queue_filters (same supported keys as get_next_queue_lead).
  v_filter_state   text;
  v_filter_source  text;
  v_filter_status  text;
  v_filter_max_att integer;
BEGIN
  -- Load campaign, org-scoped (incl. queue_filters so metrics match the claim path).
  SELECT c.id,
         upper(trim(c.type))    AS ctype,
         c.assigned_agent_ids,
         c.organization_id,
         c.max_attempts,
         c.queue_filters
  INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id
    AND c.organization_id = v_org;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0, 0, 0, 0, NULL::timestamptz;
    RETURN;
  END IF;
  v_ctype := v_campaign.ctype;

  -- Parse the stored manager filters (tolerant; absent/empty key = no filter).
  -- Mirrors get_next_queue_lead exactly. min_score/max_score are intentionally
  -- NOT applied here because the canonical claim RPC does not apply them either.
  v_filter_state   := NULLIF(v_campaign.queue_filters->>'state', '');
  v_filter_source  := NULLIF(v_campaign.queue_filters->>'lead_source', '');
  v_filter_status  := NULLIF(v_campaign.queue_filters->>'status', '');
  v_filter_max_att := NULLIF(v_campaign.queue_filters->>'max_attempts', '')::integer;

  -- TEAM eligibility gate: caller must be assigned. Return only the non-
  -- agent-specific total so the panel can still say "N total / 0 available".
  IF v_ctype = 'TEAM'
     AND NOT (
       v_uid::text = ANY (
         ARRAY(SELECT jsonb_array_elements_text(v_campaign.assigned_agent_ids))
       )
     ) THEN
    RETURN QUERY
      SELECT (SELECT count(*)::int
                FROM public.campaign_leads cl
               WHERE cl.campaign_id = p_campaign_id
                 AND cl.organization_id = v_org),
             0, 0, 0, 0, 0, 0, 0, NULL::timestamptz;
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT cl.id,
           cl.status,
           cl.call_attempts,
           cl.retry_eligible_at,
           cl.callback_agent_id,
           cl.callback_due_at,
           cl.scheduled_callback_at,
           cl.state           AS cl_state,
           l.state            AS lead_state,
           l.lead_source      AS lead_source,
           l.assigned_agent_id AS lead_assigned_agent_id
    FROM public.campaign_leads cl
    JOIN public.leads l ON l.id = cl.lead_id
    WHERE cl.campaign_id = p_campaign_id
      AND cl.organization_id = v_org
  ),
  locks AS (
    SELECT dll.campaign_lead_id, dll.locked_by, dll.expires_at
    FROM public.dialer_lead_locks dll
    WHERE dll.campaign_id = p_campaign_id
      AND dll.expires_at > now()
  ),
  supp AS (
    SELECT s.campaign_lead_id, s.suppressed_until
    FROM public.campaign_lead_agent_suppressions s
    WHERE s.campaign_id = p_campaign_id
      AND s.agent_id = v_uid
      AND s.suppressed_until > now()
  ),
  enriched AS (
    SELECT b.*,
      (b.status NOT IN ('DNC','Completed','Removed','Failed')
        AND (v_campaign.max_attempts IS NULL
             OR COALESCE(b.call_attempts, 0) < v_campaign.max_attempts)
        -- manager queue_filters — same supported keys as get_next_queue_lead
        AND (v_filter_status IS NULL OR b.status = v_filter_status)
        AND (v_filter_state  IS NULL
             OR b.cl_state = v_filter_state
             OR (b.cl_state IS NULL AND b.lead_state = v_filter_state))
        AND (v_filter_source IS NULL OR b.lead_source = v_filter_source)
        AND (v_filter_max_att IS NULL
             OR COALESCE(b.call_attempts, 0) <= v_filter_max_att)
      )                                                            AS is_eligible_universe,
      (b.callback_agent_id IS NULL OR b.callback_agent_id = v_uid) AS callback_ok,
      (b.lead_assigned_agent_id IS NULL
        OR b.lead_assigned_agent_id = v_uid)                       AS lead_ok,
      EXISTS (SELECT 1 FROM locks lk
               WHERE lk.campaign_lead_id = b.id
                 AND lk.locked_by <> v_uid)                        AS locked_by_other,
      EXISTS (SELECT 1 FROM supp sp
               WHERE sp.campaign_lead_id = b.id)                   AS suppressed_me
    FROM base b
  )
  SELECT
    (SELECT count(*)::int FROM base)                                AS total_leads,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe)                                  AS eligible_leads,
    (SELECT count(*)::int FROM locks)                               AS locked_leads,
    (SELECT count(DISTINCT locked_by)::int FROM locks)             AS active_agents,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe
         AND callback_ok AND lead_ok
         AND NOT locked_by_other AND NOT suppressed_me
         AND (retry_eligible_at IS NULL OR retry_eligible_at <= now())
    )                                                              AS available_leads,
    (SELECT count(*)::int FROM supp)                               AS suppressed_for_current_agent,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe
         AND callback_ok AND lead_ok
         AND NOT locked_by_other AND NOT suppressed_me
         AND retry_eligible_at IS NOT NULL AND retry_eligible_at > now()
    )                                                              AS retry_blocked_leads,
    (SELECT count(*)::int FROM enriched
       WHERE is_eligible_universe
         AND callback_agent_id = v_uid
         AND COALESCE(callback_due_at, scheduled_callback_at) IS NOT NULL
         AND COALESCE(callback_due_at, scheduled_callback_at) > now()
    )                                                              AS callback_waiting_leads,
    (SELECT min(t) FROM (
        -- retry windows for leads otherwise available to me
        SELECT retry_eligible_at AS t FROM enriched
          WHERE is_eligible_universe AND callback_ok AND lead_ok
            AND NOT locked_by_other AND NOT suppressed_me
            AND retry_eligible_at IS NOT NULL AND retry_eligible_at > now()
        UNION ALL
        -- my upcoming owned callbacks
        SELECT COALESCE(callback_due_at, scheduled_callback_at) FROM enriched
          WHERE is_eligible_universe AND callback_agent_id = v_uid
            AND COALESCE(callback_due_at, scheduled_callback_at) > now()
        UNION ALL
        -- my suppressions clearing
        SELECT suppressed_until FROM supp
        UNION ALL
        -- other-agent locks expiring on leads otherwise eligible for me
        SELECT lk.expires_at FROM locks lk
          JOIN enriched e ON e.id = lk.campaign_lead_id
          WHERE lk.locked_by <> v_uid
            AND e.is_eligible_universe AND e.callback_ok AND e.lead_ok
            AND NOT e.suppressed_me
            AND (e.retry_eligible_at IS NULL OR e.retry_eligible_at <= now())
    ) future_times WHERE t > now())                                AS next_eligible_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_queue_metrics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_queue_metrics(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
