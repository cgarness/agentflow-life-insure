import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { classifySaleError, type SaleErrorClass } from "@/lib/policySaleOutcome";

/**
 * Audited sale premium corrections (Reports V2 PKG-B, D2 §3.5–§3.6, §5). A correction fixes an entry error in the
 * original sale: it restates that sale's AP on its original seller and Sold Date. It never records a sale, never
 * notifies anyone and never touches a commission. Only `correct_policy_sale_premium` writes; the server authorizes
 * every call (Admin or Super Admin of the home organization).
 */

export const CORRECTION_REASONS = [
  { value: "entry_error", label: "Entered incorrectly at sale" },
  { value: "carrier_confirmed_amount", label: "Carrier confirmed a different amount" },
  { value: "missing_at_entry", label: "Not entered at sale" },
  { value: "other", label: "Other" },
] as const;
export type CorrectionReason = (typeof CORRECTION_REASONS)[number]["value"];
export type BookMode = "match_sale" | "keep_current";
export const MAX_CORRECTED_MONTHLY = 1_000_000;

const money = z.number().nullable();
const premiumSource = z.enum(["sale_snapshot", "legacy_sale_event", "legacy_record_fallback", "correction", "none"]);
const premiumState = z.enum(["known", "missing", "invalid"]);

export const salePremiumHistoryEntrySchema = z.object({
  revision: z.number().int().positive(),
  created_at: z.string(),
  actor_name: z.string().nullable(),
  previous_effective_monthly: money,
  corrected_monthly: money,
  reason_code: z.enum(["entry_error", "carrier_confirmed_amount", "missing_at_entry", "other"]),
  note: z.string(),
  book_mode: z.enum(["match_sale", "keep_current"]),
  book_action: z.enum(["updated", "already_matched", "kept_current", "no_policy_record"]),
  request_id: z.string().uuid().nullable(),
});
export const salePremiumPolicySchema = z.object({
  policy_id: z.string().uuid(),
  win_id: z.string().uuid(),
  policy_source: z.enum(["primary", "additional"]),
  sold_date: z.string().nullable(),
  seller_id: z.string().uuid().nullable(),
  seller_name: z.string().nullable(),
  original: z.object({ monthly: money, state: premiumState, source: premiumSource }),
  effective: z.object({ monthly: money, annual: money, source: premiumSource, state: premiumState, revision: z.number().int().min(0) }),
  book: z.object({
    raw: z.union([z.number(), z.string(), z.null()]),
    monthly: money,
    present: z.boolean(),
    matches_sale: z.boolean(),
  }).nullable(),
  history: z.array(salePremiumHistoryEntrySchema),
});
export const clientSalePremiumsSchema = z.object({
  client_id: z.string().uuid(),
  can_correct: z.boolean(),
  policies: z.array(salePremiumPolicySchema),
});
export type SalePremiumPolicy = z.infer<typeof salePremiumPolicySchema>;
export type ClientSalePremiums = z.infer<typeof clientSalePremiumsSchema>;
export type SalePremiumHistoryEntry = z.infer<typeof salePremiumHistoryEntrySchema>;

export const correctionResultSchema = z.object({
  policy_id: z.string().uuid(),
  win_id: z.string().uuid(),
  request_id: z.string().uuid(),
  revision: z.number().int().positive(),
  previous_effective_monthly: money,
  corrected_monthly: money,
  effective_annual: money,
  book_action: z.enum(["updated", "already_matched", "kept_current", "no_policy_record"]),
  freeze: z.boolean(),
  sold_date: z.string().nullable(),
  seller_id: z.string().uuid().nullable(),
  corrected_at: z.string(),
  idempotent: z.boolean(),
});
export type CorrectionResult = z.infer<typeof correctionResultSchema>;

/** Dollars with optional $, thousands commas and at most two decimals (the same amounts the server accepts). */
const AMOUNT = /^\$?(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/;
export function parseCorrectedAmount(text: string): number | null {
  const t = text.trim();
  if (!AMOUNT.test(t)) return null;
  const n = Number(t.replace(/[$,]/g, ""));
  return Number.isFinite(n) && n >= 0 && n <= MAX_CORRECTED_MONTHLY ? n : null;
}
const cents = (n: number | null) => (n === null ? null : Math.round(n * 100));
export const sameAmount = (a: number | null, b: number | null) => cents(a) === cents(b);

/** The form, checked against the sale it corrects. */
export function premiumCorrectionFormSchema(sale: Pick<SalePremiumPolicy, "effective" | "policy_source" | "book">) {
  return z.object({
    amount: z.string(),
    unknown: z.boolean(),
    reason: z.enum(["entry_error", "carrier_confirmed_amount", "missing_at_entry", "other"], {
      errorMap: () => ({ message: "Choose a reason." }),
    }),
    note: z.string().trim().min(3, "Add a note of at least 3 characters.").max(500, "Keep the note under 500 characters."),
    bookMode: z.enum(["match_sale", "keep_current"]),
  }).superRefine((form, ctx) => {
    const corrected = form.unknown ? null : parseCorrectedAmount(form.amount);
    if (!form.unknown && corrected === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "Enter a monthly amount from $0 to $1,000,000 with at most two decimals." });
      return;
    }
    // The same amount is allowed only to freeze an older sale that follows its policy record (RL-15).
    if (sameAmount(corrected, sale.effective.monthly) && sale.effective.source !== "legacy_record_fallback") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "This is already the sale premium." });
    }
    if (form.bookMode === "match_sale") {
      if (!sale.book?.present) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bookMode"], message: "There is no current policy record to update." });
      } else if (!sale.book.matches_sale && !sameAmount(sale.book.monthly, corrected)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bookMode"], message: "The policy record was changed after the sale." });
      } else if (sale.policy_source === "primary" && corrected === 0 && !sameAmount(sale.book.monthly, 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bookMode"], message: "A primary policy premium of $0 can't be stored; keep the current record." });
      }
    }
  });
}
export type PremiumCorrectionForm = z.input<ReturnType<typeof premiumCorrectionFormSchema>>;

