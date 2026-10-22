import type { CommissionPayload } from "@/lib/commission/capture";
import { hasClientPolicyEvidence } from "@/lib/policyIdentity";
import type { Client } from "@/lib/types";

/**
 * Phase 2A sale submissions through the commission companions. A sale is one server transaction; whether it
 * committed is decided ONLY by what the server reported. Anything else (no response, an aborted request, an
 * unrecognised error, an unreadable success) is "unknown": the exact submission is kept, in memory only, and a
 * retry replays it byte for byte, so the server's receipt makes it exactly-once.
 *
 * This module holds no transport (the companion calls live in policySaleRecording), so the sale modals and their
 * submission state never load the Supabase client themselves.
 */
export type SaleKind = "record" | "create" | "convert" | "edit";

/** A built submission. Deep-frozen; never logged, toasted, persisted or sent anywhere but its companion. */
export interface PreparedSale {
  readonly kind: SaleKind;
  readonly requestId: string;
  /** The conversion's lead (its operation key); null otherwise. */
  readonly leadId: string | null;
  /** Record/edit: the client the result must belong to. */
  readonly expectedClientId: string | null;
  /** The sale writer's own arguments (the server recomputes the writer's payload hash from these). */
  readonly saleArgs: Readonly<Record<string, unknown>>;
  readonly commission: Readonly<CommissionPayload>;
  /** Celebrate the recorded sales after success (never for historical entries). */
  readonly notify: boolean;
}

/** One send of one submission. `sent` flips to true immediately before the HTTP request starts. */
export interface SaleAttempt {
  sent: boolean;
  /** The frozen submission when this attempt is a retry; it is replayed exactly and nothing is rebuilt. */
  readonly frozen: PreparedSale | null;
  /** What this attempt sent (set before sending). */
  prepared: PreparedSale | null;
  result: SaleHandoffResult | null;
}

export function newSaleAttempt(frozen: PreparedSale | null = null): SaleAttempt {
  return { sent: false, frozen, prepared: null, result: null };
}

/** "superseded": an estimate was recorded later for the policy while this sale-time capture was open (never confirmed). */
export type SlotStatus = "recorded" | "awaiting_confirmation" | "needs_attention" | "not_recorded" | "dismissed" | "superseded";
export interface SlotOutcome {
  slot: string;
  policyId: string | null;
  status: SlotStatus;
  code: string | null;
}
export type CommissionOutcomeStatus =
  | "evidence_recorded"
  | "already_captured"
  | "other_operation"
  | "not_recorded"
  | "unavailable"
  | "not_applicable"
  | "no_new_policy"
  | "malformed";
export interface CommissionOutcome {
  status: CommissionOutcomeStatus;
  slots: SlotOutcome[];
}

export interface SaleHandoffResult {
  clientId: string;
  winIds: string[];
  idempotent: boolean;
  /** The saved client row when the writer returns one (create, record, edit). */
  client: Record<string, unknown> | null;
  commission: CommissionOutcome;
}

export type SaleErrorClass = "not_sent" | "rejected" | "conflict" | "unknown";

/** Message unchanged from the server; never carries the submission. A conflict carries the operation's server status. */
export class SaleRequestError extends Error {
  readonly code: string | null;
  readonly status: number | null;
  readonly errorClass: SaleErrorClass;
  readonly operation: SaleOperationState | null;
  constructor(message: string, errorClass: SaleErrorClass, code: string | null = null, status: number | null = null,
    operation: SaleOperationState | null = null) {
    super(message);
    this.name = "SaleRequestError";
    this.code = code;
    this.status = status;
    this.errorClass = errorClass;
    this.operation = operation;
  }
}

/** A refusal raised before anything was sent (validation, pre-save checks). Always safe to edit and resend. */
export function notSentError(message: string): SaleRequestError {
  return new SaleRequestError(message, "not_sent");
}

/** Server-reported failures that prove the transaction did not commit. Everything else is unknown. */
const CONFIRMED_REJECTIONS = new Set([
  "22023", "22P02", "22007", "22008", "23502", "23503", "23505", "23514", "42501", "P0002", "PT404",
  "40001", "40P01", "55P03", "57014",
]);
const POSTGREST_REQUEST_ERROR = /^PGRST[123]\d\d$/;

