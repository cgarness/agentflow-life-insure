/**
 * getRecentConversations — scoping, ranking, and the no-calls guarantee.
 *
 * HONESTY LYNCHPIN — the Supabase mock below is a small in-memory query engine that is
 * **projection-faithful for EVERY table**, not just one. It records the `.select()` column list and
 * returns ONLY those keys, and it genuinely evaluates `.eq()` / `.in()` / `.order()` / `.range()` /
 * `.limit()`. That matters because the repo's existing harness
 * (`src/pages/__tests__/campaignDetailImportRetry.test.tsx:81`) gates projection on
 * `table === "import_history"` and echoes full fixture rows for every other table — copying it here
 * would make "field X was not selected" and "row Y was filtered out" pass vacuously.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

interface QueryRecord {
  table: string;
  select: string;
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  is: Record<string, unknown>;
  /** `.not(col, op, val)` — the only shape used is `("col", "is", null)`, i.e. IS NOT NULL. */
  not: { column: string; operator: string; value: unknown }[];
  or: string[];
  order: { column: string; ascending: boolean; nullsFirst?: boolean }[];
  range: { from: number; to: number } | null;
  limit: number | null;
}

const state = vi.hoisted(() => ({
  queries: [] as QueryRecord[],
  tableData: {} as Record<string, Record<string, unknown>[]>,
  tableError: {} as Record<string, string | undefined>,
}));

vi.mock("@/integrations/supabase/client", () => {
  function project(row: Record<string, unknown>, select: string): Record<string, unknown> {
    const cols = select.split(",").map((c) => c.trim()).filter(Boolean);
    if (cols.includes("*")) return { ...row };
    const out: Record<string, unknown> = {};
    for (const col of cols) out[col] = row[col];
    return out;
  }

  function compare(a: unknown, b: unknown, ascending: boolean, nullsFirst: boolean): number {
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return nullsFirst ? -1 : 1;
    if (bNull) return nullsFirst ? 1 : -1;
    const av = String(a);
    const bv = String(b);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return ascending ? cmp : -cmp;
  }

  function makeBuilder(table: string) {
    const record: QueryRecord = {
      table, select: "*", eq: {}, in: {}, is: {}, not: [], or: [], order: [], range: null, limit: null,
    };
    state.queries.push(record);

    const settle = () => {
      const err = state.tableError[table];
      if (err) return { data: null, error: { message: err } };

      let rows = (state.tableData[table] ?? []).filter((row) => {
        for (const [col, val] of Object.entries(record.eq)) {
          if (row[col] !== val) return false;
        }
        for (const [col, vals] of Object.entries(record.in)) {
          if (!vals.includes(row[col] as never)) return false;
        }
        for (const [col, val] of Object.entries(record.is)) {
          if (val === null && row[col] !== null && row[col] !== undefined) return false;
        }
        for (const n of record.not) {
          if (n.operator !== "is" || n.value !== null) {
            throw new Error(`mock does not implement .not(${n.column}, ${n.operator}, ${String(n.value)})`);
          }
          if (row[n.column] === null || row[n.column] === undefined) return false;
        }
        // `.or("a.not.is.null,b.not.is.null")` — genuinely evaluated, not just recorded. Recording it
        // without evaluating would let a source silently lose its predicate and still pass.
        for (const expr of record.or) {
          const anyMatch = expr.split(",").some((term) => {
            const t = term.trim();
            const notNull = /^([A-Za-z0-9_]+)\.not\.is\.null$/.exec(t);
            if (notNull) {
              const v = row[notNull[1]];
              return v !== null && v !== undefined;
            }
            const eq = /^([A-Za-z0-9_]+)\.eq\.(.*)$/.exec(t);
            if (eq) return row[eq[1]] === eq[2];
            throw new Error(`mock does not implement .or term "${t}"`);
          });
          if (!anyMatch) return false;
        }
        return true;
      });

      // Apply orders right-to-left so the first .order() is the primary key.
      for (const o of [...record.order].reverse()) {
        rows = [...rows].sort((a, b) =>
          compare(a[o.column], b[o.column], o.ascending, o.nullsFirst !== false));
      }

      if (record.range) rows = rows.slice(record.range.from, record.range.to + 1);
      if (record.limit !== null) rows = rows.slice(0, record.limit);

      return { data: rows.map((r) => project(r, record.select)), error: null };
    };

    const builder: Record<string, unknown> = {
      select(cols: string) { record.select = cols; return builder; },
      eq(col: string, val: unknown) { record.eq[col] = val; return builder; },
      in(col: string, vals: unknown[]) { record.in[col] = vals; return builder; },
      is(col: string, val: unknown) { record.is[col] = val; return builder; },
      not(column: string, operator: string, value: unknown) {
        record.not.push({ column, operator, value });
        return builder;
      },
      or(expr: string) { record.or.push(expr); return builder; },
      order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
        record.order.push({
          column,
          ascending: opts?.ascending !== false,
          nullsFirst: opts?.nullsFirst,
        });
        return builder;
      },
      range(from: number, to: number) { record.range = { from, to }; return builder; },
      limit(n: number) { record.limit = n; return builder; },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve(settle()).then(resolve); },
    };
    return builder;
  }

  return { supabase: { from: (table: string) => makeBuilder(table) } };
});

import { messagesSupabaseApi, ACTIVITY_QUERY_BUDGET } from "@/lib/supabase-messages";
import type { ConversationScope } from "@/lib/conversationScope";

const ORG = "org-1";
const ME = "agent-me";
const OTHER = "agent-other";
const DOWNLINE = "agent-downline";

