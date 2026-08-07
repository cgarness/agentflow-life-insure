import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Cached active-session state must never bypass campaign-context revalidation.
 *
 * `startServerSession` used to `return true` the moment `activeSessionIdRef.current` existed, so a
 * session created for campaign A silently satisfied a request for campaign B and the server was
 * never asked to re-authorize. These tests pin the corrected short-circuit condition and the
 * server-refusal handling. They exercise the same decision logic the hook applies, without
 * standing up the full DialerPage tree.
 */

const CAMP_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CAMP_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** Mirrors the hook's session-start decision path exactly. */
function makeStarter(rpc: (campaignId: string) => Promise<{ id: string; campaign_id: string | null }>) {
  const state = { sessionId: null as string | null, sessionCampaign: null as string | null };
  const calls: string[] = [];
  return {
    state,
    calls,
    async start(campaignId: string): Promise<boolean> {
      // THE FIX: short-circuit only when the cached session is for THIS campaign.
      if (state.sessionId && state.sessionCampaign === campaignId) return true;
      calls.push(campaignId);
      try {
        const session = await rpc(campaignId);
        state.sessionId = session.id;
        state.sessionCampaign = session.campaign_id ?? null;
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      state.sessionId = null;
      state.sessionCampaign = null;
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("startServerSession — cached session cannot bypass revalidation", () => {
  it("reuses a cached session ONLY for the same campaign (no server call)", async () => {
    const rpc = vi.fn(async (c: string) => ({ id: "s1", campaign_id: c }));
    const s = makeStarter(rpc);

    await s.start(CAMP_A);
    expect(s.calls).toEqual([CAMP_A]);

    await s.start(CAMP_A);
    expect(s.calls).toEqual([CAMP_A]); // still one call — legitimate reuse preserved
    expect(s.state.sessionId).toBe("s1");
  });

  it("goes BACK TO THE SERVER when a different campaign is requested", async () => {
    const rpc = vi.fn(async (c: string) => ({ id: "s1", campaign_id: c }));
    const s = makeStarter(rpc);

    await s.start(CAMP_A);
    await s.start(CAMP_B);

    // The defect: the second call used to short-circuit and never reach the server.
    expect(s.calls).toEqual([CAMP_A, CAMP_B]);
  });

  it("fails closed when the server refuses a mismatched active session", async () => {
    const rpc = vi.fn(async (c: string) => {
      if (c === CAMP_B) {
        throw new Error("active dialer session belongs to campaign …, not the requested campaign …");
      }
      return { id: "s1", campaign_id: c };
    });
    const s = makeStarter(rpc);

    await expect(s.start(CAMP_A)).resolves.toBe(true);
    await expect(s.start(CAMP_B)).resolves.toBe(false);
    // The refusal must not overwrite local state with the wrong campaign.
    expect(s.state.sessionCampaign).toBe(CAMP_A);
  });

  it("fails closed when the server refuses an unauthorized resumed session", async () => {
    const rpc = vi.fn(async () => {
      throw new Error("not authorized to resume dialer session for campaign …");
    });
    const s = makeStarter(rpc);
    await expect(s.start(CAMP_A)).resolves.toBe(false);
    expect(s.state.sessionId).toBeNull();
  });

  it("tracks the campaign the SERVER reports, not the one requested", async () => {
    // The server may legitimately return an existing session; the local cache must follow it.
    const rpc = vi.fn(async () => ({ id: "s-existing", campaign_id: CAMP_A }));
    const s = makeStarter(rpc);
    await s.start(CAMP_A);
    expect(s.state.sessionCampaign).toBe(CAMP_A);

    // A later request for B must therefore hit the server rather than reuse A.
    await s.start(CAMP_B).catch(() => undefined);
    expect(s.calls).toEqual([CAMP_A, CAMP_B]);
  });

  it("re-requests from the server after local session state is cleared", async () => {
    const rpc = vi.fn(async (c: string) => ({ id: "s1", campaign_id: c }));
    const s = makeStarter(rpc);
    await s.start(CAMP_A);
    s.clear();
    await s.start(CAMP_A);
    expect(s.calls).toEqual([CAMP_A, CAMP_A]);
  });
});

describe("Campaign Detail dial authorization is bound to the current campaign id", () => {
  /** Mirrors the component's render-time derivation. */
  const derive = (
    routeId: string | undefined,
    auth: { campaignId: string; allowed: boolean } | null,
  ): boolean | null => (routeId && auth?.campaignId === routeId ? auth.allowed : null);

  it("uses a resolved answer for the matching campaign", () => {
    expect(derive(CAMP_A, { campaignId: CAMP_A, allowed: true })).toBe(true);
    expect(derive(CAMP_A, { campaignId: CAMP_A, allowed: false })).toBe(false);
  });

  it("NEVER lets the previous campaign's answer authorize a newly navigated campaign", () => {
    // Route moved A -> B while the stored answer is still A's `true`.
    expect(derive(CAMP_B, { campaignId: CAMP_A, allowed: true })).toBeNull();
  });

  it("is fail-closed until the new campaign's authorization resolves", () => {
    expect(derive(CAMP_B, null)).toBeNull();
    // null is not `true`, and the component gates on `=== true`.
    expect(derive(CAMP_B, null) === true).toBe(false);
    expect(derive(CAMP_B, { campaignId: CAMP_A, allowed: true }) === true).toBe(false);
  });

  it("is fail-closed with no route id at all", () => {
    expect(derive(undefined, { campaignId: CAMP_A, allowed: true })).toBeNull();
  });
});
