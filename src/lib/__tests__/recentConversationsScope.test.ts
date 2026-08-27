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
      table, select: "*", eq: {}, in: {}, is: {}, or: [], order: [], range: null, limit: null,
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

import { messagesSupabaseApi } from "@/lib/supabase-messages";
import type { ConversationScope } from "@/lib/conversationScope";

const ORG = "org-1";
const ME = "agent-me";
const OTHER = "agent-other";
const DOWNLINE = "agent-downline";

const MINE: ConversationScope = { kind: "agents", organizationId: ORG, agentIds: [ME] };
const TEAM: ConversationScope = { kind: "agents", organizationId: ORG, agentIds: [ME, DOWNLINE] };
const ORGWIDE: ConversationScope = { kind: "org", organizationId: ORG };

function lead(id: string, owner: string, extra: Record<string, unknown> = {}) {
  return {
    id, user_id: owner, assigned_agent_id: owner, organization_id: ORG,
    first_name: "Lead", last_name: id, phone: `555-${id}`, email: `${id}@example.com`, ...extra,
  };
}

function sms(contactId: string, sentAt: string | null, extra: Record<string, unknown> = {}) {
  return {
    contact_id: contactId, lead_id: null, body: `sms-${contactId}`,
    sent_at: sentAt, created_at: sentAt, direction: "outbound", organization_id: ORG, ...extra,
  };
}

function email(contactId: string, direction: "inbound" | "outbound", ts: Record<string, unknown>) {
  return {
    contact_id: contactId, subject: `subject-${contactId}`, body_text: "body",
    direction, received_at: null, sent_at: null, created_at: null,
    organization_id: ORG, owner_user_id: ME, ...ts,
  };
}

function queriesFor(table: string) {
  return state.queries.filter((q) => q.table === table);
}

beforeEach(() => {
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
