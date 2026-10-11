/**
 * premiumAvailability.ts — when a performance premium AMOUNT is wholly unavailable (D14, approved 2026-10-11).
 *
 * The Dashboard and Leaderboard/TV amounts sum KNOWN sale-time premiums only, so a period whose every policy has an
 * unknown premium arrives as 0. That 0 is not a sale value. The evidence is the same row's or period's own counts, in
 * the same unit: `performance_rows` counts the wins in the window (`policies_sold`) and those of them whose sale-time
 * monthly premium is NULL (`unknown_premiums`); the Dashboard summary sums both.
 *
 * Never inferred from the amount. No policies keeps the empty period's $0.00, known premiums that total $0 stay a
 * genuine $0.00, and partly known premiums keep their subtotal with the existing unknown-premium indicators. Counts
 * that are missing decide nothing here; the caller's own loading, failed and stale states apply.
 */
export function isPremiumWhollyUnknown(policies: number | null | undefined, unknownPremiums: number | null | undefined): boolean {
  return typeof policies === "number" && typeof unknownPremiums === "number" && policies > 0 && unknownPremiums >= policies;
}
