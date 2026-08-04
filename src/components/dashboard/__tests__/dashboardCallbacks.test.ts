import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The dual-source callback contract, asserted against the IMPORTED production module.
 *
 * The Supabase mock records the full filter chain each branch builds, so the tests can
 * prove that the ROWS query and the COUNT query are constructed from the same predicate
 * — making divergence between the widget list, the widget total and the detail list
 * structurally impossible rather than merely unlikely.
 */

type Call = { table: string; filters: string[]; ors: string[]; head: boolean; limit: number | null; orders: string[] };

const { state } = vi.hoisted(() => ({
  state: {
    calls: [] as Call[],
    rows: {} as Record<string, any[]>,
    counts: {} as Record<string, number>,
    /** Inject a Supabase error per branch key ("campaign-due" | "campaign-legacy" | "appointment"). */
    rowErrors: {} as Record<string, any>,
    countErrors: {} as Record<string, any>,
    /** Inject an error per contact table. */
    contactErrors: {} as Record<string, any>,
    /**
     * When set for a branch, that branch's query returns a promise this test controls.
     * Lets a stale request be resolved AFTER a newer one without relying on timers.
     */
    deferred: {} as Record<string, { promise: Promise<any>; settle: (v: any) => void }>,
    /** Count of row queries issued per branch — proves pagination serialization. */
    rowQueryCount: {} as Record<string, number>,
    contacts: {
      leads: [] as any[],
      clients: [] as any[],
      recruits: [] as any[],
    },
  },
}));

/** Branch key derived from the recorded filters, so fixtures can target each branch. */
function branchKey(c: Call): string {
  if (c.table === "appointments") return "appointment";
  // Any table outside the callback sources gets its own key (e.g. "calls"), so a
  // non-callback query can be deferred independently of `campaign-due`.
  if (c.table !== "campaign_leads") return c.table;
  if (c.filters.some((f) => f === 'is:callback_due_at=null')) return "campaign-legacy";
  return "campaign-due";
}

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const rec: Call = { table, filters: [], ors: [], head: false, limit: null, orders: [] };
    const b: any = {
      __rec: rec,
      select: (_cols: string, opts?: any) => {
        if (opts?.head) rec.head = true;
        return b;
      },
      gte: (c: string, v: string) => { rec.filters.push(`gte:${c}=${v}`); return b; },
      lt: (c: string, v: string) => { rec.filters.push(`lt:${c}=${v}`); return b; },
      eq: (c: string, v: string) => { rec.filters.push(`eq:${c}=${v}`); return b; },
      is: (c: string, v: any) => { rec.filters.push(`is:${c}=${v}`); return b; },
      not: (c: string, op: string, v: any) => { rec.filters.push(`not:${c}:${op}=${v}`); return b; },
      in: (c: string, v: any[]) => { rec.filters.push(`in:${c}=${v.join("|")}`); return b; },
      or: (expr: string) => { rec.ors.push(expr); return b; },
      order: (c: string, o?: any) => { rec.orders.push(`${c}:${o?.ascending ? "asc" : "desc"}`); return b; },
      limit: (n: number) => { rec.limit = n; return b; },
      range: (_from: number, _to: number) => b,
      then: (resolve: any) => {
        state.calls.push(rec);
        const key = branchKey(rec);
        if (rec.head) {
          const err = state.countErrors[key] ?? null;
          return Promise.resolve(
            resolve(err ? { count: null, error: err } : { count: state.counts[key] ?? 0, error: null }),
          );
        }
        state.rowQueryCount[key] = (state.rowQueryCount[key] ?? 0) + 1;
        const d = state.deferred[key];
        if (d) return d.promise.then((payload: any) => resolve(payload));
        const err = state.rowErrors[key] ?? null;
        return Promise.resolve(
          resolve(err ? { data: null, error: err } : { data: state.rows[key] ?? [], error: null }),
        );
      },
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "leads" || table === "clients" || table === "recruits") {
          return {
            select: () => ({
              in: (_c: string, ids: string[]) => {
                const err = state.contactErrors[table] ?? null;
                return Promise.resolve(
                  err
                    ? { data: null, error: err }
                    : {
                        data: (state.contacts as any)[table].filter((r: any) => ids.includes(r.id)),
                        error: null,
                      },
                );
              },
            }),
          };
        }
        return makeBuilder(table);
      },
    },
  };
});

vi.mock("react-router-dom", () => ({ useNavigate: () => () => {} }));
vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "11111111-1111-1111-1111-111111111111" }, profile: { role: "Agent" } }),
}));

import {
  APPOINTMENT_CALLBACK_TYPES,
  ownershipOrExpression,
  TERMINAL_CAMPAIGN_LEAD_STATUSES,
  bucketCallback,
  callbackBranches,
  compareCallbackRows,
  fetchCallbackPage,
  fetchCallbackTotal,
  normalizeCampaignRow,
  type NormalizedCallbackRow,
} from "@/lib/dashboard-callbacks";
import { DashboardQueryError } from "@/lib/dashboard-contact-identity";

const ME = "11111111-1111-1111-1111-111111111111";
const LEAD_A = "1ead0000-0000-0000-0000-00000000000a";
const LEAD_B = "1ead0000-0000-0000-0000-00000000000b";
const REF = new Date(2026, 7, 3, 12, 0, 0); // 2026-08-03 12:00 local

const scope = { isFiltered: true, userId: ME, reference: REF };

const OTHER = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  state.calls = [];
  state.rows = {};
  state.counts = {};
  state.rowErrors = {};
  state.countErrors = {};
  state.contactErrors = {};
  state.deferred = {};
  state.rowQueryCount = {};
  state.contacts.leads = [
    { id: LEAD_A, first_name: "Lee", last_name: "Ann", phone: "5551110001" },
    { id: LEAD_B, first_name: "Bo", last_name: "Bee", phone: "5551110002" },
  ];
  state.contacts.clients = [];
  state.contacts.recruits = [];
});

