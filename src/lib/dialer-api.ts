import { supabase } from "@/integrations/supabase/client";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export async function getCampaigns(organizationId: string | null = null) {
  let query = supabase
    .from("campaigns")
    .select("*")
    .eq("status", "Active");

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

const TERMINAL_STATUSES = ['DNC', 'Completed', 'Removed', 'Closed Won'];

export async function getCampaignLeads(campaignId: string, organizationId: string | null = null, limit = 100, offset = 0) {
  // Fetch campaign settings for maxAttempts and retryInterval logic
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("max_attempts, retry_interval_hours")
    .eq("id", campaignId)
    .maybeSingle();

  // Fix 2: NULL max_attempts means "Unlimited" — never block re-queuing
  const maxAttempts = campaign?.max_attempts ?? 9999;
  const retryIntervalHours = campaign?.retry_interval_hours ?? 0;

  // Fix 3: Query campaign_leads directly, filtering by both campaign_id and organization_id
  let query = supabase
    .from("campaign_leads")
    .select("*, lead:leads(*)")
    .eq("campaign_id", campaignId)
    .range(offset, offset + limit - 1);

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;

  // Fix 4: Log full error object before surfacing message
  if (error) {
    console.error("[getCampaignLeads] Supabase error:", error);
    throw new Error(error.message);
  }

  const now = new Date();

  // Fix 1: Exclude only terminal statuses. NULL / Pending / New / Queued / unrecognized → dialable.
  // For "Called" leads, still enforce maxAttempts + retryInterval.
  const dialable = ((data as any[]) ?? []).filter(row => {
    const status: string | null = row.status;

    if (status && TERMINAL_STATUSES.includes(status)) return false;

    if (status === 'Called') {
      if ((row.call_attempts ?? 0) >= maxAttempts) return false;
      if (retryIntervalHours > 0 && row.last_called_at) {
        const hoursSince = (now.getTime() - new Date(row.last_called_at).getTime()) / 3_600_000;
        if (hoursSince < retryIntervalHours) return false;
      }
    }

    return true;
  });

  // Flatten and map to the interface expected by the UI
  return dialable.map(row => {
    const { lead, ...campaignLead } = row;
    return {
      ...(lead || {}),
      ...campaignLead,
      state: campaignLead.state || lead?.state || "",
      id: campaignLead.id,
      lead_id: lead?.id || campaignLead.lead_id,
      // Pre-populate callback_due_at so the UI can show due callbacks
      callback_due_at: campaignLead.scheduled_callback_at
    };
  });
}

/** Per-table fetch cap; merged timeline keeps the most recent `TIMELINE_CAP` events. */
const HISTORY_PER_SOURCE_LIMIT = 80;
const HISTORY_TIMELINE_CAP = 100;

export async function getLeadHistory(leadId: string, organizationId: string | null = null, signal?: AbortSignal) {
  // Early exit if already aborted before queries fire
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  let callsQuery = supabase
    .from("calls")
    .select("id, created_at, started_at, disposition_name, duration")
    .eq("contact_id", leadId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_PER_SOURCE_LIMIT);

  let activityQuery = supabase
    .from("contact_activities")
    .select("id, created_at, activity_type, description")
    .eq("contact_id", leadId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_PER_SOURCE_LIMIT);

  if (organizationId) {
    callsQuery = callsQuery.eq("organization_id", organizationId);
    activityQuery = activityQuery.eq("organization_id", organizationId);
  }

  // Use Promise.all but respect the signal
  const [callsRes, activityRes] = await Promise.all([
    callsQuery,
    activityQuery,
  ]);

  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

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
  if (merged.length <= HISTORY_TIMELINE_CAP) return merged;
  return merged.slice(merged.length - HISTORY_TIMELINE_CAP);
}

/**
 * createCall — Creates a call record in the `calls` table.
 *
 * **IMPORTANT**: For the main dialer flow (DialerPage, FloatingDialer),
 * call creation is now consolidated into `TelnyxContext.makeCall` via
 * `MakeCallOptions`. This function is retained ONLY for the legacy
 * `AutoDialer.dialNext()` path and should NOT be used for new code.
 *
 * @see TelnyxContext.makeCall for the canonical single-entry-point call creation.
 */
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
