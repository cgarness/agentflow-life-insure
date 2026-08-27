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
const OTHER_SUPER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
  /** When set, the `profiles` read THROWS (a transport failure) rather than returning `{ error }`. */
  profileThrow: null as string | null,
  /** When true, the `profiles` read for TARGET_ID hangs until `releaseTargetLookup()` is called. */
  holdTargetLookup: false,
  releaseTargetLookup: null as null | (() => void),
  /** The listener AuthContext registered, so a session change can be driven from a test. */
  authCallback: null as null | ((event: string, session: unknown) => void | Promise<void>),
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
      if (dbState.profileThrow) throw new Error(dbState.profileThrow);
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
    /** Deferrable read, so a test can hold the target lookup open across a session change. */
    const resolveRead = () => {
      if (table === "profiles" && dbState.holdTargetLookup && rec.eq.id === TARGET_ID) {
        return new Promise<unknown>((res) => { dbState.releaseTargetLookup = () => res(settle()); });
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
        onAuthStateChange: (cb: (event: string, session: unknown) => void | Promise<void>) => {
          dbState.authCallback = cb;
          return { data: { subscription: { unsubscribe() {} } } };
        },
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
let lastLogout: (() => Promise<void>) | null = null;
let lastStartResult: unknown = undefined;
/** The whole effective profile, so field-level loss through re-validation is observable. */
let lastEffectiveProfile: Record<string, unknown> | null = null;

const Probe: React.FC = () => {
  const { profile, realProfile, isImpersonating, startImpersonation, logout } = useAuth();
  const { viewer } = useEffectiveViewer();
  lastStart = startImpersonation as unknown as (p: unknown) => unknown;
  lastLogout = logout;
  lastEffectiveProfile = (profile ?? null) as Record<string, unknown> | null;
  return (
    <div>
      <span data-testid="effective-role">{profile?.role ?? "none"}</span>
      <span data-testid="effective-id">{profile?.id ?? "none"}</span>
      <span data-testid="effective-org">{profile?.organization_id ?? "none"}</span>
      <span data-testid="real-role">{realProfile?.role ?? "none"}</span>
      <span data-testid="real-org">{realProfile?.organization_id ?? "none"}</span>
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
  dbState.profileThrow = null;
  dbState.sessionUserId = null;
  dbState.holdTargetLookup = false;
  dbState.releaseTargetLookup = null;
  dbState.authCallback = null;
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
  // Every gate below is now asserted against the SERVER ROW in `dbState.profiles`, not against a
  // candidate object. These tests previously expressed each refusal by mutating a caller-supplied
  // DTO — which only worked because the DTO WAS the authority, the very defect this pass removes.
  // The intent of each test is unchanged; the input moved to where authority actually lives.
  beforeEach(() => { lastStart = null; lastStartResult = undefined; lastEffectiveProfile = null; });

  async function activate(p: unknown) {
    await act(async () => { lastStartResult = await lastStart!(p); });
  }

  it("a real Agent cannot activate an impersonation directly", async () => {
    dbState.sessionUserId = AGENT_ID;
    dbState.profiles = [agentRow(), targetRow()];
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Agent"));

    // Passing a full candidate that CLAIMS Admin changes nothing: the caller is not a Super Admin.
    await activate({ id: TARGET_ID, role: "Admin", organization_id: ORG });

    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(screen.getByTestId("effective-role").textContent).toBe("Agent");
    expect(screen.getByTestId("org-wide").textContent).toBe("false");
    // Callers must be able to tell it failed, so they do not navigate.
    expect(lastStartResult).toBe(false);
  });

  it("a Super Admin cannot activate a target from ANOTHER organization", async () => {
    dbState.sessionUserId = SUPER_ID;
    // The TARGET ROW lives in another organization; the activation query cannot reach it.
    dbState.profiles = [superRow(), targetRow({ organization_id: OTHER_ORG })];
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));

    await activate(TARGET_ID);

    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(screen.getByTestId("effective-org").textContent).toBe(ORG);
    expect(lastStartResult).toBe(false);
  });

  it("a Deleted target cannot be activated", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow({ status: "Deleted" })];
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));

    await activate(TARGET_ID);

    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(lastStartResult).toBe(false);
  });

  it("a target missing a scoping field cannot be activated", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));

    // Each broken SERVER ROW in turn. A blank organization_id is unreachable by the org-constrained
    // query; a blank role has no scoping identity. Either way the activation is refused.
    for (const broken of [{ role: "" }, { organization_id: "" }, { status: "" }]) {
      dbState.profiles = [superRow(), targetRow(broken as Partial<ProfileRow>)];
      // …and the caller supplying a complete-looking candidate cannot paper over it.
      await activate({ id: TARGET_ID, role: "Agent", organization_id: ORG, status: "Active" });
      expect(screen.getByTestId("impersonating").textContent, JSON.stringify(broken)).toBe("false");
      expect(lastStartResult, JSON.stringify(broken)).toBe(false);
    }
  });

  it("self-impersonation is refused", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow()];
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));

    await activate(SUPER_ID);

    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(lastStartResult).toBe(false);
    // …and the same refusal when the id arrives wrapped in a candidate object.
    await activate({ id: SUPER_ID, role: "Agent", organization_id: ORG });
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(lastStartResult).toBe(false);
  });

  it("a valid activation succeeds, reports success, and stores only the pointer", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [
      superRow(),
      // The fields below live on the SERVER ROW, which is the only place they can come from.
      { ...targetRow(), team_id: "team-9", licensed_states: ["TX", "FL"], platform_role: "platform_admin" },
    ];
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe("Super Admin"));

    await activate(TARGET_ID);

    expect(lastStartResult).toBe(true);
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("true"));
    expect(screen.getByTestId("effective-id").textContent).toBe(TARGET_ID);
    expect(screen.getByTestId("effective-role").textContent).toBe("Agent");
    expect(screen.getByTestId("effective-org").textContent).toBe(ORG);
    expect(JSON.parse(storageState.raw as string)).toEqual({ version: 1, targetProfileId: TARGET_ID });
    // Activation maps the SERVER ROW through the same validator the restore path uses; that map
    // must not quietly drop fields the effective session still needs.
    expect(lastEffectiveProfile?.first_name).toBe("Tara");
    expect(lastEffectiveProfile?.team_id).toBe("team-9");
    expect(lastEffectiveProfile?.licensed_states).toEqual(["TX", "FL"]);
    // …and it still never confers platform authority, whatever the row says.
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