describe("both callback sources are queried", () => {
  it("declares three mutually exclusive branches across two tables", () => {
    const b = callbackBranches();
    expect(b.map((x) => x.id)).toEqual(["campaign-due", "campaign-legacy", "appointment"]);
    expect(b.map((x) => x.table)).toEqual(["campaign_leads", "campaign_leads", "appointments"]);
  });

  it("queries campaign_leads AND appointments for rows", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    const tables = new Set(state.calls.map((c) => c.table));
    expect(tables.has("campaign_leads")).toBe(true);
    expect(tables.has("appointments")).toBe(true);
  });

  it("queries all three branches for the count", async () => {
    await fetchCallbackTotal(scope);
    expect(state.calls.filter((c) => c.head)).toHaveLength(3);
  });
});

describe("ownership uses the field that belongs to each source", () => {
  it("campaign branches own by callback_agent_id, never appointments.user_id", () => {
    const campaign = callbackBranches().filter((b) => b.table === "campaign_leads");
    expect(campaign.every((b) => b.ownerColumn === "callback_agent_id")).toBe(true);
  });

  it("the appointment branch owns by user_id", () => {
    expect(callbackBranches().find((b) => b.table === "appointments")!.ownerColumn).toBe("user_id");
  });

  it("personal filtering applies callback_agent_id to campaign_leads and user_id to appointments", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    const campaign = state.calls.filter((c) => c.table === "campaign_leads");
    const appt = state.calls.filter((c) => c.table === "appointments");
    expect(campaign.every((c) => c.filters.includes(`eq:callback_agent_id=${ME}`))).toBe(true);
    expect(campaign.some((c) => c.filters.some((f) => f.startsWith("eq:user_id=")))).toBe(false);
    expect(appt.every((c) => c.ors.includes(ownershipOrExpression(ME)))).toBe(true);
    // No bare top-level user_id equality — that is what deleted the compatibility rows.
    expect(appt.some((c) => c.filters.some((f) => f.startsWith("eq:user_id=")))).toBe(false);
  });

  it("no ownership filter is applied when not personally filtered (existing Admin behavior)", async () => {
    await fetchCallbackPage({ isFiltered: false, userId: ME, reference: REF, pageSize: 15 });
    expect(
      state.calls.some((c) =>
        c.filters.some((f) => f.startsWith("eq:callback_agent_id=") || f.startsWith("eq:user_id=")),
      ),
    ).toBe(false);
    expect(state.calls.every((c) => c.ors.length === 0)).toBe(true);
  });

  it("sends no user-id list — no Team/Agency hierarchy expansion", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    expect(state.calls.some((c) => c.filters.some((f) => f.startsWith("in:callback_agent_id")))).toBe(false);
    expect(state.calls.some((c) => c.filters.some((f) => f.startsWith("in:user_id")))).toBe(false);
    expect(state.calls.some((c) => c.filters.some((f) => f.startsWith("in:created_by")))).toBe(false);
  });
});

describe("compatibility timestamp: callback_due_at wins, no double count", () => {
  it("the due branch requires callback_due_at NOT NULL", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    const due = state.calls.find((c) => branchKey(c) === "campaign-due" && !c.head)!;
    expect(due.filters).toContain("not:callback_due_at:is=null");
    expect(due.filters.some((f) => f.startsWith("gte:callback_due_at"))).toBe(true);
    expect(due.orders[0]).toBe("callback_due_at:asc");
  });

  it("the legacy branch requires callback_due_at IS NULL AND scheduled_callback_at NOT NULL", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    const legacy = state.calls.find((c) => branchKey(c) === "campaign-legacy" && !c.head)!;
    expect(legacy.filters).toContain("is:callback_due_at=null");
    expect(legacy.filters).toContain("not:scheduled_callback_at:is=null");
    expect(legacy.filters.some((f) => f.startsWith("gte:scheduled_callback_at"))).toBe(true);
    expect(legacy.orders[0]).toBe("scheduled_callback_at:asc");
  });

  it("the two campaign branches are mutually exclusive, so a row cannot be counted twice", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    const due = state.calls.find((c) => branchKey(c) === "campaign-due" && !c.head)!;
    const legacy = state.calls.find((c) => branchKey(c) === "campaign-legacy" && !c.head)!;
    expect(due.filters).toContain("not:callback_due_at:is=null");
    expect(legacy.filters).toContain("is:callback_due_at=null");
  });

  it("normalization prefers callback_due_at when BOTH columns are populated", () => {
    const row = normalizeCampaignRow(
      {
        id: "cl-1", lead_id: LEAD_A, first_name: "Lee", last_name: "Ann", phone: "5551110001",
        callback_due_at: "2026-08-03T17:00:00.000Z",
        scheduled_callback_at: "2026-08-01T17:00:00.000Z",
        callback_note: "note", status: "Called",
      },
      callbackBranches()[0],
      new Map(),
    );
    expect(row.dueAt).toBe("2026-08-03T17:00:00.000Z");
  });

  it("normalization uses scheduled_callback_at ONLY when callback_due_at is null", () => {
    const row = normalizeCampaignRow(
      {
        id: "cl-2", lead_id: LEAD_A, callback_due_at: null,
        scheduled_callback_at: "2026-08-02T17:00:00.000Z", status: "Called",
      },
      callbackBranches()[1],
      new Map(),
    );
    expect(row.dueAt).toBe("2026-08-02T17:00:00.000Z");
  });
});

describe("terminal campaign statuses are excluded from the canonical branches", () => {
  it("uses the canonical AGENT_RULES #15 list", () => {
    expect([...TERMINAL_CAMPAIGN_LEAD_STATUSES]).toEqual(["DNC", "Completed", "Removed", "Failed"]);
  });

  it("both campaign branches exclude them (a terminal lead can hold a stale timestamp)", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    const campaign = state.calls.filter((c) => c.table === "campaign_leads");
    expect(campaign.every((c) => c.filters.includes("not:status:in=(DNC,Completed,Removed,Failed)"))).toBe(true);
  });

  it("the appointment branch uses its own type/status predicate", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    const appt = state.calls.find((c) => c.table === "appointments" && !c.head)!;
    expect(appt.filters).toContain(`in:type=${APPOINTMENT_CALLBACK_TYPES.join("|")}`);
    expect(appt.filters).toContain("eq:status=Scheduled");
  });
});