export function classifySaleError(code: string | null | undefined, sent: boolean): SaleErrorClass {
  if (!sent) return "not_sent";
  if (code === "PT409") return "conflict";
  if (code && (CONFIRMED_REJECTIONS.has(code) || POSTGREST_REQUEST_ERROR.test(code))) return "rejected";
  return "unknown";
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** A private, deep-frozen copy: later form edits can never reach a submission that may already be saved. */
export function freezeSale(prepared: PreparedSale): PreparedSale {
  return deepFreeze(structuredClone(prepared));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const SLOT_STATUSES: readonly SlotStatus[] = ["recorded", "awaiting_confirmation", "needs_attention", "not_recorded", "dismissed", "superseded"];
const OUTCOME_STATUSES: readonly CommissionOutcomeStatus[] = [
  "evidence_recorded", "already_captured", "other_operation", "not_recorded", "unavailable", "not_applicable", "no_new_policy",
];

/** Commission metadata is parsed separately: a malformed value never turns a saved sale into a failure. */
export function parseCommissionOutcome(raw: unknown): CommissionOutcome {
  if (!isRecord(raw) || !OUTCOME_STATUSES.includes(raw.status as CommissionOutcomeStatus) || !Array.isArray(raw.slots)) {
    return { status: "malformed", slots: [] };
  }
  const slots: SlotOutcome[] = [];
  for (const slot of raw.slots) {
    if (!isRecord(slot) || typeof slot.slot !== "string" || !SLOT_STATUSES.includes(slot.status as SlotStatus)) {
      return { status: "malformed", slots: [] };
    }
    slots.push({
      slot: slot.slot,
      policyId: typeof slot.policy_id === "string" ? slot.policy_id : null,
      status: slot.status as SlotStatus,
      code: typeof slot.code === "string" ? slot.code : null,
    });
  }
  return { status: raw.status as CommissionOutcomeStatus, slots };
}

/** The sale itself, validated independently of commission metadata. */
export function parseSaleResult(raw: unknown, expectedClientId: string | null): Omit<SaleHandoffResult, "commission"> | null {
  if (!isRecord(raw) || typeof raw.client_id !== "string" || !UUID.test(raw.client_id)) return null;
  if (!Array.isArray(raw.win_ids) || !raw.win_ids.every((id) => typeof id === "string" && id.length > 0)) return null;
  if (expectedClientId && raw.client_id !== expectedClientId) return null;
  if (raw.client !== undefined && raw.client !== null && (!isRecord(raw.client) || raw.client.id !== raw.client_id)) return null;
  return {
    clientId: raw.client_id,
    winIds: raw.win_ids as string[],
    idempotent: raw.idempotent === true,
    client: isRecord(raw.client) ? raw.client : null,
  };
}

export type SaleOperationState =
  | { state: "committed"; samePayload: boolean; thisRequest: boolean | null }
  | { state: "committed_by_another_user" | "committed_without_receipt" | "not_found" }
  | { state: "unreadable" };

export const FROZEN_MESSAGE =
  "We couldn't confirm whether this save went through. Your entries are locked so a retry can't create a duplicate: Retry sends exactly the same save.";

export function conflictMessage(status: SaleOperationState): string {
  if (status.state === "committed_by_another_user") {
    return "Another user already saved this. Close and refresh the contact to see what was recorded.";
  }
  return "This was already saved with different details. Close and refresh the contact to see what was recorded.";
}

/** The separate post-save commission note; null when every displayed estimate was recorded (or none was shown). */
export function commissionNotice(outcome: CommissionOutcome, sentSlots: number): string | null {
  if (sentSlots === 0) return null;
  if (outcome.status === "malformed") return "Policy saved. The commission estimate's status couldn't be read; check the contact.";
  if (outcome.status === "not_recorded" || outcome.status === "unavailable" || outcome.slots.length === 0) {
    return "Policy saved; the commission estimate wasn't recorded. You can record it from the contact.";
  }
  if (outcome.slots.some((slot) => slot.status === "needs_attention")) return "Policy saved; the commission estimate needs attention on the contact.";
  if (outcome.slots.some((slot) => slot.status === "awaiting_confirmation")) {
    return "Policy saved; the commission estimate awaits confirmation by the agent or an admin.";
  }
  // A superseded capture already has an estimate (recorded later), so it needs no notice.
  if (outcome.slots.some((slot) => slot.status !== "recorded" && slot.status !== "superseded")) {
    return "Policy saved; the commission estimate wasn't recorded. You can record it from the contact.";
  }
  return null;
}

/** True when an Add/Edit Client save records a NEW sale: a new client's policy, or an existing client's first. */
export function clientSaleRecordsPolicy(form: Partial<Client>, initial: Partial<Client> | null | undefined): boolean {
  return hasClientPolicyEvidence(form) && (!initial || !hasClientPolicyEvidence(initial));
}
