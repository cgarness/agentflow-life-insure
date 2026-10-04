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
    "Start Inclusive", "As Of Exclusive", "Roster", "Group ID", "Snapshot Status"];
  const rows = agents.map(a => [a.rank, `${a.first_name} ${a.last_name}`, a.id, a.organizationName ?? "",
    a.organizationId ?? snapshot.organization_id, a.callsMade, a.policiesSold, a.premiumSold.toFixed(2),
    a.unknownPremiums ?? 0, a.appointmentsSet, a.talkTime, a.conversionRate, a.callsMade,
    snapshot.period, snapshot.time_zone, snapshot.start_at, snapshot.end_at, snapshot.roster, snapshot.group_id, stale ? "stale" : "current"]);
  return [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
}

export function performanceCaption(snapshot: PerformanceSnapshot): string {
  const excluded = snapshot.excluded;
  const unknown = snapshot.rows.reduce((n,a) => n + (a.unknownPremiums ?? 0), 0);
  const estimated = snapshot.rows.reduce((n,a) => n+(a.estimatedDurationCalls ?? 0),0);
  const unknownDuration = snapshot.rows.reduce((n,a) => n+(a.unknownDurationCalls ?? 0),0);
  const conflicts = snapshot.rows.reduce((n,a) => n+(a.conflictingDurationCalls ?? 0),0);
  const asOf = new Intl.DateTimeFormat("en-US", { timeZone: snapshot.time_zone, dateStyle: "short", timeStyle: "medium" }).format(new Date(snapshot.end_at));
  return `Active agents · ${snapshot.time_zone} · As of ${asOf}`
    + ` · Annualized premium${unknown ? ` (${unknown} policies with unknown premium)` : ""}`
    + ((estimated || unknownDuration || conflicts) ? ` · Stored call duration: ${estimated} estimated, ${unknownDuration} unknown provenance, ${conflicts} conflicting` : "")
    + (excluded.calls_made || excluded.appointments_set || excluded.policies_sold
      ? ` · Outside active roster: ${excluded.calls_made} calls, ${excluded.appointments_set} bookings, ${excluded.policies_sold} policies` : "");
}
