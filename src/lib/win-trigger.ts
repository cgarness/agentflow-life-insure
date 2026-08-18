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
  /**
   * Business-effective sale date (YYYY-MM-DD) entered by the agent. Stored on `wins.sold_date`;
   * `wins.created_at` stays the system-event timestamp and remains the reporting bucket everywhere.
   */
  soldDate?: string;
  /**
   * DB-enforced idempotency key (unique on non-null). For conversions, pass `conversion:<lead-id>`:
   * a concurrent/retry insert hits the unique index and is treated as already-celebrated (no duplicate
   * win, no duplicate notifications). Leave undefined for additional-policy/non-conversion wins.
   */
  idempotencyKey?: string;
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
    soldDate,
    idempotencyKey,
  } = params;

  // 1. Insert win record. The unique index on `wins.idempotency_key` (non-null) makes conversion wins
  // DB-idempotent: a concurrent/retry insert raises 23505 and we treat it as already-celebrated.
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
      sold_date: soldDate || null,
      celebrated: false,
      organization_id: organizationId,
      idempotency_key: idempotencyKey ?? null,
    } as any)
    .select("id, agent_name, contact_name, campaign_name, created_at, organization_id")
    .single();

  if (winError) {
    // 23505 = unique_violation → this win was already recorded (idempotent retry). Skip silently;
    // do NOT broadcast a duplicate notification.

    if ((winError as any).code === "23505") return;
    console.error("Failed to create win record:", winError);
    return;
  }

  // 2. Broadcast via the server-authoritative RPC: recipients are derived and org-scoped in
  // the database (Active profiles in the win's organization), content is built from the wins
  // row, authorization mirrors win creation (self / Admin / super admin / TL-over-agent), and
  // the win:<id> event key makes the fan-out exactly-once even across retries. Celebration
  // failure must never surface as a conversion/save failure.
  try {

    const { error: notifyError } = await (supabase as any).rpc("notify_win", {
      p_win_id: winData.id,
    });
    if (notifyError) {
      console.error("Failed to broadcast win notifications:", notifyError);
    }
  } catch (err) {
    console.error("Failed to broadcast win notifications:", err);
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