describe("rows, count and detail describe the SAME bounded set", () => {
  const dataFilters = (c: Call) => c.filters.filter((f) => !f.startsWith("limit"));

  it("the count query filters are identical to the rows query filters, per branch", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    const rowCalls = state.calls.filter((c) => !c.head);
    state.calls = [];
    await fetchCallbackTotal(scope);
    const countCalls = state.calls.filter((c) => c.head);

    expect(countCalls).toHaveLength(rowCalls.length);
    for (const rc of rowCalls) {
      const cc = countCalls.find((c) => branchKey(c) === branchKey(rc))!;
      expect(cc).toBeDefined();
      expect(dataFilters(cc).sort()).toEqual(dataFilters(rc).sort());
    }
  });

  it("the widget page and the detail page use identical filters (only page size differs)", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    const widget = state.calls.filter((c) => !c.head);
    state.calls = [];
    await fetchCallbackPage({ ...scope, pageSize: 20 });
    const detail = state.calls.filter((c) => !c.head);

    for (const w of widget) {
      const d = detail.find((c) => branchKey(c) === branchKey(w))!;
      expect(dataFilters(d).sort()).toEqual(dataFilters(w).sort());
    }
    expect(widget[0].limit).not.toBe(detail[0].limit);
  });

  it("all branches share one calendar window", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    const bounds = state.calls
      .filter((c) => !c.head)
      .map((c) => c.filters.filter((f) => f.startsWith("gte:") || f.startsWith("lt:")).map((f) => f.split("=")[1]).join("|"));
    expect(new Set(bounds).size).toBe(1);
  });
});

describe("exact total is independent of page length", () => {
  it("sums the mutually exclusive branch counts", async () => {
    state.counts = { "campaign-due": 30, "campaign-legacy": 5, appointment: 7 };
    expect(await fetchCallbackTotal(scope)).toBe(42);
  });

  it("returns a total far larger than the page size", async () => {
    state.counts = { "campaign-due": 100, "campaign-legacy": 0, appointment: 0 };
    const total = await fetchCallbackTotal(scope);
    state.calls = [];
    const rows = await fetchCallbackPage({ ...scope, pageSize: 15 });
    expect(total).toBe(100);
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(total).not.toBe(rows.length);
  });

  it("uses head:true count queries, never a data length", async () => {
    await fetchCallbackTotal(scope);
    expect(state.calls.every((c) => c.head)).toBe(true);
  });
});

describe("global ordering and pagination across interleaved sources", () => {
  const campaignRow = (n: number, iso: string) => ({
    id: `cl-${n}`, lead_id: LEAD_A, callback_due_at: iso, scheduled_callback_at: null, status: "Called",
    first_name: "Lee", last_name: "Ann", phone: "5551110001",
  });
  const apptRow = (n: number, iso: string) => ({
    id: `ap-${n}`, contact_id: LEAD_B, contact_name: "Bo Bee", start_time: iso, type: "Follow Up", notes: null,
  });

  beforeEach(() => {
    // Deliberately interleaved: campaign at 01/03/05, appointment at 02/04/06.
    state.rows["campaign-due"] = [
      campaignRow(1, "2026-08-03T01:00:00.000Z"),
      campaignRow(3, "2026-08-03T03:00:00.000Z"),
      campaignRow(5, "2026-08-03T05:00:00.000Z"),
    ];
    state.rows["appointment"] = [
      apptRow(2, "2026-08-03T02:00:00.000Z"),
      apptRow(4, "2026-08-03T04:00:00.000Z"),
      apptRow(6, "2026-08-03T06:00:00.000Z"),
    ];
  });

  it("merges into one globally ordered stream", async () => {
    const rows = await fetchCallbackPage({ ...scope, pageSize: 10 });
    expect(rows.map((r) => r.dueAt)).toEqual([
      "2026-08-03T01:00:00.000Z", "2026-08-03T02:00:00.000Z", "2026-08-03T03:00:00.000Z",
      "2026-08-03T04:00:00.000Z", "2026-08-03T05:00:00.000Z", "2026-08-03T06:00:00.000Z",
    ]);
    expect(rows.map((r) => r.source)).toEqual(
      ["campaign", "appointment", "campaign", "appointment", "campaign", "appointment"],
    );
  });

  it("paginates with NO gaps and NO duplicates when sources interleave", async () => {
    const p0 = await fetchCallbackPage({ ...scope, pageSize: 2, offset: 0 });
    state.calls = [];
    const p1 = await fetchCallbackPage({ ...scope, pageSize: 2, offset: 2 });
    state.calls = [];
    const p2 = await fetchCallbackPage({ ...scope, pageSize: 2, offset: 4 });

    const keys = [...p0, ...p1, ...p2].map((r) => r.key);
    expect(keys).toHaveLength(6);
    expect(new Set(keys).size).toBe(6); // no duplicates
    expect([...p0, ...p1, ...p2].map((r) => r.dueAt)).toEqual([
      "2026-08-03T01:00:00.000Z", "2026-08-03T02:00:00.000Z", "2026-08-03T03:00:00.000Z",
      "2026-08-03T04:00:00.000Z", "2026-08-03T05:00:00.000Z", "2026-08-03T06:00:00.000Z",
    ]);
  });

  it("fetches each branch to offset + pageSize so the union covers the global window", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 2, offset: 4 });
    expect(state.calls.filter((c) => !c.head).every((c) => c.limit === 6)).toBe(true);
  });

  it("breaks ties deterministically by source rank then row id", () => {
    const mk = (source: "campaign" | "appointment", id: string): NormalizedCallbackRow => ({
      key: `${source}:${id}`, source, sourceRowId: id, dueAt: "2026-08-03T01:00:00.000Z",
      contactId: null, contactType: null, contactName: "x", phone: "", note: null,
      canAct: false, blockedReason: "x",
    });
    expect([mk("appointment", "b"), mk("campaign", "a")].sort(compareCallbackRows).map((r) => r.source))
      .toEqual(["campaign", "appointment"]);
    expect([mk("campaign", "b"), mk("campaign", "a")].sort(compareCallbackRows).map((r) => r.sourceRowId))
      .toEqual(["a", "b"]);
  });

  it("source-qualified keys never collide across sources", async () => {
    const rows = await fetchCallbackPage({ ...scope, pageSize: 10 });
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows.every((r) => r.key.startsWith("campaign:") || r.key.startsWith("appointment:"))).toBe(true);
  });
});

