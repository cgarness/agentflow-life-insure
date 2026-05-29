import { supabase } from "@/integrations/supabase/client";
import { isCallsRowOutboundDirection } from "@/lib/webrtcInboundCaller";
import { isContactedCall } from "@/lib/report-utils";

export interface DialerDailyStats {
  id: string;
  agent_id: string;
  stat_date: string;
  calls_made: number;
  calls_connected: number;
  total_talk_seconds: number;
  policies_sold: number;
  amd_skipped: number;
  session_started_at: string | null;
  session_duration_seconds: number;
  last_updated_at: string;
}

/**
 * LEGACY / DISPLAY-ONLY (`dialer_daily_stats`).
 *
 * Upsert dialer stats for today. Numeric fields are INCREMENTED on conflict,
 * not replaced. session_started_at is only set if not already present.
 *
 * NOT the trusted source. As of P1 Build 3 (2026-05-29) trusted daily/session
 * stats derive from `calls` / `wins` / `dialer_sessions` via
 * `getTrustedTodayDialerStats`. This RPC remains for `dialer_daily_stats`
 * display compatibility only (`calls_made`, `session_started_at`,
 * `policies_sold`). Never pass browser talk time, connected count, or session
 * duration through here — those are no longer browser-sourced.
 */
export async function upsertDialerStats(
  agentId: string,
  updates: {
    calls_made?: number;
    calls_connected?: number;
    total_talk_seconds?: number;
    policies_sold?: number;
    amd_skipped?: number;
    session_started_at?: string | null;
  }
): Promise<void> {
  const { error } = await (supabase as any).rpc("increment_dialer_stats", { // eslint-disable-line @typescript-eslint/no-explicit-any
    p_agent_id: agentId,
    p_calls_made: updates.calls_made ?? 0,
    p_calls_connected: updates.calls_connected ?? 0,
    p_total_talk_seconds: updates.total_talk_seconds ?? 0,
    p_policies_sold: updates.policies_sold ?? 0,
    p_session_started_at: updates.session_started_at ?? null,
    p_amd_skipped: updates.amd_skipped ?? 0,
    p_session_duration_seconds: 0,
  });
  if (error) {
    console.error("[upsertDialerStats] error:", error);
    throw error;
  }
}

/**
 * LEGACY / DISPLAY-ONLY (`dialer_daily_stats`).
 *
 * Fetch today's stats row for the given agent.
 * Returns null if no row exists yet (agent hasn't called today).
 *
 * NOT the trusted source for talk time, contacted count, session duration,
 * billing, or manager reporting — use `getTrustedTodayDialerStats`.
 */
