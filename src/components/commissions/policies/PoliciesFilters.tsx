import { useSearchParams } from "react-router-dom";
import {
  CATEGORY_LABELS, SETUP_FILTERS, SETUP_LABELS, withParam, writeCarrier, writePeriod, type PoliciesFilter,
} from "@/lib/commission/centerFilters";
import { PRODUCT_CATEGORIES, type PolicyListPage } from "@/lib/commission/centerSchemas";
import { CommissionPeriodControl } from "../CommissionPeriodControl";
import { FilterSelect } from "../shared/Bits";
import { CarrierSelect } from "../shared/CarrierSelect";

const ALL = "__all__";

/**
 * Policies filters, all in the URL and combined: Sold (sale date; All time by default), Show (setup), Type and Carrier.
 * A breakdown bar or slice opens this tab with exactly its Sold period and carrier or type.
 */
export function PoliciesFilters({ filter, data }: { filter: PoliciesFilter; data: PolicyListPage | undefined }) {
  const [params, setParams] = useSearchParams();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <CommissionPeriodControl value={filter.period} allowAll label="Sold" onChange={(next) => setParams(writePeriod(params, next, "all"))} />
      <FilterSelect label="Show" value={filter.setup} className="w-48" options={SETUP_FILTERS.map((s) => [s, SETUP_LABELS[s]] as const)}
        onChange={(setup) => setParams(withParam(params, "setup", setup, "all"))} />
      <FilterSelect<string> label="Type" value={filter.category ?? ALL} className="w-40"
        options={[[ALL, "All types"], ...PRODUCT_CATEGORIES.map((c) => [c, CATEGORY_LABELS[c]] as const)]}
        onChange={(type) => setParams(withParam(params, "type", type === ALL ? null : type))} />
      <CarrierSelect carriers={data?.carriers} hasUnknown={data?.has_unknown_carrier} value={filter}
        onChange={(next) => setParams(writeCarrier(params, next))} />
    </div>
  );
}