describe("contact identity on callback rows", () => {
  it("a campaign row with a visible lead is lead-sourced and dialable", async () => {
    state.rows["campaign-due"] = [{
      id: "cl-1", lead_id: LEAD_A, callback_due_at: "2026-08-03T05:00:00.000Z",
      scheduled_callback_at: null, status: "Called", first_name: "Lee", last_name: "Ann", phone: "5551110001",
    }];
    const [row] = await fetchCallbackPage({ ...scope, pageSize: 5 });
    expect(row.contactId).toBe(LEAD_A);
    expect(row.contactType).toBe("lead");
    expect(row.canAct).toBe(true);
    expect(row.sourceRowId).toBe("cl-1");
    expect(row.contactId).not.toBe(row.sourceRowId);
  });

  it("a NULL lead_id still renders and counts, but cannot be called", async () => {
    state.rows["campaign-due"] = [{
      id: "cl-null", lead_id: null, callback_due_at: "2026-08-03T05:00:00.000Z",
      scheduled_callback_at: null, status: "Called", first_name: "Ghost", last_name: "Lead", phone: "5559990000",
    }];
    state.counts = { "campaign-due": 1, "campaign-legacy": 0, appointment: 0 };
    const [row] = await fetchCallbackPage({ ...scope, pageSize: 5 });
    expect(row.contactName).toBe("Ghost Lead");
    expect(row.contactId).toBeNull();
    expect(row.contactType).toBeNull();
    expect(row.canAct).toBe(false);
    expect(row.blockedReason).toBeTruthy();
    expect(await fetchCallbackTotal(scope)).toBe(1); // still counts
  });

  it("a DANGLING lead_id (lead not visible) behaves the same and never fabricates an id", async () => {
    state.rows["campaign-due"] = [{
      id: "cl-dangle", lead_id: "deadbeef-0000-0000-0000-000000000000",
      callback_due_at: "2026-08-03T05:00:00.000Z", scheduled_callback_at: null, status: "Called",
      first_name: "Gone", last_name: "Away", phone: "5558887777",
    }];
    const [row] = await fetchCallbackPage({ ...scope, pageSize: 5 });
    expect(row.contactId).toBeNull();
    expect(row.canAct).toBe(false);
    expect(row.contactName).toBe("Gone Away");
  });

  it("campaign_leads.id is NEVER used as a contact identity", async () => {
    state.rows["campaign-due"] = [{
      id: "cl-xyz", lead_id: null, callback_due_at: "2026-08-03T05:00:00.000Z",
      scheduled_callback_at: null, status: "Called",
    }];
    const [row] = await fetchCallbackPage({ ...scope, pageSize: 5 });
    expect(row.contactId).not.toBe("cl-xyz");
    expect(row.contactId).toBeNull();
  });

  it("an appointment callback resolves its polymorphic contact_id against real rows", async () => {
    state.contacts.clients = [{ id: LEAD_B, first_name: "Cleo", last_name: "Client", phone: "5552223333" }];
    state.contacts.leads = [];
    state.rows["appointment"] = [{
      id: "ap-1", contact_id: LEAD_B, contact_name: "Cleo Client",
      start_time: "2026-08-03T05:00:00.000Z", type: "Call Back", notes: "ring back",
    }];
    const [row] = await fetchCallbackPage({ ...scope, pageSize: 5 });
    expect(row.contactType).toBe("client");   // resolved, not assumed to be a lead
    expect(row.phone).toBe("5552223333");
    expect(row.note).toBe("ring back");
  });

  it("prefers the joined lead name/phone, falling back to the denormalized columns", () => {
    const withJoin = normalizeCampaignRow(
      { id: "a", lead_id: LEAD_A, callback_due_at: "2026-08-03T05:00:00.000Z", first_name: "Stale", last_name: "Name", phone: "0000000000", status: "Called" },
      callbackBranches()[0],
      new Map([[LEAD_A, { type: "lead" as const, name: "Fresh Name", phone: "5551110001" }]]),
    );
    expect(withJoin.contactName).toBe("Fresh Name");
    expect(withJoin.phone).toBe("5551110001");

    const noJoin = normalizeCampaignRow(
      { id: "b", lead_id: null, callback_due_at: "2026-08-03T05:00:00.000Z", first_name: "Denorm", last_name: "Only", phone: "5554443333", status: "Called" },
      callbackBranches()[0],
      new Map(),
    );
    expect(noJoin.contactName).toBe("Denorm Only");
    expect(noJoin.phone).toBe("5554443333");
  });
});

describe("Today bucketing = overdue PLUS due-today", () => {
  const now = new Date(2026, 7, 3, 14, 0);
  const todayEnd = new Date(2026, 7, 4);
  const mk = (due: Date): NormalizedCallbackRow => ({
    key: "k", source: "campaign", sourceRowId: "s", dueAt: due.toISOString(),
    contactId: null, contactType: null, contactName: "x", phone: "", note: null,
    canAct: false, blockedReason: null,
  });

  it("a previous day is overdue", () => {
    expect(bucketCallback(mk(new Date(2026, 6, 20, 9)), now, todayEnd)).toBe("overdue");
  });
  it("earlier today is overdue", () => {
    expect(bucketCallback(mk(new Date(2026, 7, 3, 9)), now, todayEnd)).toBe("overdue");
  });
  it("later today is due today", () => {
    expect(bucketCallback(mk(new Date(2026, 7, 3, 17)), now, todayEnd)).toBe("dueToday");
  });
  it("exactly midnight tomorrow is NOT due today", () => {
    expect(bucketCallback(mk(new Date(2026, 7, 4, 0, 0, 0, 0)), now, todayEnd)).toBe("dueSoon");
  });
});

