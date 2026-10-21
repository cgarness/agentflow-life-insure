import { useState } from "react";
import { Link } from "react-router-dom";
import { AmountsHiddenPanel } from "@/components/commission/ui/AmountsVisibility";
import { useAmounts } from "@/components/commission/ui/amountsContext";
import ReportSegmented from "@/components/reports/ReportSegmented";
import { historyHref, soldPoliciesHref, type CommissionPeriod } from "@/lib/commission/centerFilters";
import type { CarrierGroup, CommissionBreakdown } from "@/lib/commission/centerSchemas";
import { carrierBars, carrierValue, type CarrierMetric } from "@/lib/commission/insights";
import { cn } from "@/lib/utils";
import { CenterEmpty } from "../shared/CenterState";
import { BreakdownDetails } from "./BreakdownDetails";

const METRICS = [["policies", "Policies"], ["estimate", "Est. commission"], ["received", "Received"]] as const;
// Categorical slot 1 (blue) for sales; the Timeline's Received colour for receipts; neutral for Other and Unknown.
const FILL: Record<CarrierMetric, string> = {
  policies: "fill-[#2a78d6] dark:fill-[#3987e5]", estimate: "fill-[#2a78d6] dark:fill-[#3987e5]", received: "fill-[#1baf7a] dark:fill-[#199e70]",
};
const NEUTRAL = "fill-muted-foreground/40";

function Bar({ label, value, max, text, fill, to, onClick }: {
  label: string; value: number; max: number; text: string; fill: string; to?: string; onClick?: () => void;
}) {
  const body = (
    <>
      <span className="truncate text-sm text-foreground">{label}</span>
      <svg className="h-2.5 w-full rounded-sm bg-muted/50" aria-hidden focusable="false">
        <rect className={fill} height="100%" width={`${max > 0 ? Math.max((value / max) * 100, value > 0 ? 1.5 : 0) : 0}%`} />
      </svg>
      <span className="text-right text-sm tabular-nums text-foreground">{text}</span>
    </>
  );
  const row = "grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]";
  const focus = "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  if (to) return <li><Link to={to} className={cn(row, focus)}>{body}</Link></li>;
  if (onClick) return <li><button type="button" onClick={onClick} className={cn(row, focus, "w-full text-left")}>{body}</button></li>;
  return <li className={row}>{body}</li>;
}

/**
 * By carrier: horizontal bars for Policies (sold in the period), Est. commission (saved first-year estimates of those
 * sales) or Received (receipts dated in the period). Each bar opens exactly its list; Unknown keeps its own bar; Other
 * sums the rest and expands into View all.
 */
export function CarrierBreakdown({ data, period }: { data: CommissionBreakdown; period: CommissionPeriod }) {
  const { hidden, money } = useAmounts();
  const [metric, setMetric] = useState<CarrierMetric>("policies");
  const [all, setAll] = useState(false);
  const bars = carrierBars(data.carriers, metric, all);
  const rows = [...bars.shown, ...(bars.unknown ? [bars.unknown] : [])];
  const max = Math.max(...rows.map((g) => carrierValue(g, metric)), bars.other?.value ?? 0, 0);
  const text = (value: number) => (metric === "policies" ? String(value) : money(value));
  // A carrier whose sales have no saved estimate shows a dash: a missing estimate is not $0.
  const groupText = (g: CarrierGroup) => (metric === "estimate" && g.with_estimate_count === 0 ? "—" : text(carrierValue(g, metric)));
  const otherNamed = carrierBars(data.carriers, metric, true).shown.slice(bars.shown.length);
  const target = (g: CarrierGroup) => {
    const carrier = { carrier: g.carrier, carrierUnknown: g.carrier === null };
    return metric === "received" ? historyHref(period, carrier) : soldPoliciesHref(period, { carrier });
  };
  const isMoney = metric !== "policies";
  return (
    <div className="space-y-3">
      <ReportSegmented ariaLabel="Show carriers by" value={metric} onChange={(next) => setMetric(next)} options={METRICS} />
      {data.carriers.length === 0 ? <CenterEmpty title="No sales or payments in this period" />
        : isMoney && hidden ? <AmountsHiddenPanel /> : (
          <ul aria-label={`Carriers by ${METRICS.find(([m]) => m === metric)?.[1]}`} className="-mx-2 space-y-0.5">
            {bars.shown.map((g) => (
              <Bar key={g.carrier} label={g.carrier ?? ""} value={carrierValue(g, metric)} max={max} text={groupText(g)}
                fill={FILL[metric]} to={target(g)} />
            ))}
            {bars.other && (
              <Bar label={`Other carriers (${bars.other.count})`} value={bars.other.value} max={max}
                text={metric === "estimate" && otherNamed.every((g) => g.with_estimate_count === 0) ? "—" : text(bars.other.value)}
                fill={NEUTRAL} onClick={() => setAll(true)} />
            )}
            {bars.unknown && (
              <Bar label="Unknown" value={carrierValue(bars.unknown, metric)} max={max} text={groupText(bars.unknown)}
                fill={NEUTRAL} to={target(bars.unknown)} />
            )}
          </ul>
        )}
      {(bars.other || all) && !(isMoney && hidden) && (
        <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setAll(!all)}>
          {all ? "Show top carriers" : "View all"}
        </button>
      )}
      {data.carriers.length > 0 && (
        <BreakdownDetails kind="carrier" groups={data.carriers} period={period} />
      )}
    </div>
  );
}
