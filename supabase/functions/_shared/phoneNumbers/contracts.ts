export const PROTOCOL_VERSION = 1;
export const ACCOUNT_SID = /^AC[0-9a-f]{32}$/i;
export const NUMBER_SID = /^PN[0-9a-f]{32}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const US_NUMBER = /^\+1[2-9]\d{9}$/;
const TOLL_FREE = /^\+1(?:800|888|877|866|855|844|833)\d{7}$/;
const OFFERED_TOLL_FREE = /^\+1(?:800|888)\d{7}$/;

export type NumberType = "local" | "toll_free";
export type Prefix = "prefer_800" | "800" | "888";
export type Scope = {
  actor_id?: string;
  organization_id?: string;
  view_as?: false;
};
export type Actor = { id: string; organizationId: string };
export type Credentials = { accountSid: string; authToken: string };
export type SearchInput = Scope & {
  action: "search";
  number_type: NumberType;
  prefix: Prefix;
  limit: number;
  area_code?: string;
  state?: string;
  locality?: string;
};
export type QuoteInput = Scope & {
  action: "quote";
  phone_number: string;
  number_type: NumberType;
};
export type PurchaseInput = Scope & {
  action: "purchase" | "status";
  quote_id: string;
  request_id: string;
};
export type RentalPrice = { monthly_price: string; currency: string };
export type QuotePrice = RentalPrice & { inbound_per_minute: string };
export type InventoryNumber = {
  phone_number: string;
  friendly_name: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  country: "US";
  number_type: NumberType;
};
export const OPERATION_STATES = [
  "quoted",
  "purchasing",
  "purchased_pending_save",
  "completed",
  "failed_before_purchase",
  "needs_review",
] as const;
export type OperationState = typeof OPERATION_STATES[number];
export type Operation = {
  id: string;
  organization_id: string;
  actor_id: string;
  account_sid: string;
  phone_number: string;
  number_type: NumberType;
  friendly_name: string;
  quote: QuotePrice;
  expires_at: string;
  state: OperationState;
  request_id: string | null;
  provider_sid: string | null;
  phone_number_id: string | null;
  claimed?: boolean;
  error_code?: string | null;
  row?: Record<string, unknown> | null;
};

