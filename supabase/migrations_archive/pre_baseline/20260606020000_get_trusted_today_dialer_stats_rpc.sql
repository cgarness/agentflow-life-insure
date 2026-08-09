-- Trusted Dialer header stats — server-side aggregate RPC
--
-- Replaces the client-side row-fetch + JS aggregation in
-- `src/lib/supabase-dialer-stats.ts::getTrustedTodayDialerStats`. That path
-- fetched EVERY of today's `calls` rows for the agent+campaign and computed
-- calls/contacted/talk-time in the browser — O(call volume) payload that grows
-- with the North Star of 300+ dials/day/agent. This RPC pushes the aggregation
-- into Postgres and returns a single fixed-size row (counts only, no PII), so
-- the header fetch is flat and fast regardless of call volume.
--
-- Scope: the CURRENT agent's own stats only (agent_id = auth.uid()), org-scoped
-- via public.get_org_id(), for one campaign and a caller-supplied UTC time
-- window [p_start, p_end). The window is the agent's LOCAL calendar day computed
-- client-side (browser IANA tz, P1 Build 3B `userLocalDayBounds`) and passed in,
-- so the daily reset matches the user's local midnight without the server
-- needing the browser timezone.
--
-- Definitions mirror the trusted Dialer model and `get_campaign_card_stats`,
-- but PER CALL (the header "Contacted" counts contacted calls, not distinct
-- leads):
--   calls_made        = COUNT(outbound calls) in window
--   total_talk_seconds= SUM(calls.duration) (Twilio-backed only)
--   contacted_calls   = COUNT(outbound calls) where duration > 45 OR the call's
--                       disposition has counts_as_contacted = true, EXCLUDING the
--                       system/locked "No Answer". Disposition match prefers
--                       calls.disposition_id (UUID FK) and falls back to
--                       lowercased disposition_name (org-scoped) for legacy rows.
--   policies_sold     = COUNT(wins) for the agent+campaign in window.
--   session_duration / closed_session_duration / active_session_* mirror the
--     prior JS math over `dialer_sessions`: per session span =
--       COALESCE(ended_at, [now() if active else COALESCE(last_heartbeat_at,
--       started_at)]) - started_at; "closed" excludes the active session's live
--       portion so the browser ticker can add live elapsed without double-count.
--
-- Outbound predicate mirrors `report-utils.isCallsRowOutboundDirection`
-- (direction IN ('outbound','outgoing')); a null/inbound row is excluded.
--
-- Security: SECURITY DEFINER so it can read the agent's rows under RLS, but
-- hard-scoped to auth.uid() + get_org_id() — an agent can only ever read their
-- OWN stats; no cross-agent or cross-org access, no p_agent_id parameter.

CREATE OR REPLACE FUNCTION public.get_trusted_today_dialer_stats(
  p_campaign_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE (
  calls_made                      integer,
  contacted_calls                 integer,
  total_talk_seconds              integer,
  policies_sold                   integer,
  session_duration_seconds        integer,
  closed_session_duration_seconds integer,
  active_session_id               uuid,
  active_session_started_at       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT public.get_org_id() AS org_id, auth.uid() AS uid
  ),
  -- One row per OUTBOUND call in window, with resolved contacted flag.
  call_facts AS (
    SELECT
      coalesce(ca.duration, 0) AS duration,
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
      END AS is_contacted
    FROM me
    JOIN public.calls ca
      ON ca.agent_id = me.uid
     AND ca.organization_id = me.org_id
     AND ca.campaign_id = p_campaign_id
     AND ca.created_at >= p_start
     AND ca.created_at <  p_end
     AND lower(coalesce(ca.direction, '')) = ANY (ARRAY['outbound', 'outgoing'])
    LEFT JOIN public.dispositions di ON di.id = ca.disposition_id
    LEFT JOIN public.dispositions dn
      ON ca.disposition_id IS NULL
     AND lower(dn.name) = lower(ca.disposition_name)
     AND dn.organization_id = me.org_id
    WHERE me.org_id IS NOT NULL AND me.uid IS NOT NULL
  ),
  -- One row per session started in window, with its span (seconds).
  sess AS (
    SELECT
      s.id,
      s.started_at,
      (s.status = 'active' AND s.ended_at IS NULL) AS is_active,
      GREATEST(0, floor(extract(epoch FROM (
        coalesce(
          s.ended_at,
          CASE
            WHEN s.status = 'active' AND s.ended_at IS NULL THEN now()
            ELSE coalesce(s.last_heartbeat_at, s.started_at)
          END
        ) - s.started_at
      )))::int) AS span
    FROM me
    JOIN public.dialer_sessions s
      ON s.agent_id = me.uid
     AND s.organization_id = me.org_id
     AND s.campaign_id = p_campaign_id
     AND s.started_at >= p_start
     AND s.started_at <  p_end
    WHERE me.org_id IS NOT NULL AND me.uid IS NOT NULL
  ),
  active_sess AS (
    SELECT id, started_at FROM sess WHERE is_active ORDER BY started_at LIMIT 1
  )
  SELECT
    (SELECT count(*)::int FROM call_facts)                                  AS calls_made,
    (SELECT count(*)::int FROM call_facts WHERE is_contacted)               AS contacted_calls,
    (SELECT coalesce(sum(duration), 0)::int FROM call_facts)                AS total_talk_seconds,
    (SELECT count(*)::int
       FROM public.wins w, me
      WHERE w.agent_id = me.uid
        AND w.organization_id = me.org_id
        AND w.campaign_id = p_campaign_id
        AND w.created_at >= p_start
        AND w.created_at <  p_end)                                          AS policies_sold,
    (SELECT coalesce(sum(span), 0)::int FROM sess)                          AS session_duration_seconds,
    (SELECT coalesce(sum(span), 0)::int FROM sess WHERE NOT is_active)      AS closed_session_duration_seconds,
    (SELECT id FROM active_sess)                                            AS active_session_id,
    (SELECT started_at FROM active_sess)                                    AS active_session_started_at;
$$;

REVOKE ALL ON FUNCTION public.get_trusted_today_dialer_stats(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trusted_today_dialer_stats(uuid, timestamptz, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
