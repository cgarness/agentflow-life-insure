/**
 * stat-computations.ts — the Reports stat-card registry.
 *
 * Every AVAILABLE stat is computed from canonical fields returned by the secured report RPCs
 * (Calls Made, Talk Time, Contacted, Call Contact Rate, Converted, Policies Sold, Appointments, session
 * time — AGENT_RULES #8/#12/#13/#17/#23) or is plain arithmetic over two of them. A stat with no
 * documented definition is UNAVAILABLE: it shows its reason, never a number, and is not offered in
 * the layout picker. Stat ids are unchanged so saved layouts stay compatible.
 *
 * There is deliberately NO conversion rate of any kind (plan rev 2 §R2.2): Policies Sold counts
 * policies (one client may buy several), so policies ÷ dials is not a lead conversion rate. The only
 * dial-to-policy figure is explicitly named "Dials per policy sold".
 *
 * Policies Sold = normalized STORED policies by sale date (plan §20). Per-agent policy counts are the
 * client's CURRENT assignment, not original seller credit, so: the policy ranking is labelled "Most
 * policies — current assignments", and the two call/talk-per-policy ratios exist ONLY for the whole
 * organization with no agent filter (period activity ÷ dated stored policies) — never as an agent or
 * team efficiency figure.
 */
import type { ReportQuality, ReportSummary, ReportVolume } from "@/lib/reports-schemas";
import type { LoadState } from "@/hooks/useReportsData";
import { addDays, formatCount, formatElapsed, formatRate, formatPremium, ratio } from "@/lib/reports-format";

export type StatCategory = "activity" | "results" | "pipeline" | "team";

export const STAT_CATEGORIES: Record<StatCategory, { label: string; color: string }> = {
  activity: { label: "Activity", color: "#378ADD" },
  results: { label: "Results", color: "#639922" },
  pipeline: { label: "Pipeline", color: "#1D9E75" },
  team: { label: "Team", color: "#BA7517" },
};

export interface StatDefinition {
  id: string;
  label: string;
  category: StatCategory;
  /** Set when there is no approved definition; the card shows this reason instead of a value. */
  unavailable?: string;
  invertTrend?: boolean;
}

export type StatState = "ready" | "loading" | "error" | "unavailable";

export interface StatResult {
  id: string;
  label: string;
  category: StatCategory;
  state: StatState;
  /** Display value; "—" when the value is unknown or its denominator is zero. */
  value: string;
  subtitle?: string;
  /** When true, render the value smaller (used for agent names). */
  smallValue?: boolean;
  /** "caution": the subtitle is a data-quality note about this value (rendered with a caution dot). */
  noteTone?: "caution";
}

const NO_DEFINITION = "No approved definition yet";
const NO_CONVERSION = "No approved conversion-rate definition";
const NOT_TRACKED = "Not tracked by the report data yet";

