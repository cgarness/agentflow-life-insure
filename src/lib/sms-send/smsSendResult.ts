import { z } from "zod";

/**
 * The `twilio-sms` response contract, classified conservatively.
 *
 * Only the exact (HTTP status, code) and (HTTP status, error literal) pairs below were inspected in
 * the deployed source (twilio-sms v38, byte-identical to the repository) and are raised BEFORE the
 * provider is called, so they alone prove that THIS request did not send. Everything else — a
 * provider rejection, an ambiguous database error, a malformed body, an unknown code, a lost
 * connection — is "uncertain": never restored, never resent. No code families, no "any 4xx".
 */

export interface SmsReceipt {
  messageId: string;
  providerMessageId: string;
  status: string;
  replayed: boolean;
}

export type UncertainReason =
  | "provider_rejected"
  | "provider_suppressed"
  | "send_uncertain"
  | "attempt_exists"
  | "in_progress"
  | "state_unverified"
  | "malformed_receipt"
  | "unrecognized_response"
  | "transport"
  | "deadline";

/** `refused`: an exact pre-send server contract. The others never started the POST. */
export type NotSentReason = "refused" | "session" | "authority" | "deadline";

export type SmsSendOutcome =
  | { state: "accepted"; receipt: SmsReceipt }
  | { state: "accepted_review"; code: string; message: string }
  | { state: "not_sent"; reason: NotSentReason; code: string | null; message: string }
  | { state: "uncertain"; reason: UncertainReason; code: string | null; message: string };

const ReceiptSchema = z.object({
  success: z.literal(true),
  message_id: z.string().uuid(),
  // The legacy path echoes "" when Twilio omits a sid; the dispatcher always sends an SM… sid.
  provider_message_id: z.string().max(64),
  status: z.string().min(1).max(40),
  replayed: z.boolean().optional(),
});

const FailureSchema = z.object({
  success: z.literal(false),
  code: z.string().regex(/^[A-Z0-9_]{2,64}$/).optional(),
  error: z.string().max(2000).optional(),
});

/** Coded pre-send refusals and the exact status each is raised with. */
export const PROVEN_NOT_SENT_CODES: Readonly<Record<string, number>> = Object.freeze({
  SEND_SCOPE: 403, // twilio-sms/index.ts:150, dispatch.ts:48
  CONTACT_SCOPE: 403, // scope.ts, always before sms_start_dispatch
  CONTACT_CHANGED: 403, // scope.ts, always before sms_start_dispatch
  CONTACT_CONVERTED: 409, // dispatch.ts:160, before start
  ACTOR: 403, // dispatch.ts:88
  SMS_PAUSED: 409, // dispatch.ts:36
  SMS_INPUT: 400, // dispatch.ts:56
  PHONE: 409, // wire.ts phone(), only reached before start
  SMS_POLICY: 503, // index.ts:157, dispatcher returned before any work
  SENDER_NOT_SELECTED: 409, // manual.ts, dispatch.ts:68
  A2P_NOT_READY: 409, // manual.ts, dispatch.ts:75, a2p/sending.ts:13
  SENDER_NOT_ALLOWED: 403, // a2p/sending.ts:24, before prepare
  NUMBER_NOT_REGISTERED: 409, // a2p/sending.ts:33, before prepare
  SENDER_REMOVED: 409, // a2p/sending.ts:46, before prepare
});

/** Uncoded pre-send refusals: exact status and exact error text (index.ts:88-207). */
export const PROVEN_NOT_SENT_LITERALS: ReadonlyArray<readonly [number, string]> = Object.freeze([
  [401, "Unauthorized"],
  [400, "Organization not found for user"],
  [400, "Invalid JSON body"],
  [400, "Missing required fields: to, body"],
  [400, "A sender number is required."],
  [400, "Invalid phone number format (E.164 required)."],
  [400, "Sender number not registered to your organization."],
  [400, "Twilio credentials not configured."],
] as const);

const UNCERTAIN_CODES: Readonly<Record<string, UncertainReason>> = Object.freeze({
  // The server also returns PROVIDER_REJECTED for provider 5xx, whose receipt it marks uncertain.
  PROVIDER_REJECTED: "provider_rejected",
  // Chosen from the provider's error code, not its HTTP status.
  SMS_SUPPRESSED: "provider_suppressed",
  SEND_UNCERTAIN: "send_uncertain",
  SEND_REVIEW: "attempt_exists",
  SEND_IN_PROGRESS: "in_progress",
  // Also STOP/DNC blocks and receipt-persistence failures after an attempt.
  SMS_STATE: "state_unverified",
});

const ACCEPTED_REVIEW = { code: "SEND_ACCEPTED_REVIEW", status: 503 } as const;

