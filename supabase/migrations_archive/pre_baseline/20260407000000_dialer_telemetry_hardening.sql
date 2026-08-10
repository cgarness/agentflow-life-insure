-- =============================================================
-- Migration: Dialer Telemetry Hardening
-- Date: 2026-04-07
-- Purpose: Two targeted fixes:
--   1. get_org_id() — graceful fallback to profiles table
--      when JWT claim is missing (e.g. stale session).
--   2. get_enterprise_queue_leads — re-apply with explicit
--      SET search_path = public to resolve PostgREST return
--      type issues in freshly deployed environments.
-- =============================================================

-- ──────────────────────────────────────────────────────
-- FIX 1: get_org_id() — JWT claim + profile fallback
-- ──────────────────────────────────────────────────────
-- Previous version was LANGUAGE sql STABLE and only read
-- the JWT claim. If the claim was missing (stale token,
-- first login before trigger fires), all RLS policies
-- using get_org_id() would silently return NULL and
-- block all data access.
--
-- New version: tries the JWT claim first (fast path),
-- then falls back to a profile table lookup.
-- ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_org_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  -- Primary: JWT claim (fast path — no table access)
  v_org := NULLIF(
    current_setting('request.jwt.claims', true)::json
      ->'app_metadata'->>'organization_id',
    ''
  )::uuid;

  IF v_org IS NOT NULL THEN
    RETURN v_org;
  END IF;

  -- Fallback: profile table lookup (handles stale/missing JWT claims)
  SELECT organization_id INTO v_org
  FROM public.profiles
  WHERE id = auth.uid();

  RETURN v_org;
END;
$$;


-- ──────────────────────────────────────────────────────
-- FIX 2: Re-apply get_enterprise_queue_leads with
--        explicit SET search_path = public
-- ──────────────────────────────────────────────────────
-- The previous migration (20260406950000) already has
-- SET search_path = public, but this re-apply ensures
-- it is active in environments where migrations were
-- applied in a different order or schema cache was stale.
-- ──────────────────────────────────────────────────────

-- Drop any stale overloads first
DROP FUNCTION IF EXISTS public.get_enterprise_queue_leads(UUID, UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.get_enterprise_queue_leads(UUID, INTEGER, INTEGER, UUID);

CREATE OR REPLACE FUNCTION public.get_enterprise_queue_leads(
  p_campaign_id UUID,
  p_limit       INTEGER,
  p_offset      INTEGER,
  p_org_id      UUID
)
RETURNS SETOF public.campaign_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_att       INTEGER;
  v_retry_hrs     INTEGER;
  v_hours_start   TIME;
  v_hours_end     TIME;
BEGIN
  -- 1. Fetch Campaign Settings
  SELECT 
    max_attempts, 
    COALESCE(retry_interval_hours, 0),
    COALESCE(calling_hours_start, '00:00:00')::TIME,
    COALESCE(calling_hours_end, '23:59:59')::TIME
  INTO v_max_att, v_retry_hrs, v_hours_start, v_hours_end
  FROM public.campaigns
  WHERE id = p_campaign_id;

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
    -- ── COMPLIANCE: Max Attempts ──
    COALESCE(cl.call_attempts, 0) < COALESCE(v_max_att, 9999)
    
    AND (
      -- ── BUCKET A: Due Callbacks ──
      (cl.scheduled_callback_at IS NOT NULL AND cl.scheduled_callback_at <= now())
      
      -- ── BUCKET B: Fresh Queued Leads ──
      OR COALESCE(cl.status, 'Queued') = 'Queued'
      
      -- ── BUCKET C: Retry Eligible leads ──
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
      -- ── COMPLIANCE: Calling Hours (Timezone Aware) ──
      (now() AT TIME ZONE 'UTC' AT TIME ZONE l.lead_tz)::TIME >= v_hours_start
      AND (now() AT TIME ZONE 'UTC' AT TIME ZONE l.lead_tz)::TIME < v_hours_end
    )
  ORDER BY 
    -- Priority 1: Due Callbacks first
    (CASE WHEN cl.scheduled_callback_at IS NOT NULL AND cl.scheduled_callback_at <= now() THEN 0 ELSE 1 END) ASC,
    -- Priority 2: Callbacks sorted by due date
    cl.scheduled_callback_at ASC NULLS LAST,
    -- Priority 3: Oldest leads first
    cl.created_at ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_enterprise_queue_leads(UUID, INTEGER, INTEGER, UUID) TO authenticated;

-- 3. Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
