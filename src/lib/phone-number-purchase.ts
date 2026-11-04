import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { NumberSearchValues } from "@/components/settings/phone/numberSearchSchema";

const numberType = z.enum(["local", "toll_free"]);
const phoneNumber = z.string().regex(/^\+1\d{10}$/);
const amount = z.string().regex(/^\d{1,9}(?:\.\d{1,8})?$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const optionalText = z.string().nullable().optional();
const availableNumberSchema = z.object({
  phone_number: phoneNumber, number_type: numberType,
  friendly_name: optionalText, locality: optionalText, region: optionalText,
  postal_code: optionalText, country: z.literal("US"), monthly_price: amount, currency,
});
const quoteSchema = z.object({
  id: z.string().uuid(), phone_number: phoneNumber, number_type: numberType,
  friendly_name: optionalText, monthly_price: amount, currency,
  inbound_per_minute: amount, expires_at: z.string().datetime({ offset: true }),
});
const operationSchema = z.object({
  id: z.string().uuid(), phone_number: phoneNumber,
  state: z.enum(["quoted", "purchasing", "purchased_pending_save", "completed", "failed_before_purchase", "needs_review"]),
  phone_number_id: z.string().uuid().nullable().optional(), error_code: z.string().nullable().optional(),
}).refine((operation) => operation.state !== "completed" || !!operation.phone_number_id);
const errorSchema = z.object({ protocol_version: z.literal(1), error: z.string(), code: z.string() });
const searchSchema = z.object({ protocol_version: z.literal(1), numbers: z.array(availableNumberSchema).max(100) });
const quoteResponseSchema = z.object({ protocol_version: z.literal(1), quote: quoteSchema });
const operationResponseSchema = z.object({ protocol_version: z.literal(1), operation: operationSchema });

export type AvailablePhoneNumber = z.infer<typeof availableNumberSchema>;
export type PhoneNumberQuote = z.infer<typeof quoteSchema>;
export type PurchaseOperation = z.infer<typeof operationSchema>;
export type PurchaseScope = { actor_id: string; organization_id: string; view_as: false };
export type PurchaseCompletion = { failedCount: number; pendingCount: number };
export type PurchaseItem = {
  number: AvailablePhoneNumber; quote?: PhoneNumberQuote; requestId?: string;
  attempted: boolean; operation?: PurchaseOperation; error?: string;
};

export class NumberPurchaseError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = "NumberPurchaseError"; }
}
const incompatible = () => new NumberPurchaseError("Phone-number purchasing has changed. Refresh the page before continuing.", "INCOMPATIBLE_PROTOCOL");
export const isTollFreeNumber = (phone: string) => /^\+1(?:800|888|877|866|855|844|833)\d{7}$/.test(phone);

export function getNumberPurchaseScope(
  userId: string | undefined,
  profile: { id: string; organization_id: string | null; role: string; status: string } | null,
  organizationId: string | null,
  isImpersonating: boolean,
): PurchaseScope | null {
  return !isImpersonating && profile?.id === userId && profile?.status === "Active" &&
    ["Admin", "Super Admin"].includes(profile.role) && !!organizationId && profile.organization_id === organizationId
    ? { actor_id: profile.id, organization_id: organizationId, view_as: false } : null;
}

async function invoke<T>(name: string, body: object, schema: z.ZodType<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    const reply = await Promise.race([
      supabase.functions.invoke(name, { body }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new NumberPurchaseError(
        name === "twilio-buy-number" ? "The request timed out. Check purchase status before continuing." : "The request timed out. Try the search or price review again.", "REQUEST_TIMEOUT",
      )), 30_000); }),
    ]);
    let data: unknown = reply.data;
    if (reply.error) {
      const context = (reply.error as { context?: Response }).context;
      if (context && typeof context.json === "function") {
        try { data = await context.json(); } catch { /* A transport error may have no JSON body. */ }
      }
    }
    const failure = errorSchema.safeParse(data);
    if (failure.success) throw new NumberPurchaseError(failure.data.error.slice(0, 300), failure.data.code);
    if (reply.error && data == null) throw new NumberPurchaseError("Could not reach the phone-number service. Please try checking again.", "REQUEST_FAILED");
    const parsed = schema.safeParse(data);
    if (!parsed.success || reply.error) throw incompatible();
    return parsed.data;
  } finally { clearTimeout(timer!); }
}

