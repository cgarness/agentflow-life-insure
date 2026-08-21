import { useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DIALER_CAMPAIGN_PRESENCE_QUERY_KEY } from "@/lib/supabase-dialer-presence";

const POLL_MS = 15_000;

/**
 * Keeps the dialer campaign selection screen fresh (lead counts, campaign list,
 * active-agent presence) while the agent is on the picker — Realtime + polling fallback.
 * This hook is the ONE refresh owner for the screen: the presence query itself has no
 * refetchInterval and no focus refetch, so no second poller can exist.
 */
export function useCampaignSelectionLive(
  organizationId: string | null | undefined,
  isActive: boolean,
  refetchCampaigns: (opts?: { silent?: boolean }) => void | Promise<void>,
) {
  const queryClient = useQueryClient();

  const refreshStats = useCallback(() => {
    if (!organizationId) return;
    void queryClient.invalidateQueries({
      queryKey: ["campaignStateStats", organizationId],
    });
  }, [queryClient, organizationId]);

  const refreshPresence = useCallback(() => {
    if (!organizationId) return;
    void queryClient.invalidateQueries({
      queryKey: [DIALER_CAMPAIGN_PRESENCE_QUERY_KEY, organizationId],
    });
  }, [queryClient, organizationId]);

  const refreshAll = useCallback(() => {
    refreshStats();
    refreshPresence();
    void refetchCampaigns({ silent: true });
  }, [refreshStats, refreshPresence, refetchCampaigns]);

  useEffect(() => {
    if (!isActive || !organizationId) return;
    const id = window.setInterval(refreshAll, POLL_MS);
    return () => window.clearInterval(id);
  }, [isActive, organizationId, refreshAll]);

  useEffect(() => {
    if (!isActive || !organizationId) return;

    const filter = `organization_id=eq.${organizationId}`;
    const channel = supabase
      .channel(`dialer-campaign-selection-${organizationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campaign_leads", filter },
        () => refreshStats(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campaigns", filter },
        () => refreshAll(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isActive, organizationId, refreshStats, refreshAll]);

  useEffect(() => {
    if (!isActive || !organizationId) return;
    const onFocus = () => refreshAll();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isActive, organizationId, refreshAll]);
}
