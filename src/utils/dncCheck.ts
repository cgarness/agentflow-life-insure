import { supabase } from "@/integrations/supabase/client";
import { normalizePhoneNumber } from "@/utils/phoneUtils";

export interface DNCMatch {
  id: string;
  phone_number: string;
  reason: string | null;
}

export interface DNCCheckResult {
  blocked: boolean;
  match: DNCMatch | null;
}

/**
 * Check whether a phone number is on the agency DNC list for the given org.
 * Returns blocked=true with the matching row when a match is found. On query
 * error, returns blocked=false (fail-open) but logs — caller must decide
 * whether DB-error fail-open is acceptable in their flow.
 */
export async function checkDNC(
  phone: string,
  organizationId: string | null | undefined
): Promise<DNCCheckResult> {
  if (!phone || !organizationId) {
    return { blocked: false, match: null };
  }
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return { blocked: false, match: null };

  const { data, error } = await supabase
    .from("dnc_list")
    .select("id, phone_number, reason")
    .eq("organization_id", organizationId)
    .eq("phone_number", normalized)
    .maybeSingle();

  if (error) {
    console.error("[checkDNC] query failed:", error.message);
    return { blocked: false, match: null };
  }
  return { blocked: !!data, match: data ?? null };
}
