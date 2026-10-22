import { useRef } from "react";

/**
 * Carrier filter options: the seller's carriers from the latest response, kept while a changed filter loads (the list
 * comes from all of the seller's current estimates or policies, not from the filter), plus the selected carrier. The
 * page remounts per user and organization, so another identity never sees this list.
 */
export function useCarrierOptions(carriers: string[] | undefined, selected: string | null): string[] {
  const last = useRef<string[]>([]);
  if (carriers) last.current = carriers;
  return selected && !last.current.includes(selected) ? [...last.current, selected] : last.current;
}
