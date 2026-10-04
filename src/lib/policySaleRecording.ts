import { supabase } from "@/integrations/supabase/client";

export type ClientSaleOptions = { requestId: string; recordSale: boolean; historical?: boolean };
export type RecordedSaleResult = { client_id: string; win_ids: string[]; idempotent: boolean };

export type PolicyEntry = {
  policy_type: string; carrier: string; policy_number?: string; premium: number | null;
  face_amount?: string; sold_date: string; effective_date?: string; sale_mode: "new" | "historical";
};

/** Existing-client policy and sale persistence is one server transaction. */
export async function recordClientPolicy(requestId: string, clientId: string, policy: PolicyEntry, primary = false): Promise<RecordedSaleResult> {
  const { data, error } = await (supabase as any).rpc("record_client_policy", {
    p_request_id: requestId, p_client_id: clientId, p_policy: policy, p_primary: primary,
  });
  if (error) throw new Error(error.message);
  const result = data as RecordedSaleResult;
  if (result?.client_id !== clientId || !Array.isArray(result.win_ids)) throw new Error("Policy save returned an invalid receipt; retry this save.");
  if (policy.sale_mode !== "historical") await notifyRecordedSales(result.win_ids);
  return result;
}

/** Never turn malformed or negative premium input into a plausible sale amount. */
export function saleMonthlyPremium(raw: string | null | undefined): number | null {
  const value = (raw ?? "").replace(/[,$\s]/g, "");
  if (!value) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value))) {
    throw new Error("Enter a nonnegative monthly premium with at most two decimal places");
  }
  return Number(value);
}

/** Only delivery happens here. The transaction already persisted each canonical policy event. */
export async function notifyRecordedSales(winIds: string[]): Promise<void> {
  await Promise.all(winIds.map(async (id) => {
    try {
      const { error } = await supabase.rpc("notify_win", { p_win_id: id });
      if (error) throw error;
    } catch (error) {
      // Retrying the original save returns the same IDs; notify_win deduplicates its recipients.
      console.warn("Sale saved; celebration delivery failed:", error);
    }
  }));
}
