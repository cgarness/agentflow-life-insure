-- ============================================================================
-- Build 2b · Phase 3 — Licensed-state queue access (extends Build 2a)
-- ============================================================================
-- Adds an opt-in, per-campaign restriction: when require_licensed_state_access
-- is ON, the dialer only serves a contact to an agent if the contact's state is
-- blank/unknown OR the agent holds an active license in that state.
--
-- Extends Build 2a's settings model (the BEFORE UPDATE trigger + the save RPC)
-- and the canonical lead-serving RPCs. The filter runs INSIDE the SKIP LOCKED
-- candidate selection — never after claiming — and does NOT change lock ownership
-- or claim semantics.
--
-- Depends on Phase 2's public.normalize_us_state(text) (migration
-- 20260608170000). *** APPLY 20260608170000 BEFORE this file *** so lead state
-- and license state compare as clean 2-letter codes.
--
-- agent_state_licenses already has idx_agent_state_licenses_agent_id (btree on
-- agent_id) + a UNIQUE (agent_id, state) index — the per-call licensed-states
-- lookup is index-supported, so no new index is added here.
--
-- *** FILE ONLY — PENDING APPLY. Do NOT apply standalone. ***
-- ============================================================================

-- 1. Per-campaign flag (existing rows inherit false → no behavior change) ------
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS require_licensed_state_access boolean NOT NULL DEFAULT false;

-- 2. Extend the settings-edit guard so toggling the flag needs edit permission --
--    (CREATE OR REPLACE the function the existing trg_enforce_campaign_settings_edit
--    trigger already points to; only the new column is added to v_changed.)
CREATE OR REPLACE FUNCTION public.enforce_campaign_settings_edit_permission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_changed boolean;
BEGIN
  v_changed :=
       NEW.max_attempts            IS DISTINCT FROM OLD.max_attempts
    OR NEW.calling_hours_start     IS DISTINCT FROM OLD.calling_hours_start
    OR NEW.calling_hours_end       IS DISTINCT FROM OLD.calling_hours_end
    OR NEW.retry_interval_hours    IS DISTINCT FROM OLD.retry_interval_hours
    OR NEW.retry_interval_minutes  IS DISTINCT FROM OLD.retry_interval_minutes
    OR NEW.ring_timeout_seconds    IS DISTINCT FROM OLD.ring_timeout_seconds
    OR NEW.auto_dial_enabled       IS DISTINCT FROM OLD.auto_dial_enabled
    OR NEW.local_presence_enabled  IS DISTINCT FROM OLD.local_presence_enabled
    OR NEW.number_group_id         IS DISTINCT FROM OLD.number_group_id
    OR NEW.settings_edit_policy    IS DISTINCT FROM OLD.settings_edit_policy
    OR NEW.require_licensed_state_access IS DISTINCT FROM OLD.require_licensed_state_access;

  -- Constrain authenticated END USERS only. System/service-role/migration
  -- contexts (auth.uid() IS NULL) bypass — so backfills won't be blocked.
  IF v_changed
     AND auth.uid() IS NOT NULL
     AND NOT public.can_edit_campaign_settings(NEW.id) THEN
    RAISE EXCEPTION 'You don''t have permission to edit this campaign''s settings.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Save RPC: append p_require_licensed_state_access -> 11-arg identity --------
--    Adding a parameter changes function identity, so DROP the 10-arg version
--    first, then CREATE the 11-arg version (all existing logic preserved) and
--    re-REVOKE/GRANT.
DROP FUNCTION IF EXISTS public.update_campaign_settings(
  uuid, integer, time, time, integer, integer, integer, boolean, boolean, text
);

