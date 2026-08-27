/**
 * "View As" is an AUTHORITY decision, and localStorage is attacker-controlled.
 *
 * THE BYPASS THIS PINS: impersonation used to be rehydrated by validating only the SHAPE of the
 * stored payload — `id`, `role`, `organization_id` present. Nothing proved the *real* signed-in
 * user was allowed to impersonate anyone. A rank-and-file Agent could open devtools and write
 *
 *     localStorage.agentflow_impersonation = JSON.stringify({
 *       id: "...", role: "Admin", organization_id: "..." })
 *
 * and `useAuth().profile` — which every scoping surface reads — would return role "Admin", making
 * `isOrganizationWideViewer` true and turning their Import History query organization-wide.
 *
 * The corrected design stores only `{ version: 1, targetProfileId }` (nothing authority-bearing),
 * and activates impersonation ONLY after the real database-backed profile has loaded and proven
 * `is_super_admin === true`, then re-fetches the target from the server.
 *
 * NOTE ON DEPTH, stated honestly: this is a FRONTEND authority boundary. `import_history_select`
 * RLS is still organization-wide, so an Agent who bypasses the UI can read those rows directly over
 * PostgREST regardless. Closing that is a separate, unapproved RLS phase. What this test guarantees
 * is that the application no longer *grants* the elevated role itself.
 */

import React from "react";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TARGET_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

interface ProfileRow {
  id: string;
  role: string;
  organization_id: string | null;
  is_super_admin: boolean;
  status?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

const dbState = vi.hoisted(() => ({
  /** Rows visible through the mocked `profiles` SELECT (i.e. what RLS would allow). */
  profiles: [] as Record<string, unknown>[],
  /** Ids the app asked the server to resolve, in order. */
  profileFetches: [] as string[],
  /** Full filter set of each `profiles` query, so the org predicate can be asserted. */
  profileQueries: [] as { id?: string; organization_id?: string }[],
  sessionUserId: null as string | null,
  profileError: null as string | null,
}));

const storageState = vi.hoisted(() => ({
  raw: null as string | null,
  throwOnGet: false,
  throwOnSet: false,
  throwOnRemove: false,
  removed: 0,
}));

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    const rec = { eq: {} as Record<string, unknown> };
    const settle = () => {
      if (table !== "profiles") return { data: null, error: null };
      if (dbState.profileError) return { data: null, error: { message: dbState.profileError } };
      const id = rec.eq.id;
      if (typeof id === "string") dbState.profileFetches.push(id);
      dbState.profileQueries.push({
        id: typeof id === "string" ? id : undefined,
        organization_id: typeof rec.eq.organization_id === "string" ? rec.eq.organization_id : undefined,
      });
      const row = dbState.profiles.find((r) =>
        Object.entries(rec.eq).every(([c, v]) => r[c] === v));
      return { data: row ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select() { return b; },
      eq(col: string, val: unknown) { rec.eq[col] = val; return b; },
      maybeSingle() { return Promise.resolve(settle()); },
      single() { return Promise.resolve(settle()); },
      update() { return b; },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve(settle()).then(resolve); },
    };
    return b;
  }

  const session = () => {
    if (!dbState.sessionUserId) return null;
    const row = dbState.profiles.find((r) => r.id === dbState.sessionUserId) as ProfileRow | undefined;
    return {
      // Claims are kept consistent with the profile row so the token-refresh loop stays idle.
      access_token: "test-token",
      user: {
        id: dbState.sessionUserId,
        app_metadata: { organization_id: row?.organization_id, role: row?.role },
      },
    };
  };

  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getSession: () => Promise.resolve({ data: { session: session() } }),
        signOut: () => Promise.resolve({ error: null }),
        refreshSession: () => Promise.resolve({ data: { session: session() } }),
      },
    },
  };
});

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useEffectiveViewer } from "@/hooks/useEffectiveViewer";
import { isOrganizationWideViewer } from "@/lib/effectiveViewer";
import { IMPERSONATION_STORAGE_KEY } from "@/lib/impersonationProfile";

/** Renders the values every scoping surface actually consumes. */
let lastStart: ((p: unknown) => unknown) | null = null;
let lastStartResult: unknown = undefined;
/** The whole effective profile, so field-level loss through re-validation is observable. */
let lastEffectiveProfile: Record<string, unknown> | null = null;

