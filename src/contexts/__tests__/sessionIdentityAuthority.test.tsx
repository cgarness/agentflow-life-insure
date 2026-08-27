/**
 * Session identity is the root of every authority decision in AuthContext — and it changes
 * ASYNCHRONOUSLY, one layer below the profile that authority is actually read from.
 *
 * THE BLOCKING DEFECT THIS PINS (present at b38253e). `onAuthStateChange` treats two cases
 * differently:
 *
 *     if (event === "INITIAL_SESSION") await fetchProfile(id);
 *     else setTimeout(() => fetchProfile(id), 0);   //  <-- SIGNED_IN lands here
 *
 * So for every real session replacement, the authenticated user is already B while the trusted
 * real profile — and `realProfileRef`, which `startImpersonation` re-checks after its await — still
 * holds A. An activation started by A that resolves inside that window passes the re-check
 * (`live.id === profile.id`, both still A), writes the pointer and returns `true`. The previous
 * pass's re-check only compared the profile to ITSELF; nothing compared either to the session.
 *
 * The corrected design records the authenticated user id SYNCHRONOUSLY the moment a session is
 * adopted, bumps a generation counter, and destroys everything the previous identity authorised
 * before the new profile fetch is even scheduled. Every asynchronous authority attempt — direct
 * activation and stored-pointer restore alike — captures both, and re-checks both immediately
 * before committing.
 */

import React from "react";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const SUPER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TARGET = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TARGET_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

interface Deferred { kind: "profile" | "target"; id: string; release: () => void }

const dbState = vi.hoisted(() => ({
  profiles: [] as Record<string, unknown>[],
  /** Profile reads (no organization predicate) that hang until released. */
  holdProfile: new Set<string>(),
  /** Target reads (WITH an organization predicate) that hang until released. */
  holdTarget: new Set<string>(),
  pending: [] as unknown[],
  /** Profile reads that resolve with a PostgREST error. */
  profileError: null as string | null,
  /** When set, the TARGET read (the one carrying an organization predicate) THROWS. */
  targetThrow: null as string | null,
  queries: [] as { id?: string; organization_id?: string }[],
  sessionUserId: null as string | null,
  authCallback: null as null | ((event: string, session: unknown) => void | Promise<void>),
  /** When true, `getSession()` hangs until `releaseGetSession()` — with the session it captured. */
  holdGetSession: false,
  releaseGetSession: null as null | (() => void),
}));

const storageState = vi.hoisted(() => ({ raw: null as string | null }));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const rec = { eq: {} as Record<string, unknown> };

    const settle = () => {
      if (table !== "profiles") return { data: null, error: null };
      const id = typeof rec.eq.id === "string" ? rec.eq.id : undefined;
      const org = typeof rec.eq.organization_id === "string" ? rec.eq.organization_id : undefined;
      dbState.queries.push({ id, organization_id: org });
      // A profile read has no organization predicate; a target read does.
      if (!org && dbState.profileError) return { data: null, error: { message: dbState.profileError } };
      const row = dbState.profiles.find((r) => Object.entries(rec.eq).every(([c, v]) => r[c] === v));
      // A FRESH object every time, as a real network response is. Returning the same reference
      // would let React bail out of `setProfile`, so effects keyed on `profile` would silently
      // never re-run and any test depending on that re-run would pass without exercising it.
      return { data: row ? { ...row } : null, error: null };
    };

    const resolveRead = (): Promise<unknown> => {
      if (table !== "profiles") return Promise.resolve(settle());
      const id = typeof rec.eq.id === "string" ? rec.eq.id : "";
      const isTarget = typeof rec.eq.organization_id === "string";
      // Scoped to the target read on purpose: throwing for the PROFILE read too would stop the
      // profile ever loading, so the restore would never start and the test would pass vacuously.
      if (isTarget && dbState.targetThrow) {
        // A transport failure happens AFTER the request goes out, so record it as issued.
        dbState.queries.push({
          id,
          organization_id: typeof rec.eq.organization_id === "string" ? rec.eq.organization_id : undefined,
        });
        return Promise.reject(new Error(dbState.targetThrow));
      }
      const held = isTarget ? dbState.holdTarget : dbState.holdProfile;
      if (id && held.has(id)) {
        return new Promise((res) => {
          (dbState.pending as Deferred[]).push({
            kind: isTarget ? "target" : "profile",
            id,
            release: () => res(settle()),
          });
        });
      }
      return Promise.resolve(settle());
    };

    const b: Record<string, unknown> = {
      select() { return b; },
      eq(col: string, val: unknown) { rec.eq[col] = val; return b; },
      maybeSingle() { return resolveRead(); },
      single() { return resolveRead(); },
      update() { return b; },
      then(resolve: (v: unknown) => unknown) { return resolveRead().then(resolve); },
    };
    return b;
  }

  const sessionFor = (userId: string | null) => {
    if (!userId) return null;
    const row = dbState.profiles.find((r) => r.id === userId) as Record<string, unknown> | undefined;
    return {
      access_token: `token-${userId}`,
      user: {
        id: userId,
        app_metadata: { organization_id: row?.organization_id, role: row?.role },
      },
    };
  };

  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      auth: {
        onAuthStateChange: (cb: (e: string, s: unknown) => void | Promise<void>) => {
          dbState.authCallback = cb;
          return { data: { subscription: { unsubscribe() {} } } };
        },
        getSession: () => {
          // Captured NOW, resolved later — exactly how a real in-flight bootstrap goes stale.
          const captured = sessionFor(dbState.sessionUserId);
          if (dbState.holdGetSession) {
            return new Promise((res) => {
              dbState.releaseGetSession = () => res({ data: { session: captured } });
            });
          }
          return Promise.resolve({ data: { session: captured } });
        },
        signOut: () => Promise.resolve({ error: null }),
        refreshSession: () => Promise.resolve({ data: { session: sessionFor(dbState.sessionUserId) } }),
      },
    },
  };
});

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { IMPERSONATION_STORAGE_KEY } from "@/lib/impersonationProfile";

