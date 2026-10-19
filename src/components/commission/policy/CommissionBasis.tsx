import { formatRatePercent } from "@/lib/commission/money";
import { formatCalendarDate } from "@/lib/commission/installments";
import type { CommissionEstimateRecord } from "@/lib/commission/trackingSchemas";

/** How the saved estimate was calculated, exactly as recorded (never recomputed from today's grid). */
export function CommissionBasis({ estimate }: { estimate: CommissionEstimateRecord }) {
  const premium = `$${estimate.monthly_premium}/mo${estimate.premium_source === "policy_record" ? " (policy record)" : ""}`;
  const rows: Array<[string, string]> = [
    ["Product", `${estimate.product_carrier} · ${estimate.product_name}`],
    ["Grid", `${estimate.grid_name} (eff. ${formatCalendarDate(estimate.grid_effective_date)}, rev. ${estimate.grid_revision})`],
    ["Rate", `${formatRatePercent(estimate.rate_percent)} at level ${estimate.contract_level}`],
    ["Insured", `Age ${estimate.insured_age}${estimate.term_years ? ` · ${estimate.term_years}-yr term` : ""}${estimate.variant_label ? ` · ${estimate.variant_label}` : ""}`],
    ["Premium", premium],
    ["Recorded", estimate.capture_mode === "sale_entry" ? "At sale entry" : "Recorded later · current rates"],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-3 gap-y-1.5 text-[11px] sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
