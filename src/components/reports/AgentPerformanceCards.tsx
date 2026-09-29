import React from "react";
import { formatCount, formatHours, formatRate } from "@/lib/reports-format";
import type { CsvCell, ReportExportFn } from "@/lib/reports-export";
import type { ReportAgentRow, ReportSummary } from "@/lib/reports-schemas";
import { cn } from "@/lib/utils";
import ReportSection from "./ReportSection";

interface Props {
  summary: ReportSummary;
  selectedAgentId: string | null;
  /** Agents the viewer may filter to; any other card is not clickable. */
  selectableAgentIds: ReadonlySet<string>;
  onSelectAgent: (id: string | null) => void;
  onExport?: ReportExportFn;
}

const EXPORT_HEADERS = [
  "Agent",
  "Status",
  "Calls made",
  "Contacted",
  "Call contact rate %",
  "Talk time (s)",
  "Policies sold",
  "Converted",
  "Appointments",
  "Session time (s)",
];

const statusSuffix = (status: string | null) => (status && status !== "Active" ? ` (${status.toLowerCase()})` : "");

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider truncate">{label}</p>
    <p className="text-base font-black text-foreground leading-none mt-1 tabular-nums">{value}</p>
  </div>
);

const AgentStats: React.FC<{ a: ReportAgentRow }> = ({ a }) => (
  <div className="grid grid-cols-3 gap-x-3 gap-y-3">
    <Stat label="Calls made" value={formatCount(a.calls_made)} />
    <Stat label="Contacted" value={formatCount(a.contacted)} />
    <Stat label="Call contact rate" value={formatRate(a.contact_rate_pct)} />
    <Stat label="Policies sold" value={formatCount(a.policies_sold)} />
    <Stat label="Converted" value={formatCount(a.converted)} />
  </div>
);

/**
 * Agent Performance — one card per agent in the secured summary, in server order. A card toggles the
 * agent filter only when the viewer may filter to that agent. Converted (unique contacts) and
 * Policies sold (wins) are separate counts; there is no conversion rate and no goal bar.
 */
const AgentPerformanceCards: React.FC<Props> = ({
  summary,
  selectedAgentId,
  selectableAgentIds,
  onSelectAgent,
  onExport,
}) => {
  const agents = summary.by_agent;
  const u = summary.unattributed;
  const hasUnattributed = Object.values(u).some((n) => n > 0);

  const handleExport = onExport
    ? () => {
        const rows: CsvCell[][] = agents.map((a) => [
          a.name,
          a.status,
          a.calls_made,
          a.contacted,
          a.contact_rate_pct,
          a.talk_time_seconds,
          a.policies_sold,
          a.converted,
          a.appointments_set,
          a.session_seconds,
        ]);
        if (hasUnattributed) {
          rows.push(["Unattributed", null, u.calls_made, null, null, u.talk_time_seconds, u.policies_sold, null, u.appointments_set, null]);
        }
        onExport("Agent Performance", EXPORT_HEADERS, rows);
      }
    : undefined;

  return (
    <ReportSection title="Agent Performance" onExport={handleExport}>
      {agents.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">No agents in this report.</p>
      )}
      {(agents.length > 0 || hasUnattributed) && (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {agents.map((a) => {
            const selectable = selectableAgentIds.has(a.agent_id);
            const selected = selectedAgentId === a.agent_id;
            const cardClass = cn(
              "shrink-0 w-60 rounded-2xl border p-4 text-left transition-all duration-200",
              selected ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20" : "bg-card border-border/60",
              selectable && !selected && "group hover:border-primary/40 hover:shadow-md",
            );
            const header = (
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0 transition-transform group-hover:scale-105">
                  {initials(a.name)}
                </div>
                <p className="text-sm font-bold text-foreground truncate min-w-0" title={a.name + statusSuffix(a.status)}>
                  {a.name}
                  {a.status && a.status !== "Active" && (
                    <span className="font-medium text-muted-foreground">{statusSuffix(a.status)}</span>
                  )}
                </p>
              </div>
            );
            return selectable ? (
              <button
                key={a.agent_id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelectAgent(selected ? null : a.agent_id)}
                className={cardClass}
              >
                {header}
                <AgentStats a={a} />
              </button>
            ) : (
              <div key={a.agent_id} className={cardClass}>
                {header}
                <AgentStats a={a} />
              </div>
            );
          })}
          {hasUnattributed && (
            <div className="shrink-0 w-60 rounded-2xl border border-dashed border-border/60 bg-muted/30 p-4">
              <div className="mb-4">
                <p className="text-sm font-bold text-muted-foreground">Unattributed</p>
                <p className="text-[11px] text-muted-foreground">Activity not linked to an agent</p>
              </div>
              <div className="grid grid-cols-3 gap-x-3 gap-y-3">
                <Stat label="Calls made" value={formatCount(u.calls_made)} />
                <Stat label="Inbound" value={formatCount(u.inbound_calls)} />
                <Stat label="Policies sold" value={formatCount(u.policies_sold)} />
                <Stat label="Appointments" value={formatCount(u.appointments_set)} />
                <Stat label="Talk time" value={formatHours(u.talk_time_seconds)} />
              </div>
            </div>
          )}
        </div>
      )}
      {agents.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          Converted counts unique contacts converted; Policies sold counts policies won. One client can buy more than
          one policy.
        </p>
      )}
    </ReportSection>
  );
};

export default AgentPerformanceCards;
