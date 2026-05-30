import { useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Disposition } from "@/lib/types";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Duration after which a still-connected call auto-claims the lead.
 * 46s (not 45s) so the live-call auto-claim fires just past the `> 45s`
 * hard-claim threshold and avoids 45.0-boundary ambiguity.
 */
const CLAIM_TIMER_MS = 46_000;

/** Minimum connected duration (seconds) that hard-claims a lead. */
const HARD_CLAIM_MIN_DURATION_SEC = 45;

/**
 * Canonical locked/system "No Answer" disposition name — the ONLY allowed
 * disposition-name check (mirrors report-utils.isSystemNoAnswerName). No Answer
 * must never hard-claim.
 */
function isSystemNoAnswer(name: string | undefined | null): boolean {
  return (name ?? "").trim().toLowerCase() === "no answer";
}

/**
 * Hard-claim decision (ordered short-circuit). Returns true when the lead
 * should be claimed via `claim_lead`.
 *
 * Order:
 *   1. System No Answer            → no claim
 *   2. DNC / dncAutoAdd            → no claim (don't own a number we're suppressing)
 *   3. duration > 45s              → claim
 *   4. countsAsContacted = true    → claim
 *   5. callbackScheduler = true    → claim (ownership-critical: callbacks return to the agent)
 *   6. otherwise                   → no claim
 */
export function shouldHardClaim(
  disposition: Pick<
    Disposition,
    "name" | "dncAutoAdd" | "countsAsContacted" | "callbackScheduler"
  > | null,
  durationSeconds: number,
): boolean {
  if (disposition && isSystemNoAnswer(disposition.name)) return false;
  if (disposition?.dncAutoAdd) return false;
  if (durationSeconds > HARD_CLAIM_MIN_DURATION_SEC) return true;
  if (disposition?.countsAsContacted) return true;
  if (disposition?.callbackScheduler) return true;
  return false;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * useHardClaim — Hard Claim Engine
 *
 * Handles permanent lead ownership transfer for Team and Open Pool campaigns.
 * A lead is "claimed" (via the claim_lead RPC, which writes
 * leads.assigned_agent_id) when the ordered hard-claim rule passes:
 * duration > 45 OR countsAsContacted OR callbackScheduler, excluding system
 * No Answer AND DNC. See `shouldHardClaim`.
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
   * Cancels any pending auto-claim timer and claims the lead only when the
   * ordered hard-claim rule (see `shouldHardClaim`) passes:
   *   duration > 45  OR  countsAsContacted  OR  callbackScheduler,
   *   excluding system No Answer AND DNC/dncAutoAdd.
   *
   * Receives the full Disposition so it can read the flags (System No Answer,
   * dncAutoAdd, countsAsContacted, callbackScheduler) — no label matching
   * beyond the canonical No Answer exception.
   */
  const claimOnDisposition = useCallback(
    async (
      campaignLeadId: string,
      leadId: string,
      campaignId: string,
      disposition: Pick<
        Disposition,
        "name" | "dncAutoAdd" | "countsAsContacted" | "callbackScheduler"
      > | null,
      durationSeconds: number
    ): Promise<void> => {
      cancelClaimTimer();
      if (!shouldHardClaim(disposition, durationSeconds)) return;
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
