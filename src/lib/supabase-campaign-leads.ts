import { supabase } from "@/integrations/supabase/client";

const RPC_BATCH_SIZE = 500;

/** Adds master-table leads to a campaign queue via `add_leads_to_campaign` (authenticated JWT). */
export async function addLeadsToCampaignBatched(
  campaignId: string,
  leadIds: string[]
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (let i = 0; i < leadIds.length; i += RPC_BATCH_SIZE) {
    const batch = leadIds.slice(i, i + RPC_BATCH_SIZE);
    const { data, error } = await supabase.rpc("add_leads_to_campaign", {
      p_campaign_id: campaignId,
      p_lead_ids: batch,
    });
    if (error) throw error;
    const result = data as { added: number; skipped: number };
    added += result.added ?? 0;
    skipped += result.skipped ?? 0;
  }
  return { added, skipped };
}
