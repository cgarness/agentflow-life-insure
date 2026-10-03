import { supabase } from "@/integrations/supabase/client";

export type ClientSaleOptions = { requestId: string; recordSale: boolean };
export type RecordedSaleResult = { client_id: string; win_ids: string[]; idempotent: boolean };

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
