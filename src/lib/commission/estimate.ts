import { divideBy, integer, multiply, parseDecimal, subtract, type Rational } from "./money";

/**
 * First-year commission estimate (illustrative assumptions specified by the agency, NOT verified carrier
 * payment terms; no target/excess premium, renewals, chargebacks or underwriting):
 *   annual premium       = monthly premium × 12
 *   first-year           = annual premium × rate_percent / 100
 *   advance              = first-year × 75%
 *   Month 10 = 11 = 12   = (first-year − advance) / 3
 * Exact arithmetic throughout; rounding to cents happens only when a value is displayed, so the displayed
 * lines may legitimately differ from their displayed sum by a cent.
 */
export const ADVANCE_PERCENT = 75;

export interface CommissionEstimate {
  /** Exact rate text used, as stored. */
  ratePercent: string;
  annualPremium: Rational;
  firstYearCommission: Rational;
  advance: Rational;
  /** Each of Month 10, Month 11 and Month 12. */
  monthlyRemainder: Rational;
}

export function estimateCommission(monthlyPremium: string, ratePercent: string): CommissionEstimate | null {
  const premium = parseDecimal(monthlyPremium);
  const rate = parseDecimal(ratePercent);
  if (!premium || !rate || premium.num === 0n) return null;
  const annualPremium = multiply(premium, integer(12));
  const firstYearCommission = divideBy(multiply(annualPremium, rate), 100n);
  const advance = divideBy(multiply(firstYearCommission, integer(ADVANCE_PERCENT)), 100n);
  const monthlyRemainder = divideBy(subtract(firstYearCommission, advance), 3n);
  return { ratePercent, annualPremium, firstYearCommission, advance, monthlyRemainder };
}
