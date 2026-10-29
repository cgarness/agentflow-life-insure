import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Polish V2 §3.5 — cleared callbacks are excluded INSIDE the paging math of the ONE callback
 * contract, never filtered off a limited page. Asserted against an in-memory PostgREST that
 * evaluates every filter, order and limit, and a brute-force oracle: for random interleavings of
 * campaign (due + legacy) and appointment callbacks, with random clearances (matching, rescheduled,
 * other perspective), every page at every offset and both totals equal the oracle exactly.
 */
const h = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/integrations/supabase/client", async () => {
  const { makeFakeSupabase } = await import("@/test/fakePostgrest");
  return { supabase: { from: (t: string) => makeFakeSupabase(h.db).from(t), rpc: (n: string, a: any) => makeFakeSupabase(h.db).rpc(n, a) } };
});

import { createFakeDb } from "@/test/fakePostgrest";
import { AttentionExclusions, type AttentionClearance } from "@/lib/dashboard-attention";
import {
  callbackWindow,
  fetchCallbackCounts,
  fetchCallbackPage,
  fetchCallbackTotal,
  fetchClearedCallbacks,
  TERMINAL_CAMPAIGN_LEAD_STATUSES,
} from "@/lib/dashboard-callbacks";
import { callbackBucketCounts } from "@/lib/dashboard-widget-loads";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REF = new Date(2026, 7, 3, 12, 0, 0);
const uuid = (prefix: string, n: number) => `${prefix}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Scenario {
  campaign: any[];
  appointments: any[];
  clearances: AttentionClearance[];
}

function scenario(seed: number): Scenario {
  const r = rng(seed);
  const { startIso, endIso } = callbackWindow({ isFiltered: true, userId: ME, reference: REF });
  const start = Date.parse(startIso);
  const span = Date.parse(endIso) - start;
  // Few distinct instants, so equal due times (tie-breaks) are common.
  const due = () => new Date(start + Math.floor(r() * 12) * (span / 12)).toISOString();
  const campaign = Array.from({ length: 4 + Math.floor(r() * 14) }, (_, i) => {
    const legacy = r() < 0.3;
    const d = due();
    return {
      id: uuid("c", i), lead_id: null, first_name: `C${i}`, last_name: "", phone: "",
      callback_due_at: legacy ? null : d, scheduled_callback_at: legacy || r() < 0.5 ? d : null,
      callback_note: null, campaign_id: null,
      status: r() < 0.15 ? TERMINAL_CAMPAIGN_LEAD_STATUSES[i % 4] : "Queued",
      callback_agent_id: r() < 0.7 ? ME : OTHER,
    };
  });
  const appointments = Array.from({ length: 2 + Math.floor(r() * 12) }, (_, i) => ({
    id: uuid("a", i), contact_id: null, contact_name: `A${i}`, start_time: due(), notes: null,
    type: r() < 0.85 ? (r() < 0.5 ? "Follow Up" : "Call Back") : "Meeting",
    status: r() < 0.9 ? "Scheduled" : "Completed",
    user_id: r() < 0.6 ? ME : r() < 0.5 ? null : OTHER,
    created_by: r() < 0.7 ? ME : OTHER,
  }));
  const clearances: AttentionClearance[] = [];
  let n = 0;
  for (const row of campaign) {
    const roll = r();
    const current = row.callback_due_at ?? row.scheduled_callback_at;
    if (roll < 0.35) clearances.push({ id: uuid("d", n++), sourceType: "campaign_callback", sourceId: row.id, occurrenceAt: current, clearedAt: "2026-08-03T10:00:00.000Z" });
    else if (roll < 0.45) clearances.push({ id: uuid("d", n++), sourceType: "campaign_callback", sourceId: row.id, occurrenceAt: "2026-08-01T00:00:00.000Z", clearedAt: "2026-08-01T00:00:00.000Z" }); // rescheduled since
  }
  for (const row of appointments) {
    const roll = r();
    if (roll < 0.35) clearances.push({ id: uuid("d", n++), sourceType: "appointment_callback", sourceId: row.id, occurrenceAt: row.start_time, clearedAt: "2026-08-03T10:00:00.000Z" });
    else if (roll < 0.42) clearances.push({ id: uuid("d", n++), sourceType: "campaign_callback", sourceId: row.id, occurrenceAt: row.start_time, clearedAt: "2026-08-03T10:00:00.000Z" }); // wrong type: never matches
  }
  return { campaign, appointments, clearances };
}

/** The oracle: every pending callback in the window and scope, minus currently matched clearances, in global order. */
function oracle(s: Scenario, isFiltered: boolean) {
  const { startIso, endIso } = callbackWindow({ isFiltered, userId: ME, reference: REF });
  const inWindow = (d: string | null) => d !== null && Date.parse(d) >= Date.parse(startIso) && Date.parse(d) < Date.parse(endIso);
  const all: Array<{ key: string; due: string; rank: number; id: string; type: string; srcId: string }> = [];
  for (const row of s.campaign) {
    const d = row.callback_due_at ?? row.scheduled_callback_at;
    if (!inWindow(d) || (TERMINAL_CAMPAIGN_LEAD_STATUSES as readonly string[]).includes(row.status)) continue;
    if (isFiltered && row.callback_agent_id !== ME) continue;
    all.push({ key: `campaign:${row.id}`, due: d, rank: 0, id: row.id, type: "campaign_callback", srcId: row.id });
  }
  for (const row of s.appointments) {
    if (!inWindow(row.start_time) || !["Follow Up", "Call Back"].includes(row.type) || row.status !== "Scheduled") continue;
    if (isFiltered && !(row.user_id === ME || (row.user_id === null && row.created_by === ME))) continue;
    all.push({ key: `appointment:${row.id}`, due: row.start_time, rank: 1, id: row.id, type: "appointment_callback", srcId: row.id });
  }
  const hidden = (x: (typeof all)[number]) =>
    s.clearances.some((c) => c.sourceType === x.type && c.sourceId === x.srcId && Date.parse(c.occurrenceAt) === Date.parse(x.due));
  const sorted = all.sort((a, b) => (a.due !== b.due ? (a.due < b.due ? -1 : 1) : a.rank - b.rank || (a.id < b.id ? -1 : 1)));
  return { active: sorted.filter((x) => !hidden(x)), cleared: sorted.filter(hidden) };
}

beforeEach(() => {
  h.db = createFakeDb({ leads: [], clients: [], recruits: [] });
});

describe("exact exclusion over interleaved sources (property test against an oracle)", () => {
  for (const isFiltered of [true, false]) {
    it(`every page, every offset and both totals match the oracle (${isFiltered ? "My" : "Admin Team"} scope, 40 scenarios)`, async () => {
      for (let seed = 1; seed <= 40; seed++) {
        const s = scenario(seed);
        h.db = createFakeDb({ campaign_leads: s.campaign, appointments: s.appointments, leads: [], clients: [], recruits: [] });
        const exclusions = new AttentionExclusions(s.clearances);
        const opts = { isFiltered, userId: ME, reference: REF, exclusions };
        const expected = oracle(s, isFiltered);

        expect(await fetchCallbackCounts(opts)).toEqual({ active: expected.active.length, cleared: expected.cleared.length });
        expect(await fetchCallbackTotal(opts)).toBe(expected.active.length);
        for (const pageSize of [1, 3, 7, 20]) {
          const seen: string[] = [];
          for (let offset = 0; offset <= expected.active.length; offset += pageSize) {
            const page = await fetchCallbackPage({ ...opts, offset, pageSize });
            expect(page.map((r) => r.key)).toEqual(expected.active.slice(offset, offset + pageSize).map((x) => x.key));
            seen.push(...page.map((r) => r.key));
          }
          // No gaps, no duplicates, no short page before the end, never a false empty.
          expect(seen).toEqual(expected.active.map((x) => x.key));
        }
        const cleared = await fetchClearedCallbacks(opts);
        expect(cleared.map((r) => r.key)).toEqual(expected.cleared.map((x) => x.key));
        expect(cleared.every((r) => r.clearance !== null && r.clearance !== undefined)).toBe(true);
      }
    });
  }

  it("is sensitive: the scenarios exercise clearances, and filtering a limited page would be caught", async () => {
    let cleared = 0;
    let naiveWrong = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = scenario(seed);
      const expected = oracle(s, true);
      cleared += expected.cleared.length;
      h.db = createFakeDb({ campaign_leads: s.campaign, appointments: s.appointments, leads: [], clients: [], recruits: [] });
      // The defect this design avoids: read a limited page WITHOUT exclusions, then drop cleared rows.
      const page = await fetchCallbackPage({ isFiltered: true, userId: ME, reference: REF, pageSize: 3 });
      const exclusions = new AttentionExclusions(s.clearances);
      const naive = page.filter((r) => !exclusions.match(r.source === "campaign" ? "campaign_callback" : "appointment_callback", r.sourceRowId, r.dueAt));
      if (naive.map((r) => r.key).join() !== expected.active.slice(0, 3).map((x) => x.key).join()) naiveWrong += 1;
    }
    expect(cleared).toBeGreaterThan(40);
    expect(naiveWrong).toBeGreaterThan(5);
  });

  it("a rescheduled callback is NOT excluded and still counts as active", async () => {
    const { startIso } = callbackWindow({ isFiltered: true, userId: ME, reference: REF });
    const due = new Date(Date.parse(startIso) + 86_400_000).toISOString();
    h.db = createFakeDb({
      campaign_leads: [{ id: uuid("c", 1), lead_id: null, callback_due_at: due, scheduled_callback_at: null, status: "Queued", callback_agent_id: ME }],
      appointments: [], leads: [], clients: [], recruits: [],
    });
    const exclusions = new AttentionExclusions([
      { id: uuid("d", 1), sourceType: "campaign_callback", sourceId: uuid("c", 1), occurrenceAt: "2026-07-20T09:00:00.000Z", clearedAt: "2026-07-20T09:00:00.000Z" },
    ]);
    const opts = { isFiltered: true, userId: ME, reference: REF, exclusions };
    expect((await fetchCallbackPage({ ...opts, pageSize: 15 })).map((r) => r.key)).toEqual([`campaign:${uuid("c", 1)}`]);
    expect(await fetchCallbackCounts(opts)).toEqual({ active: 1, cleared: 0 });
  });

  it("each branch reads `K` rows deeper (K = clearances of its table) and match reads reuse the branch filters", async () => {
    const s = scenario(7);
    h.db = createFakeDb({ campaign_leads: s.campaign, appointments: s.appointments, leads: [], clients: [], recruits: [] });
    const exclusions = new AttentionExclusions(s.clearances);
    await fetchCallbackPage({ isFiltered: true, userId: ME, reference: REF, pageSize: 15, offset: 5, exclusions });
    const rows = h.db.queries.filter((q: any) => !q.head && q.inIds === null && q.table !== "leads" && q.table !== "clients" && q.table !== "recruits");
    for (const q of rows) {
      const k = exclusions.count(q.table === "appointments" ? "appointment_callback" : "campaign_callback");
      expect(q.limit).toBe(20 + k);
    }
    h.db.queries.length = 0;
    await fetchCallbackCounts({ isFiltered: true, userId: ME, reference: REF, exclusions });
    const matches = h.db.queries.filter((q: any) => q.inIds !== null);
    const counts = h.db.queries.filter((q: any) => q.head);
    expect(counts).toHaveLength(3);
    // The SAME filters as the branch (window, status/type, ownership), plus the id list.
    for (const m of matches) {
      const branch = counts.find((c: any) => c.table === m.table && c.filters.includes("is:callback_due_at=null") === m.filters.includes("is:callback_due_at=null"));
      expect(m.filters.filter((f: string) => !f.startsWith("in:id"))).toEqual(branch.filters);
      expect(m.inIds!.length).toBeLessThanOrEqual(100);
    }
  });

  it("a failing match read rejects the whole count (never a partial total)", async () => {
    const s = scenario(3);
    h.db = createFakeDb({ campaign_leads: s.campaign, appointments: s.appointments, leads: [], clients: [], recruits: [] });
    h.db.failWhen = (q: any) => (q.inIds ? { message: "statement timeout", code: "57014" } : null);
    const exclusions = new AttentionExclusions(s.clearances.length ? s.clearances : [
      { id: uuid("d", 9), sourceType: "appointment_callback", sourceId: uuid("a", 0), occurrenceAt: "2026-08-03T10:00:00.000Z", clearedAt: "2026-08-03T10:00:00.000Z" },
    ]);
    await expect(fetchCallbackCounts({ isFiltered: true, userId: ME, reference: REF, exclusions })).rejects.toMatchObject({ name: "DashboardQueryError" });
  });
});

describe("flag-off parity: without clearances the contract sends exactly today's reads", () => {
  it("no clearance read, no match read, the original limits; an empty exclusion set is identical", async () => {
    const s = scenario(11);
    const run = async (exclusions?: AttentionExclusions) => {
      h.db = createFakeDb({ campaign_leads: s.campaign, appointments: s.appointments, leads: [], clients: [], recruits: [] });
      await fetchCallbackPage({ isFiltered: true, userId: ME, reference: REF, pageSize: 15, exclusions });
      await fetchCallbackTotal({ isFiltered: true, userId: ME, reference: REF, exclusions });
      return h.db.queries.map((q: any) => `${q.table}|${q.head}|${q.limit}|${q.filters.join(",")}`);
    };
    const off = await run(undefined);
    expect(off.some((q: string) => q.startsWith("dashboard_attention_clearances"))).toBe(false);
    expect(off.filter((q: string) => q.includes("in:id"))).toEqual([]);
    expect(off.filter((q: string) => /^(campaign_leads|appointments)\|false\|/.test(q)).every((q: string) => q.includes("|15|"))).toBe(true);
    expect(await run(AttentionExclusions.empty())).toEqual(off);
    expect(h.db.writes).toEqual([]);
  });
});

describe("bucket header counts are exact, or a marked lower bound, without extra queries", () => {
  const rows = (n: number) => Array.from({ length: n }, () => ({}) as any);
  it("all exact when the page holds every active row", () => {
    expect(callbackBucketCounts({ overdue: rows(2), dueToday: rows(1), dueSoon: rows(3) }, 6, 6)).toEqual({ overdue: "2", dueToday: "1", dueSoon: "3" });
  });
  it("earlier buckets exact, the last row's bucket a lower bound, later ones unknown", () => {
    expect(callbackBucketCounts({ overdue: rows(10), dueToday: rows(5), dueSoon: [] }, 15, 40)).toEqual({ overdue: "10", dueToday: "5+", dueSoon: null });
    expect(callbackBucketCounts({ overdue: rows(15), dueToday: [], dueSoon: [] }, 15, 40)).toEqual({ overdue: "15+", dueToday: null, dueSoon: null });
  });
});
