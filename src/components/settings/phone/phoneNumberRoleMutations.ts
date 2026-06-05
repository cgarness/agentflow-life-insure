import { supabase } from "@/integrations/supabase/client";

/**
 * Phone-number outbound-role mutations (Phone Assignment Pass 3).
 *
 * Canonical outbound role lives on `phone_numbers.assignment_type` (invariant #18):
 *   - 'agency'   = shared outbound pool (automatic local-presence / dialer rotation + manual).
 *   - 'personal' = owner-only; requires `assigned_to`; can never be the org default; never automatic.
 *
 * `assigned_to` alone never implies Personal, and `is_direct_line` is inbound-only — neither is
 * touched here as a role signal.
 */

type ChangeToPersonalArgs = {
  phoneNumberId: string;
  organizationId: string;
  ownerId: string;
};

type ChangeToAgencyArgs = {
  phoneNumberId: string;
  organizationId: string;
};

/**
 * Agency -> Personal.
 *
 * Sets `assignment_type='personal'`, `assigned_to=ownerId`, `is_default=false`, then removes the
 * number from every campaign number group — Personal numbers are never part of an automatic pool.
 *
 * `number_group_members` has NO `organization_id` column, so memberships are deleted by
 * `phone_number_id` only. We confirm the phone number belongs to the caller's organization first
 * (the org-scoped UPDATE returns the row via `.select()`), so the unscoped membership delete is safe.
 */
export async function changePhoneNumberToPersonal({
  phoneNumberId,
  organizationId,
  ownerId,
}: ChangeToPersonalArgs): Promise<{ error: string | null }> {
  if (!ownerId) {
    return { error: "Personal numbers must have an assigned owner." };
  }

  const { data: updated, error } = await supabase
    .from("phone_numbers")
    .update({ assignment_type: "personal", assigned_to: ownerId, is_default: false })
    .eq("id", phoneNumberId)
    .eq("organization_id", organizationId)
    .select("id")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!updated) return { error: "Number not found in your organization." };

  // Org ownership confirmed above — safe to delete memberships by phone_number_id
  // (number_group_members has no organization_id column).
  const { error: delErr } = await supabase
    .from("number_group_members")
    .delete()
    .eq("phone_number_id", phoneNumberId);
  if (delErr) return { error: delErr.message };

  return { error: null };
}

/**
 * Personal -> Agency.
 *
 * Sets `assignment_type='agency'` only. `assigned_to` is kept (on an Agency number it is purely
 * administrative/display tracking and does not make the number owner-only). The number is NOT made
 * default and is NOT auto-added to any group.
 */
export async function changePhoneNumberToAgency({
  phoneNumberId,
  organizationId,
}: ChangeToAgencyArgs): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("phone_numbers")
    .update({ assignment_type: "agency" })
    .eq("id", phoneNumberId)
    .eq("organization_id", organizationId);
  if (error) return { error: error.message };
  return { error: null };
}
