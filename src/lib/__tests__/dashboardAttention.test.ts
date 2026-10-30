import { beforeEach, describe, expect, it, vi } from "vitest";

/** Polish V2 §3.3–§3.8 — clearance reads, the exclusion index, the two RPCs and the release switch. */
const h = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/integrations/supabase/client", async () => {
  const { makeFakeSupabase } = await import("@/test/fakePostgrest");
  return { supabase: { from: (t: string) => makeFakeSupabase(h.db).from(t), rpc: (n: string, a: any) => makeFakeSupabase(h.db).rpc(n, a) } };
});

import { createFakeDb } from "@/test/fakePostgrest";
import {
  AttentionActionError,
  AttentionExclusions,
  CLEARANCE_READ_CAP,
  clearAttentionItem,
  compareInstants,
  readOwnClearances,
  sameInstant,
  undoAttentionClear,
} from "@/lib/dashboard-attention";
import { parseAttentionConfig } from "@/lib/dashboard-attention-config";

const ME = "11111111-1111-4111-8111-111111111111";
const ORG = "a0000000-0000-4000-8000-00000000000a";
const CALL = "40000000-0000-4000-8000-000000000001";
const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, user_id: ME, organization_id: ORG,
  source_type: "missed_call", source_id: CALL, occurrence_at: "2026-10-29T18:00:00.123456+00:00",
  cleared_at: "2026-10-29T18:05:00.000001+00:00", ...over,
});

beforeEach(() => {
  h.db = createFakeDb({ dashboard_attention_clearances: [] });
});

describe("release switch", () => {
  it("is on only for the exact string \"true\" (fails closed)", () => {
    expect(parseAttentionConfig({ VITE_DASHBOARD_ATTENTION_CLEARANCES: "true" })).toEqual({ clearancesEnabled: true });
    for (const v of [undefined, "", "TRUE", "1", "yes", " true"]) {
      expect(parseAttentionConfig({ VITE_DASHBOARD_ATTENTION_CLEARANCES: v })).toEqual({ clearancesEnabled: false });
    }
  });
});

describe("instants are compared to the microsecond", () => {
  it("sameInstant: equal instants in any server format, and never a ms-truncated near miss", () => {
    expect(sameInstant("2026-10-29T18:00:00.123456+00:00", "2026-10-29T18:00:00.123456Z")).toBe(true);
    expect(sameInstant("2026-10-29T18:00:00+00:00", "2026-10-29T18:00:00.000Z")).toBe(true);
    expect(sameInstant("2026-10-29T18:00:00.123456+00:00", "2026-10-29T18:00:00.123Z")).toBe(false);
    expect(sameInstant("2026-10-29T18:00:00Z", "2026-10-29T18:00:01Z")).toBe(false);
    expect(sameInstant("garbage", "garbage")).toBe(false);
  });
  it("compareInstants orders by sub-millisecond digits too", () => {
    expect(compareInstants("2026-10-29T18:00:00.123456Z", "2026-10-29T18:00:00.123457Z")).toBeLessThan(0);
    expect(compareInstants("2026-10-29T18:00:01Z", "2026-10-29T18:00:00.999999Z")).toBeGreaterThan(0);
  });
});

describe("the exclusion index", () => {
  it("matches only the cleared occurrence of the cleared source and type", () => {
    const ex = new AttentionExclusions([
      { id: "x", sourceType: "campaign_callback", sourceId: "s1", occurrenceAt: "2026-10-30T15:00:00Z", clearedAt: "c" },
      { id: "y", sourceType: "campaign_callback", sourceId: "s1", occurrenceAt: "2026-11-02T09:30:00Z", clearedAt: "c" },
    ]);
    expect(ex.match("campaign_callback", "s1", "2026-10-30T15:00:00.000Z")?.id).toBe("x");
    expect(ex.match("campaign_callback", "s1", "2026-10-31T15:00:00Z")).toBeNull();
    expect(ex.match("appointment_callback", "s1", "2026-10-30T15:00:00Z")).toBeNull();
    expect(ex.count("campaign_callback")).toBe(2);
    expect(ex.sourceIds("campaign_callback")).toEqual(["s1"]);
    expect(AttentionExclusions.empty().isEmpty).toBe(true);
  });
});