describe("direct activation derives target authority from the SERVER, never the candidate", () => {
  // At 8a45e2c `startImpersonation` authenticated the REAL caller correctly and then mapped the
  // CALLER-SUPPLIED DTO through `profileRowToImpersonationProfile`. Everything except the caller's
  // own super-admin flag therefore came from the argument: role, status, organization, super-admin.
  // A Super Admin (or anything that could reach that call) could hand it `role: "Admin"` for a
  // database row that says `role: "Agent"` and get an organization-wide effective viewer.
  beforeEach(() => { lastStart = null; lastStartResult = undefined; lastEffectiveProfile = null; });

  /** Mount as the real Super Admin (or Agent) and wait until the REAL profile has loaded. */
  async function mountAs(realRole: string) {
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("real-role").textContent).toBe(realRole));
  }

  async function activate(p: unknown) {
    await act(async () => { lastStartResult = await lastStart!(p); });
  }

  /** The forged candidate: a real target id wrapped in fields that claim organization-wide power. */
  const forged = (over: Record<string, unknown> = {}) => ({
    id: TARGET_ID,
    role: "Admin",
    organization_id: ORG,
    is_super_admin: true,
    status: "Active",
    first_name: "Forged",
    last_name: "Candidate",
    email: "forged@x.test",
    platform_role: "platform_admin",
    ...over,
  });

  it("a candidate claiming Admin over a server row that says Agent activates as AGENT", async () => {
    dbState.sessionUserId = SUPER_ID;
    // The DATABASE says this target is an ordinary Agent.
    dbState.profiles = [superRow(), targetRow({ role: "Agent" })];
    await mountAs("Super Admin");

    await activate(forged());

    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("true"));
    // Authority is the server row's, not the candidate's.
    expect(screen.getByTestId("effective-role").textContent).toBe("Agent");
    // …and therefore the scoping branch every surface reads stays narrow.
    expect(screen.getByTestId("org-wide").textContent).toBe("false");
    expect(lastEffectiveProfile?.is_super_admin).toBe(false);
    expect(lastEffectiveProfile?.first_name).toBe("Tara");
    expect(lastEffectiveProfile?.platform_role).toBeNull();
  });

  it("the activation query constrains BOTH the id and the organization", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    await mountAs("Super Admin");
    dbState.profileQueries = [];

    await activate(TARGET_ID);

    const q = dbState.profileQueries.find((x) => x.id === TARGET_ID);
    expect(q, "no profiles query was issued for the activation target").toBeTruthy();
    // Neither RLS nor UUID uniqueness is the application's tenant boundary (AGENT_RULES §3).
    expect(q!.organization_id).toBe(ORG);
  });

  it("a nonexistent target is rejected", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow()]; // no target row at all
    await mountAs("Super Admin");

    await activate(forged());

    expect(lastStartResult).toBe(false);
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(screen.getByTestId("effective-role").textContent).toBe("Super Admin");
  });

  it("an Inactive server row is rejected even when the candidate claims Active", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow({ status: "Inactive" })];
    await mountAs("Super Admin");

    await activate(forged({ status: "Active" }));

    expect(lastStartResult).toBe(false);
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
  });

  it("a Deleted server row is rejected even when the candidate claims Active", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow({ status: "Deleted" })];
    await mountAs("Super Admin");

    await activate(forged({ status: "Active" }));

    expect(lastStartResult).toBe(false);
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
  });

  it("a server row missing a scoping field is rejected even when the candidate supplies one", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow({ role: "" })];
    await mountAs("Super Admin");

    await activate(forged({ role: "Admin" }));

    expect(lastStartResult).toBe(false);
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
  });

  it("a query failure rejects activation instead of falling back to the candidate", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    await mountAs("Super Admin");

    // The target read fails; a candidate-shaped fallback would be exactly the bug.
    dbState.profileError = "permission denied for table profiles";
    await activate(forged());

    expect(lastStartResult).toBe(false);
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
  });

  it("a target in ANOTHER organization is unreachable even with a valid id", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow({ organization_id: OTHER_ORG })];
    await mountAs("Super Admin");

    await activate(forged({ organization_id: ORG }));

    expect(lastStartResult).toBe(false);
    expect(screen.getByTestId("effective-org").textContent).toBe(ORG);
  });

  it("accepts a bare target id — a full Profile is never REQUIRED", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    await mountAs("Super Admin");

    await activate(TARGET_ID);

    expect(lastStartResult).toBe(true);
    await waitFor(() => expect(screen.getByTestId("impersonating").textContent).toBe("true"));
    expect(screen.getByTestId("effective-id").textContent).toBe(TARGET_ID);
    expect(screen.getByTestId("effective-role").textContent).toBe("Agent");
    expect(JSON.parse(storageState.raw as string)).toEqual({ version: 1, targetProfileId: TARGET_ID });
  });

  // NOTE, honestly: this one PASSES at 8a45e2c — there a bare id string is not an object, so the
  // old mapper returned null and refused anyway. It is kept as a guard that the server-authoritative
  // path still writes nothing on refusal.
  it("a sign-out DURING the target lookup cancels the activation", async () => {
    // `startImpersonation` is async: it authorises against a `profile` snapshot taken before a
    // network round-trip. `logout()` clears impersonation and storage — but it runs BEFORE the
    // in-flight lookup resolves, so an unconditional commit would re-establish an impersonation on
    // a session that has just signed out, and re-write the pointer logout had just cleared. The
    // demotion-revocation effect cannot catch this: it does nothing when `profile` is null.
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    await mountAs("Super Admin");

    dbState.holdTargetLookup = true;
    let result: unknown;
    await act(async () => {
      const inFlight = lastStart!(TARGET_ID);
      // The session ends while the lookup is still outstanding.
      await waitFor(() => expect(dbState.releaseTargetLookup).toBeTypeOf("function"));
      await lastLogout!();
      dbState.releaseTargetLookup!();
      result = await inFlight;
    });

    expect(result).toBe(false);
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(storageState.raw).toBeNull();
  });

  it("a DIFFERENT Super Admin signing in during the lookup cancels the activation", async () => {
    // The replacement account is itself a Super Admin, so the revocation effect would never fire —
    // yet the target was validated against the FIRST account's organization.
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), superRow({ id: OTHER_SUPER_ID, organization_id: OTHER_ORG }), targetRow()];
    await mountAs("Super Admin");

    dbState.holdTargetLookup = true;
    let result: unknown;
    await act(async () => {
      const inFlight = lastStart!(TARGET_ID);
      await waitFor(() => expect(dbState.releaseTargetLookup).toBeTypeOf("function"));
      // A different Super Admin, in a different organization, takes over the session.
      dbState.sessionUserId = OTHER_SUPER_ID;
      await dbState.authCallback!("INITIAL_SESSION", {
        access_token: "t2",
        user: { id: OTHER_SUPER_ID, app_metadata: { organization_id: OTHER_ORG, role: "Super Admin" } },
      });
      dbState.releaseTargetLookup!();
      result = await inFlight;
    });

    expect(result).toBe(false);
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(storageState.raw).toBeNull();
  });

  // NOTE, honestly: PASSES at 8a45e2c — there `startImpersonation` was synchronous and issued no
  // query at all, so nothing could throw. It is pinned instead by mutation: deleting the try/catch
  // in AuthContext.startImpersonation makes this the only failing test.
  it("a transport-level THROW is a refusal, not a rejection", async () => {
    // supabase returns { error } for a PostgREST error but THROWS for a transport failure. Callers
    // treat this as a boolean, so a throw would surface as an unhandled rejection: no navigation,
    // no message, nothing logged where a user could act on it.
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow()];
    await mountAs("Super Admin");

    dbState.profileThrow = "network down";
    let result: unknown;
    let threw = false;
    await act(async () => {
      try { result = await lastStart!(TARGET_ID); } catch { threw = true; }
    });

    expect(threw, "startImpersonation must never reject").toBe(false);
    expect(result).toBe(false);
    expect(screen.getByTestId("impersonating").textContent).toBe("false");
    expect(storageState.raw).toBeNull();
  });

  it("stores the pointer only AFTER the server row validates", async () => {
    dbState.sessionUserId = SUPER_ID;
    dbState.profiles = [superRow(), targetRow({ status: "Inactive" })];
    await mountAs("Super Admin");

    await activate(TARGET_ID);

    expect(lastStartResult).toBe(false);
    // A refused activation must leave nothing behind for the restore path to pick up on reload.
    expect(storageState.raw).toBeNull();
  });
});
