/**
 * Conversation History typed model — canonical filter identifiers, discriminated-union
 * builders, timestamp fallbacks, and optimistic-item construction (2026-08-17 build).
 *
 * The canonical filter model exists because the previous comparison was
 * `item._type === convoFilter.toLowerCase()` with display labels as state:
 * "Calls".toLowerCase() === "calls" while call rows carry _type "call", so the
 * Calls filter always matched nothing. These tests pin the id/label split.
 */
import { describe, it, expect } from "vitest";
import {
  CONVERSATION_FILTERS,
  buildCallItem,
  buildSmsItem,
  buildEmailItem,
  buildOptimisticEmailItem,
  buildOptimisticSmsItem,
  filterConversationItems,
  formatCallDuration,
  type ConversationItem,
} from "@/components/contacts/conversation-history/conversationTypes";

describe("canonical filter model", () => {
  it("uses canonical ids that match item kinds, with display labels kept separately", () => {
    expect(CONVERSATION_FILTERS.map((f) => f.id)).toEqual(["all", "call", "sms", "email"]);
    expect(CONVERSATION_FILTERS.map((f) => f.label)).toEqual(["All", "Calls", "SMS", "Email"]);
  });

  it("filters each channel by kind and preserves input order; 'all' passes everything", () => {
    const items: ConversationItem[] = [
      buildCallItem({ id: "c1", direction: "outbound", started_at: "2026-08-10T10:00:00Z" }),
      buildSmsItem({ id: "s1", direction: "inbound", body: "hi", sent_at: "2026-08-10T11:00:00Z" }),
      buildEmailItem({ id: "e1", direction: "outbound", subject: "s", sent_at: "2026-08-10T12:00:00Z" }),
      buildCallItem({ id: "c2", direction: "inbound", started_at: "2026-08-10T13:00:00Z" }),
    ];
    expect(filterConversationItems(items, "all")).toEqual(items);
    expect(filterConversationItems(items, "call").map((i) => i.id)).toEqual(["c1", "c2"]);
    expect(filterConversationItems(items, "sms").map((i) => i.id)).toEqual(["s1"]);
    expect(filterConversationItems(items, "email").map((i) => i.id)).toEqual(["e1"]);
  });
});

describe("builders", () => {
  it("source-qualifies keys so a merged timeline can never collide across tables", () => {
    expect(buildCallItem({ id: "x" }).key).toBe("call:x");
    expect(buildSmsItem({ id: "x", body: "b" }).key).toBe("sms:x");
    expect(buildEmailItem({ id: "x" }).key).toBe("email:x");
  });

  it("maps call direction via the calls-row inbound rule ('inbound'/'incoming' only)", () => {
    expect(buildCallItem({ id: "1", direction: "outbound" }).outbound).toBe(true);
    expect(buildCallItem({ id: "1", direction: "outgoing" }).outbound).toBe(true);
    expect(buildCallItem({ id: "1", direction: "inbound" }).outbound).toBe(false);
    expect(buildCallItem({ id: "1", direction: "incoming" }).outbound).toBe(false);
  });

  it("falls back sms timestamps to created_at when sent_at is null (no NaN sort poisoning)", () => {
    const item = buildSmsItem({ id: "s", body: "b", sent_at: null, created_at: "2026-08-10T11:30:00Z" });
    expect(item.timestampMs).toBe(new Date("2026-08-10T11:30:00Z").getTime());
    expect(Number.isFinite(item.timestampMs)).toBe(true);
  });

  it("uses 0 rather than NaN when no timestamp candidate parses", () => {
    expect(buildSmsItem({ id: "s", body: "b", sent_at: null }).timestampMs).toBe(0);
    expect(buildCallItem({ id: "c" }).timestampMs).toBe(0);
    expect(buildEmailItem({ id: "e" }).timestampMs).toBe(0);
  });

  it("keeps the email timestamp preference received_at → sent_at → created_at", () => {
    const t = (s: string) => new Date(s).getTime();
    expect(
      buildEmailItem({ id: "e", received_at: "2026-08-10T12:05:00Z", sent_at: "2026-08-10T12:00:00Z" }).timestampMs,
    ).toBe(t("2026-08-10T12:05:00Z"));
    expect(
      buildEmailItem({ id: "e", received_at: null, sent_at: "2026-08-10T12:00:00Z" }).timestampMs,
    ).toBe(t("2026-08-10T12:00:00Z"));
  });

  it("parses email address Json defensively (array, single string, garbage)", () => {
    expect(buildEmailItem({ id: "e", to_emails: ["a@x.com", " b@y.com "] }).toEmails).toEqual(["a@x.com", "b@y.com"]);
    expect(buildEmailItem({ id: "e", to_emails: "a@x.com" }).toEmails).toEqual(["a@x.com"]);
    expect(buildEmailItem({ id: "e", to_emails: 42 }).toEmails).toEqual([]);
    expect(buildEmailItem({ id: "e", cc_emails: null, bcc_emails: undefined }).ccEmails).toEqual([]);
  });

  it("preserves the email body preference body_text → body_html → '(No body)'", () => {
    expect(buildEmailItem({ id: "e", body_text: "t", body_html: "h" }).body).toBe("t");
    expect(buildEmailItem({ id: "e", body_text: null, body_html: "h" }).body).toBe("h");
    expect(buildEmailItem({ id: "e" }).body).toBe("(No body)");
  });

  it("gates recording availability on recording_url excluding the pending sentinel (unchanged rule)", () => {
    expect(buildCallItem({ id: "c", recording_url: "storage:o/x.mp3" }).recordingAvailable).toBe(true);
    expect(buildCallItem({ id: "c", recording_url: "__recording_pending__" }).recordingAvailable).toBe(false);
    expect(buildCallItem({ id: "c", recording_url: null }).recordingAvailable).toBe(false);
  });
});