export const STAT_DEFINITIONS: StatDefinition[] = [
  // Activity
  { id: "stat_total_dials", label: "Calls made", category: "activity" },
  { id: "stat_outbound", label: "Outbound calls", category: "activity" },
  { id: "stat_inbound", label: "Inbound calls", category: "activity" },
  { id: "stat_calls_today", label: "Calls today", category: "activity" },
  { id: "stat_calls_this_week", label: "Calls this week", category: "activity" },
  { id: "stat_calls_per_day", label: "Calls per day", category: "activity" },
  { id: "stat_calls_per_hour", label: "Calls per session hour", category: "activity" },
  { id: "stat_session_time", label: "Dialer session time", category: "activity" },
  { id: "stat_unique_leads", label: "Unique leads dialed", category: "activity", unavailable: NOT_TRACKED },
  { id: "stat_new_leads_dialed", label: "New leads dialed", category: "activity", unavailable: NOT_TRACKED },
  { id: "stat_followup_calls", label: "Follow-up calls", category: "activity", unavailable: NOT_TRACKED },
  { id: "stat_voicemails_left", label: "Voicemails left", category: "activity", unavailable: NOT_TRACKED },
  { id: "stat_total_contacted", label: "Contacted calls", category: "activity" },
  { id: "stat_contact_rate", label: "Call contact rate", category: "activity" },
  { id: "stat_first_dial_contact", label: "First dial contact rate", category: "activity", unavailable: NOT_TRACKED },
  { id: "stat_followup_contact_rate", label: "Follow-up contact rate", category: "activity", unavailable: NOT_TRACKED },
  { id: "stat_avg_dials_to_contact", label: "Avg dials to contact", category: "activity", unavailable: NOT_TRACKED },
  { id: "stat_speed_to_contact", label: "Speed to contact", category: "activity", unavailable: NOT_TRACKED },
  { id: "stat_total_talk_time", label: "Talk time", category: "activity" },
  { id: "stat_avg_duration_all", label: "Avg talk time per dial", category: "activity" },
  { id: "stat_avg_talk_contacted", label: "Avg talk time (contacted)", category: "activity", unavailable: NOT_TRACKED },
  { id: "stat_longest_call", label: "Longest call", category: "activity", unavailable: NOT_TRACKED },
  { id: "stat_shortest_connected", label: "Shortest connected", category: "activity", unavailable: NOT_TRACKED },
  { id: "stat_talk_time_ratio", label: "Talk time share of session", category: "activity" },
  { id: "stat_dnc_count", label: "DNC dispositions", category: "activity" },
  { id: "stat_dnc_rate", label: "DNC per 100 dials", category: "activity", invertTrend: true },

  // New optional metrics retain all existing layout ids/order.
  { id: "stat_annual_premium", label: "Known annual premium", category: "results" },
  { id: "stat_avg_premium", label: "Avg annual premium / known policy", category: "results" },
  // Results
  { id: "stat_policies_sold", label: "Policies sold", category: "results" },
  { id: "stat_call_to_close", label: "Call to close rate", category: "results", unavailable: NO_CONVERSION },
  { id: "stat_contacted_to_close", label: "Contacted to close", category: "results", unavailable: NO_CONVERSION },
  { id: "stat_appt_to_close", label: "Appt to close rate", category: "results", unavailable: NO_CONVERSION },
  { id: "stat_dials_per_sale", label: "Dials per policy sold", category: "results", invertTrend: true },
  { id: "stat_avg_days_to_close", label: "Avg days to close", category: "results", unavailable: NOT_TRACKED, invertTrend: true },
  { id: "stat_best_closing_hour", label: "Best closing hour", category: "results", unavailable: NOT_TRACKED },
  { id: "stat_best_closing_day", label: "Best closing day", category: "results", unavailable: NOT_TRACKED },
  { id: "stat_appointments_set", label: "Bookings created (all types)", category: "results" },
  { id: "stat_appt_set_rate", label: "Appt set rate", category: "results", unavailable: NO_DEFINITION },
  { id: "stat_contacted_to_appt", label: "Contacted to appt", category: "results", unavailable: NO_DEFINITION },
  { id: "stat_appts_kept", label: "Appointments kept", category: "results", unavailable: NOT_TRACKED },
  { id: "stat_appt_noshow_rate", label: "Appt no-show rate", category: "results", unavailable: NOT_TRACKED, invertTrend: true },
  { id: "stat_avg_dials_to_appt", label: "Avg dials to appt", category: "results", unavailable: NOT_TRACKED, invertTrend: true },
  { id: "stat_not_interested_rate", label: "Not interested rate", category: "results", unavailable: NO_DEFINITION, invertTrend: true },

  // Pipeline
  { id: "stat_active_leads", label: "Active leads", category: "pipeline", unavailable: NO_DEFINITION },
  { id: "stat_leads_contacted", label: "Leads contacted", category: "pipeline", unavailable: NOT_TRACKED },
  { id: "stat_leads_converted", label: "Converted leads/clients", category: "pipeline" },
  { id: "stat_callback_rate", label: "Callback dispositions", category: "pipeline" },
  { id: "stat_callbacks_completed", label: "Callbacks completed", category: "pipeline", unavailable: NOT_TRACKED },
  { id: "stat_callback_conv_rate", label: "Callback conv rate", category: "pipeline", unavailable: NO_CONVERSION },
  { id: "stat_lead_exhaustion", label: "Lead exhaustion rate", category: "pipeline", unavailable: NOT_TRACKED, invertTrend: true },

  // Team
  { id: "stat_top_performer", label: "Most policies — current assignments", category: "team" },
  { id: "stat_top_dialer", label: "Top dialer", category: "team" },
  { id: "stat_best_contact_agent", label: "Best call contact rate", category: "team" },
  { id: "stat_best_conv_agent", label: "Best conv rate", category: "team", unavailable: NO_CONVERSION },
  { id: "stat_avg_calls_agent", label: "Avg calls per dialing agent", category: "team" },
  { id: "stat_avg_sales_agent", label: "Avg sales/agent", category: "team", unavailable: NO_DEFINITION },
  { id: "stat_agents_active", label: "Agents dialing", category: "team" },
  { id: "stat_dials_per_contact", label: "Dials per contacted call", category: "team", invertTrend: true },
  { id: "stat_dials_per_appt", label: "Dials per booking", category: "team", invertTrend: true },
  { id: "stat_talk_mins_per_sale", label: "Talk minutes per policy sold", category: "team", invertTrend: true },
  { id: "stat_sessions_per_sale", label: "Sessions per sale", category: "team", unavailable: NOT_TRACKED, invertTrend: true },
  { id: "stat_cost_per_lead", label: "Cost per lead", category: "team", unavailable: NOT_TRACKED, invertTrend: true },
  { id: "stat_cost_per_appt", label: "Cost per appt", category: "team", unavailable: NOT_TRACKED, invertTrend: true },
  { id: "stat_cost_per_sale", label: "Cost per sale", category: "team", unavailable: NOT_TRACKED, invertTrend: true },
];