describe("appointment ownership compatibility (FloatingDialer writes created_by, not user_id)", () => {
  /**
   * The predicate is enforced by PostgREST, so these cases assert the emitted expression
   * — the shape that decides inclusion — plus a simulation of the server-side semantics
   * so the truth table itself is pinned.
   */
  const matches = (row: { user_id: string | null; created_by: string | null }, uid: string) =>
    row.user_id === uid || (row.user_id === null && row.created_by === uid);

  it("emits the EXACT PostgREST or() expression", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    const appt = state.calls.filter((c) => c.table === "appointments");
    expect(appt.length).toBeGreaterThan(0);
    for (const c of appt) {
      expect(c.ors).toEqual([
        `user_id.eq.${ME},and(user_id.is.null,created_by.eq.${ME})`,
      ]);
    }
  });

  it("ownershipOrExpression is the single source of that string", () => {
    expect(ownershipOrExpression(ME)).toBe(
      `user_id.eq.${ME},and(user_id.is.null,created_by.eq.${ME})`,
    );
  });

  // Truth table — case numbers match §13.5 / the approval.
  it("1. user_id = current user is included", () => {
    expect(matches({ user_id: ME, created_by: OTHER }, ME)).toBe(true);
  });

  it("2. user_id NULL + created_by current user is INCLUDED (the FloatingDialer shape)", () => {
    expect(matches({ user_id: null, created_by: ME }, ME)).toBe(true);
  });

  it("3. user_id NULL + created_by another user is excluded", () => {
    expect(matches({ user_id: null, created_by: OTHER }, ME)).toBe(false);
  });

  it("4. user_id another user + created_by current user is EXCLUDED — user_id wins", () => {
    expect(matches({ user_id: OTHER, created_by: ME }, ME)).toBe(false);
  });

  it("5. user_id another user + created_by same other user is excluded", () => {
    expect(matches({ user_id: OTHER, created_by: OTHER }, ME)).toBe(false);
  });

  it("6. user_id NULL + created_by NULL is excluded", () => {
    expect(matches({ user_id: null, created_by: null }, ME)).toBe(false);
  });

  it("7. appointment rows and counts emit the identical ownership predicate", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    const rowOr = state.calls.filter((c) => c.table === "appointments" && !c.head).map((c) => c.ors);
    state.calls = [];
    await fetchCallbackTotal(scope);
    const countOr = state.calls.filter((c) => c.table === "appointments" && c.head).map((c) => c.ors);
    expect(countOr).toEqual(rowOr);
  });

  it("8. widget and detail contracts remain identical (only page size differs)", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    const widget = state.calls.filter((c) => c.table === "appointments" && !c.head)[0];
    state.calls = [];
    await fetchCallbackPage({ ...scope, pageSize: 20 });
    const detail = state.calls.filter((c) => c.table === "appointments" && !c.head)[0];
    expect(detail.ors).toEqual(widget.ors);
    expect(detail.limit).not.toBe(widget.limit);
  });

  it("9. campaign ownership remains callback_agent_id only — never created_by", async () => {
    await fetchCallbackPage({ ...scope, pageSize: 15 });
    const campaign = state.calls.filter((c) => c.table === "campaign_leads");
    expect(campaign.every((c) => c.filters.includes(`eq:callback_agent_id=${ME}`))).toBe(true);
    expect(campaign.every((c) => c.ors.length === 0)).toBe(true);
    expect(campaign.some((c) => c.filters.some((f) => f.includes("created_by")))).toBe(false);
  });

  it("10. Admin Team view adds no ownership predicate at all", async () => {
    await fetchCallbackPage({ isFiltered: false, userId: ME, reference: REF, pageSize: 15 });
    expect(state.calls.every((c) => c.ors.length === 0)).toBe(true);
    expect(
      state.calls.some((c) =>
        c.filters.some((f) => f.includes("callback_agent_id") || f.includes("user_id") || f.includes("created_by")),
      ),
    ).toBe(false);
  });

  it("12. a non-UUID userId rejects BEFORE any query executes", async () => {
    for (const bad of ["", "not-a-uuid", "1;--", `${ME},user_id.not.is.null`]) {
      state.calls = [];
      await expect(
        fetchCallbackPage({ isFiltered: true, userId: bad, reference: REF, pageSize: 15 }),
      ).rejects.toBeInstanceOf(DashboardQueryError);
      // Nothing reached the query layer.
      expect(state.calls).toHaveLength(0);
    }
  });

  it("12b. an invalid userId never silently drops the ownership filter", async () => {
    state.calls = [];
    await expect(
      fetchCallbackTotal({ isFiltered: true, userId: "nope", reference: REF }),
    ).rejects.toBeInstanceOf(DashboardQueryError);
    expect(state.calls).toHaveLength(0);
  });
});

