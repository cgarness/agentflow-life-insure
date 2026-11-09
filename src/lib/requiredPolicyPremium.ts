/** New recorded policies require a positive, finite monthly amount with at most two decimals. */
export function hasRequiredSalePremium(raw: string | null | undefined): boolean {
  const value = (raw ?? "").replace(/[,$\s]/g, "");
  return /^\d+(\.\d{1,2})?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0;
}
