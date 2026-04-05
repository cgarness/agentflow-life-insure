import { useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Filters applied by managers in campaign settings.
 * Only keys present and non-null are sent to the RPC.
 * Architecture note: this type is intentionally flat so that plan-based
 * limit enforcement (e.g. Starter plan = 2 active filters) can be added
 * later by counting the non-null keys before calling the RPC.
 */
export type QueueFilters = {
  status?: string;
  state?: string;
  lead_source?: string;
  max_attempts?: number;
  min_score?: number;
  max_score?: number;
};

/** Represents a campaign_leads row as returned by the dialer queue. */
export type QueuedLead = {
  id: string;
  campaign_id: string;
  lead_id: string;
  status: string;
  state: string | null;
  call_attempts: number;
  last_called_at: string | null;
  assigned_agent_id: string | null;
  organization_id: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  [key: string]: unknown; // allow extra columns added by future migrations
};

// ─── Constants ───────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const LOCK_TTL_MINUTES = 5;

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * useLeadLock — Smart Queue Lock System
 *
 * Handles atomic lead fetching and locking for Team and Open Pool campaigns.
 * Personal campaigns bypass the lock and run a direct DB query instead.
 *
 * Usage:
 *   const { getNextLead, releaseLock, startHeartbeat, stopHeartbeat } = useLeadLock();
 */
export function useLeadLock() {
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── getNextLead ───────────────────────────────────────────────────────────
  /**
   * Fetches the next eligible lead for a campaign.
   *
   * - Team / Open Pool → calls get_next_queue_lead RPC (atomic fetch + lock)
   * - Personal          → direct campaign_leads query scoped to auth.uid()
   *
   * Filters are sourced from the campaign record so agents cannot influence them.
   * Returns null when the queue is empty (not an error).
   */
  const getNextLead = useCallback(
    async (
      campaignId: string,
      campaignType: string,
      filters: QueueFilters = {}
    ): Promise<QueuedLead | null> => {
      const type = campaignType.toUpperCase();

      // ── Personal campaign: direct query, no lock needed ───────────────────
      if (type === "PERSONAL") {
        const { data, error } = await supabase
          .from("campaign_leads")
          .select("*")
          .eq("campaign_id", campaignId)
          .eq("assigned_agent_id", (await supabase.auth.getUser()).data.user?.id ?? "")
          .not("status", "in", '("DNC","Completed","Removed")')
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error("[useLeadLock] Personal queue fetch error:", error);
          return null;
        }
        return (data as QueuedLead) ?? null;
      }

      // ── Team / Open Pool: atomic RPC fetch + lock ─────────────────────────
      // Strip undefined/null values so the function only receives active filters.
      const activeFilters = Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== undefined && v !== null)
      );

      const { data, error } = await supabase.rpc("get_next_queue_lead", {
        p_campaign_id: campaignId,
        p_filters: activeFilters,
      });

      if (error) {
        console.error("[useLeadLock] get_next_queue_lead RPC error:", error);
        return null;
      }

      // RPC returns an array (SETOF). Empty array = queue exhausted.
      if (!data || (data as QueuedLead[]).length === 0) {
        return null;
      }

      return (data as QueuedLead[])[0];
    },
    []
  );

  // ── releaseLock ───────────────────────────────────────────────────────────
  /**
   * Releases the agent's lock on a lead.
   * Call on: skip, disposition save, session end, beforeunload.
   */
  const releaseLock = useCallback(async (leadId: string): Promise<void> => {
    const { error } = await supabase.rpc("release_lead_lock", {
      p_lead_id: leadId,
    });

    if (error) {
      console.error("[useLeadLock] release_lead_lock RPC error:", error);
    }
  }, []);

  // ── startHeartbeat ────────────────────────────────────────────────────────
  /**
   * Begins renewing the lock every 30 seconds.
   * If the server reports the lock was lost (returns false), a warning is
   * logged so the dialer layer can decide how to handle it (e.g. refetch).
   *
   * Only one heartbeat interval runs at a time — calling startHeartbeat while
   * one is already running will clear the previous interval first.
   */
  const startHeartbeat = useCallback(
    (leadId: string, onLockLost?: () => void): void => {
      if (heartbeatRef.current !== null) {
        clearInterval(heartbeatRef.current);
      }

      heartbeatRef.current = setInterval(async () => {
        const { data, error } = await supabase.rpc("renew_lead_lock", {
          p_lead_id: leadId,
        });

        if (error) {
          console.error("[useLeadLock] renew_lead_lock RPC error:", error);
          return;
        }

        // data is boolean: false = lock no longer belongs to this agent
        if (data === false) {
          console.warn(
            `[useLeadLock] Lock lost for lead ${leadId} — lock expired or was reclaimed.`
          );
          onLockLost?.();
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    []
  );

  // ── stopHeartbeat ─────────────────────────────────────────────────────────
  /**
   * Clears the heartbeat interval. Call when navigating away from a lead,
   * when the session ends, or after releaseLock.
   */
  const stopHeartbeat = useCallback((): void => {
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  return {
    getNextLead,
    releaseLock,
    startHeartbeat,
    stopHeartbeat,
    /** Lock TTL in minutes (informational; matches the server-side default). */
    LOCK_TTL_MINUTES,
  };
}
