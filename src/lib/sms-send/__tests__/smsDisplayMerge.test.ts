import { describe, expect, it } from "vitest";
import { buildSmsItem, type ConversationItem } from "@/components/contacts/conversation-history/conversationTypes";
import type { PendingSmsRecord } from "../pendingSmsStore";
import { mergeThreadRows, mergeTimelineItems } from "../smsDisplayMerge";

const ORG = "11111111-1111-4111-8111-111111111111";
const A = "00000000-0000-4000-8000-00000000000a";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MSG = "6f2c1a8e-7d3b-4c5a-9e1f-0a2b3c4d5e6f";
const OTHER = "7f2c1a8e-7d3b-4c5a-9e1f-0a2b3c4d5e6f";

function record(over: Partial<PendingSmsRecord> = {}): PendingSmsRecord {
  return {
    localId: "local-1", scopeKey: `${ORG}|${A}|${A}|lead|${C1}`,
    snapshot: Object.freeze({
      organizationId: ORG, actorId: A, viewerId: A, contactType: "lead" as const, contactId: C1,
      requestId: "req-1", to: "+15125550123", body: "Same words", senderPreference: null, contactLabel: "Alpha",
    }),
    createdAt: Date.parse("2026-10-14T15:00:00Z"), state: "sending", reason: null, code: null, message: null,
    uncertainty: null, attemptId: "att-1", attempts: 1, dispatched: true, slow: false, deadlineAt: 0, authorityGen: 1,
    receipt: null, canonical: null, reconcile: "none", observed: false, hidden: false, origin: null, ...over,
  };
}

const receipt = (messageId = MSG) => ({ messageId, providerMessageId: "SM1", status: "queued", replayed: false });
const canonical = (status = "queued", readSeq = 5) => ({
  readSeq,
  row: {
    id: MSG, direction: "outbound" as const, body: "Same words", from_number: "+15550002222", to_number: "+15125550123", status,
    sent_at: "2026-10-14T15:00:01Z", created_at: "2026-10-14T15:00:01Z", contact_id: C1, lead_id: null, contact_type: "lead",
    created_by: A, organization_id: ORG, provider_message_id: "SM1",
  },
});
const threadSms = (id: string, body: string, iso: string, status = "queued") => ({
  id, type: "sms", direction: "outbound", body, status, from_number: "+15550002222", _ts: Date.parse(iso), sent_at: iso,
});