export async function searchPhoneNumbers(scope: PurchaseScope, filters: NumberSearchValues) {
  const { numbers } = await invoke("twilio-search-numbers", {
    ...scope, action: "search", number_type: filters.numberType, limit: 20,
    ...(filters.numberType === "toll_free" ? { prefix: filters.prefix } : {
      area_code: filters.areaCode || undefined, locality: filters.locality || undefined, state: filters.state || undefined,
    }),
  }, searchSchema);
  if (numbers.some((number) => number.number_type !== filters.numberType || (filters.numberType === "toll_free" &&
    (!/^\+1(?:800|888)\d{7}$/.test(number.phone_number) || (filters.prefix !== "prefer_800" && !number.phone_number.startsWith(`+1${filters.prefix}`)))))) throw incompatible();
  const unique = [...new Map(numbers.map((number) => [number.phone_number, number])).values()];
  if (filters.numberType === "toll_free" && filters.prefix === "prefer_800") unique.sort((a, b) => Number(b.phone_number.startsWith("+1800")) - Number(a.phone_number.startsWith("+1800")));
  return unique.slice(0, 20);
}

export async function quotePhoneNumber(scope: PurchaseScope, number: AvailablePhoneNumber) {
  // Quote only through the non-purchasing endpoint. The legacy buy endpoint ignores action.
  const { quote } = await invoke("twilio-search-numbers", {
    ...scope, action: "quote", phone_number: number.phone_number, number_type: number.number_type,
  }, quoteResponseSchema);
  if (quote.phone_number !== number.phone_number || quote.number_type !== number.number_type) throw incompatible();
  if (Date.parse(quote.expires_at) <= Date.now()) throw new NumberPurchaseError("This price has expired. Review current prices before purchasing.", "QUOTE_EXPIRED");
  return quote;
}

export async function purchasePhoneNumber(scope: PurchaseScope, quote: PhoneNumberQuote, requestId: string, action: "purchase" | "status") {
  // Never send the legacy phone_number payload, including for status/recovery.
  const { operation } = await invoke("twilio-buy-number", {
    ...scope, action, quote_id: quote.id, request_id: requestId,
  }, operationResponseSchema);
  if (operation.id !== quote.id || operation.phone_number !== quote.phone_number) throw incompatible();
  return operation;
}

export function formatNumberPrice(value: string, unit: string) {
  const [whole, fraction = ""] = value.split(".");
  // Keep the quoted decimal intact, including sub-cent usage rates.
  return `${unit} ${BigInt(whole).toLocaleString("en-US")}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}

export function monthlyNumberTotals(quotes: Pick<PhoneNumberQuote, "monthly_price" | "currency">[]) {
  const sums = new Map<string, bigint>();
  for (const quote of quotes) {
    const [whole, fraction = ""] = quote.monthly_price.split(".");
    sums.set(quote.currency, (sums.get(quote.currency) ?? 0n) + BigInt(whole + fraction.padEnd(8, "0")));
  }
  return [...sums].map(([unit, total]) => ({ currency: unit, amount: `${total / 100000000n}.${(total % 100000000n).toString().padStart(8, "0")}` }));
}

const recoverySchema = z.object({ version: z.literal(1), items: z.array(z.object({ quote: quoteSchema, requestId: z.string().uuid() })) });
const recoveryKey = (scope: PurchaseScope) => `agentflow:number-purchases:v1:${scope.actor_id}:${scope.organization_id}`;

export function restorePendingPurchases(scope: PurchaseScope): PurchaseItem[] {
  try {
    const saved = recoverySchema.safeParse(JSON.parse(sessionStorage.getItem(recoveryKey(scope)) || "null"));
    if (!saved.success) return [];
    return saved.data.items.map(({ quote, requestId }) => ({
      number: { ...quote, country: "US" }, quote, requestId, attempted: true,
      operation: { id: quote.id, phone_number: quote.phone_number, state: "needs_review" },
      error: "Check the status of this purchase before continuing.",
    }));
  } catch { return []; }
}

export function savePendingPurchases(scope: PurchaseScope, items: PurchaseItem[]) {
  const pending = items.filter((item) => item.attempted && item.quote && item.requestId && !["completed", "failed_before_purchase"].includes(item.operation?.state ?? ""));
  sessionStorage.setItem(recoveryKey(scope), JSON.stringify({ version: 1, items: pending.map(({ quote, requestId }) => ({ quote, requestId })) }));
}
