import React, { useMemo } from "react";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import OdometerValue from "@/components/leaderboard/OdometerValue";
import type { AgentStats, Period } from "@/components/leaderboard/leaderboardTypes";
import { ANNUAL_PREMIUM_LABEL, formatCount, formatPremiumSold } from "@/components/leaderboard/leaderboardTypes";
import { isPremiumWhollyUnknown } from "@/lib/premiumAvailability";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "Today", label: "Today" },
  { value: "This Week", label: "Week" },
  { value: "This Month", label: "Month" },
];

interface TVAgencyTotalsStripProps {
  agents: AgentStats[];
  period: Period;
  onPeriodChange: (period: Period) => void;
}

/** Roster totals: Annual Premium (the ranking metric, always highlighted), then Policies. */
const TVAgencyTotalsStrip: React.FC<TVAgencyTotalsStripProps> = ({
  agents,
  period,
  onPeriodChange,
}) => {
  const totals = useMemo(
    () => ({
      policies: agents.reduce((sum, a) => sum + a.policiesSold, 0),
      premium: agents.reduce((sum, a) => sum + a.premiumSold, 0),
      unknownPremiums: agents.reduce((sum, a) => sum + (a.unknownPremiums ?? 0), 0),
    }),
    [agents],
  );

  const cells: {
    key: "premium" | "policies";
    label: string;
    value: number | null;
    format: (n: number) => string;
    valueClass: string;
  }[] = [
    {
      key: "premium",
      label: ANNUAL_PREMIUM_LABEL,
      // The roster sold policies but every premium is unknown: "—", never $0 (D14).
      value: isPremiumWhollyUnknown(totals.policies, totals.unknownPremiums) ? null : totals.premium,
      format: formatPremiumSold,
      valueClass: "text-amber-300",
    },
    {
      key: "policies",
      label: "Policies",
      value: totals.policies,
      format: formatCount,
      valueClass: "text-blue-300",
    },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 shadow-xl backdrop-blur-md sm:px-6 sm:py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-white">Active-Agent Totals</h3>
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

      <div className="grid grid-cols-2 gap-2 sm:gap-4">
        {cells.map((cell) => {
          const highlighted = cell.key === "premium";
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
