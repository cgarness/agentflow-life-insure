import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { usePermissions } from "@/hooks/usePermissions";
import { filterCampaignsForAssignee } from "@/lib/campaign-assignee-scope";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = any;

interface SessionStats {
  calls_made: number;
  calls_connected: number;
  total_talk_seconds: number;
  policies_sold: number;
}

interface UseDialerSessionReturn {
  campaigns: AnyRecord[];
  setCampaigns: React.Dispatch<React.SetStateAction<AnyRecord[]>>;
  campaignsLoading: boolean;
  campaignsViewAll: boolean;
  refetchCampaigns: (opts?: { silent?: boolean }) => Promise<void>;
  selectedCampaignId: string | null;
  setSelectedCampaignId: (id: string | null) => void;
  selectedCampaign: AnyRecord | undefined;
  sessionStats: SessionStats;
  setSessionStats: React.Dispatch<React.SetStateAction<SessionStats>>;
}

export function useDialerSession(): UseDialerSessionReturn {
  const { user, profile } = useAuth();
  const { organizationId } = useOrganization();
  const { getDataScope, hasFeatureAccess } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();

  const campaignsViewAll = useMemo(
    () =>
      Boolean(profile?.is_super_admin) ||
      getDataScope("campaigns") === "all" ||
      hasFeatureAccess("View All Campaigns"),
    [profile?.is_super_admin, getDataScope, hasFeatureAccess],
  );

  const [campaigns, setCampaigns] = useState<AnyRecord[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const hasLoadedCampaignsRef = useRef(false);
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    calls_made: 0,
    calls_connected: 0,
    total_talk_seconds: 0,
    policies_sold: 0,
  });

  const selectedCampaignId = searchParams.get("campaign");

  const setSelectedCampaignId = (id: string | null) => {
    if (id) setSearchParams({ campaign: id });
    else setSearchParams({});
  };

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaignId),
    [campaigns, selectedCampaignId],
  );

  const refetchCampaigns = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!organizationId) return;
      const silent = opts?.silent && hasLoadedCampaignsRef.current;
      if (!silent) setCampaignsLoading(true);
      // Note: omit `dial_delay_seconds` here so older DBs without that column still load the list;
      // delay is loaded when a campaign is selected (sync effect + optional follow-up query).
      const { data, error } = await supabase
        .from("campaigns")
        .select(
          "id, name, type, status, description, tags, total_leads, leads_contacted, leads_converted, max_attempts, calling_hours_start, calling_hours_end, retry_interval_hours, auto_dial_enabled, local_presence_enabled, number_group_id, assigned_agent_ids, user_id, created_by, created_at",
        )
        .eq("organization_id", organizationId)
        .eq("status", "Active")
        .order("name", { ascending: true });
      if (error) {
        console.error("[Dialer] campaigns fetch:", error);
        if (!silent) {
          toast.error(
            "Could not load campaigns. Check your connection or ask an admin to verify database migrations.",
          );
        }
        setCampaigns([]);
        hasLoadedCampaignsRef.current = false;
        if (!silent) setCampaignsLoading(false);
        return;
      }
      if (data) {
        const userId = user?.id ?? "";
        const visible = userId
          ? filterCampaignsForAssignee(data, userId, { viewAll: campaignsViewAll })
          : [];
        setCampaigns(visible);
        hasLoadedCampaignsRef.current = true;
      }
      if (!silent) setCampaignsLoading(false);
    },
    [organizationId, user?.id, campaignsViewAll],
  );

  useEffect(() => {
    hasLoadedCampaignsRef.current = false;
    void refetchCampaigns();
  }, [refetchCampaigns]);

  return {
    campaigns,
    setCampaigns,
    campaignsLoading,
    campaignsViewAll,
    refetchCampaigns,
    selectedCampaignId,
    setSelectedCampaignId,
    selectedCampaign,
    sessionStats,
    setSessionStats,
  };
}
