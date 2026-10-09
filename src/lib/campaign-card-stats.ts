import { supabase } from "@/integrations/supabase/client";

/**
 * Derived campaign stats (Queue/Campaign Build 4) for the Campaigns table.
 *
 * Trusted, read-only aggregate counts sourced from `public.get_campaign_card_stats` instead
 * of the stored `campaigns.leads_*` columns (`leads_contacted` / `leads_converted` are not
 * trigger-maintained).
 *
 * Definitions mirror the Dialer model:
 *   - total      — campaign_leads in the campaign (terminal/DNC/converted kept).
 *   - called     — campaign_leads with call_attempts > 0 (Skip never counts).
 *   - contacted  — distinct leads with a contacted call (duration > 45 OR the
 *                  disposition's counts_as_contacted = true; system "No Answer"
 *                  excluded; prefers disposition_id, falls back to name).
 *   - converted  — distinct leads converted via the convert_to_client
 *                  pipeline-stage path (unique per lead, NOT per policy).
 *   - policiesSold — COUNT(wins) for the campaign; policy-level production metric,
 *                  NOT the table's Converted value and not rendered.
 *
 * The RPC is org-scoped via `get_org_id()` and returns Personal campaigns to their owner
 * only, so a campaign absent from the result is "not returned", never zero.
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

/** Ids per RPC call; well below PostgREST's row cap so a chunk can never be truncated. */
export const CAMPAIGN_CARD_STATS_CHUNK = 200;

export class CampaignCardStatsError extends Error {
  /** The raw provider error, for console diagnostics only — never rendered. */
  readonly cause: unknown;
  constructor(cause?: unknown) {
    super("Campaign metrics could not be loaded.");
    this.name = "CampaignCardStatsError";
    this.cause = cause;
  }
}

/**
 * Fetch derived stats for the given (already visible) campaigns. Ids are sent in chunks and
 * merged; any failed chunk rejects the whole call, so a partial map is never returned.
 */
export async function getCampaignCardStats(
  campaignIds: string[],
  options: { signal?: AbortSignal } = {},
): Promise<Record<string, CampaignCardStats>> {
  const out: Record<string, CampaignCardStats> = {};
  const ids = Array.from(new Set(campaignIds));
  for (let i = 0; i < ids.length; i += CAMPAIGN_CARD_STATS_CHUNK) {
    const chunk = ids.slice(i, i + CAMPAIGN_CARD_STATS_CHUNK);
    let request = supabase.rpc("get_campaign_card_stats", { p_campaign_ids: chunk });
    if (options.signal) request = request.abortSignal(options.signal);
    const { data, error } = await request;
    if (error) throw new CampaignCardStatsError(error);
    for (const row of (data ?? []) as CampaignCardStatsRow[]) {
      out[row.campaign_id] = {
        total: row.total_leads ?? 0,
        called: row.called_leads ?? 0,
        contacted: row.contacted_leads ?? 0,
        converted: row.converted_leads ?? 0,
        policiesSold: row.policies_sold ?? 0,
      };
    }
  }
  return out;
}