describe("Supabase error propagation — a failed query is not an empty one", () => {
  const ERR = { message: "permission denied for table appointments", code: "42501", hint: "check RLS" };

  it("13. successful empty branches are accepted, not treated as failure", async () => {
    const rows = await fetchCallbackPage({ ...scope, pageSize: 15 });
    expect(rows).toEqual([]);
    await expect(fetchCallbackTotal(scope)).resolves.toBe(0);
  });

  it.each(["campaign-due", "campaign-legacy", "appointment"])(
    "14. a failed %s row branch rejects the page",
    async (branch) => {
      state.rowErrors[branch] = ERR;
      await expect(fetchCallbackPage({ ...scope, pageSize: 15 })).rejects.toBeInstanceOf(
        DashboardQueryError,
      );
    },
  );

  it("15. a failure alongside succeeding branches still rejects — NO partial feed", async () => {
    state.rows["campaign-due"] = [{
      id: "cl-1", lead_id: LEAD_A, callback_due_at: "2026-08-03T05:00:00.000Z",
      scheduled_callback_at: null, status: "Called",
    }];
    state.rows["appointment"] = [{
      id: "ap-1", contact_id: LEAD_B, contact_name: "Bo Bee",
      start_time: "2026-08-03T06:00:00.000Z", type: "Follow Up", notes: null,
    }];
    state.rowErrors["campaign-legacy"] = ERR;
    await expect(fetchCallbackPage({ ...scope, pageSize: 15 })).rejects.toBeInstanceOf(
      DashboardQueryError,
    );
  });

  it.each(["campaign-due", "campaign-legacy", "appointment"])(
    "16. a failed %s count branch rejects the total — no partial sum",
    async (branch) => {
      state.counts = { "campaign-due": 10, "campaign-legacy": 5, appointment: 3 };
      state.countErrors[branch] = ERR;
      await expect(fetchCallbackTotal(scope)).rejects.toBeInstanceOf(DashboardQueryError);
    },
  );

  it.each(["leads", "clients", "recruits"])(
    "18/19/20. a failed %s lookup rejects the page",
    async (table) => {
      state.rows["campaign-due"] = [{
        id: "cl-1", lead_id: LEAD_A, callback_due_at: "2026-08-03T05:00:00.000Z",
        scheduled_callback_at: null, status: "Called", first_name: "Lee", last_name: "Ann",
      }];
      state.contactErrors[table] = ERR;
      await expect(fetchCallbackPage({ ...scope, pageSize: 15 })).rejects.toBeInstanceOf(
        DashboardQueryError,
      );
    },
  );

  it("23. a lookup failure is NOT converted into a dangling/deleted identity", async () => {
    state.rows["campaign-due"] = [{
      id: "cl-1", lead_id: LEAD_A, callback_due_at: "2026-08-03T05:00:00.000Z",
      scheduled_callback_at: null, status: "Called", first_name: "Lee", last_name: "Ann",
    }];
    state.contactErrors["leads"] = ERR;
    // It must throw rather than return a row claiming there is no linked contact.
    await expect(fetchCallbackPage({ ...scope, pageSize: 15 })).rejects.toBeInstanceOf(
      DashboardQueryError,
    );
  });

  it("20b. a genuinely absent contact (successful empty lookup) still yields dangling handling", async () => {
    state.rows["campaign-due"] = [{
      id: "cl-1", lead_id: "deadbeef-0000-0000-0000-000000000000",
      callback_due_at: "2026-08-03T05:00:00.000Z", scheduled_callback_at: null,
      status: "Called", first_name: "Gone", last_name: "Away", phone: "5551110000",
    }];
    const [row] = await fetchCallbackPage({ ...scope, pageSize: 15 });
    expect(row.contactId).toBeNull();
    expect(row.canAct).toBe(false);
  });

  it("21. the user-facing message exposes NO database detail", async () => {
    state.rowErrors["appointment"] = ERR;
    await expect(fetchCallbackPage({ ...scope, pageSize: 15 })).rejects.toSatisfy((e: any) => {
      const msg = String(e.message);
      return (
        !msg.includes("permission denied") &&
        !msg.includes("42501") &&
        !msg.includes("appointments") &&
        !msg.includes("RLS") &&
        msg.length > 0
      );
    });
  });

  it("21b. the original Supabase error is retained as diagnostic context", async () => {
    state.rowErrors["appointment"] = ERR;
    try {
      await fetchCallbackPage({ ...scope, pageSize: 15 });
      throw new Error("should have rejected");
    } catch (e: any) {
      expect(e).toBeInstanceOf(DashboardQueryError);
      expect(e.cause).toBe(ERR);
      expect(e.context).toContain("appointment");
    }
  });

  it("24. stale-JWT preservation: a successful empty campaign result is NOT an error", async () => {
    // campaign_leads returns [] because RLS filtered it (stale role claim), while the
    // appointment source still has rows. That must resolve, not reject.
    state.rows["campaign-due"] = [];
    state.rows["campaign-legacy"] = [];
    state.rows["appointment"] = [{
      id: "ap-1", contact_id: LEAD_B, contact_name: "Bo Bee",
      start_time: "2026-08-03T06:00:00.000Z", type: "Follow Up", notes: null,
    }];
    const rows = await fetchCallbackPage({ ...scope, pageSize: 15 });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("appointment");
  });
});

describe("24. CallbacksWidget failure UI cannot render its valid-empty message", () => {
  it("renders the failure block on error and the empty block on success — never both, never swapped", async () => {
    const { render, screen, waitFor, cleanup } = await import("@testing-library/react");
    const React = (await import("react")).default;
    const { default: CallbacksWidget } = await import(
      "@/components/dashboard/widgets/CallbacksWidget"
    );

    // --- successful empty: the empty state, and NOT the failure state ---
    const okEl = React.createElement(CallbacksWidget, { userId: ME, role: "Agent", adminToggle: "my" as const });
    render(okEl);
    await waitFor(() => expect(screen.getByText("No pending callbacks")).toBeTruthy());
    expect(screen.queryByText("Couldn't load callbacks")).toBeNull();
    cleanup();

    // --- failed request: the failure state, and NOT the empty state ---
    state.rowErrors["appointment"] = { message: "permission denied", code: "42501" };
    const errEl = React.createElement(CallbacksWidget, { userId: ME, role: "Agent", adminToggle: "my" as const });
    render(errEl);
    await waitFor(() => expect(screen.getByText("Couldn't load callbacks")).toBeTruthy());
    // THE assertion this requirement exists for.
    expect(screen.queryByText("No pending callbacks")).toBeNull();
    // And no raw database detail leaks into the DOM.
    expect(document.body.textContent).not.toContain("permission denied");
    expect(document.body.textContent).not.toContain("42501");
    cleanup();
  });
});

describe("25/26. DashboardDetailModal failure UI", () => {
  const renderModal = async () => {
    const rtl = await import("@testing-library/react");
    const React = (await import("react")).default;
    const { default: Modal } = await import("@/components/dashboard/DashboardDetailModal");
    rtl.render(
      React.createElement(Modal, {
        isOpen: true,
        onClose: () => {},
        type: "callbacks" as const,
        userId: ME,
        role: "Agent",
        adminToggle: "my" as const,
        timeRange: "day" as const,
      }),
    );
    return rtl;
  };

  it("25. an initial failure renders the failure message, NOT 'No intelligence found'", async () => {
    state.rowErrors["campaign-due"] = { message: "permission denied for table campaign_leads", code: "42501" };
    const { screen, waitFor, cleanup } = await renderModal();
    await waitFor(() => expect(screen.getByText("Couldn't load these records")).toBeTruthy());
    // THE assertion this requirement exists for.
    expect(screen.queryByText("No intelligence found in this range")).toBeNull();
    // No raw database detail in the DOM.
    expect(document.body.textContent).not.toContain("permission denied");
    expect(document.body.textContent).not.toContain("42501");
    cleanup();
  });

  it("a successful empty initial load renders the valid-empty message, not the failure one", async () => {
    const { screen, waitFor, cleanup } = await renderModal();
    await waitFor(() => expect(screen.getByText("No intelligence found in this range")).toBeTruthy());
    expect(screen.queryByText("Couldn't load these records")).toBeNull();
    cleanup();
  });

  // Requirement 26 is implemented as a real component flow in the dedicated
  // "requirement 26" describe block below. The former placeholder here only asserted
  // that the initial page rendered, which did not test pagination failure at all.
});

