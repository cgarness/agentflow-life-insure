import { useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Duration after which a connected call auto-claims the lead. */
const CLAIM_TIMER_MS = 30_000;

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * useHardClaim — Hard Claim Engine
 *
 * Handles permanent lead ownership transfer for Team and Open Pool campaigns.
 * When an agent is connected for ≥ 30 seconds, the lead is "claimed" by
 * calling the claim_lead RPC which writes leads.assigned_agent_id.
 *
 * Usage:
 *   const { startClaimTimer, cancelClaimTimer, claimOnDisposition, claimedLeadIds }
 *     = useHardClaim();
 *
 * Do NOT use for Personal campaigns — claim logic only applies to shared pools.
 *
 * Schema safety:
 *   claim_lead RPC updates leads.assigned_agent_id ONLY.
 *   It never touches campaign_leads.assigned_agent_id.
 */
export function useHardClaim() {
  const claimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track which lead_ids (master leads.id) have been claimed this session.
  const [claimedLeadIds, setClaimedLeadIds] = useState<Set<string>>(new Set());

  // ── Internal RPC caller ─────────────────────────────────────────────────
  const callClaimRpc = useCallback(
    async (
      campaignLeadId: string,
      leadId: string,
      campaignId: string
    ): Promise<void> => {
      const { error } = await supabase.rpc("claim_lead", {
        p_campaign_lead_id: campaignLeadId,
        p_lead_id: leadId,
        p_campaign_id: campaignId,
      });

      if (error) {
        console.error("[useHardClaim] claim_lead RPC error:", error);
        return;
      }

      // Track locally so the "✦ Claimed" badge renders immediately.
      setClaimedLeadIds((prev) => new Set([...prev, leadId]));
    },
    []
  );

  // ── startClaimTimer ──────────────────────────────────────────────────────
  /**
   * Starts the 30-second auto-claim timer when a call is answered.
   * If the call drops before 30s, call cancelClaimTimer() to abort.
   *
   * Only one timer runs at a time — calling startClaimTimer while one is
   * active will clear the previous timer first.
   */
  const startClaimTimer = useCallback(
    (campaignLeadId: string, leadId: string, campaignId: string): void => {
      if (claimTimerRef.current !== null) {
        clearTimeout(claimTimerRef.current);
      }

      claimTimerRef.current = setTimeout(() => {
        claimTimerRef.current = null;
        callClaimRpc(campaignLeadId, leadId, campaignId);
      }, CLAIM_TIMER_MS);
    },
    [callClaimRpc]
  );

  // ── cancelClaimTimer ─────────────────────────────────────────────────────
  /**
   * Cancels the active claim timer without triggering a claim.
   * Call when: call ends before 30s, agent skips, session ends.
   */
  const cancelClaimTimer = useCallback((): void => {
    if (claimTimerRef.current !== null) {
      clearTimeout(claimTimerRef.current);
      claimTimerRef.current = null;
    }
  }, []);

  // ── claimOnDisposition ───────────────────────────────────────────────────
  /**
   * Called on disposition save for Team/Open campaigns.
   * Cancels any pending auto-claim timer and immediately claims the lead
   * if the call was meaningful (durationSeconds > 0).
   *
   * This ensures that even if the ClaimRing did not complete its 30s arc
   * (e.g. call lasted 20s), the agent still claims a lead they talked to.
   */
  const claimOnDisposition = useCallback(
    async (
      campaignLeadId: string,
      leadId: string,
      campaignId: string,
      disposition: string,
      durationSeconds: number
    ): Promise<void> => {
      cancelClaimTimer();
      // Only claim on meaningful calls (> 0 seconds of connected time)
      if (durationSeconds <= 0) return;
      await callClaimRpc(campaignLeadId, leadId, campaignId);
    },
    [cancelClaimTimer, callClaimRpc]
  );

  return {
    startClaimTimer,
    cancelClaimTimer,
    claimOnDisposition,
    /** Set of master lead IDs (leads.id) claimed this session. */
    claimedLeadIds,
  };
}
