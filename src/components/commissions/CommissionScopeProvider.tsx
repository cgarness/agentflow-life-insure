import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useCommissionsAccess } from "@/hooks/useCommissionsCenter";
import { useCommissionAgentRoster } from "@/hooks/useCommissionAgentRoster";
import { CommissionApiError } from "@/lib/commission/errors";
import { isCommissionAuthorityError } from "@/hooks/commissionCenterQuery";
import { canonicalScopeKey, commissionScopeHref, normalizeCommissionSelection, parseCommissionScope, writeCommissionScope,
  type CommissionAgentScope, type CommissionScopeMeta } from "@/lib/commission/centerScope";
import { CommissionScopeContext } from "./commissionScopeContext";

/** URL is committed state; discovery admits it before any financial child mounts. */
export function CommissionScopeProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const access = useCommissionsAccess();
  const client = useQueryClient();
  const parsed = useMemo(() => parseCommissionScope(params), [params]);
  const selectionKey = `${access.userId}:${access.orgId}:${access.authorityKey}:${parsed.kind === "valid" ? canonicalScopeKey(parsed.scope) : parsed.kind}`;
  const active = useRef(selectionKey);
  const [blocked, setBlocked] = useState<{ key: string; error: Error } | null>(null);
  const localError = blocked?.key === selectionKey ? blocked.error : null;
  const query = useCommissionAgentRoster(parsed.kind === "valid" ? parsed.scope : null, { enabled: parsed.kind !== "invalid" && !localError });
  const error = localError ?? query.error;
  const roster = !error && access.enabled && query.isFetchedAfterMount ? query.data ?? null : null;
  const scope: CommissionAgentScope | null = useMemo(() => parsed.kind === "valid" ? parsed.scope : parsed.kind === "missing" && roster?.default_scope
    ? { mode: roster.default_scope, agentIds: [] } : null, [parsed, roster?.default_scope]);
  const revision = roster?.scope_revision ?? "unresolved";
  const admissionKey = `${selectionKey}:${revision}`;
  active.current = admissionKey;
  const scopeKey = scope ? canonicalScopeKey(scope) : "unresolved";
  const ready = access.enabled && !!roster && roster.available_count > 0 && !!scope && !error && parsed.kind !== "invalid";
  const matchesIdentity = useCallback((key: readonly unknown[]) => key[0] === "policy-commissions" && key[1] === "center"
    && key[2] === access.userId && key[3] === access.orgId, [access.userId, access.orgId]);
  const clear = useCallback(() => {
    void client.cancelQueries({ predicate: (q) => matchesIdentity(q.queryKey) });
    client.removeQueries({ predicate: (q) => matchesIdentity(q.queryKey) });
  }, [client, matchesIdentity]);
  const admission = useRef<{ authority: string; revision: string } | null>(null);
  const rosterHash = hashKey(query.rosterKey);
  useEffect(() => {
    const previous = admission.current;
    const changed = previous && (previous.authority !== access.authorityKey || (roster && previous.revision !== revision));
    if (changed) {
      const stale = (key: readonly unknown[]) => matchesIdentity(key) && hashKey(key) !== rosterHash
        && (key[4] === "agent-roster" ? key[9] !== revision : (key[4] as { revision?: string })?.revision !== revision);
      void client.cancelQueries({ predicate: (q) => stale(q.queryKey) });
      client.removeQueries({ predicate: (q) => stale(q.queryKey) });
    }
    if (roster) admission.current = { authority: access.authorityKey, revision };
  }, [client, matchesIdentity, access.authorityKey, revision, roster, rosterHash]);
  useEffect(() => () => clear(), [clear]);
  const deny = useCallback((failure: Error) => {
    if (active.current !== admissionKey) return;
    setBlocked((current) => current?.key === selectionKey ? current : { key: selectionKey, error: failure });
    clear();
  }, [clear, selectionKey, admissionKey]);
  useEffect(() => { if (query.error && isCommissionAuthorityError(query.error)) deny(query.error); }, [query.error, deny]);
  useEffect(() => {
    const cache = client.getQueryCache();
    const rejected = new Set<string>();
    const check = (candidate: (ReturnType<typeof cache.getAll>)[number]) => {
      const key = candidate.queryKey;
      if (key[0] !== "commission-calculator" || key[2] !== access.userId || key[3] !== access.orgId) return;
      if (rejected.has(candidate.queryHash)) return;
      const state = candidate.state;
      const forbidden = state.error instanceof CommissionApiError && state.error.kind === "forbidden";
      if (!forbidden && (state.data as { status?: string })?.status !== "no_access") return;
      rejected.add(candidate.queryHash);
      deny(state.error ?? new Error("Personal commission access is no longer available."));
      void client.cancelQueries({ queryKey: key, exact: true });
      client.removeQueries({ queryKey: key, exact: true });
    };
    cache.getAll().forEach(check);
    return cache.subscribe((event) => { if (event.type === "updated") check(event.query); });
  }, [client, access.userId, access.orgId, deny]);

  // Cancel superseded reads; the keyed child also closes drawers and clears local carrier caches.
  useEffect(() => () => {
    void client.cancelQueries({ predicate: (q) => matchesIdentity(q.queryKey) && q.queryKey[4] !== "agent-roster" });
  }, [client, matchesIdentity, scopeKey, revision]);
  const acceptRevision = useCallback((meta: CommissionScopeMeta) => {
    if (active.current !== admissionKey) return false;
    const ids = [...meta.agent_ids].sort();
    const sameSelection = meta.mode === scope?.mode && (scope.mode === "all" ||
      (scope.mode === "me" ? ids.length === 1 && ids[0] === access.userId : ids.join(",") === scope.agentIds.join(",")));
    return sameSelection && meta.revision === revision;
  }, [admissionKey, scope, access.userId, revision]);
  const apply = useCallback((next: CommissionAgentScope) => {
    const normalized = normalizeCommissionSelection(next, access.userId!, roster?.can_view_own ?? access.ownPermitted);
    clear();
    setBlocked(null);
    setParams(writeCommissionScope(params, normalized));
  }, [access.userId, access.ownPermitted, roster?.can_view_own, clear, setParams, params]);
  const { refetch } = query;
  const retry = useCallback(() => { setBlocked(null); void refetch(); }, [refetch]);
  const value = {
    managed: true, scope, revision, financialKey: `${access.userId}:${access.orgId}:${scopeKey}:${revision}`, ready,
    isMe: scope?.mode === "me", readOnly: scope?.mode !== "me",
    // A known authority failure also unmounts personal tools; stale client permissions cannot reactivate them.
    canViewOwn: !localError && !isCommissionAuthorityError(query.error) && (roster?.can_view_own ?? access.ownPermitted),
    roster, loading: !error && parsed.kind !== "invalid" && !roster, error,
    invalid: parsed.kind === "invalid", apply, retry, deny, acceptRevision,
    withScopeHref: (destination: string) => scope ? commissionScopeHref(destination, scope) : destination,
  };
  return <CommissionScopeContext.Provider value={value}>{children}</CommissionScopeContext.Provider>;
}