const Probe: React.FC = () => {
  const { profile, realProfile, isImpersonating, startImpersonation } = useAuth();
  const { viewer } = useEffectiveViewer();
  lastStart = startImpersonation as unknown as (p: unknown) => unknown;
  lastEffectiveProfile = (profile ?? null) as Record<string, unknown> | null;
  return (
    <div>
      <span data-testid="effective-role">{profile?.role ?? "none"}</span>
      <span data-testid="effective-id">{profile?.id ?? "none"}</span>
      <span data-testid="effective-org">{profile?.organization_id ?? "none"}</span>
      <span data-testid="real-role">{realProfile?.role ?? "none"}</span>
      <span data-testid="impersonating">{String(isImpersonating)}</span>
      <span data-testid="org-wide">{String(isOrganizationWideViewer(viewer))}</span>
    </div>
  );
};

function renderAuth() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

function installStorage() {
  const store = {
    getItem: (k: string) => {
      if (storageState.throwOnGet) throw new DOMException("denied", "SecurityError");
      return k === IMPERSONATION_STORAGE_KEY ? storageState.raw : null;
    },
    setItem: (k: string, v: string) => {
      if (storageState.throwOnSet) throw new DOMException("quota", "QuotaExceededError");
      if (k === IMPERSONATION_STORAGE_KEY) storageState.raw = v;
    },
    removeItem: (k: string) => {
      if (storageState.throwOnRemove) throw new DOMException("denied", "SecurityError");
      if (k === IMPERSONATION_STORAGE_KEY) { storageState.raw = null; storageState.removed += 1; }
    },
    clear: () => { storageState.raw = null; },
    key: () => null,
    length: 0,
  };
  Object.defineProperty(window, "localStorage", { value: store, configurable: true, writable: true });
}

const agentRow = (over: Partial<ProfileRow> = {}) => ({
  id: AGENT_ID, role: "Agent", organization_id: ORG, is_super_admin: false,
  status: "Active", first_name: "Ann", last_name: "Agent", email: "a@x.test", ...over,
});
const superRow = (over: Partial<ProfileRow> = {}) => ({
  id: SUPER_ID, role: "Super Admin", organization_id: ORG, is_super_admin: true,
  status: "Active", first_name: "Sam", last_name: "Super", email: "s@x.test", ...over,
});
const targetRow = (over: Partial<ProfileRow> = {}) => ({
  id: TARGET_ID, role: "Agent", organization_id: ORG, is_super_admin: false,
  status: "Active", first_name: "Tara", last_name: "Target", email: "t@x.test", ...over,
});

beforeEach(() => {
  dbState.profiles = [];
  dbState.profileFetches = [];
  dbState.profileQueries = [];
  dbState.profileError = null;
  dbState.sessionUserId = null;
  storageState.raw = null;
  storageState.throwOnGet = false;
  storageState.throwOnSet = false;
  storageState.throwOnRemove = false;
  storageState.removed = 0;
  installStorage();
});

afterEach(cleanup);

describe("a forged stored target cannot elevate a real Agent", () => {
  it("an Agent who writes a full Admin profile into storage stays an Agent", async () => {
    dbState.sessionUserId = AGENT_ID;
    dbState.profiles = [agentRow()];
    // The attack: a complete, well-SHAPED profile claiming Admin in the same org.
    storageState.raw = JSON.stringify({
      id: TARGET_ID, role: "Admin", organization_id: ORG, is_super_admin: false,
      first_name: "Forged", last_name: "Admin", email: "f@x.test", status: "Active",
    });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Agent"));

    expect(screen.getByTestId("effective-role").textContent).toBe("Agent");
    expect(screen.getByTestId("effective-id").textContent).toBe(AGENT_ID);
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    // The whole point: this is what turns the Import History query organization-wide.
    expect(screen.getByTestId("org-wide").textContent).toBe("false");
  });

  it("clears the forged payload rather than leaving it to be retried", async () => {
    dbState.sessionUserId = AGENT_ID;
    dbState.profiles = [agentRow()];
    storageState.raw = JSON.stringify({ id: TARGET_ID, role: "Admin", organization_id: ORG });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Agent"));
    await waitFor(() => expect(storageState.raw).toBeNull());
  });

  it("a forged target in ANOTHER organization cannot move the viewer's org", async () => {
    dbState.sessionUserId = AGENT_ID;
    dbState.profiles = [agentRow()];
    storageState.raw = JSON.stringify({ id: TARGET_ID, role: "Admin", organization_id: OTHER_ORG });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Agent"));

    expect(screen.getByTestId("effective-org").textContent).toBe(ORG);
    expect(screen.getByTestId("org-wide").textContent).toBe("false");
  });

  it("never hydrates role or organization from storage — the target is re-fetched from the server", async () => {
    dbState.sessionUserId = SUPER_ID;
    // Storage LIES about the target's role; the server says Agent.
    dbState.profiles = [superRow(), targetRow({ role: "Agent" })];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET_ID });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("true"));

    expect(screen.getByTestId("effective-role").textContent).toBe("Agent");
    expect(dbState.profileFetches).toContain(TARGET_ID);
  });
});

