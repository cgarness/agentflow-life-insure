import { isCallsRowInboundDirection } from "@/lib/webrtcInboundCaller";

/**
 * Canonical Conversation History filter identifiers for FullScreenContactView.
 * Filtering compares these ids against `ConversationItem.kind` — never display
 * labels. (The old comparison was `_type === label.toLowerCase()`, and
 * "Calls".toLowerCase() === "calls" never matched the "call" record type.)
 */
export type ConversationFilter = "all" | "call" | "sms" | "email";

export const CONVERSATION_FILTERS: ReadonlyArray<{ id: ConversationFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "call", label: "Calls" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
];

interface ConversationItemBase {
  /** Source-qualified React key ("call:<id>") — merged timelines must never key on a bare id. */
  key: string;
  id: string;
  timestampMs: number;
  outbound: boolean;
}

export interface CallConversationItem extends ConversationItemBase {
  kind: "call";
  durationSeconds: number;
  status: string | null;
  dispositionName: string | null;
  /** calls.contact_phone — the customer endpoint. */
  contactPhone: string | null;
  /** calls.caller_id_used — the AgentFlow number or inbound DID. */
  agentflowNumber: string | null;
  startedAt: string | null;
  endedAt: string | null;
  recordingAvailable: boolean;
}

export interface SmsConversationItem extends ConversationItemBase {
  kind: "sms";
  body: string;
  fromNumber: string | null;
  toNumber: string | null;
  status: string | null;
}

export interface EmailConversationItem extends ConversationItemBase {
  kind: "email";
  subject: string | null;
  body: string;
  fromEmail: string | null;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  deliveryStatus: string | null;
}

export type ConversationItem = CallConversationItem | SmsConversationItem | EmailConversationItem;

type RawRow = Record<string, unknown>;

function textOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/** First candidate that parses to a finite epoch; 0 otherwise — never NaN (NaN poisons sort comparators). */
function firstParseableTime(...candidates: unknown[]): number {
  for (const c of candidates) {
    if (typeof c !== "string" || !c) continue;
    const t = new Date(c).getTime();
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function parseEmailList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

/** SMS/email direction rule preserved from the previous inline logic. */
function isOutboundMessageDirection(direction: unknown): boolean {
  return direction !== "inbound" && direction !== "incoming";
}

export function buildCallItem(row: RawRow): CallConversationItem {
  const id = String(row.id ?? "");
  return {
    kind: "call",
    key: `call:${id}`,
    id,
    timestampMs: firstParseableTime(row.started_at, row.created_at),
    outbound: !isCallsRowInboundDirection(row.direction),
    durationSeconds: typeof row.duration === "number" && Number.isFinite(row.duration) ? row.duration : 0,
    status: textOrNull(row.status),
    dispositionName: textOrNull(row.disposition_name),
    contactPhone: textOrNull(row.contact_phone),
    agentflowNumber: textOrNull(row.caller_id_used),
    startedAt: textOrNull(row.started_at),
    endedAt: textOrNull(row.ended_at),
    // Unchanged gating rule: a real URL that is not the pending sentinel.
    recordingAvailable: Boolean(row.recording_url && row.recording_url !== "__recording_pending__"),
  };
}

export function buildSmsItem(row: RawRow): SmsConversationItem {
  const id = String(row.id ?? "");
  return {
    kind: "sms",
    key: `sms:${id}`,
    id,
    timestampMs: firstParseableTime(row.sent_at, row.created_at),
    outbound: isOutboundMessageDirection(row.direction),
    body: typeof row.body === "string" ? row.body : "",
    fromNumber: textOrNull(row.from_number),
    toNumber: textOrNull(row.to_number),
    status: textOrNull(row.status),
  };
}

export function buildEmailItem(row: RawRow): EmailConversationItem {
  const id = String(row.id ?? "");
  return {
    kind: "email",
    key: `email:${id}`,
    id,
    timestampMs: firstParseableTime(row.received_at, row.sent_at, row.created_at),
    outbound: isOutboundMessageDirection(row.direction),
    subject: textOrNull(row.subject),
    body:
      (typeof row.body_text === "string" && row.body_text) ||
      (typeof row.body_html === "string" && row.body_html) ||
      "(No body)",
    fromEmail: textOrNull(row.from_email),
    toEmails: parseEmailList(row.to_emails),
    ccEmails: parseEmailList(row.cc_emails),
    bccEmails: parseEmailList(row.bcc_emails),
    deliveryStatus: textOrNull(row.delivery_status),
  };
}

/**
 * Optimistic outbound email for the timeline, built from the values actually
 * sent. delivery status is "sent" because email-send-contact-message returns
 * success:true only after the provider-confirmed send it records as
 * delivery_status "sent" (failure paths never create an optimistic item).
 */
export function buildOptimisticEmailItem(args: {
  subject: string;
  body: string;
  fromEmail: string | null | undefined;
  toEmail: string;
  sentAt: string;
}): EmailConversationItem {
  const id = `optimistic-email-${Date.now()}`;
  return {
    kind: "email",
    key: `email:${id}`,
    id,
    timestampMs: firstParseableTime(args.sentAt) || Date.now(),
    outbound: true,
    subject: textOrNull(args.subject),
    body: args.body,
    fromEmail: textOrNull(args.fromEmail),
    toEmails: parseEmailList(args.toEmail),
    ccEmails: [],
    bccEmails: [],
    deliveryStatus: "sent",
  };
}

/** Optimistic outbound SMS; status is only what twilio-sms echoed back — never invented. */
export function buildOptimisticSmsItem(args: {
  id: string | null;
  body: string;
  fromNumber: string;
  toNumber: string;
  status: string | null;
  sentAt: string;
}): SmsConversationItem {
  const id = args.id || `optimistic-sms-${Date.now()}`;
  return {
    kind: "sms",
    key: `sms:${id}`,
    id,
    timestampMs: firstParseableTime(args.sentAt) || Date.now(),
    outbound: true,
    body: args.body,
    fromNumber: textOrNull(args.fromNumber),
    toNumber: textOrNull(args.toNumber),
    status: textOrNull(args.status),
  };
}

export function filterConversationItems(items: ConversationItem[], filter: ConversationFilter): ConversationItem[] {
  return filter === "all" ? items : items.filter((item) => item.kind === filter);
}

/** m:ss with a 0:00 floor — identical output to the previous inline math. */
export function formatCallDuration(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
