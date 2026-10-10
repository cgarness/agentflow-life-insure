import React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatCategory, StatResult, StatState } from "@/lib/stat-computations";

interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  category?: StatCategory;
  state: StatState;
  smallValue?: boolean;
  noteTone?: StatResult["noteTone"];
}

/**
 * One compact tile of the metric strip. An error or unavailable reason reads as foreground text beside a
 * destructive icon (destructive text fails contrast on the dark card); a data-quality note carries a caution dot.
 */
const StatCard: React.FC<StatCardProps> = ({ label, value, subtitle, category, state, smallValue, noteTone }) => {
  const problem = state === "error" || state === "unavailable";
  return (
    <div className="flex h-full min-h-[60px] min-w-0 flex-col px-3 py-2 md:min-h-[84px] md:px-4 md:py-3"
      data-stat-state={state} data-stat-category={category} aria-busy={state === "loading"}>
      <p className="text-xs font-medium leading-4 text-muted-foreground [overflow-wrap:anywhere]">{label}</p>
      {state === "loading" ? (
        <div className="mt-1 h-7 w-16 animate-pulse rounded bg-muted" aria-label={`Loading ${label}`} />
      ) : (
        <p className={cn("mt-1 font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]",
          smallValue ? "text-base leading-6 md:leading-7" : "text-xl leading-6 md:text-2xl md:leading-7", state === "ready" ? "text-foreground" : "text-muted-foreground")}>
          {value}
        </p>
      )}
      {subtitle && (
        <p className={cn("mt-0.5 flex items-start gap-1.5 text-[11px] leading-4 [overflow-wrap:anywhere]", problem ? "text-foreground" : "text-muted-foreground")}
          data-note-tone={problem ? "problem" : noteTone}>
          {problem && <AlertTriangle aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />}
          {!problem && noteTone === "caution" && <span aria-hidden="true" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
          <span className="min-w-0">{subtitle}</span>
        </p>
      )}
    </div>
  );
};

export default StatCard;