export const STAT_DEFINITION_MAP: Record<string, StatDefinition> = Object.fromEntries(STAT_DEFINITIONS.map((d) => [d.id, d]));

export function isStatAvailable(id: string): boolean {
  const def = STAT_DEFINITION_MAP[id];
  return !!def && !def.unavailable;
}

// ─── Formatting ──────────────────────────────────────────────────────────────────────────────────

const DASH = "—";
const num = (n: number | null, digits = 1): string => (n === null || !Number.isFinite(n) ? DASH : n.toFixed(digits));

/** Why the per-policy ratios are withheld outside an unfiltered organization view. */
export const POLICY_RATIO_SCOPE_REASON =
  "Organization view only: policies are credited to the client's current agent, not the original seller";

/** Calls/talk per policy are period-level ratios, never seller efficiency: whole organization, no agent filter. */
function orgWidePolicyRatio(s: ReportSummary): boolean {
  return s.scope === "organization" && s.filter_agent_id === null;
}

// ─── Computation ─────────────────────────────────────────────────────────────────────────────────

export interface StatInputs {
  summary: LoadState<ReportSummary>;
  volume: LoadState<ReportVolume>;
  /** Days in the reported agency window. */
  dayCount: number;
  /** Agency calendar today (`get_report_scope().today`). */
  agencyToday: string;
}

type Computed = { value: string; subtitle?: string; smallValue?: boolean; noteTone?: "caution" } | { unknown: string };
type Caution = Pick<StatResult, "subtitle" | "noteTone">;

/** Only the non-zero parts, so a caution never lists a zero; nothing at all when every part is zero. */
function caution(parts: [number, string][], prefix = ""): Caution {
  const shown = parts.filter(([n]) => n > 0).map(([n, text]) => `${formatCount(n)} ${text}`);
  return shown.length ? { subtitle: `${prefix}${shown.join(" · ")}`, noteTone: "caution" } : {};
}

/** Duration provenance of the calls behind talk time (data-basis C14); never on session-matched talk. */
const durationCaution = (d: ReportQuality["duration"]) => caution([
  [d.estimated_calls, "estimated"], [d.unknown_calls, "unknown source or amount"], [d.conflicting_calls, "conflicting"],
], "Durations: ");

/** Session evidence behind dialer session time (data-basis C15). */
const sessionCaution = (q: ReportQuality["sessions"]) => caution([
  [q.stale_capped, "stale, capped at last heartbeat"], [q.missing_evidence, "missing/invalid end evidence"],
]);