describe("a genuine Super Admin restores a valid target", () => {
  it("restores the target and adopts its server-side role and organization", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET_ID });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("true"));

    expect(screen.getByTestId("effective-id").textContent).toBe(TARGET_ID);
    expect(screen.getByTestId("effective-role").textContent).toBe("Agent");
    expect(screen.getByTestId("effective-org").textContent).toBe(ORG);
    expect(screen.getByTestId("real-role").textContent).toBe("Super Admin");
    expect(screen.getByTestId("org-wide").textContent).toBe("false");
  });
});

describe("invalid, deleted and unreachable targets are cleared", () => {
  it("a target the server will not return is cleared", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow()]; // target row absent (deleted, or outside RLS)
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET_ID });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));
    await waitFor(() => expect(storageState.raw).toBeNull());

    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(screen.getByTestId("effective-id").textContent).toBe(SUPER_ID);
  });

  it("a Deleted target is refused", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow({ status: "Deleted" })];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET_ID });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("false"));
  });

  it("a target row missing organization_id is refused", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow({ organization_id: null })];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET_ID });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("false"));
  });

  it("malformed and wrong-version payloads are refused", async () => {
    for (const raw of ["{not json", "[]", "null", JSON.stringify({ version: 99, targetProfileId: TARGET_ID }), JSON.stringify({ version: 1 })]) {
      cleanup();
      dbState.sessionUserId = SUPER_ID;
      dbState.profiles = [superRow(), targetRow()];
      storageState.raw = raw;

      renderAuth();
      await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));
      expect(screen.getByTestId("impersonating").textContent).toBe("false");
    }
  });

  it("a server error while resolving the target fails closed", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET_ID });
    dbState.profileError = "permission denied for table profiles";

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("false"));
  });
});

describe("storage access failures neither crash nor enable impersonation", () => {
  it("survives a localStorage read that throws", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    storageState.throwOnGet = true;

    expect(() => renderAuth()).not.toThrow();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
  });

  it("survives a localStorage remove that throws while still refusing to impersonate", async () => {
    dbState.sessionUserId = AGENT_ID;
    dbState.profiles = [agentRow()];
    storageState.raw = JSON.stringify({ id: TARGET_ID, role: "Admin", organization_id: ORG });
    storageState.throwOnRemove = true;

    expect(() => renderAuth()).not.toThrow();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Agent"));
    expect(screen.getByTestId("effective-role").textContent).toBe("Agent");
    expect(screen.getByTestId("org-wide").textContent).toBe("false");
  });
});

describe("stale stored data cannot survive a demotion or an organization move", () => {
  it("a demoted Super Admin cannot resume impersonation from stored data on the next load", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET_ID });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("true"));
    // The pointer is still in storage — this is exactly the stale state an attacker relies on.
    expect(storageState.raw).not.toBeNull();

    // The account is demoted server-side, then the app reloads.
    cleanup();
    dbState.profiles = [superRow({ role: "Agent", is_super_admin: false }), targetRow()];

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Agent"));
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("false"));
    expect(screen.getByTestId("effective-role").textContent).toBe("Agent");
    expect(screen.getByTestId("org-wide").textContent).toBe("false");
    await waitFor(() => expect(storageState.raw).toBeNull());
  });

  it("a stored target now outside the Super Admin's organization is refused", async () => {
    dbState.sessionUserId = SUPER_ID;
    // RLS confines a Super Admin to their home org, so a moved target simply stops resolving.
    dbState.profiles = [superRow(), targetRow({ organization_id: OTHER_ORG })];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET_ID });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));

    // Either refused outright, or restored only within the real Super Admin's own organization —
    // never adopting a foreign organization.
    await waitFor(() => {
      const org = screen.getByTestId("effective-org").textContent;
      expect(org).not.toBe(OTHER_ORG);
    });
  });
});

