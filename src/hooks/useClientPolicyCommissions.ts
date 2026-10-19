import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

/**
 * One tracking write per dialog open. The request id is fixed for the open dialog, so retrying after an unknown
 * outcome returns the stored result instead of writing twice; after an unknown outcome the dialog's inputs stay
 * locked (the retry must be the same change). A confirmed refusal leaves them editable.
 */
export function useTrackingMutation() {
  const refresh = useRefreshPolicyCommissions();
  const requestId = useRef<string>(crypto.randomUUID());
  const [state, setState] = useState<TrackingMutationState>({ status: "idle", message: null, locked: false });

  const restart = useCallback(() => {
    requestId.current = crypto.randomUUID();
    setState({ status: "idle", message: null, locked: false });
  }, []);

  const run = useCallback(async <T,>(write: (requestId: string) => Promise<T>): Promise<T | null> => {
    setState((current) => ({ ...current, status: "saving", message: null }));
    try {
      const result = await write(requestId.current);
      setState({ status: "idle", message: null, locked: false });
      void refresh();
      return result;
    } catch (error) {
      const kind = error instanceof CommissionTrackingError ? error.kind : "unknown";
      const message = error instanceof Error ? error.message : "Something went wrong.";
      if (kind === "stale") void refresh();
      setState((current) => ({ status: "error", message, locked: kind === "unknown" || current.locked }));
      return null;
    }
  }, [refresh]);

  return { ...state, saving: state.status === "saving", run, restart };
}
