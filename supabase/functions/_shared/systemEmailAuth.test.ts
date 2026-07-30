// Unit tests for shared system-email caller authentication.
// Uses a hand-written fake Supabase client — no network, no Supabase SDK.
// Run: deno test --allow-env --allow-read supabase/functions/_shared/

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  authenticateRequest,
  AuthFailure,
  AuthResult,
  AuthSuccess,
  CallerProfile,
  canManageOrganization,
  getBearerToken,
  isOrgAdmin,
  isSuperAdmin,
  SystemEmailAuthClient,
} from "./systemEmailAuth.ts";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeAuthUser {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}

interface FakeQueryCall {
  table: string;
  columns: string;
  column: string;
  value: string;
}

interface FakeClientOptions {
  user?: FakeAuthUser | null;
  authError?: unknown;
  profile?: unknown;
  profileError?: unknown;
}

interface FakeClient {
  client: SystemEmailAuthClient;
  authCalls: string[];
  queryCalls: FakeQueryCall[];
}

function makeClient(options: FakeClientOptions = {}): FakeClient {
  const authCalls: string[] = [];
  const queryCalls: FakeQueryCall[] = [];

  const client: SystemEmailAuthClient = {
    auth: {
      getUser(jwt: string) {
        authCalls.push(jwt);
        return Promise.resolve({
          data: { user: options.user ?? null },
          error: options.authError ?? null,
        });
      },
    },
    from(table: string) {
      return {
        select(columns: string) {
          return {
            eq(column: string, value: string) {
              return {
                maybeSingle() {
                  queryCalls.push({ table, columns, column, value });
                  return Promise.resolve({
                    data: options.profile ?? null,
                    error: options.profileError ?? null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };

  return { client, authCalls, queryCalls };
}

function makeRequest(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) {
    headers.set("Authorization", authorization);
  }
  return new Request("https://example.com/functions/v1/send-welcome-email", {
    method: "POST",
    headers,
  });
}

function expectFailure(result: AuthResult): AuthFailure {
  if (result.ok) {
    throw new Error("expected an auth failure but the request succeeded");
  }
  return result;
}

function expectSuccess(result: AuthResult): AuthSuccess {
  if (!result.ok) {
    throw new Error(`expected auth success but got ${result.status}: ${result.error}`);
  }
  return result;
}

function profileOf(partial: Partial<CallerProfile>): CallerProfile {
  return { organization_id: null, role: null, is_super_admin: false, ...partial };
}

// ---------------------------------------------------------------------------
// getBearerToken
// ---------------------------------------------------------------------------

Deno.test("getBearerToken extracts the token from a well-formed header", () => {
  assertEquals(getBearerToken(makeRequest("Bearer abc.def.ghi")), "abc.def.ghi");
});

Deno.test("getBearerToken matches the scheme case-insensitively", () => {
  assertEquals(getBearerToken(makeRequest("bearer abc.def.ghi")), "abc.def.ghi");
  assertEquals(getBearerToken(makeRequest("BEARER abc.def.ghi")), "abc.def.ghi");
  assertEquals(getBearerToken(makeRequest("BeArEr abc.def.ghi")), "abc.def.ghi");
});

Deno.test("getBearerToken tolerates extra whitespace around the token", () => {
  assertEquals(getBearerToken(makeRequest("Bearer    abc.def.ghi")), "abc.def.ghi");
  assertEquals(getBearerToken(makeRequest("Bearer\tabc.def.ghi")), "abc.def.ghi");
});

Deno.test("getBearerToken returns null when the header is absent or empty", () => {
  assertEquals(getBearerToken(makeRequest()), null);
  assertEquals(getBearerToken(makeRequest("")), null);
});

Deno.test("getBearerToken returns null for a malformed header", () => {
  assertEquals(getBearerToken(makeRequest("Token abc.def.ghi")), null);
  assertEquals(getBearerToken(makeRequest("Basic dXNlcjpwYXNz")), null);
  assertEquals(getBearerToken(makeRequest("Bearer")), null);
  assertEquals(getBearerToken(makeRequest("abc.def.ghi")), null);
  assertEquals(getBearerToken(makeRequest("NotBearer abc")), null);
});

// ---------------------------------------------------------------------------
// authenticateRequest
// ---------------------------------------------------------------------------

Deno.test("authenticateRequest returns 401 when the Authorization header is missing", async () => {
  const { client, authCalls, queryCalls } = makeClient();
  const failure = expectFailure(await authenticateRequest(client, makeRequest()));
  assertEquals(failure.status, 401);
  assertEquals(failure.error, "Missing Authorization header");
  // Short-circuits before touching the client at all.
  assertEquals(authCalls.length, 0);
  assertEquals(queryCalls.length, 0);
});

Deno.test("authenticateRequest returns 401 when the header is malformed", async () => {
  const { client } = makeClient({ user: { id: "user-1" } });
  const failure = expectFailure(
    await authenticateRequest(client, makeRequest("Token abc")),
  );
  assertEquals(failure.status, 401);
  assertEquals(failure.error, "Missing Authorization header");
});

Deno.test("authenticateRequest returns 401 when getUser reports an error", async () => {
  const { client, authCalls } = makeClient({
    user: null,
    authError: { message: "invalid JWT" },
  });
  const failure = expectFailure(
    await authenticateRequest(client, makeRequest("Bearer bad-token")),
  );
  assertEquals(failure.status, 401);
  assertEquals(failure.error, "Invalid or expired token");
  assertEquals(authCalls, ["bad-token"]);
});

Deno.test("authenticateRequest returns 401 when getUser resolves no user", async () => {
  const { client } = makeClient({ user: null, authError: null });
  const failure = expectFailure(
    await authenticateRequest(client, makeRequest("Bearer expired-token")),
  );
  assertEquals(failure.status, 401);
  assertEquals(failure.error, "Invalid or expired token");
});

Deno.test("authenticateRequest maps the user and profile on success", async () => {
  const { client, authCalls, queryCalls } = makeClient({
    user: {
      id: "user-1",
      email: "admin@example.com",
      email_confirmed_at: "2026-01-01T00:00:00Z",
    },
    profile: {
      organization_id: "org-1",
      role: "Admin",
      is_super_admin: false,
    },
  });

  const success = expectSuccess(
    await authenticateRequest(client, makeRequest("Bearer good-token")),
  );
  assertEquals(success.user, {
    id: "user-1",
    email: "admin@example.com",
    emailConfirmed: true,
  });
  assertEquals(success.profile, {
    organization_id: "org-1",
    role: "Admin",
    is_super_admin: false,
  });
  assertEquals(authCalls, ["good-token"]);
  assertEquals(queryCalls, [
    {
      table: "profiles",
      columns: "organization_id, role, is_super_admin",
      column: "id",
      value: "user-1",
    },
  ]);
});

Deno.test("authenticateRequest reports an unconfirmed email and a null address", async () => {
  const { client } = makeClient({
    user: { id: "user-2" },
    profile: { organization_id: "org-1", role: "Agent", is_super_admin: false },
  });
  const success = expectSuccess(
    await authenticateRequest(client, makeRequest("Bearer good-token")),
  );
  assertEquals(success.user.email, null);
  assertEquals(success.user.emailConfirmed, false);
});

Deno.test("authenticateRequest coerces missing profile columns to null/false", async () => {
  const { client } = makeClient({
    user: { id: "user-3", email: "a@example.com" },
    profile: {},
  });
  const success = expectSuccess(
    await authenticateRequest(client, makeRequest("Bearer good-token")),
  );
  assertEquals(success.profile, {
    organization_id: null,
    role: null,
    is_super_admin: false,
  });
});

Deno.test("authenticateRequest coerces a truthy non-boolean is_super_admin to false", async () => {
  const { client } = makeClient({
    user: { id: "user-3b", email: "a@example.com" },
    profile: { organization_id: "org-1", role: "Admin", is_super_admin: "true" },
  });
  const success = expectSuccess(
    await authenticateRequest(client, makeRequest("Bearer good-token")),
  );
  assertEquals(success.profile?.is_super_admin, false);
});

Deno.test("authenticateRequest returns profile:null when the row is missing", async () => {
  const { client } = makeClient({
    user: { id: "user-4", email: "orphan@example.com" },
    profile: null,
  });
  const success = expectSuccess(
    await authenticateRequest(client, makeRequest("Bearer good-token")),
  );
  assertEquals(success.profile, null);
  assertEquals(success.user.id, "user-4");
});

Deno.test("authenticateRequest returns 500 when the profile query errors", async () => {
  const { client } = makeClient({
    user: { id: "user-5", email: "a@example.com" },
    profileError: { message: "permission denied for table profiles" },
  });
  const failure = expectFailure(
    await authenticateRequest(client, makeRequest("Bearer good-token")),
  );
  assertEquals(failure.status, 500);
  assertEquals(failure.error, "Failed to load caller profile");
});

// ---------------------------------------------------------------------------
// isOrgAdmin
// ---------------------------------------------------------------------------

Deno.test("isOrgAdmin role matrix", () => {
  const cases: Array<[CallerProfile | null, boolean, string]> = [
    [null, false, "no profile"],
    [profileOf({ role: null }), false, "null role"],
    [profileOf({ role: "Agent" }), false, "Agent"],
    [profileOf({ role: "Team Leader" }), false, "Team Leader"],
    [profileOf({ role: "admin" }), false, "lowercase admin is not a real role"],
    [profileOf({ role: "Admin" }), true, "Admin"],
    [profileOf({ role: "Super Admin" }), true, "Super Admin"],
    [profileOf({ role: "Agent", is_super_admin: true }), true, "platform super admin"],
  ];
  for (const [profile, expected, label] of cases) {
    assertEquals(isOrgAdmin(profile), expected, label);
  }
});

// ---------------------------------------------------------------------------
// canManageOrganization
// ---------------------------------------------------------------------------

Deno.test("canManageOrganization allows an Admin of the same organization", () => {
  const profile = profileOf({ organization_id: "org-1", role: "Admin" });
  assertEquals(canManageOrganization(profile, "org-1"), true);
});

Deno.test("canManageOrganization denies an Admin of a different organization", () => {
  const profile = profileOf({ organization_id: "org-1", role: "Admin" });
  assertEquals(canManageOrganization(profile, "org-2"), false);
});

Deno.test("canManageOrganization allows a platform super admin cross-org", () => {
  const profile = profileOf({
    organization_id: "org-1",
    role: "Agent",
    is_super_admin: true,
  });
  assertEquals(canManageOrganization(profile, "org-2"), true);
  assertEquals(canManageOrganization(profile, "org-1"), true);
});

Deno.test("canManageOrganization denies non-admins and null inputs", () => {
  assertEquals(
    canManageOrganization(profileOf({ organization_id: "org-1", role: "Agent" }), "org-1"),
    false,
  );
  assertEquals(
    canManageOrganization(
      profileOf({ organization_id: "org-1", role: "Team Leader" }),
      "org-1",
    ),
    false,
  );
  // A null target org is never manageable — not even by a super admin.
  assertEquals(
    canManageOrganization(profileOf({ organization_id: "org-1", role: "Admin" }), null),
    false,
  );
  assertEquals(
    canManageOrganization(profileOf({ role: "Agent", is_super_admin: true }), null),
    false,
  );
  assertEquals(canManageOrganization(null, "org-1"), false);
  assertEquals(canManageOrganization(null, null), false);
});

Deno.test("canManageOrganization denies an Admin with no organization of their own", () => {
  const profile = profileOf({ organization_id: null, role: "Admin" });
  assertEquals(canManageOrganization(profile, "org-1"), false);
});

// ---------------------------------------------------------------------------
// isSuperAdmin
// ---------------------------------------------------------------------------

Deno.test("isSuperAdmin gates strictly on the is_super_admin flag", () => {
  assertEquals(isSuperAdmin(null), false);
  assertEquals(isSuperAdmin(profileOf({ role: "Agent" })), false);
  assertEquals(isSuperAdmin(profileOf({ role: "Admin" })), false);
  assertEquals(isSuperAdmin(profileOf({ role: "Super Admin" })), false);
  assertEquals(isSuperAdmin(profileOf({ role: "Agent", is_super_admin: true })), true);
  assertEquals(isSuperAdmin(profileOf({ role: "Super Admin", is_super_admin: true })), true);
});

// ---------------------------------------------------------------------------
// End-to-end gate composition (still fully offline)
// ---------------------------------------------------------------------------

Deno.test("authenticateRequest output feeds the gates directly", async () => {
  const { client } = makeClient({
    user: { id: "user-6", email: "sa@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" },
    profile: { organization_id: "org-9", role: "Agent", is_super_admin: true },
  });
  const success = expectSuccess(
    await authenticateRequest(client, makeRequest("Bearer good-token")),
  );
  assert(isSuperAdmin(success.profile));
  assert(isOrgAdmin(success.profile));
  assert(canManageOrganization(success.profile, "org-other"));
});
