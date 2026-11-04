import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { kpi } from "@/lib/reports-kpi-registry";
import { tileView } from "@/lib/reports-kpi-format";
import { formatCount, formatPremium } from "@/lib/reports-format";
import type { Panels } from "@/lib/reports-panels";
import type { KpiEnvelope } from "@/lib/reports-v3-schemas";
import { CHIP_IN_PROGRESS, CHIP_PARTIAL, NOT_LOADED } from "@/lib/reports-v3-text";
import ReportSection from "./ReportSection";
import ReportTableFrame from "./ReportTableFrame";
import { AGENT_COLUMNS } from "./agentPerformanceColumns";
import { TD, TD_FIRST, TF, TF_FIRST, TH, TH_FIRST, TH_LABEL, TR } from "./reportTableStyles";

interface Props { panels: Panels; viewerId: string | null; agencyScope: boolean }

function Cell({ id, env }: { id: number; env: KpiEnvelope | null }) {
  if (!env) return <span className="text-muted-foreground" title={NOT_LOADED}>—<span className="sr-only"> {NOT_LOADED}</span></span>;
  const v = tileView(kpi(id), env);
  return (
    <span className="inline-flex flex-col items-end">
      <span aria-hidden="true">{v.text}</span><span className="sr-only">{v.srText}</span>
      {(v.cue || v.chips.length > 0) && (
        <span className="text-[11px] text-muted-foreground" aria-hidden="true">
          {[v.cue, ...v.chips.map(c => (c === "partial" ? CHIP_PARTIAL : CHIP_IN_PROGRESS))].filter(Boolean).join(" · ")}
        </span>
      )}
    </span>
  );
}

/** Section 4: combined agent performance (Team/Agency). Joined on agent_id; server order; no total row from rows. */
const AgentPerformanceCards: React.FC<Props> = ({ panels, viewerId, agencyScope }) => {
  const rows = useMemo(() => {
    if (panels.summary.status !== "ready") return [];
    const index = (p: Panels["journey"] | Panels["salesAppointments"]) =>
      new Map(p.status === "ready" ? p.data.by_agent.map(r => [r.agent_id, r.metrics]) : []);
    const journey = index(panels.journey), appts = index(panels.salesAppointments);
    return panels.summary.data.by_agent.map(r => ({
      id: r.agent_id, name: r.name,
      cells: AGENT_COLUMNS.map(c => {
        const ms = c.panel === "summary" ? r.metrics : c.panel === "journey" ? journey.get(r.agent_id) : appts.get(r.agent_id);
        return ms?.find(m => m.id === c.id) ?? null;
      }),
    }));
  }, [panels.summary, panels.journey, panels.salesAppointments]);
  const top = panels.summary.status === "ready" ? panels.summary.data.metrics : [];
  const unattributedPolicies = (top.find(m => m.id === 2)?.detail as { quality?: { unattributed_policies?: number | null } } | null)?.quality?.unattributed_policies ?? null;
  const unattributedAp = (top.find(m => m.id === 1)?.detail as { unattributed_annual_premium?: number | null } | null)?.unattributed_annual_premium ?? null;
  return (
    <ReportSection title="Agent performance">
      <ReportTableFrame label="Agent performance table" tableClassName="min-w-[56rem]">
          <thead>
            <tr>
              <th scope="col" className={TH_FIRST}>Agent</th>
              {AGENT_COLUMNS.map(c => <th key={c.id} scope="col" className={TH}><span className={TH_LABEL}>{kpi(c.id).label}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className={cn(TR, r.id === viewerId && "bg-primary/5")}>
                <th scope="row" className={cn(TD_FIRST, "whitespace-nowrap", r.id === viewerId && "bg-primary/5")}>
                  {r.name}{r.id === viewerId && <span className="ml-2 text-xs text-muted-foreground">You</span>}
                </th>
                {r.cells.map((env, i) => <td key={AGENT_COLUMNS[i].id} className={TD}><Cell id={AGENT_COLUMNS[i].id} env={env} /></td>)}
              </tr>
            ))}
          </tbody>
          {agencyScope && unattributedPolicies !== null && unattributedPolicies > 0 && (
            <tfoot>
              <tr>
                <th scope="row" className={TF_FIRST}>Unattributed</th>
                <td className={TF}>{formatCount(unattributedPolicies)}</td>
                <td className={TF}>{unattributedAp === null ? "—" : formatPremium(unattributedAp)}</td>
                {AGENT_COLUMNS.slice(2).map(c => <td key={c.id} className={TF} />)}
              </tr>
            </tfoot>
          )}
      </ReportTableFrame>
    </ReportSection>
  );
};

export default AgentPerformanceCards;