export async function getTodayStats(
  agentId: string
): Promise<DialerDailyStats | null> {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const { data, error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from("dialer_daily_stats")
    .select("*")
    .eq("agent_id", agentId)
    .eq("stat_date", today)
    .maybeSingle();
  if (error) {
    console.error("[getTodayStats] error:", error);
    throw error;
  }
  return (data as DialerDailyStats) ?? null;
}

/**
 * LEGACY / DISPLAY-ONLY (`dialer_daily_stats`).
 *
 * Delete today's stats row for the given agent (used by Reset Stats).
 */
export async function deleteTodayStats(agentId: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const { error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from("dialer_daily_stats")
    .delete()
    .eq("agent_id", agentId)
    .eq("stat_date", today);
  if (error) {
    console.error("[deleteTodayStats] error:", error);
    throw error;
  }
}

// ─── Trusted daily/session stats (P1 Build 3) ───────────────────────────────
//
// Derived from canonical sources only:
//   - calls   → calls made, talk time (Twilio-backed calls.duration), contacted
//   - wins    → policies sold
//   - dialer_sessions → session duration (server timestamps)
// `dialer_daily_stats` is intentionally NOT read here.

export interface TrustedDialerStats {
  calls_made: number;
  contacted_calls: number;
  total_talk_seconds: number;
  policies_sold: number;
  /** Sum of completed session spans today + live delta for the active session. */
  session_duration_seconds: number;
  active_session_id: string | null;
  active_session_started_at: string | null;
}

/** UTC calendar-day [start, end) bounds — matches getTodayCallCount semantics. */
function utcDayBounds(date: Date): { startIso: string; endIso: string } {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/**
 * Trusted today's dialer stats for an agent, scoped to org + UTC day.
 *
 * - `calls_made`        — count of outbound `calls` rows
 * - `total_talk_seconds`— SUM(calls.duration) (Twilio-backed only)
 * - `contacted_calls`   — report definition: duration > 45 OR DNC disposition
 * - `policies_sold`     — count of `wins` rows
 * - `session_duration_seconds` — from `dialer_sessions`
 *
 * Pass `dncDispositionNames` (lowercased, from `buildDNCDispositionSet`) so the
 * contacted classification can credit DNC dispositions per `report-utils`.
 */
export async function getTrustedTodayDialerStats(args: {
  agentId: string;
  organizationId: string;
  date?: Date;
  dncDispositionNames?: Set<string>;
}): Promise<TrustedDialerStats> {
  const { agentId, organizationId, dncDispositionNames } = args;
  const { startIso, endIso } = utcDayBounds(args.date ?? new Date());

  const empty: TrustedDialerStats = {
    calls_made: 0,
    contacted_calls: 0,
    total_talk_seconds: 0,
    policies_sold: 0,
    session_duration_seconds: 0,
    active_session_id: null,
    active_session_started_at: null,
  };

  if (!agentId || !organizationId) return empty;

  // ── calls: made, talk time, contacted ──
  const { data: callRows, error: callsError } = await supabase
    .from("calls")
    .select("duration, disposition_name, direction")
    .eq("agent_id", agentId)
    .eq("organization_id", organizationId)
    .gte("created_at", startIso)
    .lt("created_at", endIso);
  if (callsError) {
    console.error("[getTrustedTodayDialerStats] calls error:", callsError);
  }

  let callsMade = 0;
  let totalTalkSeconds = 0;
  let contactedCalls = 0;
  for (const row of callRows ?? []) {
    if (!isCallsRowOutboundDirection(row.direction)) continue;
    callsMade += 1;
    const duration = row.duration ?? 0;
    totalTalkSeconds += duration;
    if (isContactedCall(duration, row.disposition_name, dncDispositionNames)) {
      contactedCalls += 1;
    }
  }

  // ── wins: policies sold ──
  const { count: winsCount, error: winsError } = await supabase
    .from("wins")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agentId)
    .eq("organization_id", organizationId)
    .gte("created_at", startIso)
    .lt("created_at", endIso);
  if (winsError) {
    console.error("[getTrustedTodayDialerStats] wins error:", winsError);
  }

  // ── dialer_sessions: session duration ──
  // types.ts is stale for last_heartbeat_at/status (added in Build 1 migration).
  const { data: sessionRows, error: sessionsError } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .from("dialer_sessions")
    .select("id, started_at, ended_at, last_heartbeat_at, status")
    .eq("agent_id", agentId)
    .eq("organization_id", organizationId)
    .gte("started_at", startIso)
    .lt("started_at", endIso);
  if (sessionsError) {
    console.error("[getTrustedTodayDialerStats] sessions error:", sessionsError);
  }

  const nowMs = Date.now();
  let sessionDurationSeconds = 0;
  let activeSessionId: string | null = null;
  let activeSessionStartedAt: string | null = null;
  for (const s of (sessionRows ?? []) as Array<{
    id: string;
    started_at: string | null;
    ended_at: string | null;
    last_heartbeat_at: string | null;
    status: string | null;
  }>) {
    if (!s.started_at) continue;
    const startMs = new Date(s.started_at).getTime();
    const isActive = s.status === "active" && !s.ended_at;
    // ended/abandoned: ended_at − started_at; active: live now − started_at.
    const endMs = s.ended_at
      ? new Date(s.ended_at).getTime()
      : isActive
        ? nowMs
        : s.last_heartbeat_at
          ? new Date(s.last_heartbeat_at).getTime()
          : startMs;
    sessionDurationSeconds += Math.max(0, Math.floor((endMs - startMs) / 1000));
    if (isActive && !activeSessionId) {
      activeSessionId = s.id;
      activeSessionStartedAt = s.started_at;
    }
  }

  return {
    calls_made: callsMade,
    contacted_calls: contactedCalls,
    total_talk_seconds: totalTalkSeconds,
    policies_sold: winsCount ?? 0,
    session_duration_seconds: sessionDurationSeconds,
    active_session_id: activeSessionId,
    active_session_started_at: activeSessionStartedAt,
  };
}