const MINE: ConversationScope = { kind: "agents", organizationId: ORG, agentIds: [ME] };
const TEAM: ConversationScope = { kind: "agents", organizationId: ORG, agentIds: [ME, DOWNLINE] };
const ORGWIDE: ConversationScope = { kind: "org", organizationId: ORG };

/** Row identity counter, so every fixture row has the `id` the tiebreak orders on. */
let fixtureSeq = 0;

function lead(id: string, owner: string, extra: Record<string, unknown> = {}) {
  return {
    id, user_id: owner, assigned_agent_id: owner, organization_id: ORG,
    first_name: "Lead", last_name: id, phone: `555-${id}`, email: `${id}@example.com`, ...extra,
  };
}

function sms(contactId: string, sentAt: string | null, extra: Record<string, unknown> = {}) {
  return {
    id: `m-${(fixtureSeq += 1).toString().padStart(4, "0")}`,
    contact_id: contactId, lead_id: null, body: `sms-${contactId}`,
    sent_at: sentAt, created_at: sentAt, direction: "outbound", organization_id: ORG, ...extra,
  };
}

function email(contactId: string, direction: "inbound" | "outbound", ts: Record<string, unknown>) {
  return {
    id: `e-${(fixtureSeq += 1).toString().padStart(4, "0")}`,
    contact_id: contactId, subject: `subject-${contactId}`, body_text: "body",
    direction, received_at: null, sent_at: null, created_at: null,
    organization_id: ORG, owner_user_id: ME, ...ts,
  };
}

function queriesFor(table: string) {
  return state.queries.filter((q) => q.table === table);
}

beforeEach(() => {
  fixtureSeq = 0;
  state.queries = [];
  state.tableError = {};
  state.tableData = { messages: [], contact_emails: [], calls: [], leads: [], clients: [], recruits: [] };
});