function leader<T>(rows: T[], score: (r: T) => number | null, name: (r: T) => string): { name: string; score: number } | null {
  let best: { name: string; score: number } | null = null;
  for (const r of rows) {
    const s = score(r);
    if (s === null || s <= 0) continue;
    const n = name(r);
    if (!best || s > best.score || (s === best.score && n.localeCompare(best.name) < 0)) best = { name: n, score: s };
  }
  return best;
}

function computeFromSummary(id: string, s: ReportSummary, inputs: StatInputs): Computed {
  const t = s.totals;
  const dialers = s.by_agent.filter((a) => a.calls_made > 0);
  // Only calls inside a same-agent/campaign interval enter a session-rate numerator.
  // The server unions overlapping intervals per agent before calculating the denominator.
  const sessionPop = { calls: t.session_matched_calls, talk: t.session_matched_talk_seconds, secs: t.session_seconds };
  switch (id) {
    case "stat_total_dials":
    case "stat_outbound":
      return { value: formatCount(t.calls_made) };
    case "stat_inbound":
      return { value: formatCount(t.inbound_calls) };
    case "stat_calls_per_day":
      return { value: num(ratio(t.calls_made, inputs.dayCount)), subtitle: `over ${inputs.dayCount} day${inputs.dayCount === 1 ? "" : "s"}` };
    case "stat_calls_per_hour":
      return { value: num(ratio(sessionPop.calls, sessionPop.secs / 3600)), subtitle: "session-matched calls ÷ all session hours" };
    case "stat_session_time":
      return { value: formatElapsed(t.session_seconds), ...sessionCaution(s.quality.sessions) };
    case "stat_total_contacted":
      return { value: formatCount(t.contacted) };
    case "stat_contact_rate":
      return { value: formatRate(t.contact_rate_pct) };
    case "stat_total_talk_time":
      return { value: formatElapsed(t.talk_time_seconds), ...durationCaution(s.quality.duration) };
    case "stat_avg_duration_all":
      // The server already rounds this average to 0.1 s; show it as sent, never rounded again.
      return { value: formatElapsed(t.avg_talk_per_dial_seconds, 1), ...durationCaution(s.quality.duration) };
    case "stat_talk_time_ratio": {
      const r = ratio(sessionPop.talk, sessionPop.secs);
      return { value: r === null ? DASH : `${(r * 100).toFixed(1)}%`, subtitle: "session-matched talk ÷ all session time" };
    }
    case "stat_dnc_count":
      return { value: formatCount(t.dnc_calls) };
    case "stat_dnc_rate": {
      const r = ratio(t.dnc_calls, t.calls_made);
      return { value: r === null ? DASH : num(r * 100), subtitle: "DNC dispositions per 100 calls" };
    }
    case "stat_annual_premium":
      return { value: formatPremium(t.premium.annual_premium), subtitle: `${t.premium.known_count}/${t.premium.policy_count} known; current monthly ×12` };
    case "stat_avg_premium":
      return { value: formatPremium(t.premium.average_annual_premium), subtitle: `${t.premium.known_count}/${t.premium.policy_count} known policies` };
    case "stat_policies_sold":
      return { value: formatCount(t.policies_sold), subtitle: "stored policies, by sale date" };
    case "stat_dials_per_sale":
      if (!orgWidePolicyRatio(s)) return { unknown: POLICY_RATIO_SCOPE_REASON };
      return { value: num(ratio(t.calls_made, t.policies_sold)), subtitle: "calls in period ÷ dated stored policies in period" };
    case "stat_appointments_set":
      return { value: formatCount(t.appointments_set) };
    case "stat_leads_converted":
      return { value: formatCount(t.converted), subtitle: "distinct people" };
    case "stat_callback_rate":
      return { value: formatCount(t.callback_calls), subtitle: "callback dispositions" };
    case "stat_top_performer": {
      // A ranking by CURRENT assignment — not original sales credit (clients can be reassigned).
      const best = leader(s.by_agent, (a) => a.policies_sold, (a) => a.name);
      return best
        ? { value: best.name, subtitle: `${best.score} polic${best.score === 1 ? "y" : "ies"} currently assigned`, smallValue: true }
        : { value: DASH, subtitle: "no policies in this period" };
    }
    case "stat_top_dialer": {
      const best = leader(s.by_agent, (a) => a.calls_made, (a) => a.name);
      return best ? { value: best.name, subtitle: `${formatCount(best.score)} calls made`, smallValue: true } : { value: DASH, subtitle: "no calls made" };
    }
    case "stat_best_contact_agent": {
      const best = leader(dialers, (a) => a.contact_rate_pct, (a) => a.name);
      return best ? { value: best.name, subtitle: `${best.score.toFixed(1)}% call contact rate`, smallValue: true } : { value: DASH };
    }
    case "stat_avg_calls_agent":
      return { value: num(ratio(t.calls_made - s.unattributed.calls_made, dialers.length)), subtitle: `${dialers.length} dialing agent${dialers.length === 1 ? "" : "s"}` };
    case "stat_agents_active":
      return { value: formatCount(dialers.length), subtitle: "with at least one call" };
    case "stat_dials_per_contact":
      return { value: num(ratio(t.calls_made, t.contacted)) };
    case "stat_dials_per_appt":
      // Calls made ÷ Bookings created (all types): every booking kind, not appointments only.
      return { value: num(ratio(t.calls_made, t.appointments_set)), subtitle: "all booking types" };
    case "stat_talk_mins_per_sale":
      if (!orgWidePolicyRatio(s)) return { unknown: POLICY_RATIO_SCOPE_REASON };
      return { value: num(ratio(t.talk_time_seconds / 60, t.policies_sold)), subtitle: "talk minutes in period ÷ dated stored policies in period" };
    default:
      return { unknown: NOT_TRACKED };
  }
}

