import { supabase } from "@/integrations/supabase/client";
import { isCallsRowOutboundDirection } from "@/lib/webrtcInboundCaller";
import { isContactedCallRow, type ContactedDispositionLookup } from "@/lib/report-utils";

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
  /**
   * Sum of ONLY ended/abandoned session spans today (excludes the active
   * session's live portion). The browser adds `now − active_session_started_at`
   * on top of this to tick live without double-counting after a reconcile.
   */
  closed_session_duration_seconds: number;
  active_session_id: string | null;
  active_session_started_at: string | null;
}

/**
 * Resolve the agent/user's IANA timezone for daily-reset boundaries.
 *
 * P1 Build 3B: the daily reset uses the agent's local day, not UTC and not the
 * agency timezone. `profiles.timezone` stores Rails/ActiveSupport labels (e.g.
 * "Eastern Time (US & Canada)") which are NOT IANA and cannot drive `Intl` date
 * math, so the trusted source is the browser IANA zone. UTC is the last resort.
 */
export function resolveUserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Offset (local − UTC, in ms) of an IANA timezone at a given instant.
 * Uses Intl to read the wall-clock the zone shows for `utcDate`.
 */
function tzOffsetMs(timeZone: string, utcDate: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(utcDate)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour,
    map.minute,
    map.second,
  );
  return asUtc - utcDate.getTime();
}

/** UTC ms for a wall-clock midnight (y-m-d 00:00:00) in the given IANA zone. */
function zonedMidnightToUtcMs(
  y: number,
  m: number,
  d: number,
  timeZone: string,
): number {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const offset = tzOffsetMs(timeZone, new Date(guess));
  let utc = guess - offset;
  // One refinement for the rare midnight-DST-transition edge.
  const offset2 = tzOffsetMs(timeZone, new Date(utc));
  if (offset2 !== offset) utc = guess - offset2;
  return utc;
}

/**
 * User-local calendar-day `[start, end)` bounds as UTC ISO strings, for the
 * agent's IANA `timeZone` (P1 Build 3B). Daily Dialer stats reset at the user's
 * local midnight, so Supabase `gte`/`lt` filters use these bounds — not UTC.
 */