describe("startImpersonation is gated on the trusted real profile", () => {
  it("persists only a versioned target id — never role or organization", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET_ID });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("true"));

    const stored = JSON.parse(storageState.raw as string);
    expect(stored).toEqual({ version: 1, targetProfileId: TARGET_ID });
    expect(stored.role).toBeUndefined();
    expect(stored.organization_id).toBeUndefined();
    expect(stored.is_super_admin).toBeUndefined();
  });
});


describe("direct startImpersonation activation is gated the same way as a restore", () => {
  const targetProfile = (over: Record<string, unknown> = {}) => ({
    id: TARGET_ID, role: "Agent", organization_id: ORG, is_super_admin: false,
    status: "Active", first_name: "Tara", last_name: "Target", email: "t@x.test",
    platform_role: null, ...over,
  });

  beforeEach(() => { lastStart = null; lastStartResult = undefined; lastEffectiveProfile = null; });

  async function activate(p: unknown) {
    await act(async () => { lastStartResult = await lastStart!(p); });
  }

  it("a real Agent cannot activate an impersonation directly", async () => {
    dbState.sessionUserId = AGENT_ID;
    dbState.profiles = [agentRow(), targetRow()];
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Agent"));

    await activate(targetProfile({ role: "Admin" }));

    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(screen.getByTestId("effective-role").textContent).toBe("Agent");
    expect(screen.getByTestId("org-wide").textContent).toBe("false");
    // Callers must be able to tell it failed, so they do not navigate.
    expect(lastStartResult).toBe(false);
  });

  it("a Super Admin cannot activate a target from ANOTHER organization", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));

    await activate(targetProfile({ organization_id: OTHER_ORG }));

    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(screen.getByTestId("effective-org").textContent).toBe(ORG);
    expect(lastStartResult).toBe(false);
  });

  it("a Deleted target cannot be activated", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));

    await activate(targetProfile({ status: "Deleted" }));

    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(lastStartResult).toBe(false);
  });

  it("a target missing a scoping field cannot be activated", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));

    for (const broken of [{ id: "" }, { role: "" }, { organization_id: "" }]) {
      await activate(targetProfile(broken));
      expect(screen.getByTestId("impersonating").textContent).toBe("false");
      expect(lastStartResult).toBe(false);
    }
  });

  it("self-impersonation is refused", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow()];
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));

    await activate(targetProfile({ id: SUPER_ID }));

    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(lastStartResult).toBe(false);
  });

  it("a valid activation succeeds, reports success, and stores only the pointer", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));

    await activate(targetProfile({ team_id: "team-9", licensed_states: ["TX", "FL"] }));

    expect(lastStartResult).toBe(true);
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("true"));
    expect(screen.getByTestId("effective-id").textContent).toBe(TARGET_ID);
    expect(screen.getByTestId("effective-role").textContent).toBe("Agent");
    expect(screen.getByTestId("effective-org").textContent).toBe(ORG);
    expect(JSON.parse(storageState.raw as string)).toEqual({ version: 1, targetProfileId: TARGET_ID });
    // Activation RE-MAPS the candidate through the same validator the restore path uses; that
    // re-map must not quietly drop fields the effective session still needs.
    expect(lastEffectiveProfile?.first_name).toBe("Tara");
    expect(lastEffectiveProfile?.team_id).toBe("team-9");
    expect(lastEffectiveProfile?.licensed_states).toEqual(["TX", "FL"]);
    // …and it still never confers platform authority.
    expect(lastEffectiveProfile?.platform_role).toBeNull();
  });
});

describe("the restore query constrains the organization server-side", () => {
  it("asks the database for the target within the real account's organization", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    storageState.raw = JSON.stringify({ version: 1, targetProfileId: TARGET_ID });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("true"));

    // Not just an after-the-fact field comparison: the query itself is org-constrained, so RLS is
    // not the application's boundary (AGENT_RULES §3).
    const targetQuery = dbState.profileQueries.find((q) => q.id === TARGET_ID);
    expect(targetQuery, "no profiles query for the impersonation target").toBeTruthy();
    expect(targetQuery!.organization_id).toBe(ORG);
  });
});
