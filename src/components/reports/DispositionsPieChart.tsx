import React, { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatCount, formatRate, ratio } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import type { ReportDispositions } from "@/lib/reports-schemas";
import ReportSection from "./ReportSection";

const TOP_N = 8;
const OTHER_COLOR = "hsl(var(--muted-foreground))";

type DispositionRow = ReportDispositions["by_disposition"][number];
type FlagField = "counts_as_contacted" | "converts" | "dnc" | "callback" | "appointment";

const FLAGS: { field: FlagField; label: string }[] = [
  { field: "counts_as_contacted", label: "Contacted" },
  { field: "converts", label: "Converts" },
  { field: "dnc", label: "DNC" },
  { field: "callback", label: "Callback" },
  { field: "appointment", label: "Appointment" },
];

interface Slice {
  key: string;
  name: string;
  color: string;
  calls: number;
  /** Share of total outbound calls as a percentage; null when there are no calls. */
  share: number | null;
  flags: string[];
  /** For the "Other" slice: how many dispositions it groups. */
  grouped?: number;
}

interface Props {
  dispositions: ReportDispositions;
  onExport?: ReportExportFn;
}

const pct = (part: number, whole: number): number | null => {
  const r = ratio(part, whole);
  return r === null ? null : r * 100;
};

const flagsOf = (d: DispositionRow): string[] => FLAGS.filter((f) => d[f.field]).map((f) => f.label);
const yesNo = (v: boolean) => (v ? "Yes" : "No");

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
};
const textStyle = { color: "hsl(var(--foreground))" };

const DispositionsPieChart: React.FC<Props> = ({ dispositions, onExport }) => {
  const total = dispositions.total_calls;

  const slices = useMemo<Slice[]>(() => {
    // Server order is calls DESC, so the first N rows are the top N by calls.
    const rows = dispositions.by_disposition.filter((d) => d.calls > 0);
    const top: Slice[] = rows.slice(0, TOP_N).map((d) => ({
      key: d.key,
      name: d.name,
      color: d.color,
      calls: d.calls,
      share: pct(d.calls, total),
      flags: flagsOf(d),
    }));
    const rest = rows.slice(TOP_N);
    if (rest.length > 0) {
      const calls = rest.reduce((s, d) => s + d.calls, 0);
      top.push({ key: "__other__", name: "Other", color: OTHER_COLOR, calls, share: pct(calls, total), flags: [], grouped: rest.length });
    }
    return top;
  }, [dispositions, total]);

  const handleExport = onExport
    ? () =>
        onExport(
          "Disposition Breakdown",
          ["Disposition", "Calls", "Share %", "Counts as contacted", "Converts", "DNC", "Callback", "Appointment"],
          dispositions.by_disposition.map((d) => {
            const share = pct(d.calls, total);
            return [
              d.name,
              d.calls,
              share === null ? null : Math.round(share * 10) / 10,
              yesNo(d.counts_as_contacted),
              yesNo(d.converts),
              yesNo(d.dnc),
              yesNo(d.callback),
              yesNo(d.appointment),
            ];
          }),
        )
    : undefined;

  return (
    <ReportSection title="Disposition Breakdown" onExport={handleExport}>
      {total === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No outbound calls in this period.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <div className="relative">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={slices} cx="50%" cy="50%" innerRadius={62} outerRadius={96} dataKey="calls" nameKey="name" paddingAngle={2} stroke="hsl(var(--card))">
                  {slices.map((s) => (
                    <Cell key={s.key} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={textStyle}
                  itemStyle={textStyle}
                  formatter={(v: number, name: string, item: { payload?: Slice }) => [
                    `${formatCount(v)} calls · ${formatRate(item.payload?.share)}`,
                    name,
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-2xl font-black text-foreground tracking-tight">{formatCount(total)}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">outbound calls</p>
              </div>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">
              {slices.some((s) => s.grouped) ? `Top ${TOP_N} dispositions by calls` : "Dispositions by calls"}
            </p>
            <ul className="divide-y divide-border/60">
              {slices.map((s) => (
                <li key={s.key} className="flex items-center gap-3 py-2">
                  {/* Swatch colour is the disposition's configured colour (data-driven). */}
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{s.name}</p>
                    {(s.flags.length > 0 || s.grouped) && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.grouped ? (
                          <span className="text-[10px] text-muted-foreground">{s.grouped} more dispositions</span>
                        ) : (
                          s.flags.map((f) => (
                            <span
                              key={f}
                              className="text-[9px] font-black uppercase tracking-wider bg-muted text-muted-foreground px-1.5 py-0.5 rounded"
                            >
                              {f}
                            </span>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-foreground tabular-nums">{formatCount(s.calls)}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">{formatRate(s.share)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {total > 0 && <p className="text-[11px] text-muted-foreground mt-3">Outbound calls by disposition; share is of all outbound calls in this period.</p>}
    </ReportSection>
  );
};

export default DispositionsPieChart;
