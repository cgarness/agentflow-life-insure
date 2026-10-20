/**
 * Commissions center reads: keyed by the signed-in user, organization and every filter; nothing under View As or
 * without the Own permission; a previous page is never shown for another identity; every tracking write refreshes
 * the center (same ["policy-commissions"] prefix as the contact view).
 */
import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORG, USER, overview, scheduledPage, scheduledRow } from "@/components/commissions/__tests__/centerFixtures";

const h = vi.hoisted(() => ({
  userId: "", impersonating: false, permitted: true,
  calls: [] as Array<[string, Record<string, unknown>]>,
  pending: [] as Array<(value: { data: unknown; error: null }) => void>,
  hold: false,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, args]);
      const data = name === "get_my_commission_overview" ? overview() : scheduledPage([scheduledRow(h.calls.length)]);
      const request = h.hold ? new Promise((resolve) => h.pending.push(resolve)) : Promise.resolve({ data, error: null });
      return Object.assign(request, { abortSignal: () => request });
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: h.userId }, isImpersonating: h.impersonating,
    profile: { id: h.impersonating ? "00000000-0000-4000-8000-0000000000ff" : h.userId, role: "Agent", organization_id: ORG } }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: ORG, role: "Agent" }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canSeeCommission: () => h.permitted, isLoading: false }) }));

import { commissionCenterKeys, useCommissionOverview, useScheduledPayments } from "../useCommissionsCenter";
import { useRefreshPolicyCommissions } from "../useClientPolicyCommissions";
import { parseScheduled } from "@/lib/commission/centerFilters";

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const MONTH = { preset: "this_month", from: null, to: null } as const;
beforeEach(() => {
  h.userId = USER; h.impersonating = false; h.permitted = true; h.calls = []; h.pending = []; h.hold = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(cleanup);

describe("useCommissionsCenter", () => {
  it("keys every read by user, organization and filter", async () => {
    const filter = parseScheduled(new URLSearchParams("status=remaining"));
    expect(commissionCenterKeys.scheduled(USER, ORG, filter)).toEqual(["policy-commissions", "center", USER, ORG, "scheduled", filter]);
    const { result } = renderHook(() => useCommissionOverview(MONTH), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryCache().findAll({ queryKey: ["policy-commissions", "center", USER, ORG, "overview"] })).toHaveLength(1);
  });

  it("requests nothing under View As, without the Own permission, or for an incomplete custom range", async () => {
    h.impersonating = true;
    renderHook(() => useCommissionOverview(MONTH), { wrapper });
    h.impersonating = false;
    h.permitted = false;
    renderHook(() => useScheduledPayments(parseScheduled(new URLSearchParams(""))), { wrapper });
    h.permitted = true;
    renderHook(() => useCommissionOverview({ preset: "custom", from: "2026-10-01", to: null }), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.calls).toEqual([]);
  });

  it("keeps the previous page while paging, but never shows it for another signed-in user", async () => {
    const { result, rerender } = renderHook(({ page }) => useScheduledPayments({ ...parseScheduled(new URLSearchParams("")), page }),
      { wrapper, initialProps: { page: 1 } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const first = result.current.data;
    h.hold = true;
    rerender({ page: 2 });
    expect(result.current.data).toBe(first);
    h.userId = "00000000-0000-4000-8000-000000000999";
    rerender({ page: 2 });
    expect(result.current.data).toBeUndefined();
  });

  it("never keeps the previous result for a changed filter, only for another page of the same filter", async () => {
    const { result, rerender } = renderHook(({ search }) => useScheduledPayments(parseScheduled(new URLSearchParams(search))),
      { wrapper, initialProps: { search: "" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const first = result.current.data;
    h.hold = true;
    rerender({ search: "page=2" });
    expect(result.current.data).toBe(first);
    expect(result.current.isPlaceholderData).toBe(true);
    for (const search of ["status=received", "kind=advance", "carrier=Harbor%20Mutual", "dates=any", "period=last_month", "status=received&page=2"]) {
      rerender({ search });
      expect(result.current.data).toBeUndefined();
    }
  });

  it("Next 90 days and Any date share one key and request whatever the hidden custom range holds", async () => {
    const next90 = parseScheduled(new URLSearchParams("dates=next_90&period=custom&from=2026-10-05"));
    const { result } = renderHook(() => useScheduledPayments(next90), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.calls.at(-1)?.[1]).toMatchObject({ p_scope: "next_90", p_period: "this_month", p_from: null, p_to: null });
    expect(client.getQueryCache().findAll({ queryKey: ["policy-commissions", "center", USER, ORG, "scheduled"] })[0].queryKey)
      .toEqual(commissionCenterKeys.scheduled(USER, ORG, parseScheduled(new URLSearchParams("dates=next_90"))));
  });

  it("refreshes the center after any tracking write (shared prefix with the contact view)", async () => {
    const { result } = renderHook(() => ({ overview: useCommissionOverview(MONTH), refresh: useRefreshPolicyCommissions() }), { wrapper });
    await waitFor(() => expect(result.current.overview.isSuccess).toBe(true));
    expect(h.calls).toHaveLength(1);
    await act(async () => { await result.current.refresh(); });
    expect(h.calls).toHaveLength(2);
  });
});
