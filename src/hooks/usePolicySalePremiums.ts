import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useEffectiveViewer } from "@/hooks/useEffectiveViewer";
import { fetchClientSalePremiums, type ClientSalePremiums } from "@/lib/policySaleCorrection";

/** Prefix ['policy-sale-premiums', clientId] is what a correction invalidates (D2 §6.4). */
export const policySalePremiumKeys = {
  client: (clientId: string | null, userId: string | null, orgId: string | null) =>
    ["policy-sale-premiums", clientId, userId, orgId] as const,
  invalidate: (clientId: string) => ["policy-sale-premiums", clientId] as const,
};

/**
 * One client's sale premiums and correction history, as the server lets the real signed-in user see them. Nothing is
 * requested under "View As" (the server would answer for the real user, not the viewed one).
 */
export function usePolicySalePremiums(clientId: string | null | undefined) {
  const { user, isImpersonating } = useAuth();
  const { viewer } = useEffectiveViewer();
  const userId = user?.id ?? null;
  const orgId = viewer?.organizationId ?? null;
  const enabled = !!clientId && !!userId && !!orgId && !isImpersonating && !viewer?.isImpersonating && viewer?.viewerId === userId;
  const query = useQuery<ClientSalePremiums>({
    queryKey: policySalePremiumKeys.client(clientId ?? null, userId, orgId),
    queryFn: ({ signal }) => fetchClientSalePremiums(clientId!, signal),
    enabled,
    staleTime: 15_000,
    retry: false,
  });
  return { ...query, enabled };
}
