import React from "react";
import { cn } from "@/lib/utils";
import type { StatCategory, StatState } from "@/lib/stat-computations";

interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  category?: StatCategory;
  state: StatState;
  smallValue?: boolean;
}

/** One cell of the grouped metric strip; unknown or failed metrics retain their reason. */
const StatCard: React.FC<StatCardProps> = ({ label, value, subtitle, category, state, smallValue }) => (
  <div className="flex h-full min-h-[104px] min-w-0 flex-col bg-card px-4 py-4"
    data-stat-state={state} data-stat-category={category} aria-busy={state === "loading"}>
    <p className="text-xs font-medium leading-snug text-muted-foreground [overflow-wrap:anywhere]">{label}</p>
    {state === "loading" ? (
      <div className="mt-2 h-7 w-16 animate-pulse rounded bg-muted" aria-label={`Loading ${label}`} />
    ) : (
      <p className={cn("mt-2 font-semibold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere]",
        smallValue ? "text-base" : "text-2xl", state === "ready" ? "text-foreground" : "text-muted-foreground")}>
        {value}
      </p>
    )}
    {subtitle && <p className={cn("mt-1.5 text-[11px] leading-snug [overflow-wrap:anywhere]",
      state === "error" ? "text-destructive" : "text-muted-foreground")}>{subtitle}</p>}
  </div>
);

export default StatCard;
