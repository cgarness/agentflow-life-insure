import React, { useMemo } from "react";
import { formatCount, formatElapsed, formatRate, ratio } from "@/lib/reports-format";
import type { CsvCell, ReportExportFn } from "@/lib/reports-export";
import type { ReportSummary } from "@/lib/reports-schemas";
import { cn } from "@/lib/utils";
import AgentEfficiencyScatter, { type EfficiencyPoint } from "./AgentEfficiencyScatter";
import ReportSection from "./ReportSection";
import ReportTableFrame from "./ReportTableFrame";
import { ROW_LABEL, TD, TD_FIRST, TH, TH_FIRST, TH_LABEL, TR } from "./reportTableStyles";

interface Props {
  summary: ReportSummary;
  currentUserId: string | null;
  onExport?: ReportExportFn;
}

interface Row {
  id: string;
  name: string;
  callsMade: number;
  sessionSeconds: number;
  /** The rate's numerator: calls inside same-agent/campaign session intervals (screen only). */
  sessionMatchedCalls: number;
  /** Calls made per hour of server-timestamped session time, 1 decimal; null without session time. */
  callsPerHour: number | null;
  contactRate: number | null;
  talkSeconds: number;
  policiesSold: number;
}

/** Screen columns. "Session-matched calls" explains the rate beside it; the CSV columns are unchanged. */
const HEADERS = [
  "Agent", "Calls made", "Session time", "Session-matched calls", "Calls per session hour", "Call contact rate", "Talk time",
  "Policies (current assignment)",
];
const EXPORT_HEADERS = [
  "Agent",
  "Calls made",
  "Session time (s)",
  "Calls per session hour",
  "Call contact rate %",
  "Talk time (s)",
  "Policies (current assignment)",
];

const round1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);

/**
 * Agent Efficiency — per-agent activity against server-timestamped dialer session time (sessions
 * clipped to the report window on the server). Undefined rates render "—", never 0.
 */
const AgentEfficiency: React.FC<Props> = ({ summary, currentUserId, onExport }) => {
  const rows = useMemo<Row[]>(
    () =>
      summary.by_agent.map((a) => ({
        id: a.agent_id,
        name: a.name,
        callsMade: a.calls_made,
        sessionSeconds: a.session_seconds,
        sessionMatchedCalls: a.session_matched_calls,
        callsPerHour: round1(ratio(a.session_matched_calls, a.session_seconds / 3600)),
        contactRate: a.contact_rate_pct,
        talkSeconds: a.talk_time_seconds,
        policiesSold: a.policies_sold,
      })),
    [summary],
  );

  const points = useMemo<EfficiencyPoint[]>(
    () =>
      rows.flatMap((r) =>
        r.callsPerHour !== null && r.contactRate !== null ? [{ name: r.name, x: r.callsPerHour, y: r.contactRate }] : [],
      ),
    [rows],
  );

  const handleExport = onExport
    ? () =>
        onExport(
          "Agent Efficiency",
          EXPORT_HEADERS,
          rows.map((r): CsvCell[] => [
            r.name,
            r.callsMade,
            r.sessionSeconds,
            r.callsPerHour,
            r.contactRate,
            r.talkSeconds,
            r.policiesSold,
          ]),
        )
    : undefined;

  return (
    <ReportSection title="Agent efficiency" defaultOpen={false} onExport={handleExport}>
      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No agents in this report.</p>
      ) : (
        <>
          <ReportTableFrame label="Agent efficiency table" tableClassName="min-w-[860px]"
            caption="Agent activity against dialer session time for the selected report.">
            <thead>
              <tr>
                {HEADERS.map((h, i) => (
                  <th key={h} scope="col" className={i === 0 ? TH_FIRST : TH}><span className={TH_LABEL}>{h}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const you = r.id === currentUserId;
                return (
                  <tr key={r.id} className={TR}>
                    <th scope="row" className={cn(TD_FIRST, you && "shadow-[inset_3px_0_0_hsl(var(--primary)),inset_-1px_0_0_hsl(var(--border))]")}>
                      <span className={ROW_LABEL}>
                        {r.name}
                        {you && " "}
                        {you && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground">You</span>}
                      </span>
                    </th>
                    <td className={TD}>{formatCount(r.callsMade)}</td>
                    <td className={TD}>{formatElapsed(r.sessionSeconds)}</td>
                    <td className={TD}>{formatCount(r.sessionMatchedCalls)}</td>
                    <td className={TD}>{r.callsPerHour === null ? "—" : r.callsPerHour.toFixed(1)}</td>
                    <td className={TD}>{formatRate(r.contactRate)}</td>
                    <td className={TD}>{formatElapsed(r.talkSeconds)}</td>
                    <td className={TD}>{formatCount(r.policiesSold)}</td>
                  </tr>
                );
              })}
            </tbody>
          </ReportTableFrame>
          <p className="mt-3 text-xs text-muted-foreground">Calls per session hour = session-matched calls ÷ session hours.</p>
          <AgentEfficiencyScatter points={points} />
        </>
      )}
    </ReportSection>
  );
};

export default AgentEfficiency;
