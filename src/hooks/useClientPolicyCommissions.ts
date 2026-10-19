import { useCallback, useEffect, useRef, useState } from "react";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useEffectiveViewer } from "@/hooks/useEffectiveViewer";
import { CommissionTrackingError, fetchClientPolicyCommissions } from "@/lib/commission/trackingApi";
import type { ClientPolicyCommissions } from "@/lib/commission/trackingSchemas";

export const clientPolicyCommissionKeys = {
  client: (userId: string | null, orgId: string | null, clientId: string | null) =>
    ["policy-commissions", userId, orgId, clientId] as const,
};

/**
 * Saved commissions for one client's policies, as the server lets the real signed-in user see them. Nothing is
 * requested under "View As" (the server would answer for the real user, not the viewed one).
 */
export function useClientPolicyCommissions(clientId: string | null | undefined) {
  const { user, isImpersonating } = useAuth();
  const { viewer } = useEffectiveViewer();
  const userId = user?.id ?? null;
  const orgId = viewer?.organizationId ?? null;
  const enabled = !!clientId && !!userId && !!orgId && !isImpersonating && !viewer?.isImpersonating && viewer?.viewerId === userId;
  const query = useQuery<ClientPolicyCommissions>({
    queryKey: clientPolicyCommissionKeys.client(userId, orgId, clientId ?? null),
    queryFn: ({ signal }) => fetchClientPolicyCommissions(clientId!, signal),
    enabled,
    staleTime: 15_000,
    retry: false,
  });
  return { ...query, enabled };
}

/** Re-reads every saved-commission view (after a write, or when a write reports a stale revision). */
export function useRefreshPolicyCommissions() {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries({ queryKey: ["policy-commissions"] }), [queryClient]);
}

export type TrackingMutationState = { status: "idle" | "saving" | "error"; message: string | null; locked: boolean };

// Always set a copy: the registry lives outside React state, so an update must never bail out as "unchanged".
const IDLE: TrackingMutationState = { status: "idle", message: null, locked: false };
const UNCONFIRMED = "We couldn't confirm this change. Retry sends exactly the same change.";

/**
 * Writes whose outcome is unknown, kept in memory only (never browser storage) so closing and reopening a dialog, or
 * remounting it, cannot resend the change under a new request id. Keyed by signed-in user, organization and
 * operation; everything is dropped when the signed-in user changes.
 */
interface UnresolvedWrite { requestId: string; write: (requestId: string) => Promise<unknown>; form: unknown; message: string }
const unresolvedWrites = new Map<string, UnresolvedWrite>();
let unresolvedUser: string | null = null;

function unresolvedKey(userId: string | null, orgId: string | null, operation: string): string | null {
  if (unresolvedUser !== userId) {
    unresolvedWrites.clear();
    unresolvedUser = userId;
  }
  return userId && orgId ? `${userId}|${orgId}|${operation}` : null;
}

/** Test-only reset of the in-memory registry. */
export function resetUnresolvedTrackingWrites() {
  unresolvedWrites.clear();
  unresolvedUser = null;
}

/**
 * One tracking write per dialog open, for one operation (e.g. `receipt:<estimate>`). The request id is fixed while
 * the dialog is open. After an unknown outcome the write stays unresolved across dismissal and remount: `restart()`
 * refuses, every submit replays the exact submitted call with its request id, and the inputs stay locked (`pending`
 * holds the submitted form values). Only a success resolves it, or a server refusal of that same request (stale,
 * invalid or not found): every tracking function returns the request's stored result first, so such a refusal proves
 * nothing was saved. Permission, sign-in and transport errors prove nothing and keep it unresolved. A response that
 * arrives after the signed-in identity changed is ignored. Opening a dialog (`restart()`) re-reads the commission
 * data; `syncing` is true until that read settles.
 */
export function useTrackingMutation<F = unknown>(operation: string) {
  const refresh = useRefreshPolicyCommissions();
  const { user } = useAuth();
  const { viewer } = useEffectiveViewer();
  const userId = user?.id ?? null;
  const scope = `${userId}|${viewer?.organizationId ?? null}`;
  const key = unresolvedKey(userId, viewer?.organizationId ?? null, operation);
  const live = useRef({ key, scope });
  live.current = { key, scope };
  const requestId = useRef<string>(crypto.randomUUID());
  const [state, setState] = useState<TrackingMutationState>(IDLE);
  const syncing = useIsFetching({ queryKey: ["policy-commissions"] }) > 0;

  // A different signed-in user or organization starts from nothing.
  const seenScope = useRef(scope);
  useEffect(() => {
    if (seenScope.current === scope) return;
    seenScope.current = scope;
    requestId.current = crypto.randomUUID();
    setState({ ...IDLE });
  }, [scope]);

  const restart = useCallback(() => {
    void refresh();
    const current = live.current.key;
    if (current && unresolvedWrites.has(current)) return;
    requestId.current = crypto.randomUUID();
    setState({ ...IDLE });
  }, [refresh]);

  const run = useCallback(async <T,>(write: (requestId: string) => Promise<T>, form?: F): Promise<T | null> => {
    const { key: started, scope: startScope } = live.current;
    const prior = started ? unresolvedWrites.get(started) : undefined;
    const id = prior ? prior.requestId : requestId.current;
    const send = (prior ? prior.write : write) as (requestId: string) => Promise<T>;
    setState((current) => ({ ...current, status: "saving", message: null }));
    try {
      const result = await send(id);
      if (started && unresolvedWrites.get(started)?.requestId === id) unresolvedWrites.delete(started);
      if (live.current.scope !== startScope) return null;
      setState({ ...IDLE });
      void refresh();
      return result;
    } catch (error) {
      if (live.current.scope !== startScope) return null;
      const kind = error instanceof CommissionTrackingError ? error.kind : "unknown";
      const message = error instanceof Error ? error.message : "Something went wrong.";
      if (kind === "stale") void refresh();
      const provesNotSaved = kind === "stale" || kind === "invalid" || kind === "not_found";
      if (prior && !provesNotSaved) {
        prior.message = `${UNCONFIRMED} Last retry: ${message}`;
        setState({ status: "error", message: prior.message, locked: true });
      } else if (prior) {
        unresolvedWrites.delete(started!);
        requestId.current = crypto.randomUUID();
        setState({ status: "error", message: `That change was not saved. ${message}`, locked: false });
      } else if (kind === "unknown" && started) {
        unresolvedWrites.set(started, { requestId: id, write: write as (requestId: string) => Promise<unknown>, form, message });
        setState({ status: "error", message, locked: true });
      } else {
        setState((current) => ({ status: "error", message, locked: kind === "unknown" || current.locked }));
      }
      return null;
    }
  }, [refresh]);

  /** Resends an unresolved write exactly (same request id and call); nothing happens when none is pending. */
  const retry = useCallback(async <T,>(): Promise<T | null> => {
    const started = live.current.key;
    const prior = started ? unresolvedWrites.get(started) : undefined;
    return prior ? run(prior.write as (requestId: string) => Promise<T>) : null;
  }, [run]);

  const pending = key ? unresolvedWrites.get(key) : undefined;
  const saving = state.status === "saving";
  return {
    status: state.status,
    message: saving ? null : state.message ?? pending?.message ?? null,
    locked: !!pending || state.locked,
    saving,
    syncing,
    /** A write whose outcome is unknown is waiting for an exact retry. */
    unresolved: !!pending,
    /** The submitted form values of an unresolved write (shown, locked, until it resolves). */
    pending: (pending?.form ?? null) as F | null,
    run,
    retry,
    restart,
  };
}
