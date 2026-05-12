
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type MissedCallData = {
  id: string;
  contact_id: string | null;
  contact_type: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  organization_id: string | null;
  agent_id: string | null;
};

export async function insertMissedCallNotifications(
  supabase: SupabaseClient,
  call: MissedCallData,
): Promise<void> {
  if (!call.organization_id) {
    console.warn("[notifications] Cannot insert missed call notification: missing organization_id");
    return;
  }
  
  const orgId = call.organization_id;
  let recipientIds: string[] = [];

  // 1) Prefer the lead's assigned agent
  if (call.contact_id && (call.contact_type === "lead" || !call.contact_type)) {
    const { data: lead } = await supabase
      .from("leads")
      .select("assigned_agent_id")
      .eq("id", call.contact_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (lead?.assigned_agent_id) recipientIds.push(lead.assigned_agent_id);
  }

  // 2) Fall back to whatever agent owned the call row, if any
  if (recipientIds.length === 0 && call.agent_id) {
    recipientIds.push(call.agent_id);
  }

  // 3) Final fallback: org Admins + Team Leaders
  if (recipientIds.length === 0) {
    const { data: admins } = await supabase
      .from("profiles")
      .select("id")
      .eq("organization_id", orgId)
      .in("role", ["Admin", "Team Leader"]);
    if (admins) recipientIds = admins.map((a: { id: string }) => a.id);
  }

  if (recipientIds.length === 0) {
    console.warn("[notifications] No recipients found for missed call notification", { orgId });
    return;
  }

  const name =
    (call.contact_name && call.contact_name.trim()) ||
    (call.contact_phone && call.contact_phone.trim()) ||
    "Unknown caller";
  const phone = call.contact_phone || "";
  const body = phone
    ? `Missed call from ${name} (${phone})`
    : `Missed call from ${name}`;
  const actionUrl = call.contact_id ? `/contacts?id=${call.contact_id}` : null;

  const { data: existingNotif } = await supabase
    .from("notifications")
    .select("id")
    .eq("type", "missed_call")
    .contains("metadata", { call_id: call.id })
    .maybeSingle();

  if (existingNotif) {
    console.log(`[notifications] Notification already exists for call ${call.id}, skipping.`);
    return;
  }

  const rows = recipientIds.map((uid) => ({
    user_id: uid,
    type: "missed_call",
    title: "Missed Call",
    body,
    action_url: actionUrl,
    action_label: actionUrl ? "View Contact" : null,
    organization_id: orgId,
    metadata: { contact_id: call.contact_id, phone, call_id: call.id },
    read: false,
  }));

  const { error } = await supabase.from("notifications").insert(rows);
  if (error) {
    console.error(
      "[notifications] notifications insert failed:",
      error.message,
    );
  } else {
    console.log(`[notifications] Inserted ${rows.length} missed call notifications for call ${call.id}`);
  }
}
