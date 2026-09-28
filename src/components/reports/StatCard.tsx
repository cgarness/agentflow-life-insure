import React from "react";
import { cn } from "@/lib/utils";
import type { StatCategory, StatState } from "@/lib/stat-computations";

/** Static Tailwind classes for the category accent (colors match STAT_CATEGORIES). */
const ACCENT: Record<StatCategory, string> = {
  activity: "border-l-[#378ADD]",
  results: "border-l-[#639922]",
  pipeline: "border-l-[#1D9E75]",
  team: "border-l-[#BA7517]",
};

interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  category?: StatCategory;
  state: StatState;
  smallValue?: boolean;
}

/**
 * One stat tile. `error` and `unavailable` never show a number: an unknown value is "—" with its
 * reason, so a failed or undefined metric can never read as a real zero.
 */
const StatCard: React.FC<StatCardProps> = ({ label, value, subtitle, category, state, smallValue }) => {
  const muted = state !== "ready";
  const accent = state === "unavailable" || !category ? "border-l-border" : ACCENT[category];

  return (
    <div
      className={cn(
        "group relative bg-card border border-border/50 border-l-[3px] flex flex-col justify-between transition-all min-h-[80px] px-3 py-2.5",
        accent,
        state === "unavailable" && "opacity-60",
      )}
      data-stat-state={state}
    >
      <div>
        <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.4px] mb-1 truncate">{label}</p>
        {state === "loading" ? (
          <div className="h-6 w-16 rounded bg-muted animate-pulse" aria-busy="true" />
        ) : (
          <p
            className={cn(
              "font-medium tracking-tight leading-tight truncate",
              smallValue ? "text-base" : "text-xl",
              muted ? "text-muted-foreground" : "text-foreground",
            )}
            title={value}
          >
            {value}
          </p>
        )}
      </div>
      {subtitle && (
        <p className={cn("text-[11px] truncate mt-1", state === "error" ? "text-amber-500" : "text-muted-foreground")} title={subtitle}>
          {subtitle}
        </p>
      )}
    </div>
  );
};

export default StatCard;
