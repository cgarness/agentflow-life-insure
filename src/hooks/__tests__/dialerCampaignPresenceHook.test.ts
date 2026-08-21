/**
 * useDialerCampaignPresence — background-failure semantics (corrective pass, 2026-08-20).
 * Contract pinned here:
 *   - a successful fetch exposes the presence map;
 *   - a FAILED background refresh suppresses previously cached presence immediately
 *     (presence -> undefined, so every cell/header/expanded section renders "—" —
 *     stale live counts and identities must never linger through an error state);
 *   - an ordinary in-flight refresh does NOT hide valid prior data.
 * Fail-first: the pre-corrective hook returned the raw useQuery result (data stayed
 * populated through a refetch error), so these assertions are red against current head.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  getPresence: vi.fn(),
}));

vi.mock("@/lib/supabase-dialer-presence", () => ({
  DIALER_CAMPAIGN_PRESENCE_QUERY_KEY: "dialerCampaignPresence",
  getDialerCampaignPresence: h.getPresence,
}));

import { useDialerCampaignPresence } from "@/hooks/useDialerCampaignPresence";

const MAP_A = { c1: { activeAgentCount: 2, activeAgents: [] } };

function mount() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  const hook = renderHook(
    () =>
      useDialerCampaignPresence({
        organizationId: "org-1",
        campaignIds: ["c1"],
        idsKey: "c1",
        enabled: true,
      }),
    { wrapper },
  );
  return { ...hook, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useDialerCampaignPresence — error/refresh semantics", () => {
  it("exposes the presence map after a successful fetch", async () => {
    h.getPresence.mockResolvedValue(MAP_A);
    const { result } = mount();
    await waitFor(() => expect(result.current.presence).toEqual(MAP_A));
    expect(result.current.isError).toBe(false);
  });

  it("suppresses previously cached presence the moment a background refresh fails", async () => {
    h.getPresence.mockResolvedValueOnce(MAP_A);
    const { result, queryClient } = mount();
    await waitFor(() => expect(result.current.presence).toEqual(MAP_A));

    h.getPresence.mockRejectedValueOnce(new Error("boom"));
    await act(async () => {
      await queryClient
        .invalidateQueries({ queryKey: ["dialerCampaignPresence", "org-1"] })
        .catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.presence).toBeUndefined();
  });

  it("keeps valid prior data visible during an ordinary in-flight refresh", async () => {
    h.getPresence.mockResolvedValueOnce(MAP_A);
    const { result, queryClient } = mount();
    await waitFor(() => expect(result.current.presence).toEqual(MAP_A));

    // A refresh that never settles within this test: data must stay visible, no error.
    h.getPresence.mockImplementationOnce(() => new Promise(() => {}));
    act(() => {
      void queryClient.invalidateQueries({ queryKey: ["dialerCampaignPresence", "org-1"] });
    });

    expect(result.current.presence).toEqual(MAP_A);
    expect(result.current.isError).toBe(false);
  });
});
