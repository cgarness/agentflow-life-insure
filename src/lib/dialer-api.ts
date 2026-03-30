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

export async function getCampaignLeads(campaignId: string, organizationId: string | null = null, limit = 100, offset = 0) {
  // 1. Fetch campaign settings for multi-attempt logic
  let campaignQuery = supabase
    .from("campaigns")
    .select("max_attempts, retry_interval_hours")
    .eq("id", campaignId);

  if (organizationId) {
    campaignQuery = campaignQuery.eq("organization_id", organizationId);
  }

  const { data: campaign } = await campaignQuery.maybeSingle();

  const maxAttempts = campaign?.max_attempts ?? 1;
  const retryInterval = campaign?.retry_interval_hours ?? 0;

  // 2. Build the query
  // We want leads that are 'Queued' OR ('Called' AND attempts < max AND time passed)
  let query = supabase
    .from("campaign_leads")
    .select("*, lead:leads(*)")
    .eq("campaign_id", campaignId)
    .not("status", "in", '("DNC","Completed","Removed")') // Exclude terminal statuses
    .order("created_at", { ascending: true });

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);

  const now = new Date();

  // 3. Flatten and Filter by attempts/interval
  return (data ?? [])
    .map(row => {
      const { lead, ...campaignLead } = row;
      return {
        ...(lead || {}),
        ...campaignLead,
        state: campaignLead.state || lead?.state || "",
        id: campaignLead.id,
        lead_id: lead?.id || campaignLead.lead_id
      };
    })
    .filter(lead => {
      // If Queued, always include
      if (lead.status === "Queued") return true;
      
      // If Called, check attempts and interval
      if (lead.status === "Called") {
        const attempts = lead.call_attempts ?? 0;
        if (attempts >= maxAttempts) return false;

        if (retryInterval > 0 && lead.last_called_at) {
          const lastCalled = new Date(lead.last_called_at);
          const hoursSince = (now.getTime() - lastCalled.getTime()) / (1000 * 60 * 60);
          if (hoursSince < retryInterval) return false;
        }
        return true;
      }

      return false; // Other statuses like 'Locked', 'Claimed' might be handled differently
    });
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
  merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return merged;
}

export async function createCall(data: {
  contact_id: string;
  agent_id: string;
  campaign_id?: string;
  campaign_lead_id?: string;
  caller_id_used?: string;
  contact_name?: string;
  contact_phone?: string;
  contact_type?: string;
}, organizationId: string | null = null) {
  const { data: call, error } = await supabase
    .from("calls")
    .insert({
      contact_id: data.contact_id,
      campaign_lead_id: data.campaign_lead_id || null,
      agent_id: data.agent_id,
      campaign_id: data.campaign_id || null,
      caller_id_used: data.caller_id_used || null,
      contact_name: data.contact_name || null,
      contact_phone: data.contact_phone || null,
      contact_type: data.contact_type || null,
      direction: "outbound",
      status: "ringing",
      started_at: new Date().toISOString(),
      organization_id: organizationId,
    } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!call) throw new Error("createCall: insert returned no data");
  return call.id;
}

export async function saveCall(data: {
  id?: string; // Optional internal call UUID
  master_lead_id: string;
  campaign_lead_id?: string;
  agent_id: string;
  campaign_id?: string;
  duration_seconds: number;
  disposition: string;
  notes: string;
  outcome: string;
  caller_id_used?: string;
  contact_type?: string;
}, organizationId: string | null = null) {
  const callPayload = {
    contact_id: data.master_lead_id,
    campaign_lead_id: data.campaign_lead_id || null,
    agent_id: data.agent_id,
    campaign_id: data.campaign_id || null,
    duration: data.duration_seconds,
    disposition_name: data.disposition,
    notes: data.notes,
    outcome: data.outcome,
    direction: "outbound",
    caller_id_used: data.caller_id_used || null,
    status: "completed",
    ended_at: new Date().toISOString(),
    contact_type: data.contact_type || null,
    organization_id: organizationId,
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  let error;
  if (data.id) {
    // Upsert if ID is provided
    const { error: upsertError } = await supabase
      .from("calls")
      .upsert({ id: data.id, ...callPayload }, { onConflict: "id" });
    error = upsertError;
  } else {
    // Otherwise insert new
    const { error: insertError } = await supabase
      .from("calls")
      .insert(callPayload);
    error = insertError;
  }

  if (error) throw new Error(error.message);

  // 2. Increment call_attempts and update last_called_at on campaign_leads
  if (data.campaign_lead_id) {
    const { data: current } = await supabase
      .from("campaign_leads")
      .select("call_attempts")
      .eq("id", data.campaign_lead_id)
      .maybeSingle();

    await supabase
      .from("campaign_leads")
      .update({ 
        call_attempts: (current?.call_attempts ?? 0) + 1,
        last_called_at: new Date().toISOString()
      } as any)
      .eq("id", data.campaign_lead_id);
  }

  const { error: actError } = await supabase.from("contact_activities").insert({
    contact_id: data.master_lead_id,
    agent_id: data.agent_id,
    activity_type: "call",
    description: `Call — ${data.disposition} — ${formatDuration(data.duration_seconds)}`,
    organization_id: organizationId,
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (actError) throw new Error(actError.message);
}

export async function saveNote(data: {
  master_lead_id: string;
  agent_id: string;
  content: string;
}, organizationId: string | null = null) {
  const { error } = await supabase.from("contact_activities").insert({
    contact_id: data.master_lead_id,
    agent_id: data.agent_id,
    activity_type: "note",
    description: data.content,
    organization_id: organizationId,
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (error) throw new Error(error.message);
}

export async function updateLeadStatus(campaignLeadId: string, masterLeadId: string, status: string, organizationId: string | null = null) {
  const validCampaignStatuses = ["Queued", "Locked", "Claimed", "Called", "Skipped", "Completed", "Failed", "DNC"];
  const campaignStatus = validCampaignStatuses.includes(status) ? status : "Called";

  const { error: updateError } = await supabase
    .from("campaign_leads")
    .update({ 
      status: campaignStatus,
      disposition: status
    } as any)
    .eq("id", campaignLeadId);
  if (updateError) throw new Error(updateError.message);

  // 3. Log activity on master record
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error: actError } = await supabase.from("contact_activities").insert({
    contact_id: masterLeadId,
    agent_id: user?.id ?? null,
    activity_type: "status",
    description: `Status changed to ${status}`,
    organization_id: organizationId,
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (actError) throw new Error(actError.message);
}

export async function saveAppointment(data: {
  master_lead_id: string;
  campaign_lead_id: string;
  agent_id: string;
  campaign_id: string;
  title: string;
  date: string;
  time: string;
  end_time: string;
  notes: string;
}, organizationId: string | null = null) {
  const startTime = `${data.date}T${convertTo24h(data.time)}`;
  const endTime = data.end_time
    ? `${data.date}T${convertTo24h(data.end_time)}`
    : null;

  const { error: aptError } = await supabase.from("appointments").insert({
    contact_id: data.master_lead_id,
    user_id: data.agent_id,
    title: data.title,
    start_time: startTime,
    end_time: endTime,
    notes: data.notes,
    status: "Scheduled",
    organization_id: organizationId,
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (aptError) throw new Error(aptError.message);

  const { error: actError } = await supabase.from("contact_activities").insert({
    contact_id: data.master_lead_id,
    agent_id: data.agent_id,
    activity_type: "status",
    description: "Appointment scheduled",
    organization_id: organizationId,
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
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
