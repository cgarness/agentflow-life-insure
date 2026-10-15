import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RECORDS,
  SEND_DEADLINE_MS,
  createPendingSmsStore,
  smsScopeKey,
  type BeginInput,
  type DraftSinkState,
  type PendingSmsRecord,
  type PendingSmsStore,
} from "../pendingSmsStore";
import { noResponse, notStarted, type SmsSendOutcome } from "../smsSendResult";
import { SmsIntent } from "@/lib/sms-intent";

const ORG = "11111111-1111-4111-8111-111111111111";
const ORG_2 = "22222222-2222-4222-8222-222222222222";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MSG = "6f2c1a8e-7d3b-4c5a-9e1f-0a2b3c4d5e6f";

let clock = 1_000;
let store: PendingSmsStore;

function input(over: Partial<BeginInput> = {}): BeginInput {
  return {
    organizationId: ORG, actorId: A, viewerId: A, contactType: "lead", contactId: C1,
    to: "+15125550123", body: "Hello", senderPreference: "+15550001111", contactLabel: "Alpha", ...over,
  };
}

function begin(over: Partial<BeginInput> = {}): PendingSmsRecord {
  const result = store.begin(input(over));
  if (!("record" in result)) throw new Error(`refused: ${result.refusal}`);
  return result.record;
}

const accepted = (messageId = MSG): SmsSendOutcome => ({
  state: "accepted", receipt: { messageId, providerMessageId: "SM1", status: "queued", replayed: false },
});
const refused = (code = "PHONE"): SmsSendOutcome => ({ state: "not_sent", reason: "refused", code, message: "Refused." });
const uncertain = (code = "PROVIDER_REJECTED"): SmsSendOutcome => ({ state: "uncertain", reason: "provider_rejected", code, message: "Provider did not confirm." });

function settle(r: PendingSmsRecord, outcome: SmsSendOutcome) {
  const live = store.get(r.localId)!;
  return store.settle(live.localId, live.attemptId, outcome);
}

function sink(scopeKey: string, state: DraftSinkState, id = "sink-1") {
  const restored: string[] = [];
  let current = { ...state };
  const unregister = store.registerSink({
    id, scopeKey, getState: () => current,
    restore: (text) => { restored.push(text); current = { ...current, text, revision: current.revision + 1 }; },
  });
  return { restored, set: (next: Partial<DraftSinkState>) => { current = { ...current, ...next }; }, unregister };
}

