import type { AgentStats } from "@/components/leaderboard/leaderboardTypes";
import type { PerformanceSnapshot } from "./performanceQueries";

/** Quote every field; neutralize spreadsheet formulas only for textual cells. */
export function csvCell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function leaderboardCsv(agents: AgentStats[], snapshot: PerformanceSnapshot, stale = false): string {
  const headers = ["Rank", "Agent", "Agent ID", "Organization", "Organization ID", "Calls Made",
    "Policies Sold", "Annualized Premium USD", "Unknown Premium Policies", "Appointments Set",
    "Talk Time Seconds", "Policies per 100 Calls", "Ratio Denominator Calls", "Period", "Agency Timezone",
    "Start Inclusive", "As Of Exclusive", "Roster", "Group ID", "Snapshot Status",
    "Sold Date From", "Sold Date Through", "Policies Without Sold Date (All Time)"];
  const rows = agents.map(a => [a.rank, `${a.first_name} ${a.last_name}`, a.id, a.organizationName ?? "",
    a.organizationId ?? snapshot.organization_id, a.callsMade, a.policiesSold, a.premiumSold.toFixed(2),
    a.unknownPremiums ?? 0, a.appointmentsSet, a.talkTime, a.conversionRate, a.callsMade,
    snapshot.period, snapshot.time_zone, snapshot.start_at, snapshot.end_at, snapshot.roster, snapshot.group_id, stale ? "stale" : "current",
    snapshot.sold_date_from, snapshot.sold_date_through, snapshot.undated_policies]);
  return [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
}

/** The excluded inactive/unattributed activity disclosure, or "" when there is none. */
export function outsideRosterNote(snapshot: PerformanceSnapshot): string {
  const excluded = snapshot.excluded;
  return excluded.calls_made || excluded.appointments_set || excluded.policies_sold
    ? `Outside active roster: ${excluded.calls_made} calls, ${excluded.appointments_set} appointments, ${excluded.policies_sold} policies` : "";
}

/** Estimated or conflicting stored durations only; the legacy_unknown default never triggers a note. */
function talkTimeNote(snapshot: PerformanceSnapshot): string {
  const estimated = snapshot.rows.reduce((n,a) => n+(a.estimatedDurationCalls ?? 0),0);
  const conflicts = snapshot.rows.reduce((n,a) => n+(a.conflictingDurationCalls ?? 0),0);
  if (estimated + conflicts === 0) return "";
  return "Talk time includes " + [estimated ? `${estimated} estimated` : null, conflicts ? `${conflicts} conflicting` : null].filter(Boolean).join(" and ")
    + " call duration" + (estimated + conflicts === 1 ? "" : "s");
}

/** Sales without a Sold Date are never placed in a period; disclosed only when there are any. */
function undatedNote(snapshot: PerformanceSnapshot): string {
  const n = snapshot.undated_policies;
  return n > 0 ? `${n} ${n === 1 ? "policy" : "policies"} without a Sold Date not counted` : "";
}

/** On-screen notes, only when material, joined by " · "; "" when none applies. */
export function performanceCaption(snapshot: PerformanceSnapshot): string {
  const unknown = snapshot.rows.reduce((n,a) => n + (a.unknownPremiums ?? 0), 0);
  return [unknown > 0 ? `Annual premium (${unknown} policies with unknown premium)` : "", talkTimeNote(snapshot), outsideRosterNote(snapshot), undatedNote(snapshot)]
    .filter(Boolean).join(" · ");
}
