// Test-only identity. This module is reachable only through the isolated Vite configuration.
export const org = "a1000000-0000-4000-8000-000000000001";
export const actor = "a2000000-0000-4000-8000-000000000001";
export function useAuth() {
  const query = new URLSearchParams(location.search);
  return {
    user: { id: actor },
    realProfile: { id: actor, organization_id: org, status: "Active", role: query.has("agent") ? "Agent" : "Admin" },
    isImpersonating: query.has("viewAs"),
  };
}
