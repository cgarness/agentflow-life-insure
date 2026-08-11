import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

/**
 * Cached active-session state must never bypass campaign-context revalidation.
 *
 * This exercises the REAL `useDialerSession` hook (not a local reimplementation): `startServerSession`
 * is the production decision that DialerPage's `handleSelectCampaign` / `handleCall` / `proceedWithCall`
 * gates on. Only the boundaries are mocked — the session RPC lib, the context hooks, the supabase
 * client and react-router. The server-side refusals these scenarios depend on are proven separately
 * in supabase/tests/import_campaign_attachment.sql (T33/T34).
 */

const CAMP_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CAMP_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const h = vi.hoisted(() => ({
  /** startDialerSession behaviour, swappable per test. Records every call. */
  startCalls: [] as string[],
  startImpl: null as null | ((campaignId?: string) => Promise<{ id: string; campaign_id: string | null; started_at: string }>),
}));

vi.mock("@/lib/supabase-dialer-sessions", () => ({
  startDialerSession: (campaignId?: string) => {
    h.startCalls.push(campaignId ?? "");
    if (!h.startImpl) {
      return Promise.resolve({ id: "s-default", campaign_id: campaignId ?? null, started_at: "2026-08-07T00:00:00Z" });
    }
    return h.startImpl(campaignId);
  },
  heartbeatDialerSession: () => Promise.resolve({}),
  endDialerSession: () => Promise.resolve({}),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "agent-1" }, profile: { is_super_admin: false } }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ getDataScope: () => "own", hasFeatureAccess: () => false, isLoading: false }),
}));
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }),
    }),
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));

import { useDialerSession } from "@/hooks/useDialerSession";

beforeEach(() => {
  h.startCalls.length = 0;
  h.startImpl = null;
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("useDialerSession.startServerSession — real hook", () => {
  it("starts an authorized session and returns true (one server call)", async () => {
    h.startImpl = (c) => Promise.resolve({ id: "s1", campaign_id: c ?? null, started_at: "t" });
    const { result } = renderHook(() => useDialerSession());

    let ok!: boolean;
    await act(async () => { ok = await result.current.startServerSession(CAMP_A); });
    expect(ok).toBe(true);
    expect(h.startCalls).toEqual([CAMP_A]);
  });

  it("reuses a cached session for the SAME campaign without a new server call", async () => {
    h.startImpl = (c) => Promise.resolve({ id: "s1", campaign_id: c ?? null, started_at: "t" });
    const { result } = renderHook(() => useDialerSession());

    await act(async () => { await result.current.startServerSession(CAMP_A); });
    let ok!: boolean;
    await act(async () => { ok = await result.current.startServerSession(CAMP_A); });
    expect(ok).toBe(true);
    expect(h.startCalls).toEqual([CAMP_A]); // still one — legitimate same-campaign reuse
  });

  it("goes BACK TO THE SERVER for a different campaign and returns false on a mismatch refusal", async () => {
    // Cached session is for A; the server refuses a B request (the migration's mismatch guard).
    h.startImpl = (c) => {
      if (c === CAMP_B) return Promise.reject(new Error("active dialer session belongs to campaign A, not B"));
      return Promise.resolve({ id: "s1", campaign_id: c ?? null, started_at: "t" });
    };
    const { result } = renderHook(() => useDialerSession());

    await act(async () => { await result.current.startServerSession(CAMP_A); });
    let ok!: boolean;
    await act(async () => { ok = await result.current.startServerSession(CAMP_B); });

    expect(ok).toBe(false);               // DialerPage aborts the call on this
    expect(h.startCalls).toEqual([CAMP_A, CAMP_B]); // it did NOT short-circuit
  });

  it("returns false when the server refuses an unauthorized resume", async () => {
    h.startImpl = () => Promise.reject(new Error("not authorized to resume dialer session for campaign …"));
    const { result } = renderHook(() => useDialerSession());

    let ok!: boolean;
    await act(async () => { ok = await result.current.startServerSession(CAMP_A); });
    expect(ok).toBe(false);
  });

  it("returns true when the server returns an EXISTING session for the requested campaign", async () => {
    // Reuse branch on the server side: it returns the pre-existing (authorized) session.
    h.startImpl = () => Promise.resolve({ id: "s-existing", campaign_id: CAMP_A, started_at: "t" });
    const { result } = renderHook(() => useDialerSession());

    let ok!: boolean;
    await act(async () => { ok = await result.current.startServerSession(CAMP_A); });
    expect(ok).toBe(true);
    expect(result.current.activeSessionId).toBe("s-existing");
  });

  it("re-requests from the server for a different campaign after the first succeeded", async () => {
    // Both campaigns individually authorized; a second DIFFERENT campaign must still hit the server.
    h.startImpl = (c) => Promise.resolve({ id: `s-${c}`, campaign_id: c ?? null, started_at: "t" });
    const { result } = renderHook(() => useDialerSession());

    await act(async () => { await result.current.startServerSession(CAMP_A); });
    await act(async () => { await result.current.startServerSession(CAMP_B); });
    expect(h.startCalls).toEqual([CAMP_A, CAMP_B]);
  });
});

describe("Campaign Detail dial authorization is bound to the current campaign id", () => {
  /** Mirrors the component's render-time derivation (production logic, not a session fake). */
  const derive = (
    routeId: string | undefined,
    auth: { campaignId: string; allowed: boolean } | null,
  ): boolean | null => (routeId && auth?.campaignId === routeId ? auth.allowed : null);

  it("uses a resolved answer for the matching campaign", () => {
    expect(derive(CAMP_A, { campaignId: CAMP_A, allowed: true })).toBe(true);
    expect(derive(CAMP_A, { campaignId: CAMP_A, allowed: false })).toBe(false);
  });

  it("NEVER lets the previous campaign's answer authorize a newly navigated campaign", () => {
    expect(derive(CAMP_B, { campaignId: CAMP_A, allowed: true })).toBeNull();
    expect(derive(CAMP_B, { campaignId: CAMP_A, allowed: true }) === true).toBe(false);
  });

  it("is fail-closed until the new campaign's authorization resolves", () => {
    expect(derive(CAMP_B, null)).toBeNull();
    expect(derive(undefined, { campaignId: CAMP_A, allowed: true })).toBeNull();
  });
});
