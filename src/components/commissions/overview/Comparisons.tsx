import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { HIDDEN_AMOUNT, useAmounts } from "@/components/commission/ui/amountsContext";
import type { CommissionBreakdown } from "@/lib/commission/centerSchemas";
import { change, comparisonLabel } from "@/lib/commission/insights";
import { InfoTip } from "../shared/Bits";

function Tile({ label, current, previous, money }: { label: string; current: number; previous: number; money?: (c: number) => string }) {
  const { hidden } = useAmounts();
  const masked = !!money && hidden;
  const show = (v: number) => (money ? money(v) : String(v));
  const { delta, percent } = change(current, previous);
  const Icon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return (
    <div className="min-w-0 rounded-lg bg-muted/40 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{masked ? HIDDEN_AMOUNT : show(current)}</p>
      {/* Neutral styling: a change is reported, never judged. No percentage without an earlier value above zero. */}
      <p className="mt-0.5 flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
        {masked ? `vs ${HIDDEN_AMOUNT}` : (
          <>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {delta === 0 ? "No change" : `${sign}${show(Math.abs(delta))}${percent === null ? "" : ` (${sign}${Math.abs(percent)}%)`}`}
            <span>· was {show(previous)}</span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Compact comparisons over server-resolved fair windows: policies sold, the saved first-year estimates on those sales
 * and recorded receipts. The label names both windows when the current one differs from the selected range (month to
 * date, for example). Future periods have no comparison.
 */
export function Comparisons({ data }: { data: CommissionBreakdown }) {
  const { money } = useAmounts();
  const c = data.comparison;
  if (!c) return null;
  const missing = c.current.policies - c.current.with_estimate_count;
  return (
    <section aria-label="Comparison" className="space-y-2">
      <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <span>{comparisonLabel(data.meta, c.current, c.previous)}</span>
        <InfoTip label="About comparisons">
          Policies by sale date and their saved first-year estimates; Received by the date each payment was recorded as received.
          A period in progress is compared with the same elapsed part of the one before. Not carrier-verified.
        </InfoTip>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Tile label="Policies sold" current={c.current.policies} previous={c.previous.policies} />
        <Tile label={missing > 0 ? `Est. commission · ${missing} without estimate` : "Est. commission"}
          current={c.current.estimate_cents} previous={c.previous.estimate_cents} money={money} />
        <Tile label="Received" current={c.current.received_cents} previous={c.previous.received_cents} money={money} />
      </div>
    </section>
  );
}
