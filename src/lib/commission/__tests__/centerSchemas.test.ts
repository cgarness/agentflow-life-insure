import { afterEach, describe, expect, it, vi } from "vitest";
import { drawer, historyPage, overview, policiesPage, policyRow, scheduledPage } from "@/components/commissions/__tests__/centerFixtures";

const h = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown>]>, response: { data: null as unknown, error: null as unknown } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, args]);
      const request = Promise.resolve(h.response);
      return Object.assign(request, { abortSignal: () => request });
    },
  },
}));

import { asTrackedPolicy, historyPageSchema, overviewSchema, parseDrawer, policiesPageSchema, scheduledPageSchema } from "../centerSchemas";
import { commissionCenterApi, CommissionCenterError } from "../centerApi";
import { parseScheduled } from "../centerFilters";

afterEach(() => { h.calls = []; h.response = { data: null, error: null }; });

describe("commissions center parsers", () => {
  it("accept the read shapes", () => {
    expect(overviewSchema.parse(overview()).summary.expected_cents).toBe(85671);
    expect(scheduledPageSchema.parse(scheduledPage()).rows[1].contact).toBeNull();
    expect(historyPageSchema.parse(historyPage()).totals.received_cents).toBe(5157);
    expect(policiesPageSchema.parse(policiesPage([policyRow(1, { setup: "missing", estimate_cents: null, received_cents: null,
      remaining_cents: null, excess_cents: null, next_payment: null })])).rows[0].estimate_cents).toBeNull();
  });

  it("fail closed on an unexpected shape, a negative or fractional amount, or an unknown status", () => {
    expect(() => overviewSchema.parse({ ...overview(), summary: { ...overview().summary, expected_cents: -1 } })).toThrow();
    expect(() => overviewSchema.parse({ ...overview(), summary: { ...overview().summary, received_cents: 1.5 } })).toThrow();
    expect(() => scheduledPageSchema.parse(scheduledPage([{ ...scheduledPage().rows[0], status: "overdue" }]))).toThrow();
    expect(() => policiesPageSchema.parse({ ...policiesPage(), counts: undefined })).toThrow();
  });

  it("drawer: the contact read's policy shape; a restricted contact has no source and no contact", () => {
    const visible = parseDrawer(drawer());
    expect(visible.contact?.name).toBe("Client 1");
    const restricted = parseDrawer(drawer({ contact: null, source: null }));
    expect(restricted.contact).toBeNull();
    expect(asTrackedPolicy(restricted.policy).estimate?.installments).toHaveLength(4);
    expect(() => parseDrawer(drawer({ estimate: null }))).toThrow("Recorded commission without an estimate");
  });
});

describe("commissions center API", () => {
  it("sends only filters (no agent or organization) and maps the scope", async () => {
    h.response = { data: scheduledPage(), error: null };
    await commissionCenterApi.scheduled(parseScheduled(new URLSearchParams("dates=next_90&page=2&kind=advance")));
    expect(h.calls).toEqual([["get_my_commission_installments", { p_period: "this_month", p_from: null, p_to: null, p_scope: "next_90",
      p_status: "all", p_kind: "advance", p_carrier: null, p_limit: 25, p_offset: 25 }]]);
    h.calls = [];
    h.response = { data: scheduledPage(), error: null };
    await commissionCenterApi.scheduled(parseScheduled(new URLSearchParams("")));
    expect(h.calls[0][1].p_scope).toBe("range");
  });

  it.each([
    [{ code: "42501", message: "Commission access is unavailable" }, "denied", "Commissions aren't available for your account."],
    [{ code: "55000", message: "The agency time zone is not set" }, "time_zone", "An admin needs to set the agency time zone in Settings › Company Branding."],
    [{ code: "22023", message: "Choose a range of up to two years." }, "invalid", "Choose a range of up to two years."],
    [{ code: "PT404", message: "Commission not found" }, "not_found", "This commission is no longer available."],
    [{ code: "XX000", message: "internal detail" }, "unknown", "Commissions couldn't load. Try again."],
  ])("keeps the error kind (%o)", async (error, kind, message) => {
    h.response = { data: null, error };
    const failure = await commissionCenterApi.overview({ preset: "this_month", from: null, to: null }).catch((e) => e);
    expect(failure).toBeInstanceOf(CommissionCenterError);
    expect(failure.kind).toBe(kind);
    expect(failure.message).toBe(message);
  });

  it("treats a malformed success as an error, never as figures", async () => {
    h.response = { data: { meta: {} }, error: null };
    const failure = await commissionCenterApi.overview({ preset: "this_month", from: null, to: null }).catch((e) => e);
    expect(failure.kind).toBe("unknown");
  });
});