/** Shared render helper for the modal component tests below. */
async function renderDetailModal(overrides: Record<string, any> = {}) {
  const rtl = await import("@testing-library/react");
  const React = (await import("react")).default;
  const { default: Modal } = await import("@/components/dashboard/DashboardDetailModal");
  const props = {
    isOpen: true,
    onClose: () => {},
    type: "callbacks" as const,
    userId: ME,
    role: "Agent",
    adminToggle: "my" as const,
    timeRange: "day" as const,
    ...overrides,
  };
  const view = rtl.render(React.createElement(Modal, props));
  // `container` lives on the render result, not on the RTL module.
  return { ...rtl, view, container: view.container, React, Modal, props };
}

/** A full first page of campaign callbacks with DISTINCT lead ids. */
function seedFullFirstPage(count = 20) {
  const leads: any[] = [];
  const rows = Array.from({ length: count }, (_, i) => {
    const leadId = `1ead0000-0000-0000-0000-0000000${String(100 + i)}`;
    leads.push({ id: leadId, first_name: `Agent${i}`, last_name: "Row", phone: "5551110001" });
    return {
      id: `cl-${i}`,
      lead_id: leadId,
      callback_due_at: new Date(Date.UTC(2026, 7, 3, 1, i)).toISOString(),
      scheduled_callback_at: null,
      status: "Called",
      first_name: `Agent${i}`,
      last_name: "Row",
      phone: "5551110001",
    };
  });
  state.contacts.leads = leads;
  state.rows["campaign-due"] = rows;
  return rows;
}

