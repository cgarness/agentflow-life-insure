-- ============================================================================
-- Build 1 — Queue Lock / RPC Foundation (Team/Open pool claiming)
-- Migration: 20260529170000_queue_lock_rpc_foundation.sql
-- Author: Chris Garness (via repo agent)  Date: 2026-05-29
--
-- Goal: stabilize the backend so Team/Open queue locking is correct and safe
-- to build a frontend on (Build 2+). Today prod has 4 Personal campaigns,
-- 0 Team/Open, 0 active locks, 15 campaign_leads — the broken Team/Open claim
-- path is unexercised, so repairing it is safe.
--
-- Canonical lock schema (production, unchanged here):
--   dialer_lead_locks(campaign_lead_id, locked_by, campaign_id,
--                     organization_id, expires_at)  UNIQUE(campaign_lead_id)
--
-- Canonical claim function: public.get_next_queue_lead  (the function the live
--   frontend actually calls via useLeadLock.getNextLead). fetch_and_lock_next_lead
--   becomes a deprecated wrapper around it.
--
-- DEFERRED to Build 3 (no clean data source in prod yet):
--   * Appointment queue priority — appointments has no campaign_id/lead_id link
--     (only polymorphic contact_id).
--   * Lead-local calling-window enforcement — leads has no timezone column
--     (campaigns.calling_hours_* exist but are NOT enforced in this RPC yet).
--
-- DEFERRED to Build 2 (frontend lifecycle — out of scope here):
--   * Frontend arg renames: useLeadLock still passes p_lead_id to
--     release_lead_lock / renew_lead_lock (correct VALUE, wrong arg NAME), so
--     per-lead release + heartbeat stay no-ops until Build 2. Safe: 0 Team/Open
--     campaigns in prod.
--   * Skip -> suppression write path (this migration only READS suppressions).
--
-- Scope guard: no Twilio / calls.duration / P0 / P1 stats / disposition /
--   Sold-Convert / Reports objects touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Campaign columns
-- ----------------------------------------------------------------------------

-- 1a. queue_filters — manager-set queue filters (frontend already SELECTs this;
--     currently a silently-swallowed error that falls back to {}).
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS queue_filters jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 1b. retry_interval_minutes — canonical retry interval (Decision 1).
--     retry_interval_hours kept as deprecated compatibility (frontend still
--     reads it; cut over in Build 2). Backfill: translate a POSITIVE hours
--     value (hours*60); otherwise (NULL or <= 0) fall to the product default
--     1440 — we do NOT preserve 0/immediate-retry from old test data.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS retry_interval_minutes integer NOT NULL DEFAULT 1440;

UPDATE public.campaigns
SET retry_interval_minutes =
  CASE
    WHEN retry_interval_hours IS NULL OR retry_interval_hours <= 0 THEN 1440
    ELSE retry_interval_hours * 60
  END;

-- 1c. Calling hours — product default window = 8a-9p (Decision 3).
--     Set defaults for new campaigns AND normalize all existing campaigns
--     (current data is all test data). Lead-local enforcement remains
--     deferred to Build 3 (no lead timezone column).
ALTER TABLE public.campaigns
  ALTER COLUMN calling_hours_start SET DEFAULT '08:00:00';
ALTER TABLE public.campaigns
  ALTER COLUMN calling_hours_end SET DEFAULT '21:00:00';

UPDATE public.campaigns
SET calling_hours_start = '08:00:00',
    calling_hours_end   = '21:00:00';

-- ----------------------------------------------------------------------------
-- 2. campaign_leads callback ownership columns (Decision 2)
--    No new due-date column: canonical claim RPC reasons about due callbacks
--    via COALESCE(callback_due_at, scheduled_callback_at). Full callback
--    standardization belongs to Build 3.
-- ----------------------------------------------------------------------------
ALTER TABLE public.campaign_leads
  ADD COLUMN IF NOT EXISTS callback_agent_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS callback_note text;