export function userLocalDayBounds(
  timeZone: string,
  date: Date = new Date(),
): { startIso: string; endIso: string } {
  // Local calendar Y-M-D the agent currently sees.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pmap: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") pmap[p.type] = Number(p.value);

  const startMs = zonedMidnightToUtcMs(pmap.year, pmap.month, pmap.day, timeZone);
  // Next local day's wall date (UTC math on the wall values, then re-zone).
  const nextWall = new Date(Date.UTC(pmap.year, pmap.month - 1, pmap.day));
  nextWall.setUTCDate(nextWall.getUTCDate() + 1);
  const endMs = zonedMidnightToUtcMs(
    nextWall.getUTCFullYear(),
    nextWall.getUTCMonth() + 1,
    nextWall.getUTCDate(),
    timeZone,
  );

  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

/**
 * Trusted today's dialer stats for an agent, scoped to org + **selected
 * campaign** + the agent's **user-local day** (P1 Build 3B).
 *
 * - `calls_made`        — count of outbound `calls` rows
 * - `total_talk_seconds`— SUM(calls.duration) (Twilio-backed only)
 * - `contacted_calls`   — duration > 45 OR disposition.counts_as_contacted
 * - `policies_sold`     — count of `wins` rows (campaign-linked)
 * - `session_duration_seconds` — from `dialer_sessions`
 *
 * `campaignId` is REQUIRED — all four sources filter `.eq("campaign_id", …)`;
 * with no campaign selected the helper returns zeros (header shows neutral).
 * `timeZone` is the agent's IANA zone (see `resolveUserTimeZone`); daily bounds
 * are the user's local midnight→midnight converted to UTC ISO.
 *
 * Pass `contactedDispositions` (from `buildContactedDispositionLookup`) so the
 * contacted classification credits dispositions flagged `counts_as_contacted`.
 * Matching prefers `calls.disposition_id` (UUID FK on new rows) and falls back
 * to lowercased `disposition_name` for legacy rows. `dncDispositionNames`
 * remains an optional legacy fallback for pre-backfill DNC rows.
 */
export async function getTrustedTodayDialerStats(args: {
  agentId: string;
  organizationId: string;
  campaignId: string;
  timeZone: string;
  date?: Date;
  contactedDispositions?: ContactedDispositionLookup;
  dncDispositionNames?: Set<string>;
}): Promise<TrustedDialerStats> {
  const { agentId, organizationId, campaignId, timeZone, contactedDispositions, dncDispositionNames } = args;
  const contactedSet: ContactedDispositionLookup =
    contactedDispositions ?? { ids: new Set(), names: new Set() };
  const { startIso, endIso } = userLocalDayBounds(timeZone, args.date ?? new Date());

  const empty: TrustedDialerStats = {
    calls_made: 0,
    contacted_calls: 0,
    total_talk_seconds: 0,
    policies_sold: 0,
    session_duration_seconds: 0,
    closed_session_duration_seconds: 0,
    active_session_id: null,
    active_session_started_at: null,
  };

  if (!agentId || !organizationId || !campaignId) return empty;

  // Run all three trusted-source reads CONCURRENTLY. They are independent, so
  // firing them in parallel (instead of awaiting one-after-another) cuts the
  // header-stat load from ~3 round-trips to ~1 — the fix for the slow header.
  const [callsRes, winsRes, sessionsRes] = await Promise.all([
    // ── calls: made, talk time, contacted ──
    supabase
      .from("calls")
      .select("duration, disposition_id, disposition_name, direction")
      .eq("agent_id", agentId)
      .eq("organization_id", organizationId)
      .eq("campaign_id", campaignId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    // ── wins: policies sold ──
    supabase
      .from("wins")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", agentId)
      .eq("organization_id", organizationId)
      .eq("campaign_id", campaignId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    // ── dialer_sessions: session duration ──
    // types.ts is stale for last_heartbeat_at/status (added in Build 1 migration).
    (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .from("dialer_sessions")
      .select("id, started_at, ended_at, last_heartbeat_at, status")
      .eq("agent_id", agentId)
      .eq("organization_id", organizationId)
      .eq("campaign_id", campaignId)
      .gte("started_at", startIso)
      .lt("started_at", endIso),
  ]);

  const { data: callRows, error: callsError } = callsRes;
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
    if (
      isContactedCallRow(
        {
          duration,
          disposition_id: row.disposition_id,
          disposition_name: row.disposition_name,
        },
        contactedSet,
        dncDispositionNames,
      )
    ) {
      contactedCalls += 1;
    }
  }

  const { count: winsCount, error: winsError } = winsRes;
  if (winsError) {
    console.error("[getTrustedTodayDialerStats] wins error:", winsError);
  }

  const { data: sessionRows, error: sessionsError } = sessionsRes;
  if (sessionsError) {
    console.error("[getTrustedTodayDialerStats] sessions error:", sessionsError);
  }

  const nowMs = Date.now();
  let sessionDurationSeconds = 0;
  let closedSessionDurationSeconds = 0;
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
    const span = Math.max(0, Math.floor((endMs - startMs) / 1000));
    sessionDurationSeconds += span;
    if (isActive) {
      if (!activeSessionId) {
        activeSessionId = s.id;
        activeSessionStartedAt = s.started_at;
      }
    } else {
      closedSessionDurationSeconds += span;
    }
  }

  return {
    calls_made: callsMade,
    contacted_calls: contactedCalls,
    total_talk_seconds: totalTalkSeconds,
    policies_sold: winsCount ?? 0,
    session_duration_seconds: sessionDurationSeconds,
    closed_session_duration_seconds: closedSessionDurationSeconds,
    active_session_id: activeSessionId,
    active_session_started_at: activeSessionStartedAt,
  };
}
