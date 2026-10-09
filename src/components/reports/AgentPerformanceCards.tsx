import React from "react";
import { formatCount, formatElapsed, formatRate, formatPremium } from "@/lib/reports-format";
import type { CsvCell, ReportExportFn } from "@/lib/reports-export";
import type { ReportPremium, ReportSummary } from "@/lib/reports-schemas";
import { cn } from "@/lib/utils";
import ReportSection from "./ReportSection";
import ReportTableFrame from "./ReportTableFrame";
import { ROW_LABEL, TD, TD_FIRST, TD_SUB, TF, TF_FIRST, TH, TH_FIRST, TH_LABEL, TR } from "./reportTableStyles";

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
/** Screen columns: production first, then activity. "Contacted calls" is on screen as well as in the CSV. */
const HEADERS = [
  "Agent", "Policies (current assignment)", "Known annual premium", "Calls made", "Contacted calls",
  "Call contact rate", "Bookings created (all types)", "Talk time",
];

/** The drilldown name: text-sized, with a 40px hit area that reaches into the cell padding. */
const NAME_BUTTON = "relative rounded-sm text-left text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-x-0 after:-inset-y-2.5";

const PremiumValue = ({ premium }: { premium: ReportPremium }) => (
  <>
    <span className="font-medium">{formatPremium(premium.annual_premium)}</span>
    <span className={TD_SUB}>
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
    <ReportSection title="Agent performance" onExport={handleExport}>
      {agents.length === 0 && !hasUnattributed ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No agents in this report.</p>
      ) : (
        <ReportTableFrame label="Agent performance table" tableClassName="min-w-[820px]"
          caption="Agent production and activity for the selected report. Select an available agent name to filter.">
          <thead>
            <tr>
              {HEADERS.map((label, i) => (
                <th key={label} scope="col" className={i === 0 ? TH_FIRST : TH}><span className={TH_LABEL}>{label}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => {
              const selectable = selectableAgentIds.has(a.agent_id);
              const selected = selectedAgentId === a.agent_id;
              return (
                <tr key={a.agent_id} className={TR}>
                  <th scope="row" className={cn(TD_FIRST, selected && "shadow-[inset_3px_0_0_hsl(var(--primary)),inset_-1px_0_0_hsl(var(--border))]")}>
                    <span className={ROW_LABEL}>
                      {selectable ? (
                        <button type="button" aria-pressed={selected}
                          aria-label={(selected ? "Clear agent filter for " : "Filter reports to ") + a.name}
                          onClick={() => onSelectAgent(selected ? null : a.agent_id)}
                          className={NAME_BUTTON}>
                          <span className="break-words">{a.name}</span>
                        </button>
                      ) : <span className="break-words">{a.name}</span>}
                      {a.status && a.status !== "Active" && <span className={TD_SUB}>{a.status}</span>}
                      {selected && <span className={cn(TD_SUB, "font-medium text-foreground")}>Selected</span>}
                    </span>
                  </th>
                  <td className={TD}>{formatCount(a.policies_sold)}</td>
                  <td className={TD}><PremiumValue premium={a.premium} /></td>
                  <td className={TD}>{formatCount(a.calls_made)}</td>
                  <td className={TD}>{formatCount(a.contacted)}</td>
                  <td className={TD}>{formatRate(a.contact_rate_pct)}</td>
                  <td className={TD}>{formatCount(a.appointments_set)}</td>
                  <td className={TD}>{formatElapsed(a.talk_time_seconds)}</td>
                </tr>
              );
            })}
          </tbody>
          {hasUnattributed && (
            <tfoot>
              {/* One cell per column; contacted calls and the rate are not measured for unattributed activity. */}
              <tr>
                <th scope="row" className={TF_FIRST}>
                  <span className={ROW_LABEL}>
                    Unattributed
                    <span className={TD_SUB}>Activity or policies without an agent</span>
                    {u.inbound_calls > 0 && <span className={TD_SUB}>{formatCount(u.inbound_calls)} inbound calls</span>}
                  </span>
                </th>
                <td className={TF}>{formatCount(u.policies_sold)}</td>
                <td className={TF}><PremiumValue premium={u.premium} /></td>
                <td className={TF}>{formatCount(u.calls_made)}</td>
                <td className={TF} />
                <td className={TF} />
                <td className={TF}>{formatCount(u.appointments_set)}</td>
                <td className={TF}>{formatElapsed(u.talk_time_seconds)}</td>
              </tr>
            </tfoot>
          )}
        </ReportTableFrame>
      )}
    </ReportSection>
  );
};

export default AgentPerformanceCards;