export const correctionArgsSchema = z.object({
  p_request_id: z.string().uuid(),
  p_policy_id: z.string().uuid(),
  p_expected_revision: z.number().int().min(0),
  p_expected_effective_monthly: money,
  p_expected_book_amount: z.union([z.number(), z.string(), z.null()]),
  p_corrected_monthly: money,
  p_reason_code: z.enum(["entry_error", "carrier_confirmed_amount", "missing_at_entry", "other"]),
  p_note: z.string(),
  p_book_mode: z.enum(["match_sale", "keep_current"]),
});
export type CorrectionArgs = Readonly<z.infer<typeof correctionArgsSchema>>;

/** The exact call for a valid form, deep-frozen: a retry after an unknown outcome resends these bytes unchanged. */
export function prepareCorrection(sale: SalePremiumPolicy, form: PremiumCorrectionForm, requestId: string): CorrectionArgs {
  const parsed = premiumCorrectionFormSchema(sale).parse(form);
  const args = correctionArgsSchema.parse({
    p_request_id: requestId,
    p_policy_id: sale.policy_id,
    p_expected_revision: sale.effective.revision,
    p_expected_effective_monthly: sale.effective.monthly,
    p_expected_book_amount: sale.book?.present ? sale.book.raw : null,
    p_corrected_monthly: parsed.unknown ? null : parseCorrectedAmount(parsed.amount),
    p_reason_code: parsed.reason,
    p_note: parsed.note,
    p_book_mode: parsed.bookMode,
  });
  return Object.freeze(args);
}

const DETAIL_MESSAGES: Record<string, string> = {
  stale_revision: "This sale premium changed since you opened it. Reload and try again.",
  policy_changed: "The policy record changed since you opened it. Reload and try again.",
  request_conflict: "This correction conflicts with one already sent. Close the dialog and start again.",
  no_change: "This is already the sale premium.",
  book_diverged: "The policy record no longer matches the sale. Choose “Keep the current policy record”.",
  book_zero_unsupported: "A primary policy premium of $0 can't be stored. Choose “Keep the current policy record”.",
  no_policy_record: "There is no current policy record to update. Choose “Keep the current policy record”.",
  sale_not_found: "This sale is no longer available. Reopen the contact.",
};
const CODE_MESSAGES: Record<string, string> = {
  "42501": "Only an Admin can correct a sale premium.",
  PT404: DETAIL_MESSAGES.sale_not_found,
};
const UNKNOWN = "We couldn't confirm the correction. Retry sends exactly the same correction.";

export class CorrectionError extends Error {
  readonly code: string | null;
  readonly detail: string | null;
  readonly errorClass: SaleErrorClass;
  constructor(message: string, errorClass: SaleErrorClass, code: string | null, detail: string | null) {
    super(message);
    this.name = "CorrectionError";
    this.errorClass = errorClass;
    this.code = code;
    this.detail = detail;
  }
}
export function correctionError(error: { code?: string | null; details?: string | null; message?: string | null } | null, sent: boolean) {
  const code = error?.code || null;
  const detail = error?.details || null;
  const errorClass = classifySaleError(code, sent);
  const message = errorClass === "unknown" ? UNKNOWN
    : (detail && DETAIL_MESSAGES[detail]) || (code && CODE_MESSAGES[code]) || "The correction was not saved. Check the entries and try again.";
  return new CorrectionError(message, errorClass, code, detail);
}

export async function submitCorrection(args: CorrectionArgs): Promise<CorrectionResult> {
  let response: { data: unknown; error: { code?: string; details?: string; message?: string } | null };
  try {
    response = await (supabase as any).rpc("correct_policy_sale_premium", args);
  } catch {
    throw correctionError(null, true);
  }
  if (response.error) throw correctionError(response.error, true);
  const parsed = correctionResultSchema.safeParse(response.data);
  // A response we cannot read proves nothing about whether the correction was saved.
  if (!parsed.success) throw correctionError(null, true);
  return parsed.data;
}

export async function fetchClientSalePremiums(clientId: string, signal?: AbortSignal): Promise<ClientSalePremiums> {
  let request = (supabase as any).rpc("get_client_policy_sale_premiums", { p_client_id: clientId });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw correctionError(error, true);
  return clientSalePremiumsSchema.parse(data);
}