let lastStart: ((t: unknown) => Promise<boolean>) | null = null;
let lastLogout: (() => Promise<void>) | null = null;
let lastStop: (() => void) | null = null;

const Probe: React.FC = () => {
  const { profile, realProfile, isImpersonating, startImpersonation, logout, stopImpersonation } = useAuth();
  lastStart = startImpersonation as unknown as (t: unknown) => Promise<boolean>;
  lastLogout = logout;
  lastStop = stopImpersonation;
  return (
    <div>
      <span data-testid="real-id">{realProfile?.id ?? "none"}</span>
      <span data-testid="real-role">{realProfile?.role ?? "none"}</span>
      <span data-testid="effective-id">{profile?.id ?? "none"}</span>
      <span data-testid="effective-org">{profile?.organization_id ?? "none"}</span>
      <span data-testid="impersonating">{String(isImpersonating)}</span>
    </div>
  );
};

const renderAuth = () => render(<AuthProvider><Probe /></AuthProvider>);

function installStorage() {
  const store = {
    getItem: (k: string) => (k === IMPERSONATION_STORAGE_KEY ? storageState.raw : null),
    setItem: (k: string, v: string) => { if (k === IMPERSONATION_STORAGE_KEY) storageState.raw = v; },
    removeItem: (k: string) => { if (k === IMPERSONATION_STORAGE_KEY) storageState.raw = null; },
    clear: () => { storageState.raw = null; },
    key: () => null,
    length: 0,
  };
  Object.defineProperty(window, "localStorage", { value: store, configurable: true, writable: true });
}

const superRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, role: "Super Admin", organization_id: ORG, is_super_admin: true,
  status: "Active", first_name: "Sam", last_name: String(id).slice(0, 4), email: `${id}@x.test`, ...over,
});
const targetRow = (id = TARGET, over: Record<string, unknown> = {}) => ({
  id, role: "Agent", organization_id: ORG, is_super_admin: false,
  status: "Active", first_name: "Tara", last_name: "Target", email: `${id}@x.test`, ...over,
});

/** Deliver an auth event exactly as supabase would, for an arbitrary event name. */
async function fireAuth(event: string, userId: string | null) {
  dbState.sessionUserId = userId;
  const row = dbState.profiles.find((r) => r.id === userId) as Record<string, unknown> | undefined;
  const session = userId
    ? {
        access_token: `token-${userId}`,
        user: { id: userId, app_metadata: { organization_id: row?.organization_id, role: row?.role } },
      }
    : null;
  await dbState.authCallback!(event, session);
}

const pending = () => dbState.pending as Deferred[];
const pendingFor = (kind: "profile" | "target", id: string) =>
  pending().find((p) => p.kind === kind && p.id === id);

/** Wait for a held read to be registered without flushing React work we care about. */
const awaitPending = (kind: "profile" | "target", id: string) =>
  waitFor(() => expect(pendingFor(kind, id)).toBeTruthy());

