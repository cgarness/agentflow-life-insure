import { supabase } from "@/integrations/supabase/client";

interface WinTriggerParams {
  agentId: string;
  agentName: string;
  contactName: string;
  contactId?: string;
  campaignId?: string;
  campaignName?: string;
  callId?: string;
  policyType?: string;
  premiumAmount?: number;
  organizationId?: string | null;
}

/**
 * Records a policy sale (win) when a policy is sold.
 * 1. Inserts into wins table
 * 2. Broadcasts notification to all users
 */
export async function triggerWin(params: WinTriggerParams): Promise<void> {
  const {
    agentId,
    agentName,
    contactName,
    contactId,
    campaignId,
    campaignName,
    callId,
    policyType,
    premiumAmount,
    organizationId = null,
  } = params;

  // 1. Insert win record
  const { data: winData, error: winError } = await supabase
    .from("wins")
    .insert({
      agent_id: agentId,
      agent_name: agentName,
      contact_name: contactName,
      contact_id: contactId || null,
      campaign_id: campaignId || null,
      campaign_name: campaignName || null,
      call_id: callId || null,
      policy_type: policyType || null,
      premium_amount: premiumAmount || null,
      celebrated: false,
      organization_id: organizationId,
    } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .select("id, agent_name, contact_name, campaign_name, created_at, organization_id")
    .single();

  if (winError) {
    console.error("Failed to create win record:", winError);
    return;
  }

  // 2. Broadcast notification to all users
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id");

  if (profiles && profiles.length > 0) {
    const notifications = profiles.map((p) => ({
      user_id: p.id,
      type: "win",
      title: `${agentName} just sold a policy! 🎉`,
      body: `Sold to ${contactName}`,
      action_url: "/leaderboard",
      action_label: "View Leaderboard",
      metadata: {
        agent_id: agentId,
        contact_name: contactName,
        campaign_name: campaignName,
        win_id: winData.id,
      },
      read: false,
      organization_id: organizationId,
    }));

    await supabase.from("notifications").insert(notifications);
  }
}
import { isConvertedDisposition } from "@/lib/report-utils";

/**
 * @deprecated Use `isConvertedDisposition()` from `report-utils.ts` directly.
 * Kept as a thin alias for backward compatibility.
 */
export { isConvertedDisposition };

/**
 * Check if a disposition indicates a sale (data-driven).
 * Requires the full disposition object and pipeline stages array.
 *
 * Legacy callers that only have a name should migrate to the
 * `isConvertedCall` + `buildConvertedDispositionSet` pattern.
 */
export function isSaleDisposition(
  disposition: { pipeline_stage_id?: string | null } | null | undefined,
  pipelineStages: Array<{ id: string; convert_to_client: boolean }>,
): boolean {
  return isConvertedDisposition(disposition, pipelineStages);
}
