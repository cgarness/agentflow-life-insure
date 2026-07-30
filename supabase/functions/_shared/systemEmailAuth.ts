// Shared application-level caller authentication for system-email Edge
// Functions. These functions deploy with verify_jwt=false (invariant #2 —
// the gateway rejects ES256 when verify_jwt=true), so EVERY standalone email
// endpoint must validate the caller in code with these helpers. Never rely on
// the verify_jwt deployment flag alone.
//
// The client surface is intentionally minimal so tests can pass a fake.

export interface AuthedUser {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
}

export interface CallerProfile {
  organization_id: string | null;
  role: string | null;
  is_super_admin: boolean;
}

export interface SystemEmailAuthClient {
  auth: {
    getUser(jwt: string): Promise<{
      data: {
        user:
          | { id: string; email?: string | null; email_confirmed_at?: string | null }
          | null;
      };
      error: unknown;
    }>;
  };
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
}

export type AuthFailure = { ok: false; status: number; error: string };
export type AuthSuccess = { ok: true; user: AuthedUser; profile: CallerProfile | null };
export type AuthResult = AuthSuccess | AuthFailure;

export function getBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Validates the caller's JWT and loads their profile. Returns 401 on a
 * missing/invalid token; profile is null when no row exists (callers decide
 * whether that is a 403).
 */
export async function authenticateRequest(
  client: SystemEmailAuthClient,
  req: Request,
): Promise<AuthResult> {
  const jwt = getBearerToken(req);
  if (!jwt) {
    return { ok: false, status: 401, error: "Missing Authorization header" };
  }

  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) {
    return { ok: false, status: 401, error: "Invalid or expired token" };
  }

  const { data: profileData, error: profileError } = await client
    .from("profiles")
    .select("organization_id, role, is_super_admin")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) {
    return { ok: false, status: 500, error: "Failed to load caller profile" };
  }

  const profile = profileData
    ? {
        organization_id:
          (profileData as { organization_id?: string | null }).organization_id ?? null,
        role: (profileData as { role?: string | null }).role ?? null,
        is_super_admin:
          (profileData as { is_super_admin?: boolean | null }).is_super_admin === true,
      }
    : null;

  return {
    ok: true,
    user: {
      id: data.user.id,
      email: data.user.email ?? null,
      emailConfirmed: Boolean(data.user.email_confirmed_at),
    },
    profile,
  };
}

/** Org Admin gate: exact role strings per AGENT_RULES, or platform super admin. */
export function isOrgAdmin(profile: CallerProfile | null): boolean {
  if (!profile) return false;
  return (
    profile.is_super_admin === true ||
    profile.role === "Admin" ||
    profile.role === "Super Admin"
  );
}

/**
 * Whether the caller may act on resources of `organizationId`: an Admin of
 * that same org, or a platform super admin (cross-org).
 */
export function canManageOrganization(
  profile: CallerProfile | null,
  organizationId: string | null,
): boolean {
  if (!profile || !organizationId) return false;
  if (profile.is_super_admin === true) return true;
  return isOrgAdmin(profile) && profile.organization_id === organizationId;
}

/** Platform super admin gate (send-email-previews). */
export function isSuperAdmin(profile: CallerProfile | null): boolean {
  return profile?.is_super_admin === true;
}
