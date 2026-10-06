import React from "react";
import { formatCount, formatHours, formatRate, formatPremium } from "@/lib/reports-format";
import type { CsvCell, ReportExportFn } from "@/lib/reports-export";
import { CURRENT_ASSIGNMENT_NOTE } from "@/lib/reports-policy-text";
import type { ReportPremium, ReportSummary } from "@/lib/reports-schemas";
import { cn } from "@/lib/utils";
import ReportSection from "./ReportSection";

interface Props {
  summary: ReportSummary;
  selectedAgentId: string | null;
  /** Only server-returned agents may narrow the current report. */
  selectableAgentIds: ReadonlySet<string>;
  onSelectAgent: (id: string | null) => void;
  onExport?: ReportExportFn;
}

const EXPORT_HEADERS = [
  "Agent", "Status", "Calls made", "Contacted", "Call contact rate %", "Talk time (s)",
  "Policies (current assignment)", "Converted", "Bookings created (all types)", "Session time (s)",
  "Known annual premium", "Policies with known premium", "Policies with unknown premium",
];
const HEADERS = ["Agent", "Policies (current assignment)", "Known annual premium", "Calls made", "Call contact rate", "Bookings created (all types)", "Talk time"];
const numericCell = "px-4 py-4 text-right tabular-nums whitespace-nowrap";

const PremiumValue = ({ premium }: { premium: ReportPremium }) => (
  <>
    <span className="font-medium text-foreground">{formatPremium(premium.annual_premium)}</span>
    <span className="mt-1 block text-xs text-muted-foreground">
      {premium.known_count}/{premium.policy_count} known{premium.unknown_count > 0 ? " · " + premium.unknown_count + " unknown" : ""}
    </span>
  </>
);

/** Comparable supported metrics in server order; current ownership is never presented as seller credit. */
const AgentPerformanceCards: React.FC<Props> = ({ summary, selectedAgentId, selectableAgentIds, onSelectAgent, onExport }) => {
  const agents = summary.by_agent;
  const u = summary.unattributed;
  const hasUnattributed = [u.calls_made, u.inbound_calls, u.talk_time_seconds, u.policies_sold, u.appointments_set].some((n) => n > 0);
  const handleExport = onExport ? () => {
    const rows: CsvCell[][] = agents.map((a) => [
      a.name, a.status, a.calls_made, a.contacted, a.contact_rate_pct, a.talk_time_seconds,
      a.policies_sold, a.converted, a.appointments_set, a.session_seconds, a.premium.annual_premium,
      a.premium.known_count, a.premium.unknown_count,
    ]);
    if (hasUnattributed) {
      rows.push(["Unattributed", null, u.calls_made, null, null, u.talk_time_seconds, u.policies_sold, null,
        u.appointments_set, null, u.premium.annual_premium, u.premium.known_count, u.premium.unknown_count]);
    }
    onExport("Agent Performance", EXPORT_HEADERS, rows);
  } : undefined;

  return (
    <ReportSection title="Agent Performance" onExport={handleExport}>
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{CURRENT_ASSIGNMENT_NOTE}</p>
      {agents.length === 0 && !hasUnattributed ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No agents in this report.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="region" aria-label="Agent performance table" tabIndex={0}>
          <table className="w-full min-w-[900px] text-sm">
            <caption className="sr-only">Agent production and activity for the selected report. Select an available agent name to filter.</caption>
            <thead className="bg-muted/40">
              <tr>
                {HEADERS.map((label, i) => (
                  <th key={label} scope="col" className={cn("px-4 py-3 text-xs font-medium text-muted-foreground", i === 0 ? "text-left" : "text-right")}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {agents.map((a) => {
                const selectable = selectableAgentIds.has(a.agent_id);
                const selected = selectedAgentId === a.agent_id;
                return (
                  <tr key={a.agent_id} className={cn("transition-colors hover:bg-muted/20", selected && "bg-primary/5")}>
                    <th scope="row" className="min-w-[180px] max-w-[240px] px-4 py-4 text-left font-medium">
                      {selectable ? (
                        <button type="button" aria-pressed={selected}
                          aria-label={(selected ? "Clear agent filter for " : "Filter reports to ") + a.name}
                          onClick={() => onSelectAgent(selected ? null : a.agent_id)}
                          className="rounded-sm text-left text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span className="break-words">{a.name}</span>
                        </button>
                      ) : <span className="break-words text-foreground">{a.name}</span>}
                      {a.status && a.status !== "Active" && <span className="mt-1 block text-xs font-normal text-muted-foreground">{a.status}</span>}
                      {selected && <span className="mt-1 block text-xs font-normal text-primary">Selected</span>}
                    </th>
                    <td className={numericCell}>{formatCount(a.policies_sold)}</td>
                    <td className={numericCell}><PremiumValue premium={a.premium} /></td>
                    <td className={numericCell}>{formatCount(a.calls_made)}</td>
                    <td className={numericCell}>{formatRate(a.contact_rate_pct)}</td>
                    <td className={numericCell}>{formatCount(a.appointments_set)}</td>
                    <td className={numericCell}>{formatHours(a.talk_time_seconds)}</td>
                  </tr>
                );
              })}
              {hasUnattributed && (
                <tr className="bg-muted/20 text-muted-foreground">
                  <th scope="row" className="px-4 py-4 text-left font-medium">
                    Unattributed
                    <span className="mt-1 block text-xs font-normal">Activity or policies without an agent</span>
                    {u.inbound_calls > 0 && <span className="mt-1 block text-xs font-normal">{formatCount(u.inbound_calls)} inbound calls</span>}
                  </th>
                  <td className={numericCell}>{formatCount(u.policies_sold)}</td>
                  <td className={numericCell}><PremiumValue premium={u.premium} /></td>
                  <td className={numericCell}>{formatCount(u.calls_made)}</td>
                  <td className={numericCell}>—</td>
                  <td className={numericCell}>{formatCount(u.appointments_set)}</td>
                  <td className={numericCell}>{formatHours(u.talk_time_seconds)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </ReportSection>
  );
};

export default AgentPerformanceCards;
