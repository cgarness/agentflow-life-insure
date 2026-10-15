/**
 * Fixture-only stand-in for `@/integrations/supabase/client`: an in-memory synthetic dataset and a
 * fake `twilio-sms` transport. No network, no real messages, no credentials.
 *
 * Fixed conditions (see the plan's measurement section): list reads 250 ms, targeted row read
 * 80 ms, SMS receipt 1,500 ms. The same stub serves the base build and the candidate build.
 */

export const FIXTURE = {
  org: "11111111-1111-4111-8111-111111111111",
  actor: "00000000-0000-4000-8000-000000000001",
  contact: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  phone: "+15125550123",
  agencySender: "+15550002222",
  listMs: 250,
  rowReadMs: 80,
  receiptMs: 1_500,
};

type Row = Record<string, unknown>;
type Probe = { mark: (name: string) => void };
const probe = () => (window as unknown as { __smsProbe?: Probe }).__smsProbe;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let idSeq = 0;
const uuid = () => {
  idSeq += 1;
  return `9e1f0a2b-3c4d-4e5f-8a6b-${idSeq.toString(16).padStart(12, "0")}`;
};

/** 100 SMS, 50 calls and 50 emails over the past 50 days, oldest first. */
const db = { messages: [] as Row[], calls: [] as Row[], contact_emails: [] as Row[] };
const base = Date.UTC(2026, 7, 20, 14, 0, 0);
for (let i = 0; i < 200; i += 1) {
  const at = new Date(base + i * 6 * 3_600_000).toISOString();
  const outbound = i % 2 === 0;
  if (i % 4 < 2) {
    db.messages.push({
      id: uuid(), direction: outbound ? "outbound" : "inbound", body: `Synthetic text ${i}: checking in about the policy review.`,
      from_number: outbound ? FIXTURE.agencySender : FIXTURE.phone, to_number: outbound ? FIXTURE.phone : FIXTURE.agencySender,
      status: outbound ? "delivered" : "received", sent_at: at, created_at: at, contact_id: null, lead_id: FIXTURE.contact,
      contact_type: "lead", created_by: outbound ? FIXTURE.actor : null, organization_id: FIXTURE.org, provider_message_id: `SM${i}`,
    });
  } else if (i % 4 === 2) {
    db.calls.push({
      id: uuid(), direction: outbound ? "outbound" : "inbound", duration: 60 + i, disposition_name: "Follow Up", started_at: at,
      created_at: at, ended_at: at, caller_id_used: FIXTURE.agencySender, contact_phone: FIXTURE.phone, contact_id: FIXTURE.contact,
      status: "completed", agent_id: FIXTURE.actor, organization_id: FIXTURE.org,
    });
  } else {
    db.contact_emails.push({
      id: uuid(), direction: outbound ? "outbound" : "inbound", subject: `Synthetic email ${i}`, body_text: "Synthetic email body.",
      sent_at: at, received_at: at, created_at: at, from_email: "agent@example.test", to_emails: ["jordan@example.test"],
      contact_id: FIXTURE.contact, delivery_status: "sent", organization_id: FIXTURE.org,
    });
  }
}

const desc = (key: string) => (a: Row, b: Row) => Date.parse(String(b[key] ?? b.created_at)) - Date.parse(String(a[key] ?? a.created_at));

function historyPage(args: Row) {
  const filter = String(args.p_filter ?? "all");
  const all = [
    ...db.calls.map((payload) => ({ kind: "call", payload, event_time: payload.started_at })),
    ...db.messages.map((payload) => ({ kind: "sms", payload, event_time: payload.sent_at })),
    ...db.contact_emails.map((payload) => ({ kind: "email", payload, event_time: payload.sent_at })),
  ]
    .filter((x) => filter === "all" || x.kind === filter)
    .map((x) => ({ ...x, event_key: `${x.kind}:${x.payload.id}` }))
    .sort((a, b) => Date.parse(String(b.event_time)) - Date.parse(String(a.event_time)));
  const size = Number(args.p_page_size ?? 30);
  const offset = Number((args.p_cursor as Row | undefined)?.offset ?? 0);
  const items = all.slice(offset, offset + size);
  const hasMore = offset + size < all.length;
  return { items, hasMore, nextCursor: hasMore ? { offset: offset + size } : null };
}

