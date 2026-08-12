import { z } from "zod";

/**
 * Canonical policy payment-schedule values (Convert-to-Client Policy Dates build).
 *
 * `payment_frequency` is DRAFT/PAYMENT SCHEDULE METADATA ONLY. It never changes
 * premium semantics: `clients.premium` and `wins.premium_amount` remain MONTHLY
 * dollars regardless of frequency, and every existing ×12 annualization stays
 * untouched. The DB enforces these values via `clients_payment_frequency_check`.
 */
export const PAYMENT_FREQUENCIES = ["monthly", "quarterly", "semi_annual", "annual"] as const;
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];

export const PAYMENT_FREQUENCY_LABELS: Record<PaymentFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semi_annual: "Semi-Annual",
  annual: "Annual",
};

export const DEFAULT_PAYMENT_FREQUENCY: PaymentFrequency = "monthly";

export const paymentFrequencySchema = z.enum(PAYMENT_FREQUENCIES);

/** Blank or a full YYYY-MM-DD calendar date (the format DateInput emits). */
export const optionalIsoDateSchema = z
  .string()
  .optional()
  .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Date must be a valid calendar date");

/** A required YYYY-MM-DD calendar date. */
export const requiredIsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be a valid calendar date");

export function isPaymentFrequency(v: unknown): v is PaymentFrequency {
  return typeof v === "string" && (PAYMENT_FREQUENCIES as readonly string[]).includes(v);
}

/**
 * Normalize any user/UI/legacy spelling to a canonical value, or null when
 * blank/unknown. Unknown values become NULL (never persisted as free text —
 * the DB CHECK would reject them anyway).
 */
export function normalizePaymentFrequencyOrNull(v: unknown): PaymentFrequency | null {
  if (v === null || v === undefined) return null;
  const key = String(v).trim().toLowerCase().replace(/[\s-]+/g, "_");
  return isPaymentFrequency(key) ? key : null;
}

/** Display label for a stored value; blank/unknown → "" (never a fabricated value). */
export function formatPaymentFrequency(v: unknown): string {
  const f = normalizePaymentFrequencyOrNull(v);
  return f ? PAYMENT_FREQUENCY_LABELS[f] : "";
}

/**
 * The agent's LOCAL current date as YYYY-MM-DD (browser timezone — same
 * user-local-day philosophy as the trusted Dialer stats). Used as the Sold Date
 * default for a fresh conversion; the agent can edit it for prior-date sales.
 */
export function todayLocalIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
