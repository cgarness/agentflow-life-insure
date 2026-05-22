import React, { useMemo } from "react";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import OdometerValue from "@/components/leaderboard/OdometerValue";
import type { AgentStats, Metric, Period } from "@/components/leaderboard/leaderboardTypes";
import { formatPremiumSold } from "@/components/leaderboard/leaderboardTypes";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "Today", label: "Today" },
  { value: "This Week", label: "Week" },
  { value: "This Month", label: "Month" },
];

const METRIC_COLUMN: Partial<Record<Metric, "calls" | "policies" | "premium" | "appts">> = {
  "Calls Made": "calls",
  "Policies Sold": "policies",
  "Premium Sold": "premium",
  "Appointments Set": "appts",
  "Conversion Rate": "policies",
};

interface TVAgencyTotalsStripProps {
  agents: AgentStats[];
  period: Period;
  onPeriodChange: (period: Period) => void;
  highlightMetric: Metric;
}

const TVAgencyTotalsStrip: React.FC<TVAgencyTotalsStripProps> = ({
  agents,
  period,
  onPeriodChange,
  highlightMetric,
}) => {
  const totals = useMemo(
    () => ({
      calls: agents.reduce((sum, a) => sum + a.callsMade, 0),
      policies: agents.reduce((sum, a) => sum + a.policiesSold, 0),
      premium: agents.reduce((sum, a) => sum + a.premiumSold, 0),
      appts: agents.reduce((sum, a) => sum + a.appointmentsSet, 0),
    }),
    [agents],
  );

  const activeColumn = METRIC_COLUMN[highlightMetric];

  const cells: {
    key: "calls" | "policies" | "premium" | "appts";
    label: string;
    value: number;
    format: (n: number) => string;
    valueClass: string;
  }[] = [
    {
      key: "calls",
      label: "Calls",
      value: totals.calls,
      format: (n) => String(Math.round(n)),
      valueClass: "text-slate-100",
    },
    {
      key: "policies",
      label: "Policies",
      value: totals.policies,
      format: (n) => String(Math.round(n)),
      valueClass: "text-blue-300",
    },
    {
      key: "premium",
      label: "Premium",
      value: totals.premium,
      format: formatPremiumSold,
      valueClass: "text-amber-300",
    },
    {
      key: "appts",
      label: "Appts",
      value: totals.appts,
      format: (n) => String(Math.round(n)),
      valueClass: "text-emerald-300",
    },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 shadow-xl backdrop-blur-md sm:px-6 sm:py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-white">Agency Totals</h3>
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
            · {agents.length} agents
          </span>
        </div>
        <div
          className="inline-flex rounded-full border border-white/10 bg-black/30 p-0.5"
          role="tablist"
          aria-label="Agency totals period"
        >
          {PERIOD_OPTIONS.map((opt) => {
            const selected = period === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onPeriodChange(opt.value)}
                className={cn(
                  "rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors",
                  selected
                    ? "bg-blue-500/25 text-blue-200 shadow-inner ring-1 ring-blue-400/30"
                    : "text-slate-500 hover:text-slate-300",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:gap-4">
        {cells.map((cell) => {
          const highlighted = activeColumn === cell.key;
          return (
            <div
              key={cell.key}
              className={cn(
                "rounded-xl border px-2 py-2 text-center transition-colors sm:px-3 sm:py-2.5",
                highlighted
                  ? "border-blue-400/35 bg-blue-500/10 ring-1 ring-blue-400/20"
                  : "border-white/5 bg-white/[0.02]",
              )}
            >
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">{cell.label}</p>
              <OdometerValue
                value={cell.value}
                format={cell.format}
                tv
                className={cn("mt-1 block text-xl font-black tabular-nums sm:text-2xl", cell.valueClass)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TVAgencyTotalsStrip;
