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
 * Triggers a win celebration when a policy is sold.
 * 1. Inserts into wins table
 * 2. Broadcasts notification to all users
 * 3. Dispatches event for immediate local celebration
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
    .select("id, agent_name, contact_name, campaign_name, created_at")
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

  // 3. Dispatch local event for immediate celebration
  window.dispatchEvent(
    new CustomEvent("win-celebration", {
      detail: winData,
    })
  );
}

/**
 * Check if a disposition name indicates a sale
 */
export function isSaleDisposition(dispositionName: string): boolean {
  const lower = dispositionName.toLowerCase();
  return lower.includes("sold") || lower.includes("policy");
}
