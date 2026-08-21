import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  getDialerCampaignPresence,
  DIALER_CAMPAIGN_PRESENCE_QUERY_KEY,
  type CampaignPresenceMap,
} from "@/lib/supabase-dialer-presence";
import type { AssigneeProfile, AssigneeProfileMap } from "@/components/dialer/campaignSelectionModel";

/**
 * Selection-screen presence + leadership assignee-name queries.
 *
 * REFRESH OWNERSHIP: useCampaignSelectionLive is the ONE refresh owner for this screen —
 * its 15s interval / window-focus / campaigns-Realtime handler invalidates the
 * ["dialerCampaignPresence", org] prefix. These queries therefore poll NOTHING themselves:
 * no refetchInterval, no refetchOnWindowFocus, and presence is never written to
 * localStorage (a stale cached live count would be misleading).
 */

interface UseDialerCampaignPresenceArgs {
  organizationId: string | null | undefined;
  /** Already filtered by filterCampaignsForDialing — the dialer-visible set only. */
  campaignIds: string[];
  /** Stable identity for the id set (DialerPage's visibleCampaignIdsKey). */
  idsKey: string;
  enabled: boolean;
}

export interface DialerCampaignPresenceResult {
  /**
   * undefined while loading AND whenever the query is in an error state — a failed
   * background refresh must immediately suppress previously cached counts/identities
   * (the UI renders "—", never stale live data). An ordinary in-flight refresh keeps
   * the last valid map visible.
   */
  presence: CampaignPresenceMap | undefined;
  isError: boolean;
}

export function useDialerCampaignPresence({
  organizationId,
  campaignIds,
  idsKey,
  enabled,
}: UseDialerCampaignPresenceArgs): DialerCampaignPresenceResult {
  const query = useQuery<CampaignPresenceMap>({
    queryKey: [DIALER_CAMPAIGN_PRESENCE_QUERY_KEY, organizationId, idsKey],
    enabled: enabled && !!organizationId && campaignIds.length > 0,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 10_000,
    queryFn: () => getDialerCampaignPresence(campaignIds),
  });
  return {
    presence: query.isError ? undefined : query.data,
    isError: query.isError,
  };
}

interface UseCampaignAssigneeProfilesArgs {
  organizationId: string | null | undefined;
  /** Union of Personal owners + Team participants over the visible campaigns. */
  userIds: string[];
  idsKey: string;
  /** Leadership viewers only — Agent-role sessions must never issue this fetch. */
  enabled: boolean;
}

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

export function useCampaignAssigneeProfiles({
  organizationId,
  userIds,
  idsKey,
  enabled,
}: UseCampaignAssigneeProfilesArgs) {
  return useQuery<AssigneeProfileMap>({
    queryKey: ["campaignAssigneeProfiles", organizationId, idsKey],
    enabled: enabled && !!organizationId && userIds.length > 0,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, avatar_url")
        .eq("organization_id", organizationId!)
        .in("id", userIds);
      if (error) throw error;
      const map: AssigneeProfileMap = {};
      for (const row of (data ?? []) as ProfileRow[]) {
        const displayName =
          [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || null;
        const profile: AssigneeProfile = {
          id: row.id,
          displayName,
          avatarUrl: row.avatar_url?.trim() ? row.avatar_url : null,
        };
        map[row.id] = profile;
      }
      return map;
    },
  });
}