export const FALLBACK_MESSAGES: Readonly<Record<UncertainReason | NotSentReason, string>> = Object.freeze({
  provider_rejected: "The provider did not confirm this text.",
  provider_suppressed: "This recipient has opted out of agency texts.",
  send_uncertain: "Delivery could not be confirmed.",
  attempt_exists: "This text already has an attempt.",
  in_progress: "This text is still being processed.",
  state_unverified: "Texting state could not be verified.",
  malformed_receipt: "The server's reply couldn't be read.",
  unrecognized_response: "The server's reply couldn't be read.",
  transport: "The connection dropped before the server answered.",
  deadline: "No answer within 60 seconds.",
  refused: "The text was not sent.",
  session: "Session expired. Sign in again to send texts.",
  authority: "Your account or view changed before sending.",
});

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function uncertain(reason: UncertainReason, code: string | null, message?: string): SmsSendOutcome {
  return { state: "uncertain", reason, code, message: message?.trim() || FALLBACK_MESSAGES[reason] };
}

/** Classify one completed HTTP response from `twilio-sms`. */
export function classifySmsResponse(status: number, bodyText: string): SmsSendOutcome {
  const body = parseJson(bodyText);
  if (body && typeof body === "object" && (body as { success?: unknown }).success === true) {
    const receipt = ReceiptSchema.safeParse(body);
    if (status !== 200 || !receipt.success) return uncertain("malformed_receipt", null);
    return {
      state: "accepted",
      receipt: {
        messageId: receipt.data.message_id,
        providerMessageId: receipt.data.provider_message_id,
        status: receipt.data.status,
        replayed: receipt.data.replayed === true,
      },
    };
  }

  const failure = FailureSchema.safeParse(body);
  if (!failure.success) return uncertain("unrecognized_response", null);
  const { code, error } = failure.data;

  if (code) {
    if (code === ACCEPTED_REVIEW.code) {
      return status === ACCEPTED_REVIEW.status
        ? { state: "accepted_review", code, message: error?.trim() || "Provider accepted the text; history needs review." }
        : uncertain("unrecognized_response", code, error);
    }
    if (Object.prototype.hasOwnProperty.call(PROVEN_NOT_SENT_CODES, code)) {
      return PROVEN_NOT_SENT_CODES[code] === status
        ? { state: "not_sent", reason: "refused", code, message: error?.trim() || FALLBACK_MESSAGES.refused }
        : uncertain("unrecognized_response", code, error);
    }
    const reason = Object.prototype.hasOwnProperty.call(UNCERTAIN_CODES, code) ? UNCERTAIN_CODES[code] : "unrecognized_response";
    return uncertain(reason, code, error);
  }

  const literal = PROVEN_NOT_SENT_LITERALS.find(([s, text]) => s === status && text === error);
  if (literal) return { state: "not_sent", reason: "refused", code: null, message: literal[1] };
  return uncertain("unrecognized_response", null, error);
}

/** Columns read back for the saved row. No other `messages` columns are requested. */
export const CANONICAL_SMS_COLUMNS =
  "id,direction,body,from_number,to_number,status,sent_at,created_at,contact_id,lead_id,contact_type,created_by,organization_id,provider_message_id";

const nullableText = z.string().nullable().optional().transform((v) => v ?? null);

// The identity columns are compared for equality with the captured send below, which is the real
// check; the row id must also be the receipt's UUID.
export const CanonicalSmsRowSchema = z.object({
  id: z.string().uuid(),
  direction: z.enum(["inbound", "outbound"]),
  body: z.string(),
  from_number: z.string(),
  to_number: z.string(),
  status: z.string(),
  sent_at: nullableText,
  created_at: nullableText,
  contact_id: nullableText,
  lead_id: nullableText,
  contact_type: nullableText,
  created_by: nullableText,
  organization_id: nullableText,
  provider_message_id: nullableText,
});
export type CanonicalSmsRow = z.infer<typeof CanonicalSmsRowSchema>;

/**
 * Accept a read-back row only when it is exactly the receipt's row, in the captured organization,
 * linked to the captured contact (`contact_id`, or `lead_id` for leads and legacy rows) and created
 * by the captured actor. Anything else is never shown in the pending item's place.
 */
export function matchCanonicalRow(
  raw: unknown,
  expected: { messageId: string; organizationId: string; contactId: string; actorId: string },
): CanonicalSmsRow | null {
  const parsed = CanonicalSmsRowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const row = parsed.data;
  const linked = row.contact_id === expected.contactId || row.lead_id === expected.contactId;
  return row.id === expected.messageId &&
    row.direction === "outbound" &&
    row.organization_id === expected.organizationId &&
    row.created_by === expected.actorId &&
    linked
    ? row
    : null;
}

/** A local stop before the POST started: provably not sent. */
export function notStarted(reason: Exclude<NotSentReason, "refused">): SmsSendOutcome {
  return { state: "not_sent", reason, code: null, message: FALLBACK_MESSAGES[reason] };
}

/** The POST was dispatched but no complete response arrived. */
export function noResponse(reason: "transport" | "deadline"): SmsSendOutcome {
  return uncertain(reason, null);
}