describe("Correction 1 — unique callback render keys", () => {
  it("multiple campaign AND appointment callbacks sharing one contact render with no duplicate-key warning", async () => {
    // Two campaign callbacks + one appointment callback, all for the SAME lead. Before
    // the fix all three shared the contact UUID as their React key.
    state.rows["campaign-due"] = [
      { id: "cl-1", lead_id: LEAD_A, callback_due_at: "2026-08-03T01:00:00.000Z", scheduled_callback_at: null, status: "Called", first_name: "Lee", last_name: "Ann", phone: "5551110001" },
      { id: "cl-2", lead_id: LEAD_A, callback_due_at: "2026-08-03T02:00:00.000Z", scheduled_callback_at: null, status: "Called", first_name: "Lee", last_name: "Ann", phone: "5551110001" },
    ];
    state.rows["appointment"] = [
      { id: "ap-1", contact_id: LEAD_A, contact_name: "Lee Ann", start_time: "2026-08-03T03:00:00.000Z", type: "Follow Up", notes: null },
    ];

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { screen, waitFor, cleanup } = await renderDetailModal();
      // All three rows render.
      await waitFor(() => expect(screen.getAllByText("Lee Ann")).toHaveLength(3));

      const keyWarnings = spy.mock.calls
        .map((args) => args.map(String).join(" "))
        .filter((msg) => /same key|Encountered two children with the same key/i.test(msg));
      expect(keyWarnings).toEqual([]);
      cleanup();
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps contact identity separate from render identity", async () => {
    state.rows["campaign-due"] = [
      { id: "cl-1", lead_id: LEAD_A, callback_due_at: "2026-08-03T01:00:00.000Z", scheduled_callback_at: null, status: "Called", first_name: "Lee", last_name: "Ann", phone: "5551110001" },
      { id: "cl-2", lead_id: LEAD_A, callback_due_at: "2026-08-03T02:00:00.000Z", scheduled_callback_at: null, status: "Called", first_name: "Lee", last_name: "Ann", phone: "5551110001" },
    ];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { screen, waitFor, cleanup } = await renderDetailModal();
      await waitFor(() => expect(screen.getAllByText("Lee Ann")).toHaveLength(2));
      // Both rows still point at the same CONTACT (identity preserved) while rendering
      // under distinct keys — asserted via the absence of a key collision.
      expect(
        spy.mock.calls.map((a) => a.map(String).join(" ")).filter((m) => /same key/i.test(m)),
      ).toEqual([]);
      cleanup();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("Correction 2 — stale requests cannot overwrite newer results", () => {
  it("an older failure resolved AFTER a newer success does not replace it", async () => {
    // First request hangs on a deferred promise.
    let settleFirst: (v: any) => void = () => {};
    state.deferred["campaign-due"] = {
      promise: new Promise((res) => { settleFirst = res; }),
      settle: (v) => settleFirst(v),
    };

    const { screen, waitFor, cleanup, view, React, Modal, props } = await renderDetailModal();

    // Second initial request: change timeRange, which the effect deps watch. It succeeds.
    delete state.deferred["campaign-due"];
    state.rows["campaign-due"] = [{
      id: "cl-new", lead_id: LEAD_B, callback_due_at: "2026-08-03T09:00:00.000Z",
      scheduled_callback_at: null, status: "Called", first_name: "Bo", last_name: "Bee", phone: "5551110002",
    }];
    view.rerender(React.createElement(Modal, { ...props, timeRange: "month" as const }));
    await waitFor(() => expect(screen.getByText("Bo Bee")).toBeTruthy());

    // NOW let the stale first request fail.
    settleFirst({ data: null, error: { message: "permission denied for table campaign_leads", code: "42501", hint: "check RLS" } });
    await new Promise((r) => setTimeout(r, 0));

    // The newer rows survive; the stale failure never lands.
    expect(screen.getByText("Bo Bee")).toBeTruthy();
    expect(screen.queryByText("Couldn't load these records")).toBeNull();
    expect(screen.queryByText("No intelligence found in this range")).toBeNull();
    expect(screen.queryByText("Couldn't load more records")).toBeNull();
    // And no raw detail leaked.
    expect(document.body.textContent).not.toContain("permission denied");
    expect(document.body.textContent).not.toContain("42501");
    cleanup();
  });

  it("a stale finally does not clear loading state owned by a newer request", async () => {
    // First request hangs; second hangs too. When the FIRST settles, the newer request is
    // still in flight, so the spinner must remain.
    let settleFirst: (v: any) => void = () => {};
    state.deferred["campaign-due"] = {
      promise: new Promise((res) => { settleFirst = res; }),
      settle: (v) => settleFirst(v),
    };
    const { screen, waitFor, cleanup, view, React, Modal, props } = await renderDetailModal();

    let settleSecond: (v: any) => void = () => {};
    state.deferred["campaign-due"] = {
      promise: new Promise((res) => { settleSecond = res; }),
      settle: (v) => settleSecond(v),
    };
    view.rerender(React.createElement(Modal, { ...props, timeRange: "month" as const }));

    // Stale request settles first.
    settleFirst({ data: [], error: null });
    await new Promise((r) => setTimeout(r, 0));
    // Still loading, because the NEWER request has not settled.
    expect(screen.getByText("Synchronizing Intelligence...")).toBeTruthy();

    settleSecond({ data: [], error: null });
    await waitFor(() => expect(screen.getByText("No intelligence found in this range")).toBeTruthy());
    cleanup();
  });
});

describe("Correction 2b — pagination is serialized by a ref lock", () => {
  it("rapid duplicate scroll events do not request or append the same next page twice", async () => {
    seedFullFirstPage(20);
    const { screen, waitFor, cleanup, container } = await renderDetailModal();
    await waitFor(() => expect(screen.getByText("Agent0 Row")).toBeTruthy());

    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
    expect(scroller).toBeTruthy();
    Object.defineProperty(scroller, "scrollTop", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 500, configurable: true });

    // Page 1 hangs, so the lock is held while both scroll events fire.
    let settlePage: (v: any) => void = () => {};
    state.deferred["campaign-due"] = {
      promise: new Promise((res) => { settlePage = res; }),
      settle: (v) => settlePage(v),
    };
    const before = state.rowQueryCount["campaign-due"] ?? 0;

    // Fire all three inside ONE act() so React batches them and no rerender happens in
    // between. Sequential fireEvent calls each flush state, which would let
    // `isFetchingNextPage` update and mask the race this lock exists to prevent.
    const { fireEvent, act } = await import("@testing-library/react");
    await act(async () => {
      fireEvent.scroll(scroller);
      fireEvent.scroll(scroller);
      fireEvent.scroll(scroller);
    });

    // Exactly ONE additional campaign-due row query, despite three scroll events.
    expect((state.rowQueryCount["campaign-due"] ?? 0) - before).toBe(1);

    settlePage({ data: [], error: null });
    await new Promise((r) => setTimeout(r, 0));
    // No duplicated rows appended.
    expect(screen.getAllByText("Agent0 Row")).toHaveLength(1);
    cleanup();
  });
});

describe("requirement 26 — a real pagination failure keeps loaded rows and says more failed", () => {
  it("renders the pagination-failure notice, keeps the rows, and hides the other states", async () => {
    const first = seedFullFirstPage(20);
    const { screen, waitFor, cleanup, container } = await renderDetailModal();

    // 1-2. First page renders successfully.
    await waitFor(() => expect(screen.getByText("Agent0 Row")).toBeTruthy());
    expect(screen.getAllByText(/Agent\d+ Row/)).toHaveLength(first.length);

    // 3. Inject the error ONLY after the initial load completed.
    state.rowErrors["campaign-due"] = {
      message: "permission denied for table campaign_leads", code: "42501", hint: "check RLS",
    };

    // 4. Explicit geometry, then fire the shipped scroll handler.
    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
    Object.defineProperty(scroller, "scrollTop", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 500, configurable: true });
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.scroll(scroller);

    // 5-6. The pagination failure notice appears.
    await waitFor(() => expect(screen.getByText("Couldn't load more records")).toBeTruthy());

    // 7. Every originally loaded row is still visible.
    expect(screen.getAllByText(/Agent\d+ Row/)).toHaveLength(first.length);

    // 8. The other three states stay absent.
    expect(screen.queryByText("Couldn't load these records")).toBeNull();
    expect(screen.queryByText("No intelligence found in this range")).toBeNull();
    expect(screen.queryByText("End of list")).toBeNull();

    // 9. No raw database detail anywhere in the DOM.
    const text = document.body.textContent ?? "";
    for (const leak of ["permission denied", "42501", "check RLS", "campaign_leads"]) {
      expect(text).not.toContain(leak);
    }
    cleanup();
  });
});

describe("§15 — a stale success cannot disable pagination for the current view", () => {
  it("a stale non-callback resolution leaves hasMore intact on the current callbacks view", async () => {
    // 1. An older `calls_today` initial request hangs on a deferred promise.
    let settleStale: (v: any) => void = () => {};
    state.deferred["calls"] = {
      promise: new Promise((res) => { settleStale = res; }),
      settle: (v) => settleStale(v),
    };
    const { screen, waitFor, cleanup, container, view, React, Modal, props } =
      await renderDetailModal({ type: "calls_today" as const });

    // 2-3. Switch to callbacks and let a FULL 20-row page succeed, so `hasMore` is
    // legitimately true. Distinct lead ids keep the duplicate-key path out of this test.
    const first = seedFullFirstPage(20);
    view.rerender(React.createElement(Modal, { ...props, type: "callbacks" as const }));
    await waitFor(() => expect(screen.getByText("Agent0 Row")).toBeTruthy());

    // 4. `hasMore === true` is observable as "SCROLL FOR MORE" (mixed text node, so read
    //    the container's textContent rather than matching a single node).
    expect(container.textContent).toContain("SCROLL FOR MORE");

    // 5. NOW let the stale `calls` request resolve SUCCESSFULLY with an empty result.
    settleStale({ data: [], error: null });
    await new Promise((r) => setTimeout(r, 0));

    // 6. The current rows and `hasMore` must survive. This is the assertion that fails
    //    before the fix: the stale success reaches `setHasMore(false)` unguarded.
    expect(screen.getAllByText(/Agent\d+ Row/)).toHaveLength(first.length);
    expect(container.textContent).toContain("SCROLL FOR MORE");

    // 7. Pagination is still alive for the CURRENT generation: exactly one new query.
    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
    Object.defineProperty(scroller, "scrollTop", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 500, configurable: true });
    const before = state.rowQueryCount["campaign-due"] ?? 0;
    const { fireEvent, act } = await import("@testing-library/react");
    await act(async () => {
      fireEvent.scroll(scroller);
    });
    expect((state.rowQueryCount["campaign-due"] ?? 0) - before).toBe(1);

    // 8. No stale empty, error or end-of-list state.
    expect(screen.queryByText("No intelligence found in this range")).toBeNull();
    expect(screen.queryByText("Couldn't load these records")).toBeNull();
    expect(screen.queryByText("Couldn't load more records")).toBeNull();
    expect(screen.queryByText("End of list")).toBeNull();
    cleanup();
  });
});