beforeEach(() => {
  dbState.profiles = [];
  dbState.holdProfile = new Set();
  dbState.holdTarget = new Set();
  dbState.pending = [];
  dbState.profileError = null;
  dbState.targetThrow = null;
  dbState.queries = [];
  dbState.sessionUserId = null;
  dbState.authCallback = null;
  dbState.holdGetSession = false;
  dbState.releaseGetSession = null;
  storageState.raw = null;
  lastStart = null;
  lastLogout = null;
  lastStop = null;
  installStorage();
});

afterEach(cleanup);

/** Boot as `userId` and wait until its real profile is trusted. */
async function bootAs(userId: string) {
  dbState.sessionUserId = userId;
  renderAuth();
  await waitFor(() => expect(screen.getByTestId("real-id").textContent).toBe(userId));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("a SIGNED_IN replacement invalidates an in-flight activation", () => {
  it("cannot commit after SIGNED_IN, even before the deferred profile fetch runs", async () => {
    // THE BLOCKING DEFECT. `SIGNED_IN` schedules `fetchProfile` with setTimeout, so between the
    // event and that deferred fetch the session is B while the trusted profile is still A. The
    // target lookup is released INSIDE that window on purpose — awaiting or hand-completing B's
    // profile fetch first would step over the very gap being tested.
    dbState.profiles = [superRow(SUPER_A), superRow(SUPER_B, { organization_id: OTHER_ORG }), targetRow()];
    await bootAs(SUPER_A);

    dbState.holdTarget = new Set([TARGET]);
    // B's profile fetch is held too, so it cannot accidentally close the window for us.
    dbState.holdProfile = new Set([SUPER_B]);

    let result: unknown;
    await act(async () => {
      const inFlight = lastStart!(TARGET);
      await awaitPending("target", TARGET);

      await fireAuth("SIGNED_IN", SUPER_B);
      // NOTE: no await of B's profile fetch, and no manual completion of it.
      pendingFor("target", TARGET)!.release();
      result = await inFlight;
    });

    expect(result, "a stale activation survived a SIGNED_IN replacement").toBe(false);
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(storageState.raw, "a refused activation left a pointer behind").toBeNull();
  });

  it("also refuses when the replacement is the SAME organization", async () => {
    // The organization comparison cannot save this: both Super Admins are in ORG, so only the
    // session identity distinguishes them.
    dbState.profiles = [superRow(SUPER_A), superRow(SUPER_B), targetRow()];
    await bootAs(SUPER_A);

    dbState.holdTarget = new Set([TARGET]);
    dbState.holdProfile = new Set([SUPER_B]);

    let result: unknown;
    await act(async () => {
      const inFlight = lastStart!(TARGET);
      await awaitPending("target", TARGET);
      await fireAuth("SIGNED_IN", SUPER_B);
      pendingFor("target", TARGET)!.release();
      result = await inFlight;
    });

    expect(result).toBe(false);
    expect(storageState.raw).toBeNull();
  });

  it("cannot commit after A -> B -> A, when the session id ends where it started", async () => {
    // Only the GENERATION counter can catch this. Comparing the session id to the one captured at
    // start passes — it is the same id again — and the re-fetched profile is identical too. What
    // makes the attempt stale is that an identity change happened at all, which is exactly what the
    // counter records.
    dbState.profiles = [superRow(SUPER_A), superRow(SUPER_B), targetRow()];
    await bootAs(SUPER_A);

    dbState.holdTarget = new Set([TARGET]);
    let result: unknown;
    await act(async () => {
      const inFlight = lastStart!(TARGET);
      await awaitPending("target", TARGET);

      await fireAuth("SIGNED_IN", SUPER_B);
      await new Promise((r) => setTimeout(r, 5)); // B's deferred fetch lands
      await fireAuth("SIGNED_IN", SUPER_A);       // …and A signs back in
      await new Promise((r) => setTimeout(r, 5));

      pendingFor("target", TARGET)!.release();
      result = await inFlight;
    });

    expect(result, "an activation survived a round trip through another identity").toBe(false);
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(storageState.raw).toBeNull();
  });

  // POSITIVE / NON-REGRESSION GUARD — passes at b38253e. `INITIAL_SESSION` awaits its profile
  // fetch, so the trusted profile is already B by the time the target resolves and the previous
  // pass's profile-vs-profile re-check already caught it. It is kept because it must keep working,
  // NOT as evidence for the SIGNED_IN defect above.
  it("INITIAL_SESSION replacement is still refused (guard, passes pre-fix)", async () => {
    dbState.profiles = [superRow(SUPER_A), superRow(SUPER_B, { organization_id: OTHER_ORG }), targetRow()];
    await bootAs(SUPER_A);

    dbState.holdTarget = new Set([TARGET]);
    let result: unknown;
    await act(async () => {
      const inFlight = lastStart!(TARGET);
      await awaitPending("target", TARGET);
      await fireAuth("INITIAL_SESSION", SUPER_B);
      pendingFor("target", TARGET)!.release();
      result = await inFlight;
    });

    expect(result).toBe(false);
    expect(storageState.raw).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("a session identity change invalidates the previous identity SYNCHRONOUSLY", () => {
  it("A's real and effective state are gone before B's profile request settles", async () => {
    dbState.profiles = [superRow(SUPER_A), superRow(SUPER_B), targetRow()];
    await bootAs(SUPER_A);

    // A holds a live impersonation.
    await act(async () => { await lastStart!(TARGET); });
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("true"));
    expect(storageState.raw).not.toBeNull();

    // B signs in; B's profile read is held, so nothing about B is known yet.
    dbState.holdProfile = new Set([SUPER_B]);
    await act(async () => { await fireAuth("SIGNED_IN", SUPER_B); });

    // Everything A authorised must already be gone — not after B's request settles.
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(screen.getByTestId("real-id").textContent).toBe("none");
    expect(screen.getByTestId("effective-id").textContent).toBe("none");
    expect(storageState.raw, "A's pointer survived the identity change").toBeNull();
  });

  it("a FAILED replacement profile lookup cannot leave A's authority standing", async () => {
    dbState.profiles = [superRow(SUPER_A), superRow(SUPER_B), targetRow()];
    await bootAs(SUPER_A);
    await act(async () => { await lastStart!(TARGET); });
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("true"));

    // B's profile lookup fails outright.
    dbState.profileError = "permission denied for table profiles";
    await act(async () => {
      await fireAuth("SIGNED_IN", SUPER_B);
      await new Promise((r) => setTimeout(r, 5)); // let the deferred fetch run and fail
    });

    expect(screen.getByTestId("real-id").textContent).toBe("none");
    expect(screen.getByTestId("effective-id").textContent).toBe("none");
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(storageState.raw).toBeNull();
  });

  it("a delayed profile response for A cannot overwrite B's session", async () => {
    dbState.profiles = [superRow(SUPER_A, { first_name: "Ayla" }), superRow(SUPER_B, { first_name: "Bex" })];
    dbState.sessionUserId = SUPER_A;
    dbState.holdProfile = new Set([SUPER_A]);
    renderAuth();
    await awaitPending("profile", SUPER_A);

    // The account switches while A's profile read is still outstanding.
    await act(async () => {
      await fireAuth("SIGNED_IN", SUPER_B);
      await new Promise((r) => setTimeout(r, 5)); // B's deferred fetch resolves (not held)
    });
    await waitFor(() => expect(screen.getByTestId("real-id").textContent).toBe(SUPER_B));

    // A's response finally arrives, long after the session moved on.
    await act(async () => { pendingFor("profile", SUPER_A)!.release(); });

    expect(screen.getByTestId("real-id").textContent, "a stale profile response replaced the live session").toBe(SUPER_B);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("a stored-pointer restore is bound to the session that started it", () => {
  it("cannot commit after the session identity changes", async () => {
    // B is deliberately in the SAME organization. A cross-organization replacement would make the
    // session's `app_metadata` claims disagree with the stale profile, which flips
    // `isBuildingOrganization` and unmounts the children — the assertion would then fail because
    // there is nothing to query, not because the restore was refused.
    dbState.profiles = [superRow(SUPER_A), superRow(SUPER_B), targetRow()];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET });
    dbState.holdTarget = new Set([TARGET]);
    dbState.sessionUserId = SUPER_A;

    renderAuth();
    await awaitPending("target", TARGET);

    dbState.holdProfile = new Set([SUPER_B]);
    await act(async () => {
      await fireAuth("SIGNED_IN", SUPER_B);
      pendingFor("target", TARGET)!.release();
      await new Promise((r) => setTimeout(r, 5));
    });

    expect(screen.getByTestId("impersonating").textContent, "a restore committed for a replaced session").toBe("false");
    expect(storageState.raw).toBeNull();
  });

  it("a transport-level THROW during restore fails closed and clears the pointer", async () => {
    // The restore path runs inside `void (async () => …)()`, so a throw there is an unhandled
    // rejection — it never reaches a `catch`, the pointer is never cleared, and the next reload
    // retries the same doomed restore.
    //
    // The cleared pointer is what discriminates: a `window.addEventListener("unhandledrejection")`
    // probe was tried here and is INERT under vitest's jsdom environment, so it asserted nothing.
    dbState.profiles = [superRow(SUPER_A), targetRow()];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET });
    dbState.sessionUserId = SUPER_A;
    dbState.targetThrow = "network down";

    renderAuth();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(storageState.raw, "a thrown restore left the pointer in place").toBeNull();
    // …and the failure was actually reported, rather than vanishing into a swallowed rejection.
    expect(dbState.queries.some((q) => q.id === TARGET && q.organization_id === ORG)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("newer intent supersedes older in-flight attempts", () => {
  // NOTE, honestly: PASSES at b38253e. `logout()` already set the real profile to null, and the
  // previous pass's `!live` re-check caught that. It is kept as a non-regression guard, and it is
  // mutation-pinned to the generation bump (see the pass notes), not offered as fail-first evidence.
  it("logout() invalidates an activation that is still in flight", async () => {
    dbState.profiles = [superRow(SUPER_A), targetRow()];
    await bootAs(SUPER_A);

    dbState.holdTarget = new Set([TARGET]);
    let result: unknown;
    await act(async () => {
      const inFlight = lastStart!(TARGET);
      await awaitPending("target", TARGET);
      await lastLogout!();
      pendingFor("target", TARGET)!.release();
      result = await inFlight;
    });

    expect(result).toBe(false);
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(storageState.raw).toBeNull();
  });

  it("stopImpersonation() invalidates an activation that is still in flight", async () => {
    dbState.profiles = [superRow(SUPER_A), targetRow()];
    await bootAs(SUPER_A);

    dbState.holdTarget = new Set([TARGET]);
    let result: unknown;
    await act(async () => {
      const inFlight = lastStart!(TARGET);
      await awaitPending("target", TARGET);
      lastStop!();
      pendingFor("target", TARGET)!.release();
      result = await inFlight;
    });

    expect(result).toBe(false);
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(storageState.raw).toBeNull();
  });

  it("a newer activation supersedes a pending stored-pointer restore", async () => {
    dbState.profiles = [superRow(SUPER_A), targetRow(TARGET), targetRow(TARGET_2, { first_name: "Second" })];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET });
    dbState.holdTarget = new Set([TARGET]);
    dbState.sessionUserId = SUPER_A;

    renderAuth();
    await awaitPending("target", TARGET);

    // A direct activation for a DIFFERENT target starts and finishes first.
    await act(async () => { await lastStart!(TARGET_2); });
    await waitFor(() => expect(screen.getByTestId("effective-id").textContent).toBe(TARGET_2));

    // The restore's response finally arrives and must be discarded.
    await act(async () => {
      pendingFor("target", TARGET)!.release();
      await new Promise((r) => setTimeout(r, 5));
    });

    expect(screen.getByTestId("effective-id").textContent, "a stale restore overwrote a newer activation").toBe(TARGET_2);
    expect(JSON.parse(storageState.raw as string)).toEqual({ version: 1, targetProfileId: TARGET_2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("a signed-out session holds no authority at all", () => {
  it("a page that boots SIGNED OUT scrubs the pointer before anyone logs in", async () => {
    // The pointer is read from storage on mount, before the listener registers. A signed-out boot
    // then calls adoptSessionIdentity(null) with prev === null === next, so an identity-change-only
    // teardown scrubs NOTHING — and the very next login inherits a target it never asked for,
    // within the same page life. This is why the explicit signed-out teardown must not be folded
    // into the identity-change branch.
    dbState.profiles = [superRow(SUPER_A), superRow(SUPER_B), targetRow()];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET });
    dbState.sessionUserId = null;

    renderAuth();
    // The teardown runs when the session lookup answers "nobody" — one tick, and still long before
    // any login could occur.
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });

    expect(storageState.raw, "a signed-out boot kept a stored View As pointer").toBeNull();
  });

  it("nobody inherits that pointer by logging in afterwards", async () => {
    dbState.profiles = [superRow(SUPER_A), superRow(SUPER_B), targetRow()];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET });
    dbState.sessionUserId = null;

    renderAuth();
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });

    // A different Super Admin now signs in on this same page.
    await act(async () => {
      await fireAuth("SIGNED_IN", SUPER_B);
      await new Promise((r) => setTimeout(r, 15));
    });

    expect(screen.getByTestId("real-id").textContent).toBe(SUPER_B);
    expect(
      screen.getByTestId("impersonating").textContent,
      "a fresh login inherited someone else's View As target",
    ).toBe("false");
    expect(storageState.raw).toBeNull();
  });

  // NON-REGRESSION GUARD — PASSES at b38253e, where the listener's own `else` branch did this.
  // That branch was folded into `adoptSessionIdentity`; this makes sure nothing was lost with it.
  it("an explicit SIGNED_OUT still tears everything down", async () => {
    dbState.profiles = [superRow(SUPER_A), targetRow()];
    await bootAs(SUPER_A);
    await act(async () => { await lastStart!(TARGET); });
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("true"));

    await act(async () => { await fireAuth("SIGNED_OUT", null); });

    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(screen.getByTestId("real-id").textContent).toBe("none");
    expect(storageState.raw).toBeNull();
  });
});

describe("a committed activation disarms any pending restore", () => {
  // NOTE, honestly: PASSES at b38253e and at every mutation tried against it — the restore effect
  // is gated on `profile`, so once an activation has committed the effect's own supersede check
  // catches the stale pointer. Kept as a guard on that ordering, not as fail-first evidence.
  it("a restore that had not started yet cannot later overwrite the chosen target", async () => {
    // `startImpersonation` committing does not, on its own, stop a restore that has not begun.
    // The restore effect waits for `profile`; if the activation lands first, the effect runs
    // AFTERWARDS, captures the CURRENT generation (the activation's own), and commits the stale
    // stored target over the one the operator clicked — while storage still says the operator's.
    dbState.profiles = [superRow(SUPER_A), targetRow(TARGET), targetRow(TARGET_2, { first_name: "Second" })];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET });
    // The profile read is held, so the restore effect cannot start: it is gated on `profile`.
    dbState.holdProfile = new Set([SUPER_A]);
    dbState.sessionUserId = SUPER_A;

    renderAuth();
    await awaitPending("profile", SUPER_A);

    // Release the profile so an activation is possible, then choose a DIFFERENT target.
    await act(async () => {
      pendingFor("profile", SUPER_A)!.release();
      await new Promise((r) => setTimeout(r, 5));
    });
    await waitFor(() => expect(screen.getByTestId("real-id").textContent).toBe(SUPER_A));
    await act(async () => { await lastStart!(TARGET_2); });
    await waitFor(() => expect(screen.getByTestId("effective-id").textContent).toBe(TARGET_2));

    // Now an ordinary profile refetch replaces the `profile` object and re-runs the effect.
    await act(async () => {
      await fireAuth("TOKEN_REFRESHED", SUPER_A);
      await new Promise((r) => setTimeout(r, 15));
    });

    expect(
      screen.getByTestId("effective-id").textContent,
      "a stale stored pointer overwrote the target the operator chose",
    ).toBe(TARGET_2);
    expect(JSON.parse(storageState.raw as string)).toEqual({ version: 1, targetProfileId: TARGET_2 });
  });
});

describe("the getSession bootstrap cannot revert a newer identity", () => {
  it("a late getSession result does not overwrite an identity the listener already adopted", async () => {
    // `getSession()` captures whatever session existed when it was called. If a SIGNED_IN arrives
    // while it is still in flight, its stale result would adopt the OLD id back — reverting the
    // trusted identity and re-authorising an account that is no longer signed in.
    dbState.profiles = [superRow(SUPER_A), superRow(SUPER_B)];
    dbState.sessionUserId = SUPER_A;
    dbState.holdGetSession = true;

    renderAuth();
    await waitFor(() => expect(dbState.authCallback).toBeTypeOf("function"));

    // A newer identity arrives first.
    await act(async () => {
      await fireAuth("SIGNED_IN", SUPER_B);
      await new Promise((r) => setTimeout(r, 5));
    });
    await waitFor(() => expect(screen.getByTestId("real-id").textContent).toBe(SUPER_B));

    // The bootstrap's stale answer (session A) finally arrives.
    await act(async () => {
      dbState.releaseGetSession!();
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(screen.getByTestId("real-id").textContent, "a stale bootstrap reverted the session").toBe(SUPER_B);
  });
});

describe("a superseded restore leaves nothing behind to re-fire", () => {
  it("does not re-restore the old pointer when the profile is refetched", async () => {
    // Bailing out silently on supersede is right for STORAGE (it may already belong to the newer
    // activation) but the pending target must still be dropped. The restore effect depends on
    // [pendingImpersonationTargetId, profile], so leaving it set means the next profile refetch —
    // a token refresh, an INITIAL_SESSION replay — re-runs the whole restore and overwrites the
    // target the operator actually chose.
    dbState.profiles = [superRow(SUPER_A), targetRow(TARGET), targetRow(TARGET_2, { first_name: "Second" })];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET });
    dbState.holdTarget = new Set([TARGET]);
    dbState.sessionUserId = SUPER_A;

    renderAuth();
    await awaitPending("target", TARGET);

    await act(async () => { await lastStart!(TARGET_2); });
    await waitFor(() => expect(screen.getByTestId("effective-id").textContent).toBe(TARGET_2));

    await act(async () => {
      pendingFor("target", TARGET)!.release();
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(screen.getByTestId("effective-id").textContent).toBe(TARGET_2);

    // Now the real profile is refetched for the SAME session — routine, and it re-runs the effect.
    dbState.holdTarget = new Set();
    await act(async () => {
      await fireAuth("TOKEN_REFRESHED", SUPER_A);
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(screen.getByTestId("effective-id").textContent, "a superseded pointer re-restored itself").toBe(TARGET_2);
    expect(JSON.parse(storageState.raw as string)).toEqual({ version: 1, targetProfileId: TARGET_2 });
  });
});

// NOTE, honestly: this describe PASSES at b38253e. The latch is a bug THIS PASS introduces —
// `adoptSessionIdentity` nulls the real profile, which skips the token-refresh effect's whole `if`
// including the `else` that clears the flag. At b38253e the profile is never nulled, so the flag
// always clears. It is a guard on the fix, not fail-first evidence against b38253e.
describe("the agency-building screen cannot latch on after an identity change", () => {
  it("clears isBuildingOrganization when the profile it was building for is gone", async () => {
    // `adoptSessionIdentity` nulls the real profile, which skips the token-refresh effect's whole
    // `if` — including the `else` that turns the flag back off. Latched true, AuthProvider renders
    // "Loading your agency" INSTEAD of its children, so the entire app is blank until a reload.
    // A claims mismatch is what turns the flag on: the session says one organization, the profile
    // another.
    dbState.profiles = [
      superRow(SUPER_A, { organization_id: ORG }),
      superRow(SUPER_B, { organization_id: ORG }),
    ];
    dbState.sessionUserId = SUPER_A;
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-id").textContent).toBe(SUPER_A));

    // A session whose claims disagree with the profile flips the flag on.
    await act(async () => {
      await dbState.authCallback!("TOKEN_REFRESHED", {
        access_token: "t",
        user: { id: SUPER_A, app_metadata: { organization_id: OTHER_ORG, role: "Super Admin" } },
      });
      await new Promise((r) => setTimeout(r, 5));
    });
    await waitFor(() => expect(screen.queryByText(/loading your agency/i)).toBeInTheDocument());

    // The account is replaced while the flag is on.
    dbState.holdProfile = new Set([SUPER_B]);
    await act(async () => { await fireAuth("SIGNED_IN", SUPER_B); });

    expect(
      screen.queryByText(/loading your agency/i),
      "the agency-building screen latched on and blanked the app",
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("real-id")).toBeInTheDocument();
  });
});

describe("overlapping direct activations resolve by REQUEST order, not response order", () => {
  it("the latest requested target wins when the older response arrives last", async () => {
    dbState.profiles = [superRow(SUPER_A), targetRow(TARGET), targetRow(TARGET_2, { first_name: "Second" })];
    await bootAs(SUPER_A);

    dbState.holdTarget = new Set([TARGET, TARGET_2]);

    let first: unknown;
    let second: unknown;
    await act(async () => {
      const a = lastStart!(TARGET);       // requested FIRST
      await awaitPending("target", TARGET);
      const b = lastStart!(TARGET_2);     // requested SECOND — this one must win
      await awaitPending("target", TARGET_2);

      // Responses arrive in the opposite order.
      pendingFor("target", TARGET_2)!.release();
      second = await b;
      pendingFor("target", TARGET)!.release();
      first = await a;
    });

    expect(second, "the newest activation was refused").toBe(true);
    expect(first, "an older activation committed after a newer one").toBe(false);
    await waitFor(() => expect(screen.getByTestId("effective-id").textContent).toBe(TARGET_2));
    expect(JSON.parse(storageState.raw as string)).toEqual({ version: 1, targetProfileId: TARGET_2 });
  });

  // NOTE, honestly: PASSES at b38253e — there is no generation counter there to misplace. This
  // guards the fix's own bump PLACEMENT (mutation-pinned: moving the bump to the entry point kills
  // this test and only this test), not a defect present at b38253e.
  it("a REFUSED activation does not cancel a legitimate one already in flight", async () => {
    // The generation is bumped only once a request is known to be well-formed AND authorised. The
    // refusal used here is a SELF-impersonation attempt: it is rejected after the argument parses
    // and after the session check, which is exactly the span an entry-point bump would cover — so a
    // stray click on your own row would cancel a real activation that is mid-round-trip.
    dbState.profiles = [superRow(SUPER_A), targetRow(TARGET)];
    await bootAs(SUPER_A);

    dbState.holdTarget = new Set([TARGET]);
    let legit: unknown;
    let junk: unknown;
    await act(async () => {
      const a = lastStart!(TARGET);
      await awaitPending("target", TARGET);
      junk = await lastStart!(SUPER_A);   // refused: the target is the signed-in account itself
      pendingFor("target", TARGET)!.release();
      legit = await a;
    });

    expect(junk).toBe(false);
    expect(legit, "a malformed request cancelled a legitimate activation").toBe(true);
    await waitFor(() => expect(screen.getByTestId("effective-id").textContent).toBe(TARGET));
  });

  it("an older activation cannot overwrite storage after a newer one committed", async () => {
    dbState.profiles = [superRow(SUPER_A), targetRow(TARGET), targetRow(TARGET_2)];
    await bootAs(SUPER_A);

    dbState.holdTarget = new Set([TARGET]);
    let older: unknown;
    await act(async () => {
      const a = lastStart!(TARGET);
      await awaitPending("target", TARGET);
      // A newer activation for a target that resolves immediately.
      await lastStart!(TARGET_2);
      pendingFor("target", TARGET)!.release();
      older = await a;
    });

    expect(older).toBe(false);
    expect(JSON.parse(storageState.raw as string)).toEqual({ version: 1, targetProfileId: TARGET_2 });
    expect(screen.getByTestId("effective-id").textContent).toBe(TARGET_2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("the trusted real profile must belong to the CURRENT session", () => {
  it("refuses before querying when the profile predates the live session", async () => {
    // Between a session replacement and its deferred profile fetch, `profile` belongs to the
    // previous account. An activation started in that window must not even reach the database.
    dbState.profiles = [superRow(SUPER_A), superRow(SUPER_B), targetRow()];
    await bootAs(SUPER_A);

    dbState.holdProfile = new Set([SUPER_B]);
    await act(async () => { await fireAuth("SIGNED_IN", SUPER_B); });

    dbState.queries = [];
    let result: unknown;
    await act(async () => { result = await lastStart!(TARGET); });

    expect(result).toBe(false);
    expect(dbState.queries.filter((q) => q.id === TARGET), "queried a target for a stale session").toEqual([]);
    expect(storageState.raw).toBeNull();
  });

  // POSITIVE CONTROL — the guards must not make ordinary activation impossible.
  it("an ordinary activation on a settled session still succeeds", async () => {
    dbState.profiles = [superRow(SUPER_A), targetRow()];
    await bootAs(SUPER_A);

    let result: unknown;
    await act(async () => { result = await lastStart!(TARGET); });

    expect(result).toBe(true);
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("true"));
    expect(screen.getByTestId("effective-id").textContent).toBe(TARGET);
    expect(JSON.parse(storageState.raw as string)).toEqual({ version: 1, targetProfileId: TARGET });
  });

  // POSITIVE CONTROL — a repeated event for the SAME identity is not an identity change.
  it("a TOKEN_REFRESHED event for the same user does not disturb a live impersonation", async () => {
    dbState.profiles = [superRow(SUPER_A), targetRow()];
    await bootAs(SUPER_A);
    await act(async () => { await lastStart!(TARGET); });
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("true"));

    await act(async () => {
      await fireAuth("TOKEN_REFRESHED", SUPER_A);
      await new Promise((r) => setTimeout(r, 5));
    });

    expect(screen.getByTestId("impersonating").textContent).toBe("true");
    expect(screen.getByTestId("effective-id").textContent).toBe(TARGET);
    expect(storageState.raw).not.toBeNull();
  });
});