async function resolveQuery(table: string, filters: Row, single: boolean, args: Row) {
  if (table === "rpc:get_contact_conversation_page") {
    await sleep(FIXTURE.listMs);
    return { data: historyPage(args), error: null };
  }
  if (table === "rpc:get_contact_activity_page") return { data: { items: [], hasMore: false, nextCursor: null }, error: null };
  if (table === "messages" && single && filters.id) {
    await sleep(FIXTURE.rowReadMs);
    const row = db.messages.find((r) => r.id === filters.id && r.organization_id === filters.organization_id) ?? null;
    return { data: row, error: null };
  }
  if (table === "messages" || table === "calls" || table === "contact_emails") {
    await sleep(FIXTURE.listMs);
    const key = table === "calls" ? "started_at" : "sent_at";
    return { data: [...db[table]].sort(desc(key)).slice(0, 100), error: null };
  }
  if (table === "leads" && single) {
    return { data: { id: FIXTURE.contact, first_name: "Jordan", last_name: "Rivera", phone: FIXTURE.phone, status: "New", organization_id: FIXTURE.org }, error: null };
  }
  return { data: single ? null : [], error: null, count: 0 };
}

function query(table: string, args: Row = {}) {
  const filters: Row = {};
  let single = false;
  const target: Row = {
    eq(column: string, value: unknown) { filters[column] = value; return proxy; },
    maybeSingle() { single = true; return proxy; },
    single() { single = true; return proxy; },
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return resolveQuery(table, filters, single, args).then(resolve, reject);
    },
  };
  const proxy: Row = new Proxy(target, {
    get: (t, prop) => (prop in t ? t[prop as string] : () => proxy),
  });
  return proxy;
}

const channel = () => {
  const api: Row = { on: () => api, subscribe: () => api, unsubscribe: async () => "ok" };
  return api;
};
const anything: Row = new Proxy({}, { get: () => async () => ({ data: null, error: null }) });

export const supabase = {
  from: (table: string) => query(table),
  rpc: (fn: string, args: Row) => query(`rpc:${fn}`, args),
  channel,
  removeChannel: async () => "ok",
  removeAllChannels: async () => [],
  getChannels: () => [],
  functions: { invoke: async () => ({ data: null, error: null }) },
  storage: { from: () => anything },
  auth: {
    getSession: async () => ({ data: { session: { access_token: "fixture-token", user: { id: FIXTURE.actor } } }, error: null }),
    getUser: async () => ({ data: { user: { id: FIXTURE.actor } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signOut: async () => ({ error: null }),
    refreshSession: async () => ({ data: { session: null }, error: null }),
  },
};

/** The fake `twilio-sms`: one receipt after 1,500 ms, saving the row first (as the dispatcher does). */
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/functions/v1/twilio-sms")) return realFetch(input, init);
  probe()?.mark("requestStart");
  const body = JSON.parse(String(init?.body ?? "{}")) as Row;
  await sleep(FIXTURE.receiptMs);
  const at = new Date().toISOString();
  const row = {
    id: uuid(), direction: "outbound", body: body.body, from_number: FIXTURE.agencySender, to_number: body.to, status: "queued",
    sent_at: at, created_at: at, contact_id: null, lead_id: FIXTURE.contact, contact_type: "lead", created_by: FIXTURE.actor,
    organization_id: FIXTURE.org, provider_message_id: `SM-${idSeq}`,
  };
  db.messages.push(row);
  probe()?.mark("receipt");
  return new Response(JSON.stringify({ success: true, message_id: row.id, provider_message_id: row.provider_message_id, status: "queued" }), {
    status: 200, headers: { "content-type": "application/json" },
  });
};
