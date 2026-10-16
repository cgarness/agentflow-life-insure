import React from "react";
import { AlertTriangle, Calculator, Info } from "lucide-react";
import type { CalculatorResult } from "@/lib/commission/calculator";
import { formatRatePercent, formatUsd } from "@/lib/commission/money";
import { cn } from "@/lib/utils";

interface CalculatorResultsProps {
  /** null while the inputs are incomplete or invalid: nothing stale is ever shown. */
  result: CalculatorResult | null;
}

const Tile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg bg-muted/40 px-3 py-2.5 ring-1 ring-inset ring-border/50">
    <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</dd>
  </div>
);

/** The estimate card: always the same frame, so the column does not jump between states. */
const Frame: React.FC<{ active: boolean; children: React.ReactNode }> = ({ active, children }) => (
  <section
    className={cn(
      "overflow-hidden rounded-xl border bg-card shadow-sm transition-colors",
      active ? "border-primary/30 shadow-primary/5" : "border-border/60",
    )}
  >
    <div className={cn("h-0.5", active ? "bg-primary" : "bg-border/60")} aria-hidden />
    <div className="p-5">{children}</div>
  </section>
);

const CalculatorResults: React.FC<CalculatorResultsProps> = ({ result }) => {
  if (!result) {
    return (
      <Frame active={false}>
        <div className="flex flex-col items-center gap-3 px-2 py-8 text-center">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-inset ring-border/60" aria-hidden>
            <Calculator className="h-5 w-5" />
          </span>
          <p className="max-w-[16rem] text-sm text-muted-foreground">
            Choose a product and enter the client&apos;s age and monthly premium to see the estimate.
          </p>
        </div>
      </Frame>
    );
  }
  if (result.kind !== "estimate") {
    const Icon = result.kind === "configuration_error" ? AlertTriangle : Info;
    return (
      <Frame active={false}>
        <div role="status" className="flex items-start gap-2.5 rounded-lg bg-muted/50 px-4 py-3 text-sm text-foreground ring-1 ring-inset ring-border/60">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{result.message}</span>
        </div>
      </Frame>
    );
  }
  const { estimate } = result;
  const month = formatUsd(estimate.monthlyRemainder);
  return (
    <Frame active>
      <dl aria-label="Estimate" className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-xs font-medium text-muted-foreground">Rate used</dt>
          <dd className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary ring-1 ring-inset ring-primary/20">
            {formatRatePercent(estimate.ratePercent)}
          </dd>
        </div>
        <div className="rounded-lg bg-primary/[0.06] px-4 py-4 ring-1 ring-inset ring-primary/15">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-primary/90">Total first-year commission</dt>
          <dd className="mt-1 break-words text-4xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatUsd(estimate.firstYearCommission)}
          </dd>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Tile label="Advance (75%)" value={formatUsd(estimate.advance)} />
          <Tile label="Month 10" value={month} />
          <Tile label="Month 11" value={month} />
          <Tile label="Month 12" value={month} />
        </div>
      </dl>
    </Frame>
  );
};

export default CalculatorResults;
