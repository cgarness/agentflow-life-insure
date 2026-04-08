-- =============================================================
-- Migration: Enterprise Waterfall Queue RPC
-- Date: 2026-04-06
-- Purpose: Implement database-level filtering for the dialer queue.
--          Enforces max_attempts, retry_intervals (with 0 overlap),
--          and timezone-aware calling hours.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_enterprise_queue_leads(
  p_campaign_id UUID,
  p_org_id      UUID DEFAULT NULL,
  p_limit       INTEGER DEFAULT 100,
  p_offset      INTEGER DEFAULT 0
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
  leads_with_tz AS (
    SELECT 
      cl.*,
      COALESCE(tm.tz_name, 'America/New_York') as lead_tz
    FROM public.campaign_leads cl
    LEFT JOIN timezone_mapping tm ON UPPER(cl.state) = tm.state_code
    WHERE cl.campaign_id = p_campaign_id
      AND (p_org_id IS NULL OR cl.organization_id = p_org_id)
      AND cl.status NOT IN ('DNC', 'Completed', 'Removed', 'removed')
  )
  SELECT 
    id, age, call_attempts, campaign_id, claimed_at, claimed_by, created_at, 
    disposition, email, first_name, last_called_at, last_name, lead_id, 
    locked_at, locked_by, organization_id, phone, sort_order, source, 
    state, status, updated_at, scheduled_callback_at
  FROM leads_with_tz l
  WHERE 
    -- ── COMPLIANCE: Max Attempts ──
    (v_max_att IS NULL OR l.call_attempts < v_max_att)
    
    AND (
      -- ── BUCKET A: Due Callbacks ──
      (l.scheduled_callback_at IS NOT NULL AND l.scheduled_callback_at <= now())
      
      -- ── BUCKET B: Fresh Queued Leads ──
      OR l.status = 'Queued'
      
      -- ── BUCKET C: Retry Eligible leads ──
      OR (
        l.status = 'Called' 
        AND (
          v_retry_hrs = 0 
          OR l.last_called_at IS NULL 
          OR (l.last_called_at + (v_retry_hrs * interval '1 hour')) <= now()
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
    (CASE WHEN l.scheduled_callback_at IS NOT NULL AND l.scheduled_callback_at <= now() THEN 0 ELSE 1 END) ASC,
    -- Priority 2: Callbacks sorted by due date
    l.scheduled_callback_at ASC NULLS LAST,
    -- Priority 3: Oldest leads first
    l.created_at ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_enterprise_queue_leads(UUID, UUID, INTEGER, INTEGER) TO authenticated;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
