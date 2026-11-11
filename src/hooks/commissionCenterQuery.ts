import { hashKey, type Query } from "@tanstack/react-query";
import { CommissionCenterError } from "@/lib/commission/centerApi";
import { ME_SCOPE, canonicalScopeKey, type CommissionAgentScope, type CommissionScopeMeta } from "@/lib/commission/centerScope";
import type { CommissionScopeContextValue } from "@/components/commissions/commissionScopeContext";

export interface CommissionQueryIdentity { scope: string; revision: string }
export const commissionQueryIdentity = (scope: CommissionAgentScope = ME_SCOPE, revision = "legacy"): CommissionQueryIdentity =>
  ({ scope: canonicalScopeKey(scope), revision });
const key = (user: string | null, org: string | null, resource: string, filters: unknown, identity = commissionQueryIdentity()) =>
  ["policy-commissions", "center", user, org, identity, resource, filters] as const;
export const commissionCenterKeys = {
  all: ["policy-commissions", "center"] as const,
  overview: (u: string | null, o: string | null, f: unknown, i?: CommissionQueryIdentity) => key(u, o, "overview", f, i),
  scheduled: (u: string | null, o: string | null, f: unknown, i?: CommissionQueryIdentity) => key(u, o, "scheduled", f, i),
  history: (u: string | null, o: string | null, f: unknown, i?: CommissionQueryIdentity) => key(u, o, "history", f, i),
  policies: (u: string | null, o: string | null, f: unknown, i?: CommissionQueryIdentity) => key(u, o, "policies", f, i),
  policy: (u: string | null, o: string | null, f: unknown, i?: CommissionQueryIdentity) => key(u, o, "policy", f, i),
  breakdown: (u: string | null, o: string | null, f: unknown, i?: CommissionQueryIdentity) => key(u, o, "breakdown", f, i),
  goal: (u: string | null, o: string | null, f: unknown, i?: CommissionQueryIdentity) => key(u, o, "goal", f, i),
};
/** Resource/filter fields are named by destructuring, rather than assuming the old six-element key. */
const listIdentity = (queryKey: readonly unknown[]) => {
  const [family, center, actor, organization, scope, resource, filters] = queryKey;
  return hashKey([{ family, center, actor, organization, scope, resource, filters: { ...(filters as object), page: 0 } }]);
};
export function previousPageFor<T>(queryKey: readonly unknown[]) {
  const identity = listIdentity(queryKey);
  return (previous: T | undefined, query: Query<T, Error, T, readonly unknown[]> | undefined) =>
    query && listIdentity(query.queryKey) === identity ? previous : undefined;
}
export const isCommissionAuthorityError = (error: unknown) => error instanceof CommissionCenterError &&
  ["denied", "invalid", "not_found"].includes(error.kind);

/** Personal goal APIs keep their unchanged response contract but still propagate detected authority loss. */
export async function guardedPersonalCommissionRead<T>(context: CommissionScopeContextValue, read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (error) { if (isCommissionAuthorityError(error)) context.deny(error as Error); throw error; }
}

export async function guardedCommissionRead<T extends { meta?: { agent_scope?: CommissionScopeMeta } }>(
  context: CommissionScopeContextValue, read: () => Promise<T>,
): Promise<T> {
  try {
    const data = await read();
    if (context.managed && (!data.meta?.agent_scope || !context.acceptRevision(data.meta.agent_scope))) {
      throw new CommissionCenterError("Your agent access changed. Refresh the selection.", "denied", "42501");
    }
    return data;
  } catch (error) {
    if (isCommissionAuthorityError(error)) context.deny(error as Error);
    throw error;
  }
}
/** Never allow an old cached payload to win over a newly detected authorization error. */
export function hideDeniedData<T extends { data: unknown; error: unknown }>(query: T): T {
  return isCommissionAuthorityError(query.error) ? { ...query, data: undefined } : query;
}