describe("readOwnClearances", () => {
  it("reads only the viewer's rows, in their organization, for the given types and window", async () => {
    h.db.tables.dashboard_attention_clearances = [
      row(1),
      row(2, { user_id: "22222222-2222-4222-8222-222222222222" }),
      row(3, { organization_id: "b0000000-0000-4000-8000-00000000000b" }),
      row(4, { source_type: "campaign_callback" }),
      row(5, { occurrence_at: "2026-10-27T00:00:00Z" }),
    ];
    const ex = await readOwnClearances({ userId: ME, organizationId: ORG, sourceTypes: ["missed_call"], fromIso: "2026-10-28T18:00:00.000Z" });
    expect(ex.clearances.map((c) => c.id)).toEqual([row(1).id]);
    // Timestamps are kept exactly as returned (they are sent back for Undo).
    expect(ex.clearances[0]).toMatchObject({ occurrenceAt: "2026-10-29T18:00:00.123456+00:00", clearedAt: "2026-10-29T18:05:00.000001+00:00" });
    const q = h.db.queries[0];
    expect(q.filters).toEqual(expect.arrayContaining([`eq:user_id=${ME}`, `eq:organization_id=${ORG}`, "in:source_type", "gte:occurrence_at"]));
  });

  it("fails closed: a returned error, a missing organization or more than the cap is a failure, never \"nothing cleared\"", async () => {
    h.db.failWhen = () => ({ message: "permission denied", code: "42501" });
    await expect(readOwnClearances({ userId: ME, organizationId: ORG, sourceTypes: ["missed_call"], fromIso: "2026-10-28T00:00:00Z" }))
      .rejects.toMatchObject({ name: "DashboardQueryError" });
    h.db.failWhen = undefined;
    await expect(readOwnClearances({ userId: ME, organizationId: null, sourceTypes: ["missed_call"], fromIso: "2026-10-28T00:00:00Z" }))
      .rejects.toMatchObject({ name: "DashboardQueryError" });
    await expect(readOwnClearances({ userId: "not-a-uuid", organizationId: ORG, sourceTypes: ["missed_call"], fromIso: "2026-10-28T00:00:00Z" }))
      .rejects.toThrow();
    h.db.tables.dashboard_attention_clearances = Array.from({ length: CLEARANCE_READ_CAP + 1 }, (_, i) => row(i + 1));
    await expect(readOwnClearances({ userId: ME, organizationId: ORG, sourceTypes: ["missed_call"], fromIso: "2026-10-28T00:00:00Z" }))
      .rejects.toMatchObject({ context: "attention-clearances-incomplete" });
  }, 20_000);
});

describe("Clear / Undo RPCs", () => {
  it("Clear sends the source and the occurrence string UNCHANGED (microseconds), and returns the stored row", async () => {
    h.db.rpc = () => ({ data: row(1), error: null });
    const stored = await clearAttentionItem({ sourceType: "missed_call", sourceId: CALL, expectedOccurrenceAt: "2026-10-29T18:00:00.123456+00:00" });
    expect(h.db.rpcCalls).toEqual([{ name: "clear_dashboard_attention_item", args: {
      p_source_type: "missed_call", p_source_id: CALL, p_expected_occurrence_at: "2026-10-29T18:00:00.123456+00:00",
    } }]);
    expect(stored).toMatchObject({ id: row(1).id, sourceId: CALL, clearedAt: row(1).cleared_at });
    // Never a write to any table: the RPC is the only write.
    expect(h.db.writes).toEqual([]);
  });

  it("validates input before sending (Zod): no RPC for a non-uuid source or a non-ISO time", async () => {
    await expect(clearAttentionItem({ sourceType: "missed_call", sourceId: "nope", expectedOccurrenceAt: "2026-10-29T18:00:00Z" })).rejects.toMatchObject({ kind: "invalid" });
    await expect(clearAttentionItem({ sourceType: "missed_call", sourceId: CALL, expectedOccurrenceAt: "yesterday" })).rejects.toMatchObject({ kind: "invalid" });
    await expect(clearAttentionItem({ sourceType: "voicemail" as any, sourceId: CALL, expectedOccurrenceAt: "2026-10-29T18:00:00Z" })).rejects.toMatchObject({ kind: "invalid" });
    expect(h.db.rpcCalls).toEqual([]);
  });

  it("maps server refusals to user-safe kinds; nothing stored is a failure, never success", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const input = { sourceType: "campaign_callback" as const, sourceId: CALL, expectedOccurrenceAt: "2026-10-30T15:00:00+00:00" };
    for (const [code, kind] of [["PT404", "not_pending"], ["PT409", "changed"], ["42501", "denied"], ["57014", "failed"]] as const) {
      h.db.rpc = () => ({ data: null, error: { code, message: "raw detail" } });
      await expect(clearAttentionItem(input)).rejects.toMatchObject({ kind });
    }
    h.db.rpc = () => ({ data: null, error: null });
    await expect(clearAttentionItem(input)).rejects.toBeInstanceOf(AttentionActionError);
  });

  it("Undo deletes only the exact clearance; \"false\" means it changed and is reported, not hidden", async () => {
    h.db.rpc = () => ({ data: true, error: null });
    await expect(undoAttentionClear({ id: row(1).id, clearedAt: row(1).cleared_at })).resolves.toBeUndefined();
    expect(h.db.rpcCalls[0]).toEqual({ name: "undo_dashboard_attention_clear", args: { p_id: row(1).id, p_expected_cleared_at: row(1).cleared_at } });
    h.db.rpc = () => ({ data: false, error: null });
    await expect(undoAttentionClear({ id: row(1).id, clearedAt: row(1).cleared_at })).rejects.toMatchObject({ kind: "changed" });
  });
});
