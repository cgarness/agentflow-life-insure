import { supabase } from "@/integrations/supabase/client";

/**
 * Derived campaign-card stats (Queue/Campaign Build 4).
 *
 * Trusted, read-only aggregate counts for the Campaigns page cards, sourced from
 * `public.get_campaign_card_stats` instead of the stored `campaigns.leads_*`
 * columns (`leads_contacted` / `leads_converted` are not trigger-maintained).
 *
 * Definitions mirror the Dialer model:
 *   - total      — campaign_leads in the campaign (terminal/DNC/converted kept).
 *   - called     — campaign_leads with call_attempts > 0 (Skip never counts).
 *   - contacted  — distinct leads with a contacted call (duration > 45 OR the
 *                  disposition's counts_as_contacted = true; system "No Answer"
 *                  excluded; prefers disposition_id, falls back to name).
 *   - converted  — distinct leads converted via the convert_to_client
 *                  pipeline-stage path (unique per lead, NOT per policy).
 *   - policiesSold — COUNT(wins) for the campaign; policy-level production metric
 *                  for future Reports, NOT the card's Converted stat.
 */
export interface CampaignCardStats {
  total: number;
  called: number;
  contacted: number;
  converted: number;
  policiesSold: number;
}

interface CampaignCardStatsRow {
  campaign_id: string;
  total_leads: number | null;
  called_leads: number | null;
  contacted_leads: number | null;
  converted_leads: number | null;
  policies_sold: number | null;
}

/**
 * Fetch derived card stats for the given campaigns in one call (no N+1).
 * The RPC is org-scoped via `get_org_id()`; pass the already-visible campaign
 * ids so the result mirrors the page's assignee visibility. Returns a map keyed
 * by campaign id (campaigns with no result are simply absent — caller falls back
 * to zeros).
 */
export async function getCampaignCardStats(
  campaignIds: string[],
): Promise<Record<string, CampaignCardStats>> {
  const out: Record<string, CampaignCardStats> = {};
  if (campaignIds.length === 0) return out;

  // RPC is absent from generated types — narrow cast (Build 1/3 precedent).
  const { data, error } = await (supabase as any).rpc("get_campaign_card_stats", { // eslint-disable-line @typescript-eslint/no-explicit-any
    p_campaign_ids: campaignIds,
  });

  if (error) {
    console.error("[getCampaignCardStats] error:", error);
    return out;
  }

  for (const row of (data ?? []) as CampaignCardStatsRow[]) {
    out[row.campaign_id] = {
      total: row.total_leads ?? 0,
      called: row.called_leads ?? 0,
      contacted: row.contacted_leads ?? 0,
      converted: row.converted_leads ?? 0,
      policiesSold: row.policies_sold ?? 0,
    };
  }
  return out;
}