-- ----------------------------------------------------------------------------
-- 3. Per-agent skip suppression table (Build 1 = read-only by the claim RPC;
--    frontend write path is Build 2).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_lead_agent_suppressions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id      uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  campaign_lead_id uuid NOT NULL REFERENCES public.campaign_leads(id) ON DELETE CASCADE,
  agent_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  suppressed_until timestamptz NOT NULL,
  reason           text NOT NULL DEFAULT 'skip',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_lead_agent_suppressions_uniq
    UNIQUE (organization_id, campaign_lead_id, agent_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_cl_agent_suppr_org
  ON public.campaign_lead_agent_suppressions (organization_id);
CREATE INDEX IF NOT EXISTS idx_cl_agent_suppr_campaign
  ON public.campaign_lead_agent_suppressions (campaign_id);
CREATE INDEX IF NOT EXISTS idx_cl_agent_suppr_campaign_lead
  ON public.campaign_lead_agent_suppressions (campaign_lead_id);
CREATE INDEX IF NOT EXISTS idx_cl_agent_suppr_agent
  ON public.campaign_lead_agent_suppressions (agent_id);
CREATE INDEX IF NOT EXISTS idx_cl_agent_suppr_until
  ON public.campaign_lead_agent_suppressions (suppressed_until);

ALTER TABLE public.campaign_lead_agent_suppressions ENABLE ROW LEVEL SECURITY;

-- Agent sees own rows; managers in the same org may view.
CREATE POLICY campaign_lead_agent_suppressions_select
  ON public.campaign_lead_agent_suppressions
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_org_id()
    AND (
      agent_id = auth.uid()
      OR public.get_user_role() = ANY (ARRAY['Admin'::text, 'Team Leader'::text, 'Team Lead'::text])
    )
  );

-- Own rows only for writes.
CREATE POLICY campaign_lead_agent_suppressions_insert
  ON public.campaign_lead_agent_suppressions
  FOR INSERT TO authenticated
  WITH CHECK (agent_id = auth.uid() AND organization_id = public.get_org_id());

CREATE POLICY campaign_lead_agent_suppressions_update
  ON public.campaign_lead_agent_suppressions
  FOR UPDATE TO authenticated
  USING (agent_id = auth.uid() AND organization_id = public.get_org_id())
  WITH CHECK (agent_id = auth.uid() AND organization_id = public.get_org_id());

CREATE POLICY campaign_lead_agent_suppressions_delete
  ON public.campaign_lead_agent_suppressions
  FOR DELETE TO authenticated
  USING (agent_id = auth.uid() AND organization_id = public.get_org_id());

-- ----------------------------------------------------------------------------
-- 4. Canonical claim RPC — rebuild public.get_next_queue_lead
--    Signature unchanged: (uuid, jsonb) RETURNS SETOF campaign_leads
--    (no types.ts regen needed). 5-minute lock TTL.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_next_queue_lead(
  p_campaign_id uuid,
  p_filters     jsonb DEFAULT '{}'::jsonb
)
RETURNS SETOF public.campaign_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
         c.max_attempts
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

REVOKE ALL ON FUNCTION public.get_next_queue_lead(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_next_queue_lead(uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. renew_lead_lock — heartbeat lock extension (NEW). Canonical arg
--    p_campaign_lead_id. Returns boolean: false = lock lost / not owned.
--    (Frontend wiring to this arg name is Build 2.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.renew_lead_lock(p_campaign_lead_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.dialer_lead_locks
  SET expires_at = now() + interval '5 minutes'
  WHERE campaign_lead_id = p_campaign_lead_id
    AND locked_by = auth.uid()
    AND organization_id = public.get_org_id();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.renew_lead_lock(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renew_lead_lock(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. fetch_and_lock_next_lead — DEPRECATED wrapper around the canonical RPC.
--    Eliminates the divergent 90s-TTL / created_at-only implementation.
--    Only caller was dead code (dialer-queue.ts:fetchNextQueuedLead).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_and_lock_next_lead(
  p_campaign_id uuid,
  p_filters     jsonb DEFAULT '{}'::jsonb
)
RETURNS SETOF public.campaign_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- DEPRECATED (Build 1): legacy alias retained for compatibility.
  -- All claim/lock logic now lives in public.get_next_queue_lead.
  RETURN QUERY SELECT * FROM public.get_next_queue_lead(p_campaign_id, p_filters);
END;
$function$;

REVOKE ALL ON FUNCTION public.fetch_and_lock_next_lead(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_and_lock_next_lead(uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Reload PostgREST schema cache.
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