describe("calls can never create, rank or preview a sidebar conversation", () => {
  it("issues NO query against the calls table at all", async () => {
    state.tableData.calls = [{ contact_id: "c1", contact_name: "X", direction: "outbound", created_at: "2026-08-26T00:00:00Z", disposition_name: "Sold" }];
    state.tableData.leads = [lead("c1", ME)];

    await messagesSupabaseApi.getRecentConversations(MINE);

    expect(queriesFor("calls")).toHaveLength(0);
  });

  it("a contact whose ONLY activity is a call does not appear", async () => {
    state.tableData.calls = [{ contact_id: "call-only", direction: "outbound", created_at: "2026-08-26T00:00:00Z", disposition_name: "Sold" }];
    state.tableData.messages = [sms("has-sms", "2026-08-01T00:00:00Z")];
    state.tableData.leads = [lead("call-only", ME), lead("has-sms", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out.map((r) => r.contact_id)).toEqual(["has-sms"]);
  });

  it("a newer call cannot outrank an older SMS", async () => {
    state.tableData.calls = [{ contact_id: "b", direction: "outbound", created_at: "2026-08-26T00:00:00Z", disposition_name: "Sold" }];
    state.tableData.messages = [
      sms("a", "2026-08-02T00:00:00Z"),
      sms("b", "2026-08-01T00:00:00Z"),
    ];
    state.tableData.leads = [lead("a", ME), lead("b", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    // Ranked purely by SMS recency; the 26 Aug call is invisible to the sidebar.
    expect(out.map((r) => r.contact_id)).toEqual(["a", "b"]);
    expect(out.map((r) => r.channel)).toEqual(["sms", "sms"]);
    expect(out.find((r) => r.contact_id === "b")?.last_message).toBe("sms-b");
  });
});

describe("calls remain visible in the opened contact's history", () => {
  it("getConversationThread still returns call rows", async () => {
    state.tableData.calls = [{ id: "k1", contact_id: "c1", started_at: "2026-08-05T00:00:00Z", created_at: "2026-08-05T00:00:00Z", disposition_name: "Sold" }];
    state.tableData.messages = [{ id: "m1", contact_id: "c1", sent_at: "2026-08-06T00:00:00Z", body: "hi" }];
    state.tableData.contact_emails = [{ id: "e1", contact_id: "c1", created_at: "2026-08-07T00:00:00Z", body_text: "hello" }];

    const thread = await messagesSupabaseApi.getConversationThread("c1");

    expect(thread.map((r) => r.type)).toEqual(["call", "sms", "email"]); // ascending by time
    expect(thread.find((r) => r.type === "call")?.description).toBe("Sold");
  });
});

describe("SMS recency uses the real event timestamp", () => {
  it("selects created_at AND sent_at, and orders by sent_at with nullsFirst: false", async () => {
    state.tableData.messages = [sms("a", "2026-08-01T00:00:00Z")];
    state.tableData.leads = [lead("a", ME)];

    await messagesSupabaseApi.getRecentConversations(MINE);

    const q = queriesFor("messages")[0];
    const cols = q.select.split(",").map((c) => c.trim());
    expect(cols).toContain("sent_at");
    expect(cols).toContain("created_at"); // the old code read it without selecting it
    expect(q.order[0]).toMatchObject({ column: "sent_at", ascending: false, nullsFirst: false });
  });

  it("a null sent_at ranks by created_at instead of producing an invalid date", async () => {
    state.tableData.messages = [
      { ...sms("legacy", null), created_at: "2026-08-10T00:00:00Z" },
      sms("normal", "2026-08-01T00:00:00Z"),
    ];
    state.tableData.leads = [lead("legacy", ME), lead("normal", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out.map((r) => r.contact_id)).toEqual(["legacy", "normal"]);
    for (const row of out) expect(Number.isNaN(Date.parse(row.last_message_at))).toBe(false);
  });
});

describe("email recency uses the real event timestamp, not sync-insert time", () => {
  it("inbound ranks by received_at and outbound by sent_at", async () => {
    state.tableData.contact_emails = [
      email("in", "inbound", { received_at: "2026-08-10T00:00:00Z", created_at: "2026-08-10T00:00:00Z" }),
      email("out", "outbound", { sent_at: "2026-08-11T00:00:00Z", created_at: "2026-08-11T00:00:00Z" }),
    ];
    state.tableData.leads = [lead("in", ME), lead("out", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out.map((r) => r.contact_id)).toEqual(["out", "in"]);
    const inboundQuery = queriesFor("contact_emails").find((q) => q.eq.direction === "inbound");
    const outboundQuery = queriesFor("contact_emails").find((q) => q.eq.direction === "outbound");
    expect(inboundQuery?.order[0]).toMatchObject({ column: "received_at", ascending: false, nullsFirst: false });
    expect(outboundQuery?.order[0]).toMatchObject({ column: "sent_at", ascending: false, nullsFirst: false });
  });

  it("a backfilled email does NOT jump to the top on its created_at", async () => {
    state.tableData.contact_emails = [
      // Received in January, synced today.
      email("backfilled", "inbound", { received_at: "2026-01-05T00:00:00Z", created_at: "2026-08-27T00:00:00Z" }),
      email("recent", "inbound", { received_at: "2026-08-20T00:00:00Z", created_at: "2026-08-20T00:00:00Z" }),
    ];
    state.tableData.leads = [lead("backfilled", ME), lead("recent", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out.map((r) => r.contact_id)).toEqual(["recent", "backfilled"]);
  });
});

describe("a user cannot receive another user's resolved contacts", () => {
  it("drops an org-wide SMS whose contact belongs to another agent", async () => {
    // `messages` RLS is organization-wide, so the DB legitimately returns both rows.
    state.tableData.messages = [
      sms("theirs", "2026-08-26T00:00:00Z"),
      sms("mine", "2026-08-01T00:00:00Z"),
    ];
    state.tableData.leads = [lead("theirs", OTHER), lead("mine", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out.map((r) => r.contact_id)).toEqual(["mine"]);
  });

  it("carries organization_id AND the correct owner column on every contact query", async () => {
    state.tableData.messages = [sms("mine", "2026-08-01T00:00:00Z")];
    state.tableData.leads = [lead("mine", ME)];

    await messagesSupabaseApi.getRecentConversations(MINE);

    const leadsQ = queriesFor("leads")[0];
    const clientsQ = queriesFor("clients")[0];
    const recruitsQ = queriesFor("recruits")[0];

    expect(leadsQ.eq.organization_id).toBe(ORG);
    expect(clientsQ.eq.organization_id).toBe(ORG);
    expect(recruitsQ.eq.organization_id).toBe(ORG);

    // Owner columns mirror the canonical server-side predicates.
    expect(leadsQ.in.user_id).toEqual([ME]);
    expect(clientsQ.in.assigned_agent_id).toEqual([ME]);
    expect(recruitsQ.in.assigned_agent_id).toEqual([ME]);
  });

  it("an organization-wide viewer filters by organization but not by owner", async () => {
    state.tableData.messages = [sms("theirs", "2026-08-26T00:00:00Z")];
    state.tableData.leads = [lead("theirs", OTHER)];

    const out = await messagesSupabaseApi.getRecentConversations(ORGWIDE);

    expect(out.map((r) => r.contact_id)).toEqual(["theirs"]);
    const leadsQ = queriesFor("leads")[0];
    expect(leadsQ.eq.organization_id).toBe(ORG);
    expect(leadsQ.in.user_id).toBeUndefined();
  });

  it("Team Leader recursive scope includes the downline and excludes a sibling branch", async () => {
    state.tableData.messages = [
      sms("downline-contact", "2026-08-03T00:00:00Z"),
      sms("sibling-contact", "2026-08-02T00:00:00Z"),
      sms("own-contact", "2026-08-01T00:00:00Z"),
    ];
    state.tableData.leads = [
      lead("downline-contact", DOWNLINE),
      lead("sibling-contact", OTHER),
      lead("own-contact", ME),
    ];

    const out = await messagesSupabaseApi.getRecentConversations(TEAM);

    expect(out.map((r) => r.contact_id)).toEqual(["downline-contact", "own-contact"]);
  });
});

describe("unresolved contacts are excluded, never fabricated", () => {
  it("produces no 'Unknown Contact' and never defaults contact_type to lead", async () => {
    state.tableData.messages = [
      sms("deleted-contact", "2026-08-26T00:00:00Z"),
      sms("real-client", "2026-08-01T00:00:00Z"),
    ];
    // `deleted-contact` resolves in no table at all.
    state.tableData.clients = [{ id: "real-client", assigned_agent_id: ME, organization_id: ORG, first_name: "Real", last_name: "Client", phone: "555", email: "c@example.com" }];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out.map((r) => r.contact_id)).toEqual(["real-client"]);
    expect(out.some((r) => r.contact_name === "Unknown Contact")).toBe(false);
    // The type comes from the table it actually resolved in — not a 'lead' default.
    expect(out[0].contact_type).toBe("client");
  });
});

describe("phone and email are selected so sending works", () => {
  it("populates contact_phone and contact_email", async () => {
    state.tableData.messages = [sms("mine", "2026-08-01T00:00:00Z")];
    state.tableData.leads = [lead("mine", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out[0].contact_phone).toBe("555-mine");
    expect(out[0].contact_email).toBe("mine@example.com");
    for (const q of [...queriesFor("leads"), ...queriesFor("clients"), ...queriesFor("recruits")]) {
      const cols = q.select.split(",").map((c) => c.trim());
      expect(cols).toContain("phone");
      expect(cols).toContain("email");
    }
  });
});

describe("unrelated activity cannot crowd out authorized conversations", () => {
  it("survives MORE THAN 2,000 newer unauthorized activities", async () => {
    // The whole organization is chattering. Every one of these rows is visible to this viewer
    // through the organization-wide `messages` policy, and every one is NEWER than the viewer's
    // own single conversation. Any pre-authorization cap on activity silently loses it.
    const foreign = Array.from({ length: 2500 }, (_, i) => {
      const id = `foreign-${String(i).padStart(4, "0")}`;
      // Strictly newer than the authorized row below.
      const ts = new Date(Date.UTC(2026, 7, 26, 0, 0, 0) + i * 1000).toISOString();
      return sms(id, ts);
    });
    state.tableData.messages = [...foreign, sms("mine", "2026-01-01T00:00:00Z")];
    state.tableData.leads = [
      ...foreign.map((m) => lead(m.contact_id as string, OTHER)),
      lead("mine", ME),
    ];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out.map((r) => r.contact_id)).toEqual(["mine"]);
  });

  it("returns the EXACT newest qualifying conversations, not a truncated approximation", async () => {
    // 2,500 unauthorized rows interleaved with three authorized ones of known order.
    const foreign = Array.from({ length: 2500 }, (_, i) =>
      sms(`foreign-${String(i).padStart(4, "0")}`,
        new Date(Date.UTC(2026, 7, 26, 0, 0, 0) + i * 1000).toISOString()));
    state.tableData.messages = [
      ...foreign,
      sms("mine-newest", "2026-08-25T00:00:00Z"),
      sms("mine-middle", "2026-08-24T00:00:00Z"),
      sms("mine-oldest", "2026-08-23T00:00:00Z"),
    ];
    state.tableData.leads = [
      ...foreign.map((m) => lead(m.contact_id as string, OTHER)),
      lead("mine-newest", ME), lead("mine-middle", ME), lead("mine-oldest", ME),
    ];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out.map((r) => r.contact_id)).toEqual(["mine-newest", "mine-middle", "mine-oldest"]);
  });

  it("scopes the activity query itself to the authorized contacts, not just the resolution", async () => {
    state.tableData.messages = [sms("mine", "2026-08-01T00:00:00Z")];
    state.tableData.leads = [lead("mine", ME)];

    await messagesSupabaseApi.getRecentConversations(MINE);

    // Every activity query must be constrained to the already-authorized contact set, so
    // unauthorized rows cannot occupy the window in the first place.
    const activity = [...queriesFor("messages"), ...queriesFor("contact_emails")];
    expect(activity.length).toBeGreaterThan(0);
    for (const q of activity) {
      const constrained = Array.isArray(q.in.contact_id) || Array.isArray(q.in.lead_id);
      expect(constrained, `query on ${q.table} was not constrained to the authorized set`).toBe(true);
    }
  });

  it("carries an explicit organization filter on organization-scoped activity reads", async () => {
    state.tableData.messages = [sms("theirs", "2026-08-26T00:00:00Z")];
    state.tableData.leads = [lead("theirs", OTHER)];

    await messagesSupabaseApi.getRecentConversations(ORGWIDE);

    for (const q of [...queriesFor("messages"), ...queriesFor("contact_emails")]) {
      expect(q.eq.organization_id).toBe(ORG);
    }
  });

  it("keeps paging past a full page that resolves to zero authorized contacts", async () => {
    // A full 200-row page of another agent's org-wide SMS, then one of ours behind it.
    const foreign = Array.from({ length: 200 }, (_, i) =>
      sms(`foreign-${String(i).padStart(3, "0")}`, `2026-08-26T00:00:${String(i % 60).padStart(2, "0")}Z`));
    state.tableData.messages = [...foreign, sms("mine", "2026-01-01T00:00:00Z")];
    state.tableData.leads = [
      ...foreign.map((m) => lead(m.contact_id as string, OTHER)),
      lead("mine", ME),
    ];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out.map((r) => r.contact_id)).toEqual(["mine"]);
    // Proof it actually paged rather than giving up on page 0.
    expect(queriesFor("messages").length).toBeGreaterThan(1);
  });
});

describe("failures surface instead of masquerading as an empty inbox", () => {
  it("rejects when the messages query errors", async () => {
    // An authorized contact must exist, otherwise there is correctly nothing to query for.
    state.tableData.leads = [lead("mine", ME)];
    state.tableError.messages = "permission denied for table messages";
    await expect(messagesSupabaseApi.getRecentConversations(MINE)).rejects.toThrow(/permission denied/);
  });

  it("rejects when enumerating the authorized contacts fails", async () => {
    state.tableError.leads = "permission denied for table leads";
    await expect(messagesSupabaseApi.getRecentConversations(MINE)).rejects.toThrow(/permission denied/);
  });

  it("rejects when a contact-resolution query errors", async () => {
    state.tableData.messages = [sms("mine", "2026-08-01T00:00:00Z")];
    state.tableError.clients = "boom";
    await expect(messagesSupabaseApi.getRecentConversations(MINE)).rejects.toThrow(/boom/);
    // Organization-wide viewers resolve contacts on the activity path, so they must reject too.
    await expect(messagesSupabaseApi.getRecentConversations(ORGWIDE)).rejects.toThrow(/boom/);
  });

  it("rejects when the thread query errors", async () => {
    state.tableError.calls = "calls exploded";
    await expect(messagesSupabaseApi.getConversationThread("c1")).rejects.toThrow(/calls exploded/);
  });
});

describe("fails closed", () => {
  it("a null scope issues no query and returns nothing", async () => {
    const out = await messagesSupabaseApi.getRecentConversations(null);
    expect(out).toEqual([]);
    expect(state.queries).toHaveLength(0);
  });

  it("an empty agent id set issues no query and returns nothing", async () => {
    const out = await messagesSupabaseApi.getRecentConversations({ kind: "agents", organizationId: ORG, agentIds: [] });
    expect(out).toEqual([]);
    expect(state.queries).toHaveLength(0);
  });
});

describe("resolveScopedContact — the deep-link guard", () => {
  it("returns the contact and its REAL type when it is in scope", async () => {
    state.tableData.clients = [{ id: "c1", assigned_agent_id: ME, organization_id: ORG, first_name: "In", last_name: "Scope", phone: "555", email: "c@example.com" }];
    const hit = await messagesSupabaseApi.resolveScopedContact("c1", MINE);
    expect(hit).toMatchObject({ contact_id: "c1", contact_type: "client", contact_name: "In Scope" });
  });

  it("returns null for a contact outside the viewer's scope", async () => {
    state.tableData.leads = [lead("theirs", OTHER)];
    expect(await messagesSupabaseApi.resolveScopedContact("theirs", MINE)).toBeNull();
  });

  it("returns null without querying when the scope is unresolved", async () => {
    expect(await messagesSupabaseApi.resolveScopedContact("c1", null)).toBeNull();
    expect(state.queries).toHaveLength(0);
  });
});


describe("per-source termination — one source must never settle another", () => {
  it("inbound email keeps paging even when SMS already satisfied the global limit", async () => {
    // limit = 1. SMS contributes ONE older valid contact, which at aafe3ba settled the shared
    // candidate count and stopped inbound email after its first page — a page consisting entirely
    // of orphaned contacts. The genuinely newest qualifying conversation sat on page two.
    // 200 orphans, ALL newer than `email-new`, so that inbound email page one is entirely
    // unresolvable and the valid contact genuinely lands on page two.
    const orphans = Array.from({ length: 200 }, (_, i) =>
      email(`orphan-${String(i).padStart(3, "0")}`, "inbound", {
        received_at: new Date(Date.UTC(2026, 7, 28, 0, 0, 0) + i * 1000).toISOString(),
      }));

    state.tableData.messages = [sms("sms-old", "2026-08-01T00:00:00Z")];
    state.tableData.contact_emails = [
      ...orphans,
      // Newer than the SMS, older than every orphan → inbound email PAGE TWO.
      email("email-new", "inbound", { received_at: "2026-08-27T00:00:00Z" }),
    ];
    // Only these two resolve; every orphan is unresolvable (hard-deleted contact).
    state.tableData.leads = [lead("sms-old", ME), lead("email-new", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(ORGWIDE, 1);

    expect(out.map((r) => r.contact_id)).toEqual(["email-new"]);
  });

  it("a source that exhausts its rows does not force other sources to stop", async () => {
    state.tableData.messages = [sms("sms-only", "2026-08-01T00:00:00Z")];
    state.tableData.contact_emails = [email("email-only", "outbound", { sent_at: "2026-08-02T00:00:00Z" })];
    state.tableData.leads = [lead("sms-only", ME), lead("email-only", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(ORGWIDE, 10);

    expect(out.map((r) => r.contact_id)).toEqual(["email-only", "sms-only"]);
  });
});

describe("legacy fallback timestamps must be able to WIN", () => {
  // Ordering by the nullable primary column with nulls last, then keeping the first row per
  // contact, made a newer fallback row lose to an older non-null primary row for the SAME contact.
  it("SMS: a newer null-sent_at row beats an older non-null sent_at row", async () => {
    state.tableData.messages = [
      { ...sms("c1", "2026-08-01T00:00:00Z"), body: "older-primary" },
      { ...sms("c1", null), created_at: "2026-08-20T00:00:00Z", body: "newer-fallback" },
    ];
    state.tableData.leads = [lead("c1", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out).toHaveLength(1);
    expect(out[0].last_message).toBe("newer-fallback");
    expect(out[0].last_message_at).toBe("2026-08-20T00:00:00Z");
  });

  it("inbound email: a newer null-received_at row beats an older non-null received_at row", async () => {
    state.tableData.contact_emails = [
      { ...email("c1", "inbound", { received_at: "2026-08-01T00:00:00Z" }), subject: "older-primary" },
      { ...email("c1", "inbound", { received_at: null, created_at: "2026-08-20T00:00:00Z" }), subject: "newer-fallback" },
    ];
    state.tableData.leads = [lead("c1", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out).toHaveLength(1);
    expect(out[0].last_message).toBe("newer-fallback");
    expect(out[0].last_message_at).toBe("2026-08-20T00:00:00Z");
  });

  it("outbound email: a newer null-sent_at row beats an older non-null sent_at row", async () => {
    state.tableData.contact_emails = [
      { ...email("c1", "outbound", { sent_at: "2026-08-01T00:00:00Z" }), subject: "older-primary" },
      { ...email("c1", "outbound", { sent_at: null, created_at: "2026-08-20T00:00:00Z" }), subject: "newer-fallback" },
    ];
    state.tableData.leads = [lead("c1", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out).toHaveLength(1);
    expect(out[0].last_message).toBe("newer-fallback");
    expect(out[0].last_message_at).toBe("2026-08-20T00:00:00Z");
  });

  // NOTE: correct at aafe3ba already — the organization-wide path pushes ALL rows and lets
  // `pickNewestPerContact` rank them, so it never had the first-row-wins defect. Kept as a
  // non-regression guard so the fix for the agent path cannot break it.
  it("the same rule holds on the organization-wide path", async () => {
    state.tableData.messages = [
      { ...sms("c1", "2026-08-01T00:00:00Z"), body: "older-primary" },
      { ...sms("c1", null), created_at: "2026-08-20T00:00:00Z", body: "newer-fallback" },
    ];
    state.tableData.leads = [lead("c1", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(ORGWIDE);

    expect(out).toHaveLength(1);
    expect(out[0].last_message).toBe("newer-fallback");
  });

  it("a non-null primary still wins when it is genuinely newer", async () => {
    state.tableData.messages = [
      { ...sms("c1", "2026-08-25T00:00:00Z"), body: "newer-primary" },
      { ...sms("c1", null), created_at: "2026-08-01T00:00:00Z", body: "older-fallback" },
    ];
    state.tableData.leads = [lead("c1", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out[0].last_message).toBe("newer-primary");
  });
});

describe("every agent-scoped activity query carries an explicit organization predicate", () => {
  it("organization_id is present alongside the authorized contact filter on all four sources", async () => {
    state.tableData.messages = [sms("mine", "2026-08-01T00:00:00Z")];
    state.tableData.contact_emails = [
      email("mine", "inbound", { received_at: "2026-08-02T00:00:00Z" }),
      email("mine", "outbound", { sent_at: "2026-08-03T00:00:00Z" }),
    ];
    state.tableData.leads = [lead("mine", ME)];

    await messagesSupabaseApi.getRecentConversations(MINE);

    const activity = [...queriesFor("messages"), ...queriesFor("contact_emails")];
    expect(activity.length).toBeGreaterThan(0);
    for (const q of activity) {
      // Neither RLS nor UUID uniqueness is the application boundary (AGENT_RULES §3).
      expect(q.eq.organization_id, `${q.table} missing organization predicate`).toBe(ORG);
      // …and the authorized-contact constraint is still there.
      const constrained = Array.isArray(q.in.contact_id) || Array.isArray(q.in.lead_id);
      expect(constrained, `${q.table} not constrained to the authorized set`).toBe(true);
    }
  });

  it("a contact belonging to another organization cannot be reached even with a matching id", async () => {
    // Same contact id, different organization: only the organization predicate excludes it.
    state.tableData.messages = [{ ...sms("mine", "2026-08-01T00:00:00Z"), organization_id: "org-other" }];
    state.tableData.leads = [lead("mine", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out).toEqual([]);
  });

  it("the contact-enumeration queries are organization-scoped too", async () => {
    state.tableData.leads = [lead("mine", ME)];
    await messagesSupabaseApi.getRecentConversations(MINE);

    for (const q of [...queriesFor("leads"), ...queriesFor("clients"), ...queriesFor("recruits")]) {
      expect(q.eq.organization_id).toBe(ORG);
    }
  });
});

describe("the skew fallback stays tightly bounded", () => {
  it("requests only the newest row per unresolved contact, not a full page", async () => {
    // One contact floods the batch's page budget so the per-contact fallback is exercised.
    const flood = Array.from({ length: 700 }, (_, i) =>
      sms("loud", new Date(Date.UTC(2026, 7, 26, 0, 0, 0) + i * 1000).toISOString()));
    state.tableData.messages = [...flood, sms("quiet", "2026-01-01T00:00:00Z")];
    state.tableData.leads = [lead("loud", ME), lead("quiet", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out.map((r) => r.contact_id).sort()).toEqual(["loud", "quiet"]);

    // The fallback lookups are single-contact queries and must ask for ONE row, not 200.
    const singleContactQueries = queriesFor("messages").filter(
      (q) => Array.isArray(q.in.contact_id) && q.in.contact_id.length === 1,
    );
    expect(singleContactQueries.length).toBeGreaterThan(0);
    for (const q of singleContactQueries) {
      const windowSize = q.range ? q.range.to - q.range.from + 1 : q.limit;
      expect(windowSize, "skew fallback must request a single row").toBe(1);
    }
  });
});

describe("the activity fan-out is explicitly bounded", () => {
  // Splitting every source on its primary timestamp doubled the number of queries per sidebar
  // load. These assertions make that count a decision rather than a side effect: growing it again
  // fails here first. The single-query alternative (a database view or RPC) is Phase B.
  it("pins the source count and page budgets", () => {
    expect(ACTIVITY_QUERY_BUDGET.sourceCount).toBe(8);
    expect(ACTIVITY_QUERY_BUDGET.orgSweepSourceCount).toBe(6);
    expect(ACTIVITY_QUERY_BUDGET.pageSize).toBe(200);
    expect(ACTIVITY_QUERY_BUDGET.contactBatchSize).toBe(100);
    expect(ACTIVITY_QUERY_BUDGET.maxPagesPerBatch).toBe(3);
    expect(ACTIVITY_QUERY_BUDGET.orgMaxPages).toBe(25);
  });

  it("an ordinary agent load issues exactly one query per source", async () => {
    state.tableData.messages = [sms("a", "2026-08-01T00:00:00Z")];
    state.tableData.contact_emails = [email("a", "inbound", { received_at: "2026-08-02T00:00:00Z" })];
    state.tableData.leads = [lead("a", ME)];

    await messagesSupabaseApi.getRecentConversations(MINE);

    // Every source's first page is short, so each terminates immediately: no second page, no
    // per-contact skew fallback.
    const activity = [...queriesFor("messages"), ...queriesFor("contact_emails")];
    expect(activity).toHaveLength(ACTIVITY_QUERY_BUDGET.sourceCount);
  });

  it("an organization-wide load skips the sources covered by a sibling", async () => {
    state.tableData.messages = [sms("a", "2026-08-01T00:00:00Z")];
    state.tableData.contact_emails = [email("a", "inbound", { received_at: "2026-08-02T00:00:00Z" })];
    state.tableData.leads = [lead("a", ME)];

    await messagesSupabaseApi.getRecentConversations(ORGWIDE);

    const activity = [...queriesFor("messages"), ...queriesFor("contact_emails")];
    expect(activity).toHaveLength(ACTIVITY_QUERY_BUDGET.orgSweepSourceCount);
    // The skipped sources are exactly the legacy lead_id ones, whose rows the organization-wide
    // SMS sweep already reads.
    expect(activity.filter((q) => Array.isArray(q.in.lead_id))).toEqual([]);
  });
});

describe("paging exhaustion follows the RAW database page, not the mapped candidate count", () => {
  // `makeSource().read()` maps rows through `toCandidate` before returning them, and the sweep
  // loops used that MAPPED length to decide whether the database page was exhausted. Both link
  // columns on `messages` are nullable (and the legacy `lead_id` FK is ON DELETE SET NULL), so a
  // full 200-row page can map to ZERO candidates — which read as "the table is exhausted" and
  // silently stopped the sweep one page short of a real conversation.
  //
  // FIXTURE ORDERING IS THE WHOLE TEST: the orphans must be NEWER than the valid row, so the valid
  // row genuinely lands on raw page TWO. Dated the other way round it sits on page one and the
  // test passes at 8a45e2c for the wrong reason.
  const orphanSms = (i: number) => ({
    ...sms("unused", null),
    contact_id: null,
    lead_id: null,
    sent_at: new Date(Date.UTC(2026, 7, 28, 0, 0, 0) + i * 1000).toISOString(),
    created_at: new Date(Date.UTC(2026, 7, 28, 0, 0, 0) + i * 1000).toISOString(),
  });

  const orphanEmail = (i: number) => ({
    ...email("unused", "inbound", {
      received_at: new Date(Date.UTC(2026, 7, 28, 0, 0, 0) + i * 1000).toISOString(),
    }),
    contact_id: null,
  });

  it("a full raw page of SMS with BOTH link columns null does not end the organization sweep", async () => {
    state.tableData.messages = [
      ...Array.from({ length: 200 }, (_, i) => orphanSms(i)),
      // Older than every orphan, so it is on raw page TWO of the sms:contact_id source.
      sms("real-sms", "2026-08-27T00:00:00Z"),
    ];
    state.tableData.leads = [lead("real-sms", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(ORGWIDE);

    // The outcome is the defect: a real conversation must not be lost behind a page of orphans,
    // whether the sweep reaches it by paging past them (raw-count exhaustion) or by never fetching
    // them at all (the link predicate). Both properties are asserted separately below.
    expect(out.map((r) => r.contact_id)).toEqual(["real-sms"]);
  });

  it("a full raw page of emails with a null contact_id does not end the organization sweep", async () => {
    state.tableData.contact_emails = [
      ...Array.from({ length: 200 }, (_, i) => orphanEmail(i)),
      email("real-email", "inbound", { received_at: "2026-08-27T00:00:00Z" }),
    ];
    state.tableData.leads = [lead("real-email", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(ORGWIDE);

    expect(out.map((r) => r.contact_id)).toEqual(["real-email"]);
  });

  it("the organization sweep asks the database to exclude unlinked rows", async () => {
    // Raw-count paging keeps an unlinked page from reading as an exhausted table, but on its own it
    // lets orphans burn the page budget — and the budget running out THROWS. Excluding them in the
    // query is what keeps the budget spent on rows that can actually become conversations.
    state.tableData.messages = [sms("real-sms", "2026-08-01T00:00:00Z")];
    state.tableData.contact_emails = [email("real-email", "inbound", { received_at: "2026-08-02T00:00:00Z" })];
    state.tableData.leads = [lead("real-sms", ME), lead("real-email", ME)];

    await messagesSupabaseApi.getRecentConversations(ORGWIDE);

    for (const q of queriesFor("messages")) {
      expect(q.or, "sms org sweep must exclude rows with no contact link")
        .toContain("contact_id.not.is.null,lead_id.not.is.null");
    }
    for (const q of queriesFor("contact_emails")) {
      expect(
        q.not.some((n) => n.column === "contact_id" && n.operator === "is" && n.value === null),
        "email org sweep must exclude rows with a null contact_id",
      ).toBe(true);
    }
  });

  it("orphans beyond the entire page budget still do not break the sidebar", async () => {
    // ORG_ACTIVITY_MAX_PAGES (25) x ACTIVITY_PAGE_SIZE (200) = 5,000. Before the link predicate, that
    // many orphans exhausted the budget and threw — a total sidebar outage on data the application's
    // own `ON DELETE SET NULL` produces.
    const orphans = Array.from({ length: 5200 }, (_, i) => orphanSms(i));
    state.tableData.messages = [...orphans, sms("real-sms", "2026-08-27T00:00:00Z")];
    state.tableData.leads = [lead("real-sms", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(ORGWIDE);

    expect(out.map((r) => r.contact_id)).toEqual(["real-sms"]);
  });

  // NOTE, honestly: PASSES at 8a45e2c. It is a non-regression guard that adding the link predicate
  // did not quietly remove the surfaced bound, not a proof of the defect.
  it("the page-budget error still fires when genuinely-linked rows exhaust it", async () => {
    // The surfaced bound must survive the change: an explicit, recoverable error, never a quietly
    // short list. Every row here IS linked, so the link predicate cannot rescue it.
    const noisy = Array.from({ length: 5200 }, (_, i) =>
      sms(`unresolvable-${i}`, new Date(Date.UTC(2026, 7, 28, 0, 0, 0) + i * 1000).toISOString()));
    state.tableData.messages = noisy;
    state.tableData.leads = []; // none of them resolve, so no source ever reaches `limit`

    await expect(messagesSupabaseApi.getRecentConversations(ORGWIDE)).rejects.toThrow(
      /too much recent activity/i,
    );
  });

  // NOTE, honestly: the two guards below PASS at 8a45e2c. They are non-regression guards on the
  // counterpart risks of switching to a raw count, not proofs of the defect.
  it("a genuinely short raw page still settles the source without an extra query", async () => {
    // Switching to a raw count must not make every source page forever.
    state.tableData.messages = [sms("only", "2026-08-01T00:00:00Z")];
    state.tableData.leads = [lead("only", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(ORGWIDE);

    expect(out.map((r) => r.contact_id)).toEqual(["only"]);
    expect(queriesFor("messages").filter((q) => q.range && q.range.from > 0)).toEqual([]);
  });

  it("an unlinked row is still never surfaced as a conversation", async () => {
    // Raw cardinality drives PAGING only. An orphaned row must not become a sidebar row.
    state.tableData.messages = [orphanSms(0), sms("real-sms", "2026-08-01T00:00:00Z")];
    state.tableData.leads = [lead("real-sms", ME)];

    const out = await messagesSupabaseApi.getRecentConversations(ORGWIDE);

    expect(out.map((r) => r.contact_id)).toEqual(["real-sms"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("a RESOLVED contact with no name still gets a usable label", () => {
  /**
   * THE DEFECT. `displayName` joins the two name parts and returns the EMPTY STRING when both are
   * blank — honest, but unrenderable. Combined with `Conversations.tsx` dropping its old
   * `|| "Unknown"` fallback, a contact with no name on file rendered blank avatar initials, a blank
   * sidebar row title AND a blank thread header, so the conversation looked broken rather than
   * merely unnamed. (`main` rendered "null null" in the sidebar and "Unknown" in the header —
   * neither was good, and the branch made it worse.)
   *
   * The fix is a deterministic ladder — name, else phone, else email, else a constant — sourced
   * from the SAME contact row, so nothing is invented. It applies only to contacts that RESOLVED:
   * an unresolved row has no contact record, so no phone, no email and no known type, and
   * labelling one would mean fabricating a `contact_type`. Those are still dropped.
   */
  it("falls back to the phone number", async () => {
    state.tableData.leads = [lead("nameless", ME, { first_name: "", last_name: "", phone: "+15551234567" })];
    state.tableData.messages = [sms("nameless", "2026-08-01T00:00:00Z")];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out).toHaveLength(1);
    expect(out[0].contact_name).toBe("+15551234567");
  });

  it("falls back to the email when there is no phone", async () => {
    state.tableData.leads = [
      lead("nameless", ME, { first_name: null, last_name: null, phone: "", email: "who@example.com" }),
    ];
    state.tableData.messages = [sms("nameless", "2026-08-01T00:00:00Z")];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out[0].contact_name).toBe("who@example.com");
  });

  it("falls back to a constant when the row has neither", async () => {
    state.tableData.leads = [
      lead("nameless", ME, { first_name: "  ", last_name: "", phone: null, email: null }),
    ];
    state.tableData.messages = [sms("nameless", "2026-08-01T00:00:00Z")];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out[0].contact_name).toBe("Unnamed contact");
    // Never blank — that is the whole defect.
    expect(out[0].contact_name.trim().length).toBeGreaterThan(0);
  });

  it("carries the REAL contact type, never a fabricated one", async () => {
    // The label must not become a route into inventing identity. The type still comes from the
    // table the contact was found in.
    state.tableData.leads = [lead("nameless", ME, { first_name: "", last_name: "", phone: "+15550000000" })];
    state.tableData.messages = [sms("nameless", "2026-08-01T00:00:00Z")];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out[0].contact_type).toBe("lead");
  });

  it("an UNRESOLVED row is still dropped — it is not given a label", async () => {
    // The forbidden behaviour: a message whose contact does not resolve has no row behind it, so
    // it has no phone, no email and no type. It must not surface as an "Unnamed contact".
    state.tableData.leads = [lead("real", ME)];
    state.tableData.messages = [
      sms("real", "2026-08-01T00:00:00Z"),
      sms("ghost-not-in-any-table", "2026-08-02T00:00:00Z"),
    ];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out.map((r) => r.contact_id)).toEqual(["real"]);
    expect(out.map((r) => r.contact_name)).not.toContain("Unnamed contact");
  });

  it("a named contact is unaffected", async () => {
    // POSITIVE CONTROL — passes at b29dc9f.
    state.tableData.leads = [lead("named", ME, { first_name: "Ada", last_name: "Byron" })];
    state.tableData.messages = [sms("named", "2026-08-01T00:00:00Z")];

    const out = await messagesSupabaseApi.getRecentConversations(MINE);

    expect(out[0].contact_name).toBe("Ada Byron");
  });
});
