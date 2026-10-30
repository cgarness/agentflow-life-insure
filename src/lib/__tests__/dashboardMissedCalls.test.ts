import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Polish V2 §3.6 — the ONE missed-call contract (widget + detail view): the viewer's organization
 * only, the routing scope unchanged, cleared calls excluded inside the paging math, exact totals,
 * and no write to any call, voicemail or notification.
 */
const h = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/integrations/supabase/client", async () => {
  const { makeFakeSupabase } = await import("@/test/fakePostgrest");
  return { supabase: { from: (t: string) => makeFakeSupabase(h.db).from(t), rpc: (n: string, a: any) => makeFakeSupabase(h.db).rpc(n, a) } };
});

import { createFakeDb } from "@/test/fakePostgrest";
import { AttentionExclusions } from "@/lib/dashboard-attention";
import { fetchClearedMissedCalls, fetchMissedCallCounts, fetchMissedCallPage } from "@/lib/dashboard-missed-calls";
import { loadMissedCallWidget } from "@/lib/dashboard-widget-loads";
import { buildMyMissedCallsOrFilter } from "@/lib/missedCallScope";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORG = "a0000000-0000-4000-8000-00000000000a";
const PEER = "b0000000-0000-4000-8000-00000000000b";
const SINCE = "2026-10-28T20:00:00.000Z";
const call = (n: number, over: Record<string, unknown> = {}) => ({
  id: `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`, organization_id: ORG, direction: "inbound", is_missed: true,
  created_at: new Date(Date.parse("2026-10-29T19:00:00Z") - n * 60_000).toISOString(),
  contact_id: null, contact_name: `Caller ${n}`, contact_phone: `+1555000${String(n).padStart(4, "0")}`,
  agent_id: null, missed_for_agent_id: ME, missed_recipient_ids: [ME], routed_agent_ids: null, answered_by_agent_id: null,
  voicemail_id: null, missed_reason: "no_answer", outcome: null, disposition_name: null, duration: 0, status: "no-answer",
  ...over,
});
const clearance = (c: { id: string; created_at: string }, n = 1) => ({
  id: `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, sourceType: "missed_call" as const, sourceId: c.id,
  occurrenceAt: c.created_at, clearedAt: "2026-10-29T19:30:00.000Z",
});

beforeEach(() => {
  h.db = createFakeDb({ calls: [], leads: [], clients: [], profiles: [] });
});

describe("scope", () => {
  it("reads only the viewer's organization (Agency Group peer calls never appear) with the unchanged routing filter", async () => {
    h.db.tables.calls = [call(1), call(2, { organization_id: PEER }), call(3, { missed_for_agent_id: OTHER, missed_recipient_ids: [OTHER] })];
    const team = await fetchMissedCallPage({ userId: ME, organizationId: ORG, isFiltered: false, since: SINCE, pageSize: 20 });
    expect(team.map((c) => c.contactName)).toEqual(["Caller 1", "Caller 3"]);
    const mine = await fetchMissedCallPage({ userId: ME, organizationId: ORG, isFiltered: true, since: SINCE, pageSize: 20 });
    expect(mine.map((c) => c.contactName)).toEqual(["Caller 1"]);
    const q = h.db.queries.find((x: any) => x.table === "calls" && x.filters.some((f: string) => f.startsWith("or:")));
    expect(q.filters).toContain(`or:${buildMyMissedCallsOrFilter(ME)}`);
    expect(q.filters).toContain(`eq:organization_id=${ORG}`);
  });

  it("fails closed without an organization, and returns nothing (not the organization) for an invalid viewer id", async () => {
    h.db.tables.calls = [call(1)];
    await expect(fetchMissedCallPage({ userId: ME, organizationId: null, isFiltered: true, since: SINCE, pageSize: 5 })).rejects.toMatchObject({ name: "DashboardQueryError" });
    expect(await fetchMissedCallPage({ userId: "nope", organizationId: ORG, isFiltered: true, since: SINCE, pageSize: 5 })).toEqual([]);
  });
});

describe("exact exclusion and totals", () => {
  const fifteen = () => Array.from({ length: 15 }, (_, i) => call(i + 1));

  it("pages exactly over the ACTIVE calls at every offset, reading K rows deeper", async () => {
    h.db.tables.calls = fifteen();
    const cleared = [h.db.tables.calls[0], h.db.tables.calls[4], h.db.tables.calls[5], h.db.tables.calls[12]];
    const exclusions = new AttentionExclusions(cleared.map((c, i) => clearance(c, i)));
    const active = h.db.tables.calls.filter((c: any) => !cleared.includes(c)).map((c: any) => c.contact_name);
    for (const pageSize of [1, 2, 5]) {
      const seen: string[] = [];
      for (let offset = 0; offset < active.length; offset += pageSize) {
        h.db.queries.length = 0;
        const page = await fetchMissedCallPage({ userId: ME, organizationId: ORG, isFiltered: true, since: SINCE, pageSize, offset, exclusions });
        expect(page.map((c) => c.contactName)).toEqual(active.slice(offset, offset + pageSize));
        expect(h.db.queries.find((q: any) => q.table === "calls").limit).toBe(offset + pageSize + 4);
        seen.push(...page.map((c) => c.contactName));
      }
      expect(seen).toEqual(active);
    }
    expect(await fetchMissedCallCounts({ userId: ME, organizationId: ORG, isFiltered: true, since: SINCE, exclusions })).toEqual({ active: 11, cleared: 4 });
    const clearedList = await fetchClearedMissedCalls({ userId: ME, organizationId: ORG, isFiltered: true, since: SINCE, exclusions });
    expect(clearedList.map((c) => c.contactName)).toEqual(["Caller 1", "Caller 5", "Caller 6", "Caller 13"]);
    expect(clearedList.every((c) => c.clearance !== null)).toBe(true);
  });

  it("a clearance from another perspective (a call outside My scope) is never subtracted in My view", async () => {
    h.db.tables.calls = [call(1), call(2, { missed_for_agent_id: OTHER, missed_recipient_ids: [OTHER] })];
    const exclusions = new AttentionExclusions([clearance(h.db.tables.calls[1])]);
    expect(await fetchMissedCallCounts({ userId: ME, organizationId: ORG, isFiltered: true, since: SINCE, exclusions })).toEqual({ active: 1, cleared: 0 });
  });

  it("an unlinked / Unknown caller is cleared and excluded by its call id", async () => {
    h.db.tables.calls = [call(1, { contact_id: null, contact_name: null })];
    const exclusions = new AttentionExclusions([clearance(h.db.tables.calls[0])]);
    expect(await fetchMissedCallPage({ userId: ME, organizationId: ORG, isFiltered: true, since: SINCE, pageSize: 5, exclusions })).toEqual([]);
    const cleared = await fetchClearedMissedCalls({ userId: ME, organizationId: ORG, isFiltered: true, since: SINCE, exclusions });
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatchObject({ id: h.db.tables.calls[0].id, contactName: "Unknown", contactId: null });
  });

  it("the widget: the active list's length IS the exact total when it fits (no count read); otherwise an exact count", async () => {
    h.db.tables.calls = [call(1), call(2)];
    const signal = new AbortController().signal;
    const small = await loadMissedCallWidget({ userId: ME, organizationId: ORG, isFiltered: true, clearancesEnabled: false, signal });
    expect(small).toMatchObject({ totalCount: 2, clearedCount: 0 });
    expect(h.db.queries.filter((q: any) => q.head)).toHaveLength(0);
    expect(h.db.queries.some((q: any) => q.table === "dashboard_attention_clearances")).toBe(false);
    h.db.tables.calls = fifteen();
    h.db.queries.length = 0;
    const big = await loadMissedCallWidget({ userId: ME, organizationId: ORG, isFiltered: true, clearancesEnabled: false, signal });
    expect(big.items).toHaveLength(5);
    expect(big.totalCount).toBe(15);
  });
});

describe("telemetry and source records are never written", () => {
  it("no INSERT / UPDATE / DELETE / UPSERT on any table across every read path", async () => {
    h.db.tables.calls = Array.from({ length: 8 }, (_, i) => call(i + 1, { contact_id: i % 2 ? `1ead0000-0000-4000-8000-00000000000${i}` : null }));
    const exclusions = new AttentionExclusions([clearance(h.db.tables.calls[2])]);
    const scope = { userId: ME, organizationId: ORG, isFiltered: false, since: SINCE, exclusions };
    await fetchMissedCallPage({ ...scope, pageSize: 5 });
    await fetchMissedCallCounts(scope);
    await fetchClearedMissedCalls(scope);
    expect(h.db.writes).toEqual([]);
    expect(h.db.queries.every((q: any) => ["calls", "leads", "clients"].includes(q.table))).toBe(true);
  });
});
