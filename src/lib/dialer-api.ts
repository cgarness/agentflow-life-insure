import { persistAppointment, bookingTimes, type BookingPayload } from "@/lib/appointmentPersistence";
import { persistDisposition, type DispositionInput } from "@/lib/dialer-disposition";
import { supabase } from "@/integrations/supabase/client";
import { isCallsRowInboundDirection } from "@/lib/webrtcInboundCaller";
import { describeInboundCallOutcome } from "@/lib/inbound-call-labels";
import { localDateTimeToIso } from "@/lib/calendar/localDateTime";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Count outbound calls this agent placed on this campaign today (UTC calendar day). */
export async function getTodayCallCount(agentId: string, campaignId: string): Promise<number> {
  const now = new Date();
  const startUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const endUtc = new Date(startUtc);
  endUtc.setUTCDate(endUtc.getUTCDate() + 1);

  const { count, error } = await supabase
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agentId)
    .eq("campaign_id", campaignId)
    .gte("created_at", startUtc.toISOString())
    .lt("created_at", endUtc.toISOString());

  if (error) {
    console.error("[getTodayCallCount]", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function getContactCallStats(contactIds: string[]) {
  if (!contactIds || contactIds.length === 0) return {};
  
  const { data, error } = await supabase
    .from("calls")
    .select("contact_id, disposition_name, created_at")
    .in("contact_id", contactIds);

  if (error) {
    console.error("[getContactCallStats]", error.message);
    return {};
  }

  const result: Record<string, { calls_today: number; total_calls: number; last_disposition: string | null }> = {};
  for (const id of contactIds) {
    result[id] = { calls_today: 0, total_calls: 0, last_disposition: null };
  }

  if (data && data.length > 0) {
    const todayStr = new Date().toISOString().split("T")[0];
    
    // Sort array so newest is last
    data.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    
    data.forEach((row: any) => {
      const cid = row.contact_id;
      if (!result[cid]) return;
      
      result[cid].total_calls++;
      if (row.created_at && row.created_at.startsWith(todayStr)) {
        result[cid].calls_today++;
      }
      if (row.disposition_name) {
        result[cid].last_disposition = row.disposition_name;
      }
    });
  }
  
  return result;
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

/**
 * Campaign `max_attempts === null` means unlimited. When set, a row is over cap when
 * `call_attempts >= max_attempts` (same as UI: dial while `attempts < cap`).
 */
export function isOverCampaignAttemptCap(
  callAttempts: number | null | undefined,
  campaignMaxAttempts: number | null | undefined
): boolean {
  if (campaignMaxAttempts == null) return false;
  return (callAttempts ?? 0) >= campaignMaxAttempts;
}

export async function getCampaignLeads(campaignId: string, organizationId: string | null = null, limit = 100, offset = 0) {
  const { data, error } = await (supabase as any).rpc("get_personal_queue_leads", {
    p_campaign_id: campaignId, p_limit: limit, p_offset: offset,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error("Personal queue was not confirmed");
  // Queue eligibility comes exclusively from the RPC. Master details still use
  // the caller's existing RLS, preserving Personal contact visibility boundaries.
  const ids = [...new Set(data.map(row => row.lead_id).filter((id): id is string => typeof id === "string"))];
  if (!ids.length) return data;
  const { data: masters, error: masterError } = await supabase.from("leads").select("*").in("id", ids);
  if (masterError) throw new Error(masterError.message);
  const byId = new Map((masters ?? []).map(row => [row.id, row]));
  return data.map(row => {
    const master = byId.get(row.lead_id);
    return { ...master, ...row, state: row.state || master?.state || "" };
  });
}

/** Per-table fetch cap; merged timeline keeps the most recent `TIMELINE_CAP` events. */
const HISTORY_PER_SOURCE_LIMIT = 80;
const HISTORY_TIMELINE_CAP = 100;

export type GetLeadHistoryOptions = {
  signal?: AbortSignal;
  /** Include rows tied to this campaign_lead even if `contact_id` was null until wrap-up. */
  campaignLeadId?: string | null;
};

export async function getLeadHistory(
  leadId: string,
  organizationId: string | null = null,
  options?: GetLeadHistoryOptions
) {
  const { signal, campaignLeadId } = options ?? {};
  // Early exit if already aborted before queries fire
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  let callsQuery = supabase
    .from("calls")
    .select("id, created_at, started_at, direction, disposition_name, duration, recording_url, twilio_call_sid, is_missed, missed_reason, outcome, agent_id, answered_by_agent_id, voicemail_id");

  if (campaignLeadId) {
    callsQuery = callsQuery.or(
      `contact_id.eq.${leadId},campaign_lead_id.eq.${campaignLeadId}`
    );
  } else {
    callsQuery = callsQuery.eq("contact_id", leadId);
  }

  callsQuery = callsQuery
    .order("created_at", { ascending: false })
    .limit(HISTORY_PER_SOURCE_LIMIT);

  let activityQuery = supabase
    .from("contact_activities")
    .select("id, created_at, activity_type, description")
    .eq("contact_id", leadId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_PER_SOURCE_LIMIT);

  if (organizationId) {
    // Strict .eq(organization_id) hid legitimate rows: webhook/legacy calls with NULL org
    // still pass agent RLS (agent_id match) but failed this client-side filter.
    callsQuery = callsQuery.or(
      `organization_id.eq.${organizationId},organization_id.is.null`
    );
    activityQuery = activityQuery.eq("organization_id", organizationId);
  }

  const dispositionsPromise =
    organizationId != null && organizationId !== ""
      ? supabase.from("dispositions").select("name, color").eq("organization_id", organizationId)
      : Promise.resolve({ data: [] as { name: string; color: string }[] | null, error: null });

  const emailsQuery = supabase
    .from("contact_emails")
    .select("id, direction, subject, body_text, from_email, sent_at, received_at, created_at")
    .eq("contact_id", leadId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_PER_SOURCE_LIMIT);

  // Use Promise.all but respect the signal
  const [callsRes, activityRes, dispRes, emailsRes] = await Promise.all([
    callsQuery,
    activityQuery,
    dispositionsPromise,
    emailsQuery,
  ]);

  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  if (callsRes.error) throw new Error(callsRes.error.message);
  if (activityRes.error) throw new Error(activityRes.error.message);
  if (dispRes.error) throw new Error(dispRes.error.message);
  // email errors are non-fatal — degrade gracefully

  const dispositionColorByName: Record<string, string> = {};
  for (const row of dispRes.data ?? []) {
    if (row?.name) dispositionColorByName[row.name] = row.color;
  }

  const callItems = (callsRes.data ?? []).map((c) => {
    const raw = c as any;
    const hasRecording =
      (raw.recording_url && raw.recording_url !== '__recording_pending__') ||
      (raw.twilio_call_sid && (c.duration ?? 0) > 0) ||
      (raw.recording_url?.startsWith('storage:'));
    // Inbound Calling v2 / D13: an inbound row carries its outcome label ("Missed in AgentFlow — forwarded
    // to mobile", …) so the dialer timeline never presents a mobile conversation as an AgentFlow answer.
    const inboundOutcome = isCallsRowInboundDirection(c.direction) ? describeInboundCallOutcome(raw) : null;
    return {
      id: c.id,
      type: "call" as const,
      description: `${isCallsRowInboundDirection(c.direction) ? "Inbound" : "Outbound"} Call — ${formatDuration(c.duration ?? 0)}${
        inboundOutcome && inboundOutcome.tone !== "neutral" ? ` — ${inboundOutcome.label}` : ""
      }`,
      direction: isCallsRowInboundDirection(c.direction) ? "inbound" : "outbound",
      disposition: c.disposition_name,
      disposition_color: c.disposition_name ? dispositionColorByName[c.disposition_name] ?? null : null,
      created_at: c.created_at ?? c.started_at ?? new Date().toISOString(),
      recording_url: hasRecording ? "proxy" : null,
      duration: c.duration ?? null,
      subject: null as string | null,
      from_email: null as string | null,
      body: null as string | null,
    };
  });

  const activityItems = (activityRes.data ?? []).map((a) => ({
    id: a.id,
    type: a.activity_type,
    description: a.description,
    direction: "outbound" as const, // Activities are typically agent-created
    disposition: null as string | null,
    disposition_color: null as string | null,
    created_at: a.created_at,
    recording_url: null as string | null,
    duration: null as number | null,
    subject: null as string | null,
    from_email: null as string | null,
    body: null as string | null,
  }));

  const emailItems = (emailsRes.data ?? []).map((e) => ({
    id: e.id,
    type: "email" as const,
    description: e.subject || "(No subject)",
    direction: (e.direction === "inbound" ? "inbound" : "outbound") as "inbound" | "outbound",
    disposition: null as string | null,
    disposition_color: null as string | null,
    created_at: e.received_at || e.sent_at || e.created_at || new Date().toISOString(),
    recording_url: null as string | null,
    duration: null as number | null,
    subject: e.subject ?? null,
    from_email: e.from_email ?? null,
    body: e.body_text ?? null,
  }));

  const merged = [...callItems, ...activityItems, ...emailItems];
  merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  if (merged.length <= HISTORY_TIMELINE_CAP) return merged;
  return merged.slice(merged.length - HISTORY_TIMELINE_CAP);
}

/**
 * createCall — Creates a call record in the `calls` table.
 *
 * **IMPORTANT**: For the main dialer flow (DialerPage, FloatingDialer),
 * call creation is now consolidated into `TwilioContext.makeCall` via
 * `MakeCallOptions`. This function is retained ONLY for the legacy
 * `AutoDialer.dialNext()` path and should NOT be used for new code.
 *
 * @see TwilioContext.makeCall for the canonical single-entry-point call creation.
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
  disposition_id?: string | null; // UUID FK — preferred over name-string lookup
  notes: string;
  outcome: string;
  caller_id_used?: string;
  contact_type?: string;
  converted_client_id?: string;
  callback_due_at?: string | null;
  appointment?: BookingPayload | null;
}, organizationId: string | null = null) {
  if (!data.id || !data.disposition_id) throw new Error("A persisted call and disposition are required.");
  return persistDisposition({
    campaignLeadId: data.campaign_lead_id ?? null,
    callId: data.id,
    dispositionId: data.disposition_id,
    operationId: data.id,
    notes: data.notes,
    convertedClientId: data.converted_client_id ?? null,
    callbackDueAt: data.callback_due_at ?? null,
    appointment: data.appointment,
    callbackNote: data.notes,
    releaseLock: false,
  });
}

/** Typed adapter for the single server-authoritative disposition operation.
 * Returns persisted state or throws; never writes Twilio-owned telemetry.
 */
export async function advanceCampaignLead(params: DispositionInput) {
  return persistDisposition(params);
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


export async function saveAppointment(data: {
  request_id: string;
  master_lead_id: string; campaign_lead_id: string; agent_id: string; campaign_id: string;
  title: string; date: string; time: string; end_time: string; notes: string;
}, organizationId: string | null = null) {
  if (!organizationId) throw new Error("Missing booking organization");
  return persistAppointment(data.request_id, { title: data.title, contact_id: data.master_lead_id,
    user_id: data.agent_id, notes: data.notes, ...bookingTimes(data.date, data.time, data.end_time), status: "Scheduled" });
}
