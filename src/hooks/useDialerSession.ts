import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";

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
  selectedCampaignId: string | null;
  setSelectedCampaignId: (id: string | null) => void;
  selectedCampaign: AnyRecord | undefined;
  sessionStats: SessionStats;
  setSessionStats: React.Dispatch<React.SetStateAction<SessionStats>>;
}

export function useDialerSession(): UseDialerSessionReturn {
  const { user, profile } = useAuth();
  const { organizationId } = useOrganization();
  const [searchParams, setSearchParams] = useSearchParams();

  const [campaigns, setCampaigns] = useState<AnyRecord[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
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

  // Fetch campaigns for the current org and filter by role visibility
  useEffect(() => {
    const fetchCampaigns = async () => {
      if (!organizationId) return;
      setCampaignsLoading(true);
      // Note: omit `dial_delay_seconds` here so older DBs without that column still load the list;
      // delay is loaded when a campaign is selected (sync effect + optional follow-up query).
      const { data, error } = await supabase
        .from("campaigns")
        .select(
          "id, name, type, status, description, tags, total_leads, leads_contacted, leads_converted, max_attempts, calling_hours_start, calling_hours_end, retry_interval_hours, auto_dial_enabled, local_presence_enabled, assigned_agent_ids, created_by",
        )
        .eq("organization_id", organizationId)
        .eq("status", "Active")
        .order("name", { ascending: true });
      if (error) {
        console.error("[Dialer] campaigns fetch:", error);
        toast.error(
          "Could not load campaigns. Check your connection or ask an admin to verify database migrations.",
        );
        setCampaigns([]);
        setCampaignsLoading(false);
        return;
      }
      if (data) {
        const userId = user?.id;
        const roleLower = (profile?.role || "").toLowerCase().trim();
        const seesAllDialerCampaigns =
          Boolean(profile?.is_super_admin) ||
          roleLower === "admin" ||
          roleLower === "manager" ||
          roleLower === "team leader" ||
          roleLower === "team lead" ||
          roleLower === "team_leader";
        // Agents: POOL is open; PERSONAL/TEAM need creator or assignment. Elevated roles: all returned.
        const visible = seesAllDialerCampaigns
          ? data
          : data.filter((c: AnyRecord) => {
              const t = (c.type || "").toUpperCase();
              if (t.includes("POOL")) return true;
              const ids: string[] = Array.isArray(c.assigned_agent_ids)
                ? c.assigned_agent_ids
                : [];
              return c.created_by === userId || ids.includes(userId ?? "");
            });
        setCampaigns(visible);
      }
      setCampaignsLoading(false);
    };
    fetchCampaigns();
  }, [organizationId, user?.id, profile?.role, profile?.is_super_admin]);

  return {
    campaigns,
    setCampaigns,
    campaignsLoading,
    selectedCampaignId,
    setSelectedCampaignId,
    selectedCampaign,
    sessionStats,
    setSessionStats,
  };
}
