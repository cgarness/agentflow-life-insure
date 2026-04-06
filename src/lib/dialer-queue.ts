/**
 * dialer-queue.ts — Campaign-type-aware queue helpers for DialerPage.
 *
 * Extracts lock-mode lead fetching, filter building, and bulk lock
 * release so DialerPage stays under the 200-line-per-section limit.
 *
 * Lock-mode (Team / Open / Open Pool) uses the 90-second TTL RPC
 * `fetch_and_lock_next_lead`. Personal campaigns query campaign_leads
 * directly — no lock needed.
 */

import { supabase } from "@/integrations/supabase/client";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Filters compatible with the fetch_and_lock_next_lead RPC.
 *  Only `state` and `max_attempts` are supported (no leads JOIN). */
export interface LockModeFilters {
  state?: string;
  max_attempts?: number;
}

// ─── fetchNextQueuedLead ────────────────────────────────────────────────────

/**
 * Returns the next lead to dial based on campaign type.
 *
 * - Personal: direct query scoped to the agent's own leads.
 * - Team / Open / Open Pool: calls fetch_and_lock_next_lead RPC
 *   which atomically locks the lead for 90 seconds.
 */
export async function fetchNextQueuedLead(
  campaignType: string,
  campaignId: string,
  organizationId: string,
  userId: string,
  filters: LockModeFilters = {},
): Promise<any | null> {
  const type = campaignType.toUpperCase();

  if (type === "PERSONAL") {
    const { data, error } = await supabase
      .from("campaign_leads")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("organization_id", organizationId)
      .eq("status", "Queued")
      .or(`claimed_by.eq.${userId},claimed_by.is.null`)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[dialer-queue] Personal queue fetch error:", error);
      return null;
    }
    return data ?? null;
  }

  // ── Team / Open / Open Pool: atomic 90-second lock RPC ──
  const activeFilters = Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );

  const { data, error } = await supabase.rpc("fetch_and_lock_next_lead", {
    p_campaign_id: campaignId,
    p_filters: activeFilters,
  });

  if (error) {
    console.error("[dialer-queue] fetch_and_lock_next_lead RPC error:", error);
    return null;
  }

  // RPC returns SETOF — array. Empty = queue exhausted.
  if (!data || (Array.isArray(data) && data.length === 0)) {
    return null;
  }

  return Array.isArray(data) ? data[0] : data;
}

// ─── buildFiltersFromQueueState ─────────────────────────────────────────────

/**
 * Converts the DialerPage QueueFilterState into the flat JSONB object
 * accepted by fetch_and_lock_next_lead. Only includes keys with
 * non-default, non-empty values.
 *
 * NOTE: min_score, max_score, and leadSource are intentionally excluded
 * because fetch_and_lock_next_lead operates on campaign_leads only
 * (no JOIN to leads table — avoids deadlock risk with FOR UPDATE).
 */
export function buildFiltersFromQueueState(queueFilter: {
  status: string;
  state: string;
  leadSource: string;
  minAttempts: number;
  maxAttempts: number;
  minScore: number;
  maxScore: number;
}): LockModeFilters {
  const filters: LockModeFilters = {};

  if (queueFilter.state && queueFilter.state.trim() !== "") {
    filters.state = queueFilter.state;
  }

  // max_attempts: only include if below the default ceiling (99)
  if (queueFilter.maxAttempts < 99) {
    filters.max_attempts = queueFilter.maxAttempts;
  }

  return filters;
}

// ─── releaseAllAgentLocks ───────────────────────────────────────────────────

/**
 * Releases ALL locks held by the current agent for a campaign.
 * Called on End Session and beforeunload.
 *
 * For beforeunload, use releaseAllAgentLocksBeacon() instead,
 * which uses navigator.sendBeacon for reliability.
 */
export async function releaseAllAgentLocks(campaignId: string): Promise<void> {
  const { error } = await supabase.rpc("release_all_agent_locks", {
    p_campaign_id: campaignId,
  });

  if (error) {
    console.error("[dialer-queue] release_all_agent_locks RPC error:", error);
  }
}

/**
 * Beacon-based lock release for beforeunload.
 * navigator.sendBeacon is the only reliable way to fire a request
 * during page unload — async/await will be killed by the browser.
 *
 * Falls back to synchronous XMLHttpRequest if sendBeacon is unavailable.
 */
export function releaseAllAgentLocksBeacon(
  campaignId: string,
  supabaseUrl: string,
  accessToken: string,
): void {
  const url = `${supabaseUrl}/rest/v1/rpc/release_all_agent_locks`;
  const body = JSON.stringify({ p_campaign_id: campaignId });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: accessToken,
    Authorization: `Bearer ${accessToken}`,
  };

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    // sendBeacon doesn't support custom headers natively.
    // Use fetch with keepalive instead (widely supported).
    try {
      fetch(url, {
        method: "POST",
        headers,
        body,
        keepalive: true,
      });
    } catch {
      // Last resort: sendBeacon without auth headers (will fail RLS but won't throw)
      navigator.sendBeacon(url, blob);
    }
  } else {
    // Fallback: synchronous XHR (blocks briefly but ensures delivery)
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, false); // synchronous
      Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.send(body);
    } catch {
      // Nothing more we can do during unload
    }
  }
}