beforeEach(() => {
  clock = 1_000;
  let seq = 0;
  store = createPendingSmsStore({ now: () => clock, uuid: () => `id-${(seq += 1)}` });
  store.bindAuthority({ realUserId: A, organizationId: ORG, impersonating: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("begin: authority, View As and single flight", () => {
  it("refuses without a bound identity, or for another actor or organization", () => {
    const unbound = createPendingSmsStore();
    expect(unbound.begin(input())).toEqual({ ok: false, refusal: "authority" });
    expect(store.begin(input({ actorId: B, viewerId: B }))).toEqual({ ok: false, refusal: "authority" });
    expect(store.begin(input({ organizationId: ORG_2 }))).toEqual({ ok: false, refusal: "authority" });
  });

  it("refuses under View As and whenever the viewer is not the actor", () => {
    expect(store.begin(input({ viewerId: B }))).toEqual({ ok: false, refusal: "view_as" });
    store.bindAuthority({ realUserId: A, organizationId: ORG, impersonating: true });
    expect(store.begin(input())).toEqual({ ok: false, refusal: "view_as" });
  });

  it("allows one in-flight send per contact, and other contacts concurrently (D1)", () => {
    const first = begin();
    expect(first.state).toBe("sending");
    expect(store.begin(input({ body: "Different" }))).toEqual({ ok: false, refusal: "in_flight" });
    expect(begin({ contactId: C2 }).state).toBe("sending");
  });

  it("freezes an immutable snapshot with the request ID", () => {
    const r = begin();
    expect(Object.isFrozen(r.snapshot)).toBe(true);
    // The server requires a UUID request ID; it comes from SmsIntent, not the store's local IDs.
    expect(r.snapshot).toMatchObject({
      requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      to: "+15125550123", body: "Hello", senderPreference: "+15550001111",
    });
    expect(r.deadlineAt).toBe(clock + SEND_DEADLINE_MS);
    expect(r.scopeKey).toBe(smsScopeKey(input()));
  });
});

describe("request identity (D2)", () => {
  it("an identical resubmission after a refusal reuses the record, ID and snapshot", () => {
    const first = begin();
    settle(first, refused());
    const again = begin();
    expect(again.localId).toBe(first.localId);
    expect(again.snapshot).toBe(first.snapshot);
    expect(again.attempts).toBe(2);
    expect(again.attemptId).not.toBe(first.attemptId);
  });

  it("an identical resubmission after an uncertain outcome reuses the same ID", () => {
    const first = begin();
    settle(first, uncertain());
    expect(begin().snapshot.requestId).toBe(first.snapshot.requestId);
  });

  it("identical text after confirmed acceptance is a new intent with a new ID", () => {
    const first = begin();
    settle(first, accepted());
    const second = begin();
    expect(second.localId).not.toBe(first.localId);
    expect(second.snapshot.requestId).not.toBe(first.snapshot.requestId);
  });

  it("a changed sender never turns an unresolved uncertain attempt into a fresh one", () => {
    const first = begin();
    settle(first, uncertain());
    expect(store.begin(input({ senderPreference: "+15550009999" }))).toEqual({ ok: false, refusal: "duplicate_unresolved" });
    expect(store.begin(input({ senderPreference: null }))).toEqual({ ok: false, refusal: "duplicate_unresolved" });
    expect(store.get(first.localId)!.snapshot.senderPreference).toBe("+15550001111");
  });

  it("a changed sender after a PROVEN refusal is a new intent", () => {
    const first = begin();
    settle(first, refused());
    const second = begin({ senderPreference: "+15550009999" });
    expect(second.snapshot.requestId).not.toBe(first.snapshot.requestId);
    expect(store.get(first.localId)!.state).toBe("not_sent");
  });
});

describe("settle: evidence, never ranking", () => {
  it("ignores a stale attempt", () => {
    const first = begin();
    settle(first, refused());
    begin();
    expect(store.settle(first.localId, first.attemptId, accepted())).toBeNull();
  });

  it("a later preflight refusal cannot clear an earlier uncertain attempt", () => {
    const first = begin();
    settle(first, uncertain());
    begin();
    const after = settle(first, refused("PHONE"))!;
    expect(after.state).toBe("uncertain");
    expect(after.code).toBe("PROVIDER_REJECTED");
    const local = begin();
    expect(store.settle(local.localId, local.attemptId, notStarted("deadline"))!.state).toBe("uncertain");
  });

  it("acceptance after an uncertain attempt is acceptance", () => {
    const first = begin();
    settle(first, uncertain());
    begin();
    expect(settle(first, accepted())!.state).toBe("accepted");
  });

  it("acceptance completes the intent; a refusal keeps it", () => {
    const first = begin();
    settle(first, refused());
    expect(store.intentCount).toBe(1);
    begin();
    settle(first, accepted());
    expect(store.intentCount).toBe(0);
  });

  it("completing an older request ID never removes a newer intent for the same payload", () => {
    const intents = new SmsIntent();
    const payload = [A, ORG, "lead", C1, "+15125550123", null, "Hello"];
    const current = intents.id(payload);
    intents.accepted(payload, "an-older-request-id");
    expect(intents.peek(payload)).toBe(current);
    intents.accepted(payload, current);
    expect(intents.peek(payload)).toBeUndefined();
    const legacy = intents.id(payload);
    intents.accepted(payload);
    expect(intents.peek(payload), "the existing one-argument form still completes").toBeUndefined();
    expect(legacy).not.toBe(current);
  });

  it("accepted evidence is never downgraded by a later read result", () => {
    const r = begin();
    settle(r, accepted());
    store.markReconcile(r.localId, "unavailable");
    expect(store.get(r.localId)!.state).toBe("accepted");
    expect(store.settle(r.localId, r.attemptId, noResponse("transport"))).toBeNull();
  });
});

describe("dispatch re-check immediately before the POST", () => {
  it("passes for the same identity in time", () => {
    const r = begin();
    expect(store.dispatchBlock(r.localId, r.attemptId, A)).toBeNull();
  });

  it("blocks a changed generation, View As, another session user or the deadline", () => {
    const r = begin();
    expect(store.dispatchBlock(r.localId, r.attemptId, B)).toBe("authority");
    store.bindAuthority({ realUserId: A, organizationId: ORG, impersonating: true });
    expect(store.dispatchBlock(r.localId, r.attemptId, A)).toBe("authority");
    store.bindAuthority({ realUserId: A, organizationId: ORG, impersonating: false });
    expect(store.dispatchBlock(r.localId, r.attemptId, A), "View As on and off is a new generation").toBe("authority");
    const fresh = begin({ contactId: C2 });
    clock += SEND_DEADLINE_MS;
    expect(store.dispatchBlock(fresh.localId, fresh.attemptId, A)).toBe("deadline");
  });

  it("a cleared or superseded attempt is stale", () => {
    const r = begin();
    store.handleAuthEvent("SIGNED_OUT", null);
    expect(store.dispatchBlock(r.localId, r.attemptId, A)).toBe("stale");
  });
});

describe("identity changes", () => {
  it("sign-out clears everything and bumps the generation", () => {
    begin();
    const gen = store.generation;
    store.handleAuthEvent("SIGNED_OUT", null);
    expect(store.getSnapshot()).toEqual([]);
    expect(store.intentCount).toBe(0);
    expect(store.generation).toBeGreaterThan(gen);
  });

  it("A → B → A clears, and A's old attempt can never dispatch", () => {
    const r = begin();
    store.bindAuthority({ realUserId: B, organizationId: ORG, impersonating: false });
    store.bindAuthority({ realUserId: A, organizationId: ORG, impersonating: false });
    expect(store.get(r.localId)).toBeUndefined();
    expect(store.dispatchBlock(r.localId, r.attemptId, A)).toBe("stale");
  });

  it("a sign-in answered for another user clears; an echo for the same user changes nothing", () => {
    const r = begin();
    const gen = store.generation;
    store.handleAuthEvent("SIGNED_IN", A);
    expect(store.get(r.localId)).toBeDefined();
    expect(store.generation).toBe(gen);
    store.handleAuthEvent("SIGNED_IN", B);
    expect(store.get(r.localId)).toBeUndefined();
    expect(store.generation).toBe(gen + 1);
  });

  it("a sign-out the app never rendered cannot leave sending blocked", () => {
    store.handleAuthEvent("SIGNED_OUT", null);
    store.handleAuthEvent("SIGNED_IN", A);
    expect(store.begin(input()).ok, "the bridge's binding still stands").toBe(true);
  });

  it("an organization change clears; a token refresh for the same user does not", () => {
    const r = begin();
    store.handleAuthEvent("TOKEN_REFRESHED", A);
    expect(store.get(r.localId)).toBeDefined();
    store.bindAuthority({ realUserId: A, organizationId: ORG_2, impersonating: false });
    expect(store.get(r.localId)).toBeUndefined();
  });

  it("View As keeps records (they belong to the real actor) but starts a new generation", () => {
    const r = begin();
    const gen = store.generation;
    store.bindAuthority({ realUserId: A, organizationId: ORG, impersonating: true });
    expect(store.get(r.localId)).toBeDefined();
    expect(store.generation).toBe(gen + 1);
    expect(store.isAuthorityCurrent(store.get(r.localId)!)).toBe(false);
  });
});

describe("capacity never discards unresolved text or IDs", () => {
  it("refuses clearly when every slot is unresolved, keeping all of them", () => {
    for (let i = 0; i < MAX_RECORDS; i += 1) {
      const r = begin({ contactId: `c-${i}`, body: `text ${i}` });
      settle(r, i % 2 ? refused() : uncertain());
    }
    store.dismiss(store.getSnapshot()[0].localId);
    expect(store.begin(input({ contactId: "new" }))).toEqual({ ok: false, refusal: "capacity" });
    expect(store.getSnapshot()).toHaveLength(MAX_RECORDS);
    expect(store.intentCount).toBe(MAX_RECORDS);
  });

  it("prunes list-reconciled or dismissed resolved records first, then older resolved ones", () => {
    const resolved: string[] = [];
    for (let i = 0; i < MAX_RECORDS; i += 1) {
      const r = begin({ contactId: `c-${i}`, body: `text ${i}` });
      if (i < 3) {
        settle(r, accepted(`00000000-0000-4000-8000-00000000000${i}`));
        resolved.push(r.localId);
      } else settle(r, uncertain());
    }
    store.markObserved([resolved[2]]);
    begin({ contactId: "new" });
    const ids = store.getSnapshot().map((r) => r.localId);
    expect(ids).not.toContain(resolved[2]);
    expect(ids).toContain(resolved[0]);
    expect(store.getSnapshot().filter((r) => r.state === "uncertain")).toHaveLength(MAX_RECORDS - 3);
  });
});

describe("dismiss hides; it never forgets", () => {
  it("keeps the request identity, so a resubmission reuses the ID and shows again", () => {
    const r = begin();
    settle(r, uncertain());
    store.dismiss(r.localId);
    expect(store.get(r.localId)!.hidden).toBe(true);
    const again = begin();
    expect(again.localId).toBe(r.localId);
    expect(again.snapshot.requestId).toBe(r.snapshot.requestId);
    expect(again.hidden).toBe(false);
  });

  it("cannot dismiss a send that is still in flight", () => {
    const r = begin();
    store.dismiss(r.localId);
    expect(store.get(r.localId)!.hidden).toBe(false);
  });
});

describe("draft restore (D3)", () => {
  const empty: DraftSinkState = { channel: "sms", text: "", revision: 5 };

  it("restores proven non-sending into the originating, empty, unchanged SMS composer", () => {
    const r = begin();
    const s = sink(r.scopeKey, empty);
    store.setOrigin(r.localId, "sink-1", 5);
    settle(r, refused());
    expect(store.tryRestore(r.localId)).toBe(true);
    expect(s.restored).toEqual(["Hello"]);
    expect(store.get(r.localId)!.hidden).toBe(true);
  });

  it.each([
    ["a newer draft revision", { revision: 6 }],
    ["text in the composer", { text: "newer" }],
    ["the email channel", { channel: "email" as const }],
  ])("refuses with %s and keeps the failed item visible", (_label, change) => {
    const r = begin();
    const s = sink(r.scopeKey, empty);
    store.setOrigin(r.localId, "sink-1", 5);
    s.set(change);
    settle(r, refused());
    expect(store.tryRestore(r.localId)).toBe(false);
    expect(s.restored).toEqual([]);
    expect(store.get(r.localId)!.hidden).toBe(false);
  });

  it("never restores an uncertain send, and never into another identity's composer", () => {
    const r = begin();
    const s = sink("another|scope", empty);
    store.setOrigin(r.localId, "sink-1", 5);
    settle(r, refused());
    expect(store.tryRestore(r.localId), "another identity's sink").toBe(false);
    s.unregister();
    const u = begin({ contactId: C2 });
    sink(u.scopeKey, empty, "sink-2");
    store.setOrigin(u.localId, "sink-2", 5);
    settle(u, uncertain());
    expect(store.tryRestore(u.localId)).toBe(false);
    expect(store.editIntoComposer(u.localId, "sink-2")).toBe(false);
  });

  it("Edit fills an empty SMS composer of the same identity only", () => {
    const r = begin();
    settle(r, refused());
    const s = sink(r.scopeKey, { channel: "sms", text: "draft", revision: 1 });
    expect(store.editIntoComposer(r.localId, "sink-1")).toBe(false);
    s.set({ text: "" });
    expect(store.editIntoComposer(r.localId, "sink-1")).toBe(true);
    expect(s.restored).toEqual(["Hello"]);
  });
});

describe("saved-row reconciliation", () => {
  const row = (status: string) => ({
    id: MSG, direction: "outbound" as const, body: "Hello", from_number: "+15550002222", to_number: "+15125550123", status,
    sent_at: null, created_at: null, contact_id: C1, lead_id: null, contact_type: "lead", created_by: A, organization_id: ORG, provider_message_id: "SM1",
  });

  it("attaches only the receipt's row, and a newer read wins over an older one", () => {
    const r = begin();
    settle(r, accepted());
    store.attachCanonical(r.localId, { ...row("queued"), id: "7f2c1a8e-7d3b-4c5a-9e1f-0a2b3c4d5e6f" }, 1);
    expect(store.get(r.localId)!.canonical).toBeNull();
    store.attachCanonical(r.localId, row("sent"), 3);
    store.attachCanonical(r.localId, row("queued"), 2);
    expect(store.get(r.localId)!.canonical).toMatchObject({ readSeq: 3, row: { status: "sent" } });
  });
});

describe("memory only", () => {
  it("never writes to browser storage", () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { open });
    const r = begin();
    settle(r, uncertain());
    store.dismiss(r.localId);
    store.handleAuthEvent("SIGNED_OUT", null);
    expect(local).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
