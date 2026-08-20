/**
 * useCampaignSelectionLive — the ONE refresh owner for the campaign-selection screen.
 * Fail-first additions for the table redesign: the existing 15s tick / focus refresh must ALSO
 * invalidate the presence query (["dialerCampaignPresence", org] prefix), and there must still
 * be exactly ONE polling interval (no second poller for presence — mandate test #20).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => {
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  return {
    channel,
    supabase: {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    },
    setIntervalSpy: null as ReturnType<typeof vi.spyOn> | null,
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));

import { useCampaignSelectionLive } from "@/hooks/useCampaignSelectionLive";

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useCampaignSelectionLive — single refresh owner", () => {
  let queryClient: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.spyOn>;
  let refetchCampaigns: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    refetchCampaigns = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mount(isActive = true) {
    return renderHook(
      () => useCampaignSelectionLive("org-1", isActive, refetchCampaigns),
      { wrapper: makeWrapper(queryClient) },
    );
  }

  function invalidatedKeys(): string[] {
    return invalidateSpy.mock.calls
      .map((c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey?.[0])
      .filter((k): k is string => typeof k === "string");
  }

  it("a 15s tick refreshes stats AND presence off the same owner", () => {
    mount();
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    const keys = invalidatedKeys();
    expect(keys).toContain("campaignStateStats");
    expect(keys).toContain("dialerCampaignPresence");
    expect(refetchCampaigns).toHaveBeenCalledWith({ silent: true });
  });

  it("presence invalidation is org-scoped (prefix match hits every visible-id key)", () => {
    mount();
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    const presenceCall = invalidateSpy.mock.calls.find(
      (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey?.[0] === "dialerCampaignPresence",
    );
    expect(presenceCall).toBeTruthy();
    expect((presenceCall![0] as { queryKey: unknown[] }).queryKey).toEqual([
      "dialerCampaignPresence",
      "org-1",
    ]);
  });

  it("there is exactly ONE polling interval — two windows produce exactly two tick batches", () => {
    mount();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    const presenceInvalidations = invalidatedKeys().filter((k) => k === "dialerCampaignPresence");
    expect(presenceInvalidations).toHaveLength(2);
    expect(refetchCampaigns).toHaveBeenCalledTimes(2);
  });

  it("window focus refreshes presence through the same owner", () => {
    mount();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(invalidatedKeys()).toContain("dialerCampaignPresence");
  });

  it("does nothing while inactive (off the selection screen)", () => {
    mount(false);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(refetchCampaigns).not.toHaveBeenCalled();
  });
});
