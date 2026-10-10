import React, { useMemo } from "react";
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

interface Share {
  key: string;
  name: string;
  color: string;
  calls: number;
  /** Share of total outbound calls as a percentage; null when there are no calls. */
  share: number | null;
  /** The disposition's flags ("Contacted · Converts"), or for Other how many dispositions it groups. */
  note: string;
  grouped: boolean;
}

interface Props {
  dispositions: ReportDispositions;
  onExport?: ReportExportFn;
}

const pct = (part: number, whole: number): number | null => {
  const r = ratio(part, whole);
  return r === null ? null : r * 100;
};

const flagsOf = (d: DispositionRow): string => FLAGS.filter((f) => d[f.field]).map((f) => f.label).join(" · ");
const yesNo = (v: boolean) => (v ? "Yes" : "No");
const callsLabel = (n: number) => `${formatCount(n)} outbound ${n === 1 ? "call" : "calls"}`;

/**
 * Disposition breakdown (registry id conversion_funnel) — a ranked share list, not a donut: each row names
 * its disposition in text, so identity never rests on colour (U-2). The configured colour is only a small
 * recognition swatch; the share bar is the one accent. Shares are of all outbound calls in the period (the
 * rule is in Data basis), so the rows plus Other add up to the header total.
 */
const DispositionsPieChart: React.FC<Props> = ({ dispositions, onExport }) => {
  const total = dispositions.total_calls;

  const rows = useMemo<Share[]>(() => {
    // Server order is calls DESC, so the first N rows are the top N by calls.
    const used = dispositions.by_disposition.filter((d) => d.calls > 0);
    const top: Share[] = used.slice(0, TOP_N).map((d) => ({
      key: d.key,
      name: d.name,
      color: d.color,
      calls: d.calls,
      share: pct(d.calls, total),
      note: flagsOf(d),
      grouped: false,
    }));
    const rest = used.slice(TOP_N);
    if (rest.length > 0) {
      const calls = rest.reduce((s, d) => s + d.calls, 0);
      const note = `${formatCount(rest.length)} more ${rest.length === 1 ? "disposition" : "dispositions"}`;
      top.push({ key: "__other__", name: "Other", color: OTHER_COLOR, calls, share: pct(calls, total), note, grouped: true });
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

  const grouped = rows.some((r) => r.grouped);

  return (
    <ReportSection title="Disposition breakdown" onExport={handleExport} meta={total > 0 ? callsLabel(total) : undefined}>
      {total === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No outbound calls in this period.</p>
      ) : (
        <>
          {grouped && <p className="mb-1 text-xs font-medium text-muted-foreground">Top {TOP_N} by calls</p>}
          <ol aria-label="Dispositions by share of outbound calls" className="divide-y divide-border/50">
            {rows.map((r) => (
              <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto_3.5rem] items-center gap-x-3 py-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-start gap-2">
                    {/* The configured disposition colour (data-driven) is a recognition swatch only. */}
                    <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full ring-1 ring-border" style={{ backgroundColor: r.color }} />
                    <span className="min-w-0 break-words text-sm font-medium leading-5 text-foreground">
                      {r.name}
                      {r.note && <> <span className="ml-1 text-[11px] font-normal text-muted-foreground">{r.note}</span></>}
                    </span>
                  </div>
                  <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    {/* Bar width is the row's share of outbound calls (data-driven). */}
                    <div className="h-full rounded-full bg-primary" style={{ width: `${r.share ?? 0}%` }} />
                  </div>
                </div>
                <span className="text-right text-sm font-medium tabular-nums text-foreground">
                  {formatCount(r.calls)}<span className="sr-only"> {r.calls === 1 ? "call" : "calls"}</span>
                </span>
                <span className="text-right text-xs tabular-nums text-muted-foreground">
                  {formatRate(r.share)}<span className="sr-only"> of outbound calls</span>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </ReportSection>
  );
};

export default DispositionsPieChart;