describe("formatCallDuration", () => {
  it("renders m:ss with a 0:00 floor exactly like the previous inline math", () => {
    expect(formatCallDuration(125)).toBe("2:05");
    expect(formatCallDuration(45)).toBe("0:45");
    expect(formatCallDuration(0)).toBe("0:00");
    expect(formatCallDuration(Number.NaN)).toBe("0:00");
    expect(formatCallDuration(-3)).toBe("0:00");
  });
});

describe("optimistic items", () => {
  it("carries the actual sent subject, body, endpoints, and outbound direction on optimistic email", () => {
    const item = buildOptimisticEmailItem({
      subject: "Rate quote follow-up",
      body: "Following up on our call",
      fromEmail: "agent@agency.com",
      toEmail: "charlotte@example.com",
      sentAt: "2026-08-17T15:00:00Z",
    });
    expect(item.kind).toBe("email");
    expect(item.subject).toBe("Rate quote follow-up");
    expect(item.body).toBe("Following up on our call");
    expect(item.outbound).toBe(true);
    expect(item.fromEmail).toBe("agent@agency.com");
    expect(item.toEmails).toEqual(["charlotte@example.com"]);
    // success:true from email-send-contact-message is only returned after a
    // provider-confirmed send recorded as delivery_status "sent" (R2).
    expect(item.deliveryStatus).toBe("sent");
    expect(item.timestampMs).toBe(new Date("2026-08-17T15:00:00Z").getTime());
    expect(item.key.startsWith("email:")).toBe(true);
  });

  it("carries real From/To and the endpoint-echoed status on optimistic SMS, without inventing one", () => {
    const withStatus = buildOptimisticSmsItem({
      id: "db-id-1",
      body: "hey",
      fromNumber: "+15550000001",
      toNumber: "+15125550123",
      status: "queued",
      sentAt: "2026-08-17T15:00:00Z",
    });
    expect(withStatus.id).toBe("db-id-1");
    expect(withStatus.key).toBe("sms:db-id-1");
    expect(withStatus.outbound).toBe(true);
    expect(withStatus.fromNumber).toBe("+15550000001");
    expect(withStatus.toNumber).toBe("+15125550123");
    expect(withStatus.status).toBe("queued");

    const withoutStatus = buildOptimisticSmsItem({
      id: null,
      body: "hey",
      fromNumber: "+15550000001",
      toNumber: "+15125550123",
      status: null,
      sentAt: "2026-08-17T15:00:00Z",
    });
    expect(withoutStatus.status).toBeNull();
    expect(withoutStatus.id).toBeTruthy();
    expect(withoutStatus.key).toBe(`sms:${withoutStatus.id}`);
  });
});
