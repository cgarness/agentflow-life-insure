import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCount, formatRate } from "@/lib/reports-format";
import type { ReportExportFn } from "@/lib/reports-export";
import type { ReportDispositions } from "@/lib/reports-schemas";
import { cn } from "@/lib/utils";
import ReportSection from "./ReportSection";

type Tab = "agent" | "campaign";
type Mode = "count" | "pct";
const TABS: { key: Tab; label: string }[] = [
  { key: "agent", label: "By agent" },
  { key: "campaign", label: "By campaign" },
];
const MODES: { key: Mode; label: string }[] = [
  { key: "count", label: "Count" },
  { key: "pct", label: "% of row total" },
];
const TOP_N = 8;
const OTHER_COLOR = "hsl(var(--muted-foreground))";

interface Series {
  /** Synthetic chart key (disposition keys may contain dots, which recharts reads as paths). */
  id: string;
  name: string;
  color: string;
  /** Disposition key in the payload's `counts` map; null for the grouped "Other" series. */
  key: string | null;
}

type ChartRow = { name: string; total: number } & Record<string, number | string>;

interface Props {
  dispositions: ReportDispositions;
  onExport?: ReportExportFn;
}

const tick = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
};
const textStyle = { color: "hsl(var(--foreground))" };
const truncate = (s: string) => (s.length > 18 ? `${s.slice(0, 18)}…` : s);

function toggleClass(active: boolean) {
  return cn(
    "px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all",
    active ? "bg-card text-primary shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
  );
}

const DispositionDeepDive: React.FC<Props> = ({ dispositions, onExport }) => {
  const [tab, setTab] = useState<Tab>("agent");
  const [mode, setMode] = useState<Mode>("count");

  const series = useMemo<Series[]>(() => {
    // Server order is calls DESC, so the first N rows are the top N by calls.
    const all = dispositions.by_disposition;
    const top: Series[] = all.slice(0, TOP_N).map((d, i) => ({ id: `s${i}`, name: d.name, color: d.color, key: d.key }));
    if (all.length > TOP_N) top.push({ id: "other", name: "Other", color: OTHER_COLOR, key: null });
    return top;
  }, [dispositions]);

  const source = tab === "agent" ? dispositions.by_agent : dispositions.by_campaign;

  /** Per-row counts for each series; "Other" is the row total minus the top-N series. */
  const counted = useMemo(
    () =>
      source
        .filter((r) => r.total > 0)
        .map((r) => {
          // The server's counts map omits dispositions this row never used: a genuine zero.
          const counts = series.map((s) => (s.key !== null && s.key in r.counts ? r.counts[s.key] : 0));
          const other = series.findIndex((s) => s.key === null);
          if (other >= 0) counts[other] = Math.max(0, r.total - counts.reduce((a, b) => a + b, 0));
          return { name: r.name, total: r.total, counts };
        }),
    [source, series],
  );

  const chartData = useMemo<ChartRow[]>(
    () =>
      counted.map((r) => {
        const row: ChartRow = { name: r.name, total: r.total };
        series.forEach((s, i) => {
          row[`raw_${s.id}`] = r.counts[i];
          // Rows with total 0 were filtered out above, so the share is always defined here.
          row[s.id] = mode === "count" ? r.counts[i] : (r.counts[i] / r.total) * 100;
        });
        return row;
      }),
    [counted, series, mode],
  );

  const handleExport = onExport
    ? () =>
        onExport(
          tab === "agent" ? "Disposition Deep Dive - By agent" : "Disposition Deep Dive - By campaign",
          ["Name", ...series.map((s) => s.name), "Total"],
          counted.map((r) => [r.name, ...r.counts, r.total]),
        )
    : undefined;

  return (
    <ReportSection title="Disposition Deep Dive" defaultOpen={false} onExport={handleExport}>
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-xl w-fit">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={toggleClass(t.key === tab)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-xl w-fit">
          {MODES.map((m) => (
            <button key={m.key} type="button" onClick={() => setMode(m.key)} className={toggleClass(m.key === mode)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {chartData.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No dispositioned calls in this period.</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={Math.max(240, chartData.length * 40 + 60)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis
                type="number"
                tick={tick}
                allowDecimals={false}
                domain={mode === "pct" ? [0, 100] : [0, "auto"]}
                // Float shares can stack to 100.00000000000001, which would stretch the axis to 120%.
                allowDataOverflow={mode === "pct"}
                tickFormatter={(v: number) => (mode === "pct" ? `${v}%` : formatCount(v))}
              />
              <YAxis type="category" dataKey="name" width={130} tick={tick} tickFormatter={truncate} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={textStyle}
                itemStyle={textStyle}
                cursor={{ fill: "hsl(var(--muted))" }}
                formatter={(v: number, name: string, item: { dataKey?: string | number; payload?: ChartRow }) => {
                  const raw = item.payload?.[`raw_${String(item.dataKey)}`];
                  const suffix = typeof raw === "number" ? ` (${formatCount(raw)})` : "";
                  return [mode === "pct" ? `${formatRate(v)}${suffix}` : formatCount(v), name];
                }}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                formatter={(value: string) => <span className="text-[11px] text-muted-foreground">{value}</span>}
              />
              {series.map((s) => (
                <Bar key={s.id} dataKey={s.id} name={s.name} stackId="d" fill={s.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-muted-foreground mt-3">
            Outbound calls{tab === "campaign" ? " with a campaign" : " with an assigned agent"}.
            {series.some((s) => s.key === null) ? ` Top ${TOP_N} dispositions by calls; the rest are grouped as Other.` : ""}
          </p>
        </>
      )}
    </ReportSection>
  );
};

export default DispositionDeepDive;
