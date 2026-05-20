import { supabase } from "@/integrations/supabase/client";

/**
 * Marking a number as a direct line is mutually exclusive with group membership.
 * Flipping ON also wipes the number from every group.
 */
export async function toggleDirectLine(
  phoneNumberId: string,
  isDirectLine: boolean,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("phone_numbers")
    .update({ is_direct_line: isDirectLine })
    .eq("id", phoneNumberId);
  if (error) return { error: error.message };

  if (isDirectLine) {
    const { error: delErr } = await supabase
      .from("number_group_members")
      .delete()
      .eq("phone_number_id", phoneNumberId);
    if (delErr) return { error: delErr.message };
  }
  return { error: null };
}

/**
 * Reconcile a group's members against the desired set of phone_number_ids.
 * Direct-line numbers are excluded upstream — caller is responsible for filtering.
 */
export async function reconcileGroupMembers(
  groupId: string,
  currentMemberPhoneIds: string[],
  nextMemberPhoneIds: string[],
): Promise<{ error: string | null }> {
  const current = new Set(currentMemberPhoneIds);
  const next = new Set(nextMemberPhoneIds);
  const toAdd = nextMemberPhoneIds.filter((id) => !current.has(id));
  const toRemove = currentMemberPhoneIds.filter((id) => !next.has(id));

  if (toAdd.length > 0) {
    const rows = toAdd.map((phone_number_id) => ({
      number_group_id: groupId,
      phone_number_id,
    }));
    const { error } = await supabase.from("number_group_members").insert(rows);
    if (error) return { error: error.message };
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("number_group_members")
      .delete()
      .eq("number_group_id", groupId)
      .in("phone_number_id", toRemove);
    if (error) return { error: error.message };
  }

  return { error: null };
}
