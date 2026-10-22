import { useRef } from "react";
import type { CarrierFilter } from "@/lib/commission/centerFilters";
import { FilterSelect } from "./Bits";
import { useCarrierOptions } from "./useCarrierOptions";

const ALL = "__all__";
const UNKNOWN = "__unknown__";
/** The server's carrier key, lower(btrim()): surrounding spaces and case only. */
const key = (name: string) => name.replace(/^ +| +$/g, "").toLowerCase();

/**
 * Carrier filter for a list: All, one carrier (matched by case and surrounding spaces, as on the server) or Unknown
 * carrier. The options are the seller's carriers from the latest response, kept while a changed filter loads; a carrier
 * opened from a chart that is not among them is still shown as selected.
 */
export function CarrierSelect({ carriers, hasUnknown, value, onChange }: {
  carriers: string[] | undefined; hasUnknown: boolean | undefined; value: CarrierFilter; onChange: (next: CarrierFilter) => void;
}) {
  const unknownSeen = useRef(false);
  if (hasUnknown !== undefined) unknownSeen.current = hasUnknown;
  const known = useCarrierOptions(carriers, null);
  const matched = value.carrier ? known.find((c) => key(c) === key(value.carrier!)) ?? value.carrier : null;
  const options = matched && !known.includes(matched) ? [...known, matched] : known;
  const selected = value.carrierUnknown ? UNKNOWN : matched ?? ALL;
  return (
    <FilterSelect<string> label="Carrier" value={selected} className="w-44"
      options={[[ALL, "All carriers"], ...options.map((c) => [c, c] as const),
        ...(unknownSeen.current || value.carrierUnknown ? [[UNKNOWN, "Unknown carrier"] as const] : [])]}
      onChange={(next) => onChange(next === UNKNOWN ? { carrier: null, carrierUnknown: true }
        : { carrier: next === ALL ? null : next, carrierUnknown: false })} />
  );
}
