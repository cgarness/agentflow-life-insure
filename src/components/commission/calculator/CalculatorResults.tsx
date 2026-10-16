import React from "react";
import { AlertTriangle, Info } from "lucide-react";
import type { CalculatorResult } from "@/lib/commission/calculator";
import { formatRatePercent, formatUsd } from "@/lib/commission/money";

interface CalculatorResultsProps {
  /** null while the inputs are incomplete or invalid: nothing stale is ever shown. */
  result: CalculatorResult | null;
}

const Row: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-baseline justify-between gap-4 py-2">
    <dt className="text-sm text-muted-foreground">{label}</dt>
    <dd className={`tabular-nums ${strong ? "text-lg font-semibold text-foreground" : "text-sm font-medium text-foreground"}`}>
      {value}
    </dd>
  </div>
);

const CalculatorResults: React.FC<CalculatorResultsProps> = ({ result }) => {
  if (!result) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        Choose a product and enter the client&apos;s age and monthly premium to see the estimate.
      </p>
    );
  }
  if (result.kind !== "estimate") {
    const Icon = result.kind === "configuration_error" ? AlertTriangle : Info;
    return (
      <div role="status" className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-foreground">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{result.message}</span>
      </div>
    );
  }
  const { estimate } = result;
  const month = formatUsd(estimate.monthlyRemainder);
  return (
    <dl aria-label="Estimate" className="divide-y rounded-lg border px-4">
      <Row label="Rate used" value={formatRatePercent(estimate.ratePercent)} />
      <Row label="Total first-year commission" value={formatUsd(estimate.firstYearCommission)} strong />
      <Row label="Advance (75%)" value={formatUsd(estimate.advance)} />
      <Row label="Month 10" value={month} />
      <Row label="Month 11" value={month} />
      <Row label="Month 12" value={month} />
    </dl>
  );
};

export default CalculatorResults;
