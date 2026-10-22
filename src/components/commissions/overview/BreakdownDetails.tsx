import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useAmounts } from "@/components/commission/ui/amountsContext";
import { CATEGORY_LABELS, historyHref, soldPoliciesHref, type CommissionPeriod } from "@/lib/commission/centerFilters";
import type { CarrierGroup, ProductGroup } from "@/lib/commission/centerSchemas";
import { InfoTip } from "../shared/Bits";

type Props = { kind: "carrier"; groups: CarrierGroup[]; period: CommissionPeriod } | { kind: "product"; groups: ProductGroup[]; period: CommissionPeriod };

const TH = "px-2 py-1.5 text-right font-medium";
const TD = "px-2 py-1.5 text-right tabular-nums";

/**
 * Expanded breakdown details (also the accessible data table of the chart): every group, its policies, how many have a
 * saved estimate, the average saved first-year estimate over those only (missing estimates are not $0) and the totals.
 * Held estimates are disclosed, not averaged. Not carrier-verified payout performance.
 */
export function BreakdownDetails(props: Props) {
  const { money } = useAmounts();
  const [open, setOpen] = useState(false);
  const carrier = props.kind === "carrier";
  const rows = props.groups.map((g) => {
    const name = "carrier" in g ? g.carrier ?? "Unknown" : CATEGORY_LABELS[g.category];
    const to = "carrier" in g ? soldPoliciesHref(props.period, { carrier: { carrier: g.carrier, carrierUnknown: g.carrier === null } })
      : soldPoliciesHref(props.period, { category: g.category });
    const received = "carrier" in g ? { cents: g.received_cents, count: g.receipt_count,
      to: historyHref(props.period, { carrier: g.carrier, carrierUnknown: g.carrier === null }) } : null;
    return { key: name, name, to, g, received };
  });
  const held = props.groups.reduce((n, g) => n + g.on_hold_count, 0);
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Details <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-xs">
              <caption className="sr-only">{carrier ? "By carrier" : "By product"}: policies sold in this period</caption>
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">{carrier ? "Carrier" : "Product"}</th>
                  <th scope="col" className={TH}>Policies</th>
                  <th scope="col" className={TH}>With estimate</th>
                  <th scope="col" className={TH}>Avg. est.</th>
                  <th scope="col" className={TH}>Est. commission</th>
                  {carrier && <th scope="col" className={TH}>Received</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map(({ key, name, to, g, received }) => (
                  <tr key={key}>
                    <th scope="row" className="px-2 py-1.5 text-left font-normal">
                      <Link to={to} className="text-foreground hover:underline">{name}</Link>
                    </th>
                    <td className={TD}>{g.policies}</td>
                    <td className={TD}>{g.with_estimate_count}</td>
                    <td className={TD}>{g.with_estimate_count > 0 ? money(Math.round(g.estimate_cents / g.with_estimate_count)) : "—"}</td>
                    <td className={TD}>{g.with_estimate_count > 0 ? money(g.estimate_cents) : "—"}</td>
                    {received && (
                      <td className={TD}>
                        {received.count > 0 ? <Link to={received.to} className="hover:underline">{money(received.cents)}</Link> : money(0)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {held > 0 ? `On hold: ${held} not included` : "Saved first-year estimates"}
            <InfoTip label="About these details">
              Average of saved first-year estimates on policies sold in this period, counting only policies that have one. Not
              carrier-verified.{carrier ? " Received counts payments recorded in this period, whenever the policy sold." : ""}
            </InfoTip>
          </p>
        </div>
      )}
    </div>
  );
}
