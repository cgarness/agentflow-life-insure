import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { AmountsHiddenPanel } from "@/components/commission/ui/AmountsVisibility";
import { useAmounts } from "@/components/commission/ui/amountsContext";
import { TOOLTIP_FRAME } from "@/components/reports/reportChartTheme";
import ReportSegmented from "@/components/reports/ReportSegmented";
import { CATEGORY_LABELS, soldPoliciesHref, type CommissionPeriod } from "@/lib/commission/centerFilters";
import type { CommissionBreakdown, ProductCategory, ProductGroup } from "@/lib/commission/centerSchemas";
import { CenterEmpty } from "../shared/CenterState";
import { BreakdownDetails } from "./BreakdownDetails";

type Metric = "policies" | "estimate";
const METRICS = [["policies", "Policies"], ["estimate", "Est. commission"]] as const;
/** Categorical slots 1–5 in fixed order (validated light and dark); Unknown is neutral. Colour follows the category. */
const COLOR: Record<ProductCategory, string> = {
  term: "var(--pc-term)", whole_life: "var(--pc-wl)", iul: "var(--pc-iul)", final_expense: "var(--pc-fe)", other: "var(--pc-other)",
  unknown: "var(--pc-unknown)",
};
const VARS = "[--pc-term:#2a78d6] [--pc-wl:#eb6834] [--pc-iul:#1baf7a] [--pc-fe:#eda100] [--pc-other:#e87ba4] [--pc-unknown:#898781] "
  + "dark:[--pc-term:#3987e5] dark:[--pc-wl:#d95926] dark:[--pc-iul:#199e70] dark:[--pc-fe:#c98500] dark:[--pc-other:#d55181]";

type Slice = ProductGroup & { label: string; value: number; share: number };

function SliceTooltip({ active, payload, text }: { active?: boolean; payload?: Array<{ payload?: Slice }>; text: (v: number) => string }) {
  const s = payload?.[0]?.payload;
  if (!active || !s) return null;
  return <div className={TOOLTIP_FRAME}><p className="font-semibold">{s.label}</p><p className="tabular-nums">{text(s.value)} · {s.share}%</p></div>;
}

/**
 * By product: a doughnut of the period's sales by mutually exclusive type (Final Expense never counted as Whole Life),
 * by Policies or Est. commission, with a legend of exact links. Unknown stays visible.
 */
export function ProductBreakdown({ data, period }: { data: CommissionBreakdown; period: CommissionPeriod }) {
  const { hidden, money } = useAmounts();
  const navigate = useNavigate();
  const [metric, setMetric] = useState<Metric>("policies");
  const value = (g: ProductGroup) => (metric === "policies" ? g.policies : g.estimate_cents);
  const total = data.products.reduce((sum, g) => sum + value(g), 0);
  const slices: Slice[] = data.products.map((g) => ({
    ...g, label: CATEGORY_LABELS[g.category], value: value(g), share: total > 0 ? Math.round((value(g) / total) * 100) : 0,
  }));
  const text = (v: number) => (metric === "policies" ? String(v) : money(v));
  const href = (category: ProductCategory) => soldPoliciesHref(period, { category });
  let body: ReactNode;
  if (data.products.length === 0) body = <CenterEmpty title="No policies sold in this period" />;
  else if (metric === "estimate" && hidden) body = <AmountsHiddenPanel />;
  else if (total === 0) body = <CenterEmpty title="No saved estimates on this period's sales" />;
  else {
    body = (
      <div className={`grid items-center gap-4 sm:grid-cols-[10rem_minmax(0,1fr)] ${VARS}`}>
        <div className="mx-auto h-40 w-40" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices.filter((s) => s.value > 0)} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%" startAngle={90} endAngle={-270}
                stroke="hsl(var(--card))" strokeWidth={2} isAnimationActive={false} cursor="pointer"
                onClick={(slice: { payload?: Slice }) => slice.payload && navigate(href(slice.payload.category))}>
                {slices.filter((s) => s.value > 0).map((s) => <Cell key={s.category} fill={COLOR[s.category]} />)}
              </Pie>
              <Tooltip content={<SliceTooltip text={text} />} isAnimationActive={false} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul aria-label={`Products by ${metric === "policies" ? "policies" : "est. commission"}`} className="-mx-2 space-y-0.5">
          {slices.map((s) => (
            <li key={s.category}>
              <Link to={href(s.category)}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto_3rem] items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <svg width="10" height="10" aria-hidden className="shrink-0"><rect width="10" height="10" rx="2" fill={COLOR[s.category]} /></svg>
                <span className="truncate text-foreground">{s.label}</span>
                <span className="text-right tabular-nums text-foreground">{metric === "estimate" && s.with_estimate_count === 0 ? "—" : text(s.value)}</span>
                <span className="text-right text-xs tabular-nums text-muted-foreground">{s.share}%</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <ReportSegmented ariaLabel="Show products by" value={metric} onChange={(next) => setMetric(next)} options={METRICS} />
      {body}
      {data.products.length > 0 && <BreakdownDetails kind="product" groups={data.products} period={period} />}
    </div>
  );
}
