-- =============================================================================
-- Organization leaderboard aggregate RPC — leaderboard accuracy bugfix
-- =============================================================================
-- Root cause: the org Leaderboard reconstructed per-agent metrics in the
-- browser from raw calls/appointments/clients queries. Agent RLS (correctly)
-- hides other agents' rows, so every peer rendered fabricated zero/partial
-- standings. This RPC aggregates server-side and returns standings only —
-- counts, sums, names, avatars. No raw rows, no phone numbers, no notes, no
-- contact identities, no PII.
--
-- Security model:
--   * SECURITY DEFINER is required: an Agent cannot SELECT peers' raw
--     calls/appointments/clients rows and that stays true — no RLS policy is
--     touched by this migration.
--   * The caller's organization comes from the DATABASE-AUTHORITATIVE
--     public.profiles row for auth.uid() — never from a parameter and never
--     from the JWT claim. There is no caller-controlled org or agent input.
--   * Date bounds are validated: NULLs, reversed bounds, and windows longer
--     than 35 days (Today / This Week / This Month never exceed ~31) raise.
--   * search_path pinned; every referenced object schema-qualified.
--   * EXECUTE revoked from PUBLIC and anon; granted to authenticated (and
--     service_role for ops parity with the other aggregate RPCs).
--
-- Metric canon (matches AGENT_RULES invariants #8/#12/#14/#17):
--   * calls_made / talk_time_seconds: outbound-only
--     (lower(direction) IN ('outbound','outgoing')), calls.created_at window,
--     talk time = SUM(calls.duration) — never browser timers, never
--     dialer_daily_stats.
--   * appointments_set: booking credit by created_at; attributed to
--     COALESCE(created_by, user_id) — created_by is primary, user_id rescues
--     the verified legacy/writer-gap rows where created_by IS NULL; exactly
--     one attribution per row. No status filter: credit survives
--     cancellation/reschedule.
--   * policies_sold: COUNT(wins) — never clients (multiple policies per
--     client = multiple wins). wins has no fallout/status machinery; all rows
--     count, matching every other wins reader.
--   * annualized_premium: 12 × (wins.premium_amount, falling back to the
--     canonical clients.premium ONLY when the win lacks a premium). The
--     deferred-debt clients.premium_amount column is never read or written.
--     The client-side fallback join is org-guarded because DEFINER bypasses
--     clients RLS.
--   * recent_wins_7d: rolling now()-7d org wins per agent (replaces the
--     hook's extra browser query).
--   * Roster: active profiles in the caller's org (status = 'Active', no
--     role filter — parity with the org view roster), stable
--     last_name/first_name/id order.
-- =============================================================================

-- The leaderboard polls org-window call aggregates every few seconds; calls is
-- the only high-write source table without an (organization_id, created_at)
-- btree path.
CREATE INDEX IF NOT EXISTS idx_calls_org_created_at
  ON public.calls (organization_id, created_at);

CREATE OR REPLACE FUNCTION public.get_org_leaderboard_stats(
  p_start timestamptz,
  p_end   timestamptz
)
RETURNS TABLE (
  agent_id           uuid,
  first_name         text,
  last_name          text,
  avatar_url         text,
  calls_made         bigint,
  appointments_set   bigint,
  policies_sold      bigint,
  annualized_premium numeric,
  talk_time_seconds  bigint,
  recent_wins_7d     bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_org uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'get_org_leaderboard_stats: not authenticated';
  END IF;

  SELECT pr.organization_id INTO v_org
  FROM public.profiles pr
  WHERE pr.id = v_uid;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'get_org_leaderboard_stats: no organization for caller';
  END IF;

  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'get_org_leaderboard_stats: invalid date bounds';
  END IF;

  IF (p_end - p_start) > interval '35 days' THEN
    RAISE EXCEPTION 'get_org_leaderboard_stats: unreasonable date window';
  END IF;

  -- Each source table is scanned ONCE for the whole organization/window and
  -- grouped by agent — never rescanned per profile (the LATERAL formulation
  -- this replaced re-ran every subquery once per roster row).
  RETURN QUERY
  WITH call_stats AS (
    SELECT
      cc.agent_id AS stats_agent_id,
      COUNT(*)::bigint AS calls_made,
      COALESCE(SUM(GREATEST(COALESCE(cc.duration, 0), 0)), 0)::bigint AS talk_time_seconds
    FROM public.calls cc
    WHERE cc.organization_id = v_org
      AND cc.created_at >= p_start
      AND cc.created_at <  p_end
      AND lower(COALESCE(cc.direction, '')) = ANY (ARRAY['outbound', 'outgoing'])
    GROUP BY cc.agent_id
  ),
  appt_stats AS (
    SELECT
      COALESCE(ap.created_by, ap.user_id) AS stats_agent_id,
      COUNT(*)::bigint AS appointments_set
    FROM public.appointments ap
    WHERE ap.organization_id = v_org
      AND ap.created_at >= p_start
      AND ap.created_at <  p_end
      AND COALESCE(ap.created_by, ap.user_id) IS NOT NULL
    GROUP BY COALESCE(ap.created_by, ap.user_id)
  ),
  win_stats AS (
    SELECT
      ww.agent_id AS stats_agent_id,
      COUNT(*)::bigint AS policies_sold,
      COALESCE(SUM(
        12 * CASE
          WHEN COALESCE(ww.premium_amount, 0) <> 0 THEN ww.premium_amount
          ELSE COALESCE(cl.premium, 0)
        END
      ), 0)::numeric AS annualized_premium
    FROM public.wins ww
    LEFT JOIN public.clients cl
      ON cl.id = ww.contact_id
     AND cl.organization_id = ww.organization_id
    WHERE ww.organization_id = v_org
      AND ww.created_at >= p_start
      AND ww.created_at <  p_end
    GROUP BY ww.agent_id
  ),
  recent_win_stats AS (
    SELECT
      wr.agent_id AS stats_agent_id,
      COUNT(*)::bigint AS recent_wins_7d
    FROM public.wins wr
    WHERE wr.organization_id = v_org
      AND wr.created_at >= now() - interval '7 days'
    GROUP BY wr.agent_id
  )
  SELECT
    p.id,
    p.first_name,
    p.last_name,
    p.avatar_url,
    COALESCE(c.calls_made, 0)::bigint,
    COALESCE(a.appointments_set, 0)::bigint,
    COALESCE(w.policies_sold, 0)::bigint,
    COALESCE(w.annualized_premium, 0)::numeric,
    COALESCE(c.talk_time_seconds, 0)::bigint,
    COALESCE(r.recent_wins_7d, 0)::bigint
  FROM public.profiles p
  LEFT JOIN call_stats c ON c.stats_agent_id = p.id
  LEFT JOIN appt_stats a ON a.stats_agent_id = p.id
  LEFT JOIN win_stats w ON w.stats_agent_id = p.id
  LEFT JOIN recent_win_stats r ON r.stats_agent_id = p.id
  WHERE p.organization_id = v_org
    AND p.status = 'Active'
  ORDER BY p.last_name ASC, p.first_name ASC, p.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_leaderboard_stats(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_org_leaderboard_stats(timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_org_leaderboard_stats(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_leaderboard_stats(timestamptz, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
