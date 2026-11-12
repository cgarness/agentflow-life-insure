import { useSyncExternalStore } from "react";

// This adapter is reachable only through the isolated browser Vite configuration.
export const identities = {
  organizationA: "a1000000-0000-4000-8000-000000000001",
  organizationB: "a1000000-0000-4000-8000-000000000002",
  userA: "a2000000-0000-4000-8000-000000000001",
  userB: "a2000000-0000-4000-8000-000000000002",
};

interface IdentityOptions {
  userId: string | null;
  profileId: string | null;
  organizationId: string | null;
  claimOrganizationId: string | null;
  role: "Admin" | "Agent";
  isImpersonating: boolean;
  isBuildingOrganization: boolean;
}

let options: IdentityOptions = {
  userId: identities.userA,
  profileId: identities.userA,
  organizationId: identities.organizationA,
  claimOrganizationId: null,
  role: new URLSearchParams(location.search).has("agent") ? "Agent" : "Admin",
  isImpersonating: false,
  isBuildingOrganization: false,
};

function createSnapshot() {
  const profile = options.profileId ? {
    id: options.profileId, organization_id: options.organizationId, role: options.role,
    is_super_admin: false, first_name: "Synthetic", last_name: "Verifier", status: "Active", team_id: null,
  } : null;
  return {
    user: options.userId ? { id: options.userId } : null,
    profile,
    realProfile: profile,
    session: options.claimOrganizationId ? {
      access_token: `synthetic.${btoa(JSON.stringify({ org_id: options.claimOrganizationId, user_role: options.role }))}.synthetic`,
    } : null,
    isImpersonating: options.isImpersonating,
    isBuildingOrganization: options.isBuildingOrganization,
  };
}

let snapshot = createSnapshot();
const listeners = new Set<() => void>();
export const getFixtureAuth = () => snapshot;
export function setFixtureIdentity(patch: Partial<IdentityOptions>) {
  options = { ...options, ...patch };
  snapshot = createSnapshot();
  listeners.forEach((listener) => listener());
}

export function useAuth() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getFixtureAuth);
}
