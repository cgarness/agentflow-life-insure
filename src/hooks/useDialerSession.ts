import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { usePermissions } from "@/hooks/usePermissions";
import { filterCampaignsForAssignee } from "@/lib/campaign-assignee-scope";
import {
  startDialerSession,
  heartbeatDialerSession,
  endDialerSession,
} from "@/lib/supabase-dialer-sessions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = any;

const HEARTBEAT_INTERVAL_MS = 45_000;
const DISPLAY_TICK_MS = 1_000;

interface SessionStats {
  calls_made: number;
  contacted_calls: number;
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
  activeSessionId: string | null;
  sessionStartedAt: string | null;
  sessionElapsedDisplay: number;
  startServerSession: (campaignId: string) => Promise<boolean>;
  endServerSession: () => Promise<void>;
  bestEffortEndServerSession: (accessToken: string) => void;
}

/** Best-effort end for tab close — does not block unload. */
export function bestEffortEndDialerSessionRpc(
  sessionId: string,
  accessToken: string,
): void {
  const sbUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  if (!sbUrl || !sessionId || !accessToken) return;
  void fetch(`${sbUrl}/rest/v1/rpc/end_dialer_session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: anon,
    },
    body: JSON.stringify({ p_session_id: sessionId }),
    keepalive: true,
  }).catch(() => {});
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
    contacted_calls: 0,
    total_talk_seconds: 0,
    policies_sold: 0,
  });

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [sessionElapsedDisplay, setSessionElapsedDisplay] = useState(0);

  const activeSessionIdRef = useRef<string | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const displayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startInFlightRef = useRef(false);

  const selectedCampaignId = searchParams.get("campaign");

  const setSelectedCampaignId = (id: string | null) => {
    if (id) setSearchParams({ campaign: id });
    else setSearchParams({});
  };

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaignId),
    [campaigns, selectedCampaignId],
  );

  const clearHeartbeatInterval = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const clearDisplayInterval = useCallback(() => {
    if (displayIntervalRef.current) {
      clearInterval(displayIntervalRef.current);
      displayIntervalRef.current = null;
    }
  }, []);

  const clearServerSessionLocalState = useCallback(() => {
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    setSessionStartedAt(null);
    setSessionElapsedDisplay(0);
    clearHeartbeatInterval();
    clearDisplayInterval();
  }, [clearHeartbeatInterval, clearDisplayInterval]);

  const startHeartbeatInterval = useCallback(
    (sessionId: string) => {
      clearHeartbeatInterval();
      heartbeatIntervalRef.current = setInterval(() => {
        void heartbeatDialerSession(sessionId).catch(() => {
          // Retry on next interval; stale cleanup protects abandoned sessions.
        });
      }, HEARTBEAT_INTERVAL_MS);
    },
    [clearHeartbeatInterval],
  );

  const startDisplayInterval = useCallback(
    (startedAt: string) => {
      clearDisplayInterval();
      const tick = () => {
        const elapsed = Math.floor(
          (Date.now() - new Date(startedAt).getTime()) / 1000,
        );
        setSessionElapsedDisplay(Math.max(0, elapsed));
      };
      tick();
      displayIntervalRef.current = setInterval(tick, DISPLAY_TICK_MS);
    },
    [clearDisplayInterval],
  );

  const startServerSession = useCallback(
    async (campaignId: string): Promise<boolean> => {
      if (!user?.id) {
        toast.error("Sign in required to start a dialer session.");
        return false;
      }
      if (activeSessionIdRef.current) return true;
      if (startInFlightRef.current) return false;

      startInFlightRef.current = true;
      try {
        const session = await startDialerSession(campaignId);
        activeSessionIdRef.current = session.id;
        setActiveSessionId(session.id);
        setSessionStartedAt(session.started_at);
        startHeartbeatInterval(session.id);
        startDisplayInterval(session.started_at);
        return true;
      } catch {
        toast.error(
          "Could not start dialer session tracking. Your calls will still work, but session time may not appear in reports until you retry.",
        );
        return false;
      } finally {
        startInFlightRef.current = false;
      }
    },
    [user?.id, startHeartbeatInterval, startDisplayInterval],
  );

  const endServerSession = useCallback(async () => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;

    clearServerSessionLocalState();

    try {
      await endDialerSession(sessionId);
    } catch {
      console.warn(
        "[useDialerSession] end_dialer_session failed; stale cleanup will close the session.",
      );
    }
  }, [clearServerSessionLocalState]);

  const bestEffortEndServerSession = useCallback((accessToken: string) => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    bestEffortEndDialerSessionRpc(sessionId, accessToken);
    clearServerSessionLocalState();
  }, [clearServerSessionLocalState]);

  // Unmount: stop intervals only — do not end server session (avoids strict-mode / remount false ends).
  useEffect(() => {
    return () => {
      clearHeartbeatInterval();
      clearDisplayInterval();
    };
  }, [clearHeartbeatInterval, clearDisplayInterval]);

  const refetchCampaigns = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!organizationId) return;
      const silent = opts?.silent && hasLoadedCampaignsRef.current;
      if (!silent) setCampaignsLoading(true);
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
    activeSessionId,
    sessionStartedAt,
    sessionElapsedDisplay,
    startServerSession,
    endServerSession,
    bestEffortEndServerSession,
  };
}