export class NumberError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
export function reply(value: Record<string, unknown>, status = 200): Response {
  return new Response(
    JSON.stringify({ protocol_version: PROTOCOL_VERSION, ...value }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
export function failure(error: unknown): Response {
  const known = error instanceof NumberError;
  return reply({
    error: known
      ? error.message
      : "Phone number service is unavailable. Please try again later.",
    code: known ? error.code : "INTERNAL_ERROR",
  }, known ? error.status : 500);
}
export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return failure(
      new NumberError("METHOD_NOT_ALLOWED", "Method not allowed.", 405),
    );
  }
  return null;
}
export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
export async function readJson(
  source: Request | Response,
  maxBytes: number,
): Promise<unknown> {
  const length = Number(source.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    throw new NumberError("BODY_TOO_LARGE", "Request is too large.", 413);
  }
  if (!source.body) {
    throw new NumberError("INVALID_REQUEST", "A JSON object is required.");
  }
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new NumberError("BODY_TOO_LARGE", "Request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new NumberError(
      "INVALID_REQUEST",
      "A valid JSON object is required.",
    );
  }
}
export async function requestBody(
  req: Request,
): Promise<Record<string, unknown>> {
  const body = object(await readJson(req, 8192));
  if (!body) {
    throw new NumberError("INVALID_REQUEST", "A JSON object is required.");
  }
  return body;
}
function fields(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new NumberError(
      "INVALID_REQUEST",
      "The request contains unsupported fields.",
    );
  }
}
export function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32);
}
function text(
  value: unknown,
  max: number,
  optional = false,
): string | undefined {
  if (value === undefined && optional) return undefined;
  if (
    typeof value !== "string" || value.length > max ||
    hasControlCharacters(value)
  ) {
    throw new NumberError("INVALID_REQUEST", "A request field is invalid.");
  }
  return value.trim();
}
function scope(body: Record<string, unknown>, legacy = false): Scope {
  if (body.view_as !== undefined && body.view_as !== false) {
    throw new NumberError(
      "SCOPE_CHANGED",
      "Return to your own agency to manage phone numbers.",
      403,
    );
  }
  for (const field of ["actor_id", "organization_id"]) {
    if (
      (body[field] === undefined && !legacy) ||
      (body[field] !== undefined &&
        (typeof body[field] !== "string" || !UUID.test(body[field] as string)))
    ) {
      throw new NumberError(
        "SCOPE_CHANGED",
        "Your agency context changed. Refresh and try again.",
        403,
      );
    }
  }
  if (!legacy && body.view_as !== false) {
    throw new NumberError("SCOPE_CHANGED", "Refresh your agency context.", 403);
  }
  return {
    actor_id: body.actor_id as string | undefined,
    organization_id: body.organization_id as string | undefined,
    view_as: body.view_as as false | undefined,
  };
}
export function numberType(value: unknown): NumberType {
  if (value !== "local" && value !== "toll_free") {
    throw new NumberError("INVALID_REQUEST", "Select Local or Toll-Free.");
  }
  return value;
}
export function isNumberOfType(
  phone: unknown,
  type: NumberType,
): phone is string {
  return typeof phone === "string" && US_NUMBER.test(phone) &&
    (type === "toll_free"
      ? OFFERED_TOLL_FREE.test(phone)
      : !TOLL_FREE.test(phone));
}
export function parseSearch(
  body: Record<string, unknown>,
): SearchInput | QuoteInput {
  const action = body.action ?? "search";
  if (action === "quote") {
    fields(body, [
      "action",
      "phone_number",
      "number_type",
      "actor_id",
      "organization_id",
      "view_as",
    ]);
    const context = scope(body);
    const type = numberType(body.number_type);
    if (!isNumberOfType(body.phone_number, type)) {
      throw new NumberError(
        "INVALID_NUMBER",
        "Select an available US number of the chosen type.",
      );
    }
    return {
      ...context,
      action,
      phone_number: body.phone_number,
      number_type: type,
    };
  }
  if (action !== "search") {
    throw new NumberError("INVALID_REQUEST", "Unsupported search action.");
  }
  fields(body, [
    "action",
    "number_type",
    "prefix",
    "area_code",
    "state",
    "locality",
    "limit",
    "actor_id",
    "organization_id",
    "view_as",
  ]);
  const context = scope(
    body,
    body.action === undefined && body.number_type === undefined,
  );
  const type = numberType(body.number_type ?? "local");
  const prefix = body.prefix ?? "prefer_800";
  if (
    typeof prefix !== "string" || !["prefer_800", "800", "888"].includes(prefix)
  ) {
    throw new NumberError("INVALID_REQUEST", "Select 800, 888, or Prefer 800.");
  }
  if (
    body.limit !== undefined &&
    (typeof body.limit !== "number" || !Number.isFinite(body.limit))
  ) {
    throw new NumberError("INVALID_REQUEST", "Search limit is invalid.");
  }
  const areaCode = text(body.area_code, 16, true)?.replace(/\D/g, "").slice(
    0,
    3,
  );
  const locality = text(body.locality, 100, true);
  const state = text(body.state, 32, true)?.toUpperCase().slice(0, 2);
  if (type === "toll_free" && (areaCode || locality || state)) {
    throw new NumberError(
      "INVALID_REQUEST",
      "Toll-free searches use a prefix, without local filters.",
    );
  }
  return {
    ...context,
    action,
    number_type: type,
    prefix: prefix as Prefix,
    limit: Math.min(50, Math.max(1, Math.floor(body.limit as number ?? 20))),
    area_code: areaCode,
    locality,
    state,
  };
}
export function parsePurchase(body: Record<string, unknown>): PurchaseInput {
  if (
    body.phone_number !== undefined ||
    (body.action !== "purchase" && body.action !== "status") ||
    typeof body.quote_id !== "string" || !UUID.test(body.quote_id) ||
    typeof body.request_id !== "string" || !UUID.test(body.request_id)
  ) {
    throw new NumberError(
      "REVIEW_REQUIRED",
      "Refresh Phone Numbers and review current pricing before purchasing.",
      409,
    );
  }
  fields(body, [
    "action",
    "quote_id",
    "request_id",
    "actor_id",
    "organization_id",
    "view_as",
  ]);
  return {
    ...scope(body),
    action: body.action as "purchase" | "status",
    quote_id: body.quote_id,
    request_id: body.request_id,
  };
}