CREATE OR REPLACE FUNCTION public.update_campaign_settings(
  p_campaign_id uuid,
  p_max_attempts integer,
  p_calling_hours_start time without time zone,
  p_calling_hours_end time without time zone,
  p_retry_interval_hours integer,
  p_retry_interval_minutes integer,
  p_ring_timeout_seconds integer,
  p_auto_dial_enabled boolean,
  p_local_presence_enabled boolean,
  p_settings_edit_policy text,
  p_require_licensed_state_access boolean
)
RETURNS campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.campaigns;
BEGIN
  IF NOT public.can_edit_campaign_settings(p_campaign_id) THEN
    RAISE EXCEPTION 'You don''t have permission to edit this campaign''s settings.'
      USING ERRCODE = '42501';
  END IF;

  IF p_settings_edit_policy IS NOT NULL
     AND p_settings_edit_policy NOT IN ('creator_and_admins', 'admins_only', 'team_leaders', 'specific_users') THEN
    RAISE EXCEPTION 'Invalid settings_edit_policy: %', p_settings_edit_policy
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.campaigns
  SET max_attempts                 = p_max_attempts,
      calling_hours_start          = p_calling_hours_start,
      calling_hours_end            = p_calling_hours_end,
      retry_interval_hours         = p_retry_interval_hours,
      retry_interval_minutes       = COALESCE(p_retry_interval_minutes, retry_interval_minutes),  -- NOT NULL column
      ring_timeout_seconds         = p_ring_timeout_seconds,
      auto_dial_enabled            = p_auto_dial_enabled,
      local_presence_enabled       = p_local_presence_enabled,
      settings_edit_policy         = COALESCE(p_settings_edit_policy, settings_edit_policy),
      require_licensed_state_access = COALESCE(p_require_licensed_state_access, require_licensed_state_access)  -- NOT NULL column
  WHERE id = p_campaign_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_campaign_settings(
  uuid, integer, time, time, integer, integer, integer, boolean, boolean, text, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_campaign_settings(
  uuid, integer, time, time, integer, integer, integer, boolean, boolean, text, boolean
) TO authenticated;

-- 4. Canonical claim RPC: licensed-state filter INSIDE the SKIP LOCKED select --
--    Full live body (captured via pg_get_functiondef) with the licensed-state
--    additions marked "Build 2b". fetch_and_lock_next_lead inherits this via its
--    delegation (it just RETURN QUERY SELECT * FROM get_next_queue_lead) — no
--    separate copy is maintained (AGENT_RULES invariant #15).
CREATE OR REPLACE FUNCTION public.get_next_queue_lead(p_campaign_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS SETOF campaign_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org            uuid := public.get_org_id();
  v_uid            uuid := auth.uid();
  v_campaign       RECORD;
  v_ctype          text;
  v_locked_id      uuid;
  v_result         public.campaign_leads;
  v_filter_state   text;
  v_filter_source  text;
  v_filter_status  text;
  v_filter_max_att integer;
  v_require_licensed boolean := false;   -- Build 2b
  v_licensed_states  text[]  := '{}';    -- Build 2b (canonical UPPER 2-letter codes)
BEGIN
  -- (a) Clean expired locks for this campaign first.
  DELETE FROM public.dialer_lead_locks
  WHERE campaign_id = p_campaign_id
    AND expires_at <= now();

  -- (b) Load campaign, org-scoped.
  SELECT c.id,
         upper(trim(c.type)) AS ctype,
         c.assigned_agent_ids,
         c.organization_id,
         c.max_attempts,
         c.require_licensed_state_access            -- Build 2b
  INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id
    AND c.organization_id = v_org;

  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_ctype := v_campaign.ctype;

  -- (c) Eligibility gate. Team = shared pool but the agent must be assigned.
  --     Open / Open Pool = any agent in the org (org already enforced above).
  IF v_ctype = 'TEAM' THEN
    IF NOT (
      v_uid::text = ANY (
        ARRAY(SELECT jsonb_array_elements_text(v_campaign.assigned_agent_ids))
      )
    ) THEN
      RETURN;
    END IF;
  END IF;

  -- (c2) Licensed-state access (Build 2b). Resolve the agent's licensed states
  --      ONCE per call into an array (a single index-supported set lookup — NOT a
  --      per-candidate correlated subquery). Normalized to canonical UPPER
  --      2-letter codes so a not-yet-normalized agent_state_licenses row (the
  --      license-management UI is a separate write path) still matches.
  v_require_licensed := COALESCE(v_campaign.require_licensed_state_access, false);
  IF v_require_licensed THEN
    SELECT COALESCE(array_agg(DISTINCT x.s), '{}')
    INTO v_licensed_states
    FROM (
      SELECT upper(public.normalize_us_state(asl.state)) AS s
      FROM public.agent_state_licenses asl
      WHERE asl.agent_id = v_uid
        AND asl.organization_id = v_org
    ) x
    WHERE x.s ~ '^[A-Z]{2}$';
  END IF;

  -- (d) Optional manager filters (tolerant; NO score filter per product spec).
  v_filter_state   := NULLIF(p_filters->>'state', '');
  v_filter_source  := NULLIF(p_filters->>'lead_source', '');
  v_filter_status  := NULLIF(p_filters->>'status', '');
  v_filter_max_att := NULLIF(p_filters->>'max_attempts', '')::integer;

  -- (e) Pick the next eligible lead with waterfall priority:
  --       0 = owned callbacks due/within 5 min  (Build 1)
  --       1 = new leads (call_attempts = 0)
  --       2 = retries (call_attempts > 0, retry-eligible)
  --     Appointments (priority above callbacks) DEFERRED to Build 3.
  --     Calling-window gating DEFERRED to Build 3 (no lead timezone).
  SELECT cl.id
  INTO v_locked_id
  FROM public.campaign_leads cl
  JOIN public.leads l ON l.id = cl.lead_id
  WHERE cl.campaign_id = p_campaign_id
    AND cl.organization_id = v_org
    -- terminal statuses excluded (Sold/Converted land as Completed/Removed)
    AND cl.status NOT IN ('DNC', 'Completed', 'Removed', 'Failed')
    -- max attempts
    AND (v_campaign.max_attempts IS NULL
         OR COALESCE(cl.call_attempts, 0) < v_campaign.max_attempts)
    -- retry not yet eligible -> excluded
    AND (cl.retry_eligible_at IS NULL OR cl.retry_eligible_at <= now())
    -- callback ownership: another agent's callback must never surface here
    -- (incl. as a normal/new lead)
    AND (cl.callback_agent_id IS NULL OR cl.callback_agent_id = v_uid)
    -- hard-claim ownership: a lead claimed by another agent stays with them
    AND (l.assigned_agent_id IS NULL OR l.assigned_agent_id = v_uid)
    -- exclude active locks held by OTHER agents (own active lock is allowed)
    AND NOT EXISTS (
      SELECT 1 FROM public.dialer_lead_locks dll
      WHERE dll.campaign_lead_id = cl.id
        AND dll.expires_at > now()
        AND dll.locked_by <> v_uid
    )
    -- exclude this agent's active skip suppressions
    AND NOT EXISTS (
      SELECT 1 FROM public.campaign_lead_agent_suppressions s
      WHERE s.campaign_lead_id = cl.id
        AND s.agent_id = v_uid
        AND s.suppressed_until > now()
    )
    -- manager filters
    AND (v_filter_status IS NULL OR cl.status = v_filter_status)
    AND (v_filter_state  IS NULL
         OR cl.state = v_filter_state
         OR (cl.state IS NULL AND l.state = v_filter_state))
    AND (v_filter_source IS NULL OR l.lead_source = v_filter_source)
    AND (v_filter_max_att IS NULL OR COALESCE(cl.call_attempts, 0) <= v_filter_max_att)
    -- licensed-state access (Build 2b): when required, a candidate qualifies if
    -- its (normalized) queue state is blank/unknown OR within the agent's
    -- licensed states. Uses the denormalized campaign_leads.state (the queue
    -- copy). Zero licenses -> empty array -> only blank-state leads qualify.
    AND (
      NOT v_require_licensed
      OR NULLIF(btrim(public.normalize_us_state(cl.state)), '') IS NULL
      OR upper(public.normalize_us_state(cl.state)) = ANY (v_licensed_states)
    )
  ORDER BY
    CASE
      WHEN COALESCE(cl.callback_due_at, cl.scheduled_callback_at) IS NOT NULL
           AND cl.callback_agent_id = v_uid
           AND COALESCE(cl.callback_due_at, cl.scheduled_callback_at) <= now() + interval '5 minutes'
        THEN 0
      WHEN COALESCE(cl.call_attempts, 0) = 0 THEN 1
      ELSE 2
    END,
    COALESCE(cl.callback_due_at, cl.scheduled_callback_at) ASC NULLS LAST,
    cl.last_called_at ASC NULLS FIRST,
    cl.created_at ASC
  LIMIT 1
  FOR UPDATE OF cl SKIP LOCKED;

  IF v_locked_id IS NULL THEN
    RETURN;
  END IF;

  -- (f) Insert lock (canonical schema, 5-minute TTL).
  INSERT INTO public.dialer_lead_locks
    (campaign_lead_id, locked_by, campaign_id, organization_id, expires_at)
  VALUES
    (v_locked_id, v_uid, p_campaign_id, v_org, now() + interval '5 minutes')
  ON CONFLICT (campaign_lead_id) DO NOTHING;

  -- (g) Return the locked campaign_leads row.
  SELECT * INTO v_result FROM public.campaign_leads WHERE id = v_locked_id;
  RETURN NEXT v_result;
  RETURN;
END;
$function$;

-- 5. Enterprise waterfall RPC: same licensed-state predicate -------------------
--    Full live body (captured via pg_get_functiondef) with the licensed-state
--    additions marked "Build 2b". Uses the denormalized campaign_leads.state
--    (this RPC has no leads join). auth.uid() resolves to the real caller inside
--    this SECURITY DEFINER function; org scope = the campaign's own org.
CREATE OR REPLACE FUNCTION public.get_enterprise_queue_leads(p_campaign_id uuid, p_limit integer, p_offset integer, p_org_id uuid)
 RETURNS SETOF campaign_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_max_att       INTEGER;
  v_retry_hrs     INTEGER;
  v_hours_start   TIME;
  v_hours_end     TIME;
  v_uid           uuid := auth.uid();    -- Build 2b
  v_org           uuid;                  -- Build 2b (campaign org)
  v_require_licensed boolean := false;   -- Build 2b
  v_licensed_states  text[]  := '{}';    -- Build 2b
BEGIN
  -- 1. Fetch Campaign Settings
  SELECT
    max_attempts,
    COALESCE(retry_interval_hours, 0),
    COALESCE(calling_hours_start, '00:00:00')::TIME,
    COALESCE(calling_hours_end, '23:59:59')::TIME,
    organization_id,                          -- Build 2b
    COALESCE(require_licensed_state_access, false)  -- Build 2b
  INTO v_max_att, v_retry_hrs, v_hours_start, v_hours_end, v_org, v_require_licensed
  FROM public.campaigns
  WHERE id = p_campaign_id;

  -- 1b. Licensed-state access (Build 2b): resolve the agent's licensed states
  --     ONCE (index-supported set lookup), normalized to UPPER 2-letter codes.
  IF v_require_licensed THEN
    SELECT COALESCE(array_agg(DISTINCT x.s), '{}')
    INTO v_licensed_states
    FROM (
      SELECT upper(public.normalize_us_state(asl.state)) AS s
      FROM public.agent_state_licenses asl
      WHERE asl.agent_id = v_uid
        AND asl.organization_id = v_org
    ) x
    WHERE x.s ~ '^[A-Z]{2}$';
  END IF;

  -- 2. Return Query with Waterfall Logic
  RETURN QUERY
  WITH timezone_mapping AS (
    SELECT * FROM (VALUES
      ('AL', 'America/Chicago'), ('AK', 'America/Anchorage'), ('AZ', 'America/Phoenix'),
      ('AR', 'America/Chicago'), ('CA', 'America/Los_Angeles'), ('CO', 'America/Denver'),
      ('CT', 'America/New_York'), ('DE', 'America/New_York'), ('DC', 'America/New_York'),
      ('FL', 'America/New_York'), ('GA', 'America/New_York'), ('HI', 'Pacific/Honolulu'),
      ('ID', 'America/Denver'), ('IL', 'America/Chicago'), ('IN', 'America/New_York'),
      ('IA', 'America/Chicago'), ('KS', 'America/Chicago'), ('KY', 'America/Chicago'),
      ('LA', 'America/Chicago'), ('ME', 'America/New_York'), ('MD', 'America/New_York'),
      ('MA', 'America/New_York'), ('MI', 'America/New_York'), ('MN', 'America/Chicago'),
      ('MS', 'America/Chicago'), ('MO', 'America/Chicago'), ('MT', 'America/Denver'),
      ('NE', 'America/Chicago'), ('NV', 'America/Los_Angeles'), ('NH', 'America/New_York'),
      ('NJ', 'America/New_York'), ('NM', 'America/Denver'), ('NY', 'America/New_York'),
      ('NC', 'America/New_York'), ('ND', 'America/Chicago'), ('OH', 'America/New_York'),
      ('OK', 'America/Chicago'), ('OR', 'America/Los_Angeles'), ('PA', 'America/New_York'),
      ('RI', 'America/New_York'), ('SC', 'America/New_York'), ('SD', 'America/Chicago'),
      ('TN', 'America/Chicago'), ('TX', 'America/Chicago'), ('UT', 'America/Denver'),
      ('VT', 'America/New_York'), ('VA', 'America/New_York'), ('WA', 'America/Los_Angeles'),
      ('WV', 'America/New_York'), ('WI', 'America/Chicago'), ('WY', 'America/Denver')
    ) AS t(state_code, tz_name)
  ),
  eligible_leads AS (
    SELECT
      cl.id,
      COALESCE(tm.tz_name, 'America/New_York') as lead_tz
    FROM public.campaign_leads cl
    LEFT JOIN timezone_mapping tm ON UPPER(cl.state) = tm.state_code
    WHERE cl.campaign_id = p_campaign_id
      AND (p_org_id IS NULL OR cl.organization_id = p_org_id)
      AND COALESCE(cl.status, 'Queued') NOT IN ('DNC', 'Completed', 'Removed', 'removed')
  )
  SELECT cl.*
  FROM public.campaign_leads cl
  JOIN eligible_leads l ON cl.id = l.id
  WHERE
    COALESCE(cl.call_attempts, 0) < COALESCE(v_max_att, 9999)
    AND (
      (cl.scheduled_callback_at IS NOT NULL AND cl.scheduled_callback_at <= now())
      OR COALESCE(cl.status, 'Queued') = 'Queued'
      OR (
        cl.status = 'Called'
        AND (
          v_retry_hrs = 0
          OR cl.last_called_at IS NULL
          OR (cl.last_called_at + (v_retry_hrs * interval '1 hour')) <= now()
        )
      )
    )
    AND (
      (now() AT TIME ZONE 'UTC' AT TIME ZONE l.lead_tz)::TIME >= v_hours_start
      AND (now() AT TIME ZONE 'UTC' AT TIME ZONE l.lead_tz)::TIME < v_hours_end
    )
    -- licensed-state access (Build 2b): identical predicate to get_next_queue_lead.
    AND (
      NOT v_require_licensed
      OR NULLIF(btrim(public.normalize_us_state(cl.state)), '') IS NULL
      OR upper(public.normalize_us_state(cl.state)) = ANY (v_licensed_states)
    )
  ORDER BY
    (CASE WHEN cl.scheduled_callback_at IS NOT NULL AND cl.scheduled_callback_at <= now() THEN 0 ELSE 1 END) ASC,
    cl.scheduled_callback_at ASC NULLS LAST,
    cl.created_at ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- 6. Reload PostgREST schema cache (new column + changed RPC signature).
NOTIFY pgrst, 'reload schema';
