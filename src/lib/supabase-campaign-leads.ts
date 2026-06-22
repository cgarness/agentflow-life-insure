import { supabase } from "@/integrations/supabase/client";

const RPC_BATCH_SIZE = 500;

/**
 * Adds master-table leads to a campaign queue via `add_leads_to_campaign` (authenticated JWT).
 *
 * When `importHistoryId` is supplied (CSV-import path, Contacts Build 3), every queue row created by
 * this call is stamped with `campaign_leads.import_history_id` so a later Import Undo can identify and
 * remove exactly the rows this import created (and block on any other membership).
 */
export async function addLeadsToCampaignBatched(
  campaignId: string,
  leadIds: string[],
  importHistoryId?: string | null
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;
  for (let i = 0; i < leadIds.length; i += RPC_BATCH_SIZE) {
    const batch = leadIds.slice(i, i + RPC_BATCH_SIZE);
    // p_import_history_id is a defaulted 3rd arg (migration 20260620000100); omit (undefined) for the
    // generic 2-arg behavior. Now present in generated types, so no cast on the call.
    const { data, error } = await supabase.rpc("add_leads_to_campaign", {
      p_campaign_id: campaignId,
      p_lead_ids: batch,
      p_import_history_id: importHistoryId ?? undefined,
    });
    if (error) throw error;
    const result = data as unknown as { added: number; skipped: number };
    added += result.added ?? 0;
    skipped += result.skipped ?? 0;
  }
  return { added, skipped };
}
