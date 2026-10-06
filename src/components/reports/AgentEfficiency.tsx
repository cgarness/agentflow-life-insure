import React, { useMemo } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { formatCount, formatHours, formatRate, ratio } from "@/lib/reports-format";
import type { CsvCell, ReportExportFn } from "@/lib/reports-export";
import { CURRENT_ASSIGNMENT_NOTE } from "@/lib/reports-policy-text";
import type { ReportSummary } from "@/lib/reports-schemas";
import { cn } from "@/lib/utils";
import ReportSection from "./ReportSection";

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
  /** Calls made per hour of server-timestamped session time, 1 decimal; null without session time. */
  callsPerHour: number | null;
  contactRate: number | null;
  talkSeconds: number;
  policiesSold: number;
}

interface Point {
  name: string;
  x: number;
  y: number;
}

const HEADERS = ["Agent", "Calls made", "Session time", "Calls per session hour", "Call contact rate", "Talk time", "Policies (current assignment)"];
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
const tick = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const axisLabel = { fill: "hsl(var(--muted-foreground))", fontSize: 10 };

const PointTooltip: React.FC<{ active?: boolean; payload?: Array<{ payload?: Point }> }> = ({ active, payload }) => {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-bold text-foreground mb-1">{p.name}</p>
      <p className="text-muted-foreground">Calls per session hour: {p.x.toFixed(1)}</p>
      <p className="text-muted-foreground">Call contact rate: {formatRate(p.y)}</p>
    </div>
  );
};

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
        callsPerHour: round1(ratio(a.session_matched_calls, a.session_seconds / 3600)),
        contactRate: a.contact_rate_pct,
        talkSeconds: a.talk_time_seconds,
        policiesSold: a.policies_sold,
      })),
    [summary],
  );

  const points = useMemo<Point[]>(
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
    <ReportSection title="Agent Efficiency" defaultOpen={false} onExport={handleExport}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No agents in this report.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border/60 mb-6">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr className="border-b border-border/60">
                  {HEADERS.map((h, i) => (
                    <th
                      key={h}
                      className={cn(
                        "py-3 px-3 text-muted-foreground font-bold uppercase tracking-wider text-[10px] whitespace-nowrap",
                        i === 0 ? "text-left" : "text-right",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {rows.map((r) => (
                  <tr key={r.id} className={cn("transition-colors", r.id === currentUserId ? "bg-primary/5" : "hover:bg-muted/40")}>
                    <td className="py-2.5 px-3 font-bold text-foreground whitespace-nowrap">
                      {r.name}
                      {r.id === currentUserId && <span className="ml-2 text-[10px] font-medium text-primary">You</span>}
                    </td>
                    <td className="py-2.5 px-3 text-right text-foreground tabular-nums">{formatCount(r.callsMade)}</td>
                    <td className="py-2.5 px-3 text-right text-foreground tabular-nums">{formatHours(r.sessionSeconds)}</td>
                    <td className="py-2.5 px-3 text-right text-foreground tabular-nums">
                      {r.callsPerHour === null ? "—" : r.callsPerHour.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-foreground tabular-nums">{formatRate(r.contactRate)}</td>
                    <td className="py-2.5 px-3 text-right text-foreground tabular-nums">{formatHours(r.talkSeconds)}</td>
                    <td className="py-2.5 px-3 text-right text-foreground tabular-nums">{formatCount(r.policiesSold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Calls per session hour vs call contact rate
          </h4>
          {points.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No agents with both session time and calls made in this period.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Calls per session hour"
                  tick={tick}
                  label={{ value: "Calls per session hour", position: "bottom", offset: 0, style: axisLabel }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Call contact rate"
                  unit="%"
                  domain={[0, 100]}
                  tick={tick}
                  label={{ value: "Call contact rate %", angle: -90, position: "insideLeft", style: axisLabel }}
                />
                <Tooltip cursor={{ strokeDasharray: "3 3", stroke: "hsl(var(--border))" }} content={<PointTooltip />} />
                <Scatter data={points} fill="hsl(var(--primary))" />
              </ScatterChart>
            </ResponsiveContainer>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Calls/hour uses matched agent and campaign sessions. Current assignments apply.</p>
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="w-fit cursor-pointer rounded py-1 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">How efficiency is calculated</summary>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Session hours count overlapping spans once and cap stale sessions at heartbeat. Calls/hour uses only calls inside same-agent/campaign intervals; unmatched calls remain in Calls Made. {CURRENT_ASSIGNMENT_NOTE}
            </p>
          </details>
        </>
      )}
    </ReportSection>
  );
};

export default AgentEfficiency;
