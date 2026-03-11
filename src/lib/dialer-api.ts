import { supabase } from "@/integrations/supabase/client";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export async function getCampaigns() {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("status", "Active");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getCampaignLeads(campaignId: string) {
  const { data, error } = await supabase
    .from("campaign_leads")
    .select("*")
    .eq("campaign_id", campaignId)
    .not("status", "in", '("Called","DNC")')
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getLeadHistory(leadId: string) {
  const [callsRes, activityRes] = await Promise.all([
    supabase
      .from("calls")
      .select("*")
      .eq("contact_id", leadId),
    supabase
      .from("contact_activities")
      .select("*")
      .eq("contact_id", leadId),
  ]);

  if (callsRes.error) throw new Error(callsRes.error.message);
  if (activityRes.error) throw new Error(activityRes.error.message);

  const callItems = (callsRes.data ?? []).map((c) => ({
    id: c.id,
    type: "call" as const,
    description: `Call — ${c.disposition_name ?? "Unknown"} — ${formatDuration(c.duration ?? 0)}`,
    disposition: c.disposition_name,
    disposition_color: null as string | null,
    created_at: c.created_at ?? c.started_at ?? new Date().toISOString(),
  }));

  const activityItems = (activityRes.data ?? []).map((a) => ({
    id: a.id,
    type: a.activity_type,
    description: a.description,
    disposition: null as string | null,
    disposition_color: null as string | null,
    created_at: a.created_at,
  }));

  const merged = [...callItems, ...activityItems];
  merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return merged;
}

export async function saveCall(data: {
  lead_id: string;
  agent_id: string;
  campaign_id: string;
  duration_seconds: number;
  disposition: string;
  disposition_color: string;
  notes: string;
  outcome: string;
}) {
  const { error: callError } = await supabase.from("calls").insert({
    contact_id: data.lead_id,
    agent_id: data.agent_id,
    campaign_id: data.campaign_id,
    duration: data.duration_seconds,
    disposition_name: data.disposition,
    notes: data.notes,
    outcome: data.outcome,
    direction: "outbound",
  });
  if (callError) throw new Error(callError.message);

  const { error: actError } = await supabase.from("contact_activities").insert({
    contact_id: data.lead_id,
    agent_id: data.agent_id,
    activity_type: "call",
    description: `Call — ${data.disposition} — ${formatDuration(data.duration_seconds)}`,
  });
  if (actError) throw new Error(actError.message);
}

export async function saveNote(data: {
  lead_id: string;
  agent_id: string;
  content: string;
}) {
  const { error } = await supabase.from("contact_activities").insert({
    contact_id: data.lead_id,
    agent_id: data.agent_id,
    activity_type: "note",
    description: data.content,
  });
  if (error) throw new Error(error.message);
}

export async function updateLeadStatus(leadId: string, status: string) {
  const { error: updateError } = await supabase
    .from("campaign_leads")
    .update({ status })
    .eq("id", leadId);
  if (updateError) throw new Error(updateError.message);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error: actError } = await supabase.from("contact_activities").insert({
    contact_id: leadId,
    agent_id: user?.id ?? null,
    activity_type: "status",
    description: `Status changed to ${status}`,
  });
  if (actError) throw new Error(actError.message);
}

export async function saveAppointment(data: {
  lead_id: string;
  agent_id: string;
  campaign_id: string;
  title: string;
  date: string;
  time: string;
  end_time: string;
  notes: string;
}) {
  const startTime = `${data.date}T${convertTo24h(data.time)}`;
  const endTime = data.end_time
    ? `${data.date}T${convertTo24h(data.end_time)}`
    : null;

  const { error: aptError } = await supabase.from("appointments").insert({
    contact_id: data.lead_id,
    user_id: data.agent_id,
    title: data.title,
    start_time: startTime,
    end_time: endTime,
    notes: data.notes,
    status: "Scheduled",
  });
  if (aptError) throw new Error(aptError.message);

  const { error: actError } = await supabase.from("contact_activities").insert({
    contact_id: data.lead_id,
    agent_id: data.agent_id,
    activity_type: "status",
    description: "Appointment scheduled",
  });
  if (actError) throw new Error(actError.message);
}

/** Convert "2:30 PM" style time to "14:30:00" for timestamp construction */
function convertTo24h(timeStr: string): string {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return timeStr; // already 24h or unparseable
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = match[3]?.toUpperCase();
  if (period === "PM" && hours < 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return `${hours.toString().padStart(2, "0")}:${minutes}:00`;
}