function computeFromVolume(id: string, v: ReportVolume, inputs: StatInputs): Computed {
  const inWindow = (d: string) => d >= v.window.start_date && d <= v.window.end_date;
  if (id === "stat_calls_today") {
    if (!inWindow(inputs.agencyToday)) return { unknown: "Today is outside the selected period" };
    const row = v.by_date.find((d) => d.date === inputs.agencyToday);
    return { value: formatCount(row?.calls_made ?? 0), subtitle: "agency calendar day" };
  }
  // Week = Monday..Sunday of the agency today, and only when the whole week-to-date is in range.
  const today = new Date(`${inputs.agencyToday}T00:00:00Z`);
  const weekStart = addDays(inputs.agencyToday, -((today.getUTCDay() + 6) % 7));
  if (!inWindow(weekStart) || !inWindow(inputs.agencyToday)) return { unknown: "Select a period that includes this whole week" };
  const total = v.by_date.filter((d) => d.date >= weekStart && d.date <= inputs.agencyToday).reduce((a, d) => a + d.calls_made, 0);
  return { value: formatCount(total), subtitle: "Monday to today, agency calendar" };
}

const VOLUME_STATS = new Set(["stat_calls_today", "stat_calls_this_week"]);

export function computeStat(def: StatDefinition, inputs: StatInputs): StatResult {
  const base = { id: def.id, label: def.label, category: def.category };
  if (def.unavailable) return { ...base, state: "unavailable", value: DASH, subtitle: def.unavailable };
  const source = VOLUME_STATS.has(def.id) ? inputs.volume : inputs.summary;
  if (source.status === "loading") return { ...base, state: "loading", value: DASH };
  if (source.status === "error") {
    return source.error.kind === "configuration"
      ? { ...base, state: "unavailable", value: DASH, subtitle: "Agency time zone not configured" }
      : { ...base, state: "error", value: DASH, subtitle: "Couldn't load — not a zero" };
  }
  const c = VOLUME_STATS.has(def.id)
    ? computeFromVolume(def.id, source.data as ReportVolume, inputs)
    : computeFromSummary(def.id, source.data as ReportSummary, inputs);
  if ("unknown" in c) return { ...base, state: "unavailable", value: DASH, subtitle: c.unknown };
  return { ...base, state: "ready", ...c };
}

export function computeAllStats(inputs: StatInputs): Map<string, StatResult> {
  return new Map(STAT_DEFINITIONS.map((def) => [def.id, computeStat(def, inputs)]));
}
