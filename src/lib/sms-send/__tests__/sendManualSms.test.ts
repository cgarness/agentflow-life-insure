import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEND_DEADLINE_MS, SLOW_AFTER_MS, createPendingSmsStore, type BeginInput, type PendingSmsStore } from "../pendingSmsStore";
import { REFUSAL_MESSAGES, createManualSmsSender, type ManualSmsRequestBody } from "../sendManualSms";

const ORG = "11111111-1111-4111-8111-111111111111";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MSG = "6f2c1a8e-7d3b-4c5a-9e1f-0a2b3c4d5e6f";

const flush = async () => {
  for (let i = 0; i < 25; i += 1) await Promise.resolve();
};

/** Deterministic timers: nothing fires until the test advances the clock. */
function fakeTime() {
  let now = 0;
  let seq = 0;
  let timers: { at: number; id: number; run: () => void }[] = [];
  return {
    now: () => now,
    schedule: (run: () => void, ms: number) => {
      const id = (seq += 1);
      timers.push({ at: now + ms, id, run });
      return () => { timers = timers.filter((t) => t.id !== id); };
    },
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        await flush();
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = due.at;
        due.run();
      }
      now = target;
      await flush();
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const receipt = (messageId = MSG) => JSON.stringify({ success: true, message_id: messageId, provider_message_id: "SM1", status: "queued" });
const coded = (code: string, error: string) => JSON.stringify({ success: false, code, error });
const savedRow = (over: Record<string, unknown> = {}) => ({
  id: MSG, direction: "outbound", body: "Hello", from_number: "+15550002222", to_number: "+15125550123", status: "queued",
  sent_at: "2026-10-14T15:00:00Z", created_at: "2026-10-14T15:00:00Z", contact_id: C1, lead_id: null,
  contact_type: "lead", created_by: A, organization_id: ORG, provider_message_id: "SM1", ...over,
});

let time: ReturnType<typeof fakeTime>;
let store: PendingSmsStore;
let posts: { body: ManualSmsRequestBody; token: string; signal: AbortSignal }[];
let reads: [string, string][];
let errors: string[];
let warnings: string[];
let online: boolean;
let session: () => Promise<{ accessToken: string; userId: string } | null>;
let post: (signal: AbortSignal) => Promise<{ status: number; text: string }>;
let read: () => Promise<unknown>;
let sender: ReturnType<typeof createManualSmsSender>;

function input(over: Partial<BeginInput> = {}): BeginInput {
  return {
    organizationId: ORG, actorId: A, viewerId: A, contactType: "lead", contactId: C1,
    to: "+15125550123", body: "Hello", senderPreference: null, contactLabel: "Alpha", ...over,
  };
}

/** A registered, empty SMS composer that the send cleared. */
function composer() {
  const state = { channel: "sms" as "sms" | "email", text: "Hello", revision: 0 };
  const restored: string[] = [];
  store.registerSink({
    id: "sink-1", scopeKey: `${ORG}|${A}|${A}|lead|${C1}`, getState: () => ({ ...state }),
    restore: (text) => { restored.push(text); state.text = text; state.revision += 1; },
  });
  const origin = { sinkId: "sink-1", clear: vi.fn(() => { state.text = ""; state.revision += 1; return state.revision; }) };
  return { state, restored, origin };
}

const only = () => store.getSnapshot()[0];

beforeEach(() => {
  time = fakeTime();
  store = createPendingSmsStore({ now: time.now });
  store.bindAuthority({ realUserId: A, organizationId: ORG, impersonating: false });
  posts = [];
  reads = [];
  errors = [];
  warnings = [];
  online = true;
  session = async () => ({ accessToken: "token-a", userId: A });
  post = async () => ({ status: 200, text: receipt() });
  read = async () => savedRow();
  sender = createManualSmsSender({
    store,
    getSession: () => session(),
    post: (body, token, signal) => { posts.push({ body, token, signal }); return post(signal); },
    readRow: (id, org) => { reads.push([id, org]); return read(); },
    notify: { error: (m) => errors.push(m), warning: (m) => warnings.push(m) },
    now: time.now,
    schedule: time.schedule,
    isOnline: () => online,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("submit is synchronous", () => {
  it("creates the pending send and clears the composer before anything is awaited", () => {
    const c = composer();
    const result = sender.submit({ ...input(), origin: c.origin });
    expect("localId" in result).toBe(true);
    expect(only().state).toBe("sending");
    expect(c.origin.clear).toHaveBeenCalledOnce();
    expect(c.state.text).toBe("");
    expect(posts, "nothing is dispatched synchronously").toHaveLength(0);
  });

  it("sends the existing request contract exactly once", async () => {
    sender.submit(input());
    await time.advance(0);
    expect(posts).toHaveLength(1);
    expect(posts[0].token).toBe("token-a");
    expect(posts[0].body).toEqual({
      request_id: only().snapshot.requestId, actor_id: A, organization_id: ORG, view_as: false,
      to: "+15125550123", body: "Hello", contact_id: C1, contact_type: "lead", lead_id: C1,
    });
    sender.submit(input({ contactId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", senderPreference: "+15550001111" }));
    await time.advance(0);
    expect(posts[1].body.from).toBe("+15550001111");
  });

  it("refuses offline, and View As, without creating anything", () => {
    const c = composer();
    online = false;
    expect(sender.submit({ ...input(), origin: c.origin })).toEqual({ ok: false, refusal: "offline" });
    online = true;
    expect(sender.submit(input({ viewerId: B }))).toEqual({ ok: false, refusal: "view_as" });
    expect(store.getSnapshot()).toEqual([]);
    expect(c.origin.clear).not.toHaveBeenCalled();
    expect(errors).toEqual([REFUSAL_MESSAGES.offline, REFUSAL_MESSAGES.view_as]);
  });

  it("a second submit while in flight is refused silently and dispatches nothing more", async () => {
    sender.submit(input());
    expect(sender.submit(input())).toEqual({ ok: false, refusal: "in_flight" });
    await time.advance(0);
    expect(posts).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});

describe("normal success", () => {
  it("reads exactly the receipt's row and shows the saved sender; no toast", async () => {
    const events: string[] = [];
    store.subscribeScope(`${ORG}|${A}|${A}|lead|${C1}`, (e) => events.push(e));
    sender.submit(input());
    await time.advance(0);
    expect(only().state).toBe("accepted");
    expect(reads).toEqual([[MSG, ORG]]);
    expect(only().canonical?.row.from_number).toBe("+15550002222");
    expect(only().reconcile).toBe("done");
    expect(events).toEqual(["accepted"]);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("a failed read after a valid receipt stays accepted, retried at +2 s and +10 s only", async () => {
    const events: string[] = [];
    store.subscribeScope(`${ORG}|${A}|${A}|lead|${C1}`, (e) => events.push(e));
    read = async () => { throw new Error("read failed"); };
    sender.submit(input());
    await time.advance(0);
    expect(only()).toMatchObject({ state: "accepted", reconcile: "pending" });
    await time.advance(1_999);
    expect(reads).toHaveLength(1);
    await time.advance(1);
    expect(reads).toHaveLength(2);
    await time.advance(8_000);
    expect(reads).toHaveLength(3);
    expect(only()).toMatchObject({ state: "accepted", reconcile: "unavailable" });
    expect(events).toEqual(["accepted", "recovery"]);
    await time.advance(120_000);
    expect(reads).toHaveLength(3);
    expect(errors).toEqual([]);
  });

  it("an empty read is retried and a later row attaches", async () => {
    let calls = 0;
    read = async () => (calls++ === 0 ? null : savedRow());
    sender.submit(input());
    await time.advance(0);
    expect(only().canonical).toBeNull();
    await time.advance(2_000);
    expect(only().canonical?.row.id).toBe(MSG);
  });

  it("a row that is not this contact's or actor's is never shown in its place", async () => {
    read = async () => savedRow({ created_by: B });
    sender.submit(input());
    await time.advance(0);
    expect(only()).toMatchObject({ state: "accepted", reconcile: "mismatch", canonical: null });
    await time.advance(20_000);
    expect(reads).toHaveLength(1);
  });
});

describe("proven non-sending", () => {
  it("restores the text into the untouched composer and reports the server reason", async () => {
    const c = composer();
    post = async () => ({ status: 409, text: coded("PHONE", "This number can't receive texts.") });
    sender.submit({ ...input(), origin: c.origin });
    await time.advance(0);
    expect(only()).toMatchObject({ state: "not_sent", code: "PHONE", hidden: true });
    expect(c.restored).toEqual(["Hello"]);
    expect(errors).toEqual(["This number can't receive texts."]);
  });

  it("keeps the failed item (no restore) once a newer draft exists", async () => {
    const c = composer();
    let release!: () => void;
    post = () => new Promise((resolve) => { release = () => resolve({ status: 409, text: coded("PHONE", "No.") }); });
    sender.submit({ ...input(), origin: c.origin });
    await time.advance(0);
    c.state.text = "a newer draft";
    c.state.revision += 1;
    release();
    await time.advance(0);
    expect(c.restored).toEqual([]);
    expect(c.state.text).toBe("a newer draft");
    expect(only()).toMatchObject({ state: "not_sent", hidden: false });
  });

  it("a missing session is not sent and restores", async () => {
    const c = composer();
    session = async () => null;
    sender.submit({ ...input(), origin: c.origin });
    await time.advance(0);
    expect(posts).toHaveLength(0);
    expect(only()).toMatchObject({ state: "not_sent", reason: "session" });
    expect(c.restored).toEqual(["Hello"]);
    expect(errors[0]).toMatch(/session expired/i);
  });

  it("a session read that throws synchronously cannot strand a sending record", async () => {
    session = () => { throw new Error("boom"); };
    sender.submit(input());
    await time.advance(0);
    expect(only()).toMatchObject({ state: "not_sent", reason: "session" });
  });
});

describe("uncertain outcomes are never restored, resent or relabelled", () => {
  it("PROVIDER_REJECTED (provider 5xx) is Not confirmed, with one recovery refresh and no retry", async () => {
    const c = composer();
    const events: string[] = [];
    store.subscribeScope(`${ORG}|${A}|${A}|lead|${C1}`, (e) => events.push(e));
    post = async () => ({ status: 502, text: coded("PROVIDER_REJECTED", "Provider unavailable.") });
    sender.submit({ ...input(), origin: c.origin });
    await time.advance(120_000);
    expect(only()).toMatchObject({ state: "uncertain", reason: "provider_rejected", hidden: false });
    expect(c.restored).toEqual([]);
    expect(posts).toHaveLength(1);
    expect(events).toEqual(["recovery"]);
    expect(errors).toEqual(["Provider unavailable."]);
  });

  it("an uncertain attempt followed by a different preflight error stays uncertain", async () => {
    post = async () => ({ status: 503, text: coded("SEND_UNCERTAIN", "Delivery could not be confirmed.") });
    sender.submit(input());
    await time.advance(0);
    post = async () => ({ status: 409, text: coded("PHONE", "No.") });
    const c = composer();
    sender.submit({ ...input(), origin: c.origin });
    await time.advance(0);
    expect(posts.map((p) => p.body.request_id)).toEqual([posts[0].body.request_id, posts[0].body.request_id]);
    expect(only()).toMatchObject({ state: "uncertain", code: "SEND_UNCERTAIN" });
    expect(c.restored).toEqual([]);
  });

  it("a dropped connection is Not confirmed and never retried", async () => {
    post = async () => { throw new TypeError("Failed to fetch"); };
    sender.submit(input());
    await time.advance(120_000);
    expect(only()).toMatchObject({ state: "uncertain", reason: "transport" });
    expect(posts).toHaveLength(1);
  });
});

describe("deadline and slow sends (D9)", () => {
  it("shows Still sending after 10 s", async () => {
    post = () => new Promise(() => {});
    sender.submit(input());
    await time.advance(SLOW_AFTER_MS - 1);
    expect(only().slow).toBe(false);
    await time.advance(1);
    expect(only()).toMatchObject({ state: "sending", slow: true });
  });

  it("a dispatched request at 60 s is Not confirmed and its browser request is aborted", async () => {
    post = (signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
    sender.submit(input());
    await time.advance(SEND_DEADLINE_MS);
    expect(posts[0].signal.aborted).toBe(true);
    expect(only()).toMatchObject({ state: "uncertain", reason: "deadline" });
  });

  it("a session that resolves after the deadline never starts the POST", async () => {
    const pending = deferred<{ accessToken: string; userId: string } | null>();
    session = () => pending.promise;
    sender.submit(input());
    await time.advance(SEND_DEADLINE_MS);
    expect(only()).toMatchObject({ state: "not_sent", reason: "deadline" });
    pending.resolve({ accessToken: "token-a", userId: A });
    await time.advance(0);
    expect(posts).toHaveLength(0);
  });
});

describe("authority changes before dispatch", () => {
  it("sign-out while the session is pending: no POST, nothing reported", async () => {
    const pending = deferred<{ accessToken: string; userId: string } | null>();
    session = () => pending.promise;
    sender.submit(input());
    store.handleAuthEvent("SIGNED_OUT", null);
    pending.resolve({ accessToken: "token-a", userId: A });
    await time.advance(0);
    expect(posts).toHaveLength(0);
    expect(store.getSnapshot()).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("A → B → A while the session is pending: no POST", async () => {
    const pending = deferred<{ accessToken: string; userId: string } | null>();
    session = () => pending.promise;
    sender.submit(input());
    store.bindAuthority({ realUserId: B, organizationId: ORG, impersonating: false });
    store.bindAuthority({ realUserId: A, organizationId: ORG, impersonating: false });
    pending.resolve({ accessToken: "token-a", userId: A });
    await time.advance(0);
    expect(posts).toHaveLength(0);
  });

  it("View As before the POST: not sent, no toast, no restore", async () => {
    const c = composer();
    const pending = deferred<{ accessToken: string; userId: string } | null>();
    session = () => pending.promise;
    sender.submit({ ...input(), origin: c.origin });
    store.bindAuthority({ realUserId: A, organizationId: ORG, impersonating: true });
    pending.resolve({ accessToken: "token-a", userId: A });
    await time.advance(0);
    expect(posts).toHaveLength(0);
    expect(only()).toMatchObject({ state: "not_sent", reason: "authority" });
    expect(c.restored).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("a session for another user is refused before the POST", async () => {
    session = async () => ({ accessToken: "token-b", userId: B });
    sender.submit(input());
    await time.advance(0);
    expect(posts).toHaveLength(0);
    expect(only()).toMatchObject({ state: "not_sent", reason: "authority" });
  });

  it("once dispatched, a later View As neither resends nor reports the late result", async () => {
    const c = composer();
    let release!: () => void;
    post = () => new Promise((resolve) => { release = () => resolve({ status: 409, text: coded("PHONE", "No.") }); });
    sender.submit({ ...input(), origin: c.origin });
    await time.advance(0);
    store.bindAuthority({ realUserId: A, organizationId: ORG, impersonating: true });
    release();
    await time.advance(0);
    expect(posts).toHaveLength(1);
    expect(only().state).toBe("not_sent");
    expect(c.restored).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("toasts never misattribute a contact", () => {
  it("names the contact when its conversation is not on screen", async () => {
    post = async () => ({ status: 409, text: coded("PHONE", "No.") });
    sender.submit(input());
    await time.advance(0);
    expect(errors).toEqual(["Text to Alpha not sent: No."]);
  });

  it("uses the bare reason while that contact is on screen", async () => {
    store.subscribeScope(`${ORG}|${A}|${A}|lead|${C1}`, () => {});
    post = async () => ({ status: 503, text: coded("SEND_UNCERTAIN", "Not confirmed by the server.") });
    sender.submit(input());
    await time.advance(0);
    expect(errors).toEqual(["Not confirmed by the server."]);
  });

  it("never logs", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    post = async () => ({ status: 502, text: coded("PROVIDER_REJECTED", "x") });
    sender.submit(input());
    await time.advance(0);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
