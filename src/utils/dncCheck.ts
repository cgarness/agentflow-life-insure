import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";

export const DNC_VERIFY_ERROR = "Unable to verify DNC status. Call was not started.";
const resultSchema = z.object({
  blocked: z.boolean(),
  match: z.object({ id: z.string(), phone_number: z.string(), reason: z.string().nullable() }).nullable(),
});
export type DNCCheckResult = z.infer<typeof resultSchema>;
export type DNCMatch = NonNullable<DNCCheckResult["match"]>;

/** Server derives organization/actor; unavailable or malformed verification fails closed. */
export async function checkDNC(
  phone: string,
  organizationId: string | null | undefined,
  campaignLeadId?: string | null,
): Promise<DNCCheckResult> {
  if (!phone.trim() || !organizationId) throw new Error(DNC_VERIFY_ERROR);
  try {
    const { data, error } = await (supabase as any).rpc("check_dialer_dnc", {
      p_phone: phone,
      p_campaign_lead_id: campaignLeadId ?? null,
    });
    if (error) throw error;
    const result = resultSchema.safeParse(data);
    if (!result.success) throw new Error("Invalid DNC verification response");
    return result.data;
  } catch {
    throw new Error(DNC_VERIFY_ERROR);
  }
}