describe("Conversations thread merge", () => {
  it("appends an unsaved send after the saved history", () => {
    const rows = [threadSms("s1", "Earlier", "2026-10-14T14:00:00Z")];
    const { items, observed } = mergeThreadRows(rows, 1, [record()]);
    expect(items.map((r) => r.id)).toEqual(["s1", "pending:local-1"]);
    expect(items[1]).toMatchObject({ type: "pending_sms", body: "Same words", pending: { state: "sending" } });
    expect(observed).toEqual([]);
  });

  it("another tab's saved row that arrives before this send's receipt stays visible beside it", () => {
    const rows = [threadSms(MSG, "Same words", "2026-10-14T15:00:01Z")];
    const { items } = mergeThreadRows(rows, 1, [record()]);
    expect(items.map((r) => r.id)).toEqual([MSG, "pending:local-1"]);
  });

  it("the receipt's message_id is the only match: the saved row replaces the pending one", () => {
    const rows = [threadSms(MSG, "Same words", "2026-10-14T15:00:01Z")];
    const { items, observed } = mergeThreadRows(rows, 9, [record({ state: "accepted", receipt: receipt() })]);
    expect(items.map((r) => r.id)).toEqual([MSG]);
    expect(observed).toEqual(["local-1"]);
  });

  it("never matches by body, phone or time", () => {
    const rows = [threadSms(OTHER, "Same words", "2026-10-14T15:00:01Z")];
    const { items, observed } = mergeThreadRows(rows, 1, [record({ state: "accepted", receipt: receipt() })]);
    expect(items.map((r) => r.id)).toEqual([OTHER, "pending:local-1"]);
    expect(observed).toEqual([]);
  });

  it("shows the targeted read's saved row in place before the list has it", () => {
    const rows = [threadSms("s1", "Earlier", "2026-10-14T14:00:00Z"), threadSms("s2", "Later inbound", "2026-10-14T16:00:00Z")];
    const r = record({ state: "accepted", receipt: receipt(), canonical: canonical() });
    const { items } = mergeThreadRows(rows, 1, [r]);
    expect(items.map((x) => x.id)).toEqual(["s1", MSG, "s2"]);
    expect(items[1]).toMatchObject({ type: "sms", from_number: "+15550002222" });
  });

  it("when both hold the row, the read that started later wins", () => {
    const rows = [threadSms(MSG, "Same words", "2026-10-14T15:00:01Z", "listed")];
    const r = record({ state: "accepted", receipt: receipt(), canonical: canonical("targeted", 5) });
    expect(mergeThreadRows(rows, 4, [r]).items[0].status).toBe("targeted");
    expect(mergeThreadRows(rows, 6, [r]).items[0].status).toBe("listed");
  });

  it("hiding removes only the pending presentation, never a saved row", () => {
    const hiddenUncertain = record({ state: "uncertain", hidden: true });
    expect(mergeThreadRows([], 1, [hiddenUncertain]).items).toEqual([]);
    const hiddenSaved = record({ localId: "local-2", state: "accepted", receipt: receipt(), canonical: canonical(), hidden: true });
    expect(mergeThreadRows([], 1, [hiddenSaved]).items.map((x) => x.id)).toEqual([MSG]);
  });

  it("a saved row is shown once even if two records carry its message_id", () => {
    const first = record({ state: "accepted", receipt: receipt(), canonical: canonical() });
    const second = record({ localId: "local-2", state: "accepted", receipt: receipt(), canonical: canonical() });
    const thread = mergeThreadRows([], 1, [first, second]).items.map((x) => x.id);
    expect(thread).toEqual([MSG]);
    const timeline = mergeTimelineItems([], [first, second]).items.map((x) => x.key);
    expect(timeline).toEqual([`sms:${MSG}`]);
  });

  it("an unconfirmed send is never shown as a second confirmed message", () => {
    const rows = [threadSms(MSG, "Same words", "2026-10-14T15:00:01Z")];
    const { items } = mergeThreadRows(rows, 1, [record({ state: "uncertain", message: "Not confirmed." })]);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ type: "pending_sms", pending: { state: "uncertain" } });
  });
});

describe("contact record timeline merge", () => {
  const item = (id: string, body: string, iso: string): ConversationItem =>
    buildSmsItem({ id, direction: "outbound", body, sent_at: iso, status: "queued", from_number: "+15550002222" });

  it("appends the pending send with no invented sender or status", () => {
    const { items } = mergeTimelineItems([item("s1", "Earlier", "2026-10-14T14:00:00Z")], [record()]);
    expect(items[1]).toMatchObject({ key: "pending:local-1", kind: "sms", fromNumber: null, status: null, pending: { state: "sending" } });
  });

  it("pagination revealing older rows with the same words hides nothing", () => {
    const page1 = [item("s3", "Same words", "2026-10-14T14:30:00Z")];
    const page2 = [item("s1", "Same words", "2026-10-13T10:00:00Z"), item("s2", "Same words", "2026-10-13T11:00:00Z"), ...page1];
    const r = record({ state: "uncertain" });
    expect(mergeTimelineItems(page1, [r]).items.map((x) => x.key)).toEqual(["sms:s3", "pending:local-1"]);
    expect(mergeTimelineItems(page2, [r]).items.map((x) => x.key)).toEqual(["sms:s1", "sms:s2", "sms:s3", "pending:local-1"]);
  });

  it("the feed's row wins once it holds the receipt's message_id", () => {
    const feed = [item(MSG, "Same words", "2026-10-14T15:00:01Z")];
    const r = record({ state: "accepted", receipt: receipt(), canonical: canonical() });
    const { items, observed } = mergeTimelineItems(feed, [r]);
    expect(items.map((x) => x.key)).toEqual([`sms:${MSG}`]);
    expect(observed).toEqual(["local-1"]);
  });

  it("before the feed has it, the saved row shows the sender the server actually used", () => {
    const r = record({ state: "accepted", receipt: receipt(), canonical: canonical() });
    const { items } = mergeTimelineItems([item("s1", "Earlier", "2026-10-14T14:00:00Z")], [r]);
    expect(items[1]).toMatchObject({ key: `sms:${MSG}`, fromNumber: "+15550002222", status: "queued" });
    expect(items[1]).not.toHaveProperty("pending");
  });
});
