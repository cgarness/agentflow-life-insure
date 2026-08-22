import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { insertMissedCallNotifications } from "../_shared/notifications.ts";
import {
  buildClientDialTwiml,
  buildForwardTwiml,
  buildHangupTwiml,
  buildVoicemailTwiml,
  clampRingTimeout,
  resolveTerminalAction,
} from "./twiml.ts";
import {
  EMPTY_RING_TARGETS,
  RingTargets,
  buildWavePlan,
  excludeAlreadyRoutedAgents,
  filterActiveRingTargets,
  isAnsweredDialStatus,
  shouldMarkMissedOnDialReturn,
  validateAssignedProfile,
} from "./routing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const twimlHeaders = { ...corsHeaders, "Content-Type": "text/xml" };

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

const UNCONFIGURED_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  "<Response>" +
  '<Say voice="Polly.Joanna">We&apos;re sorry, this number is not configured. Goodbye.</Say>' +
  "<Hangup/>" +
  "</Response>";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function supabasePublicOrigin(): string {
  return (Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
}

function edgeFunctionAbsoluteUrl(req: Request, slug: string): string {
  const origin = supabasePublicOrigin();
  const search = new URL(req.url).search;
  return `${origin}/functions/v1/${slug}${search}`;
}

async function validateTwilioSignature(
  req: Request,
  authToken: string,
  params: Record<string, string>,
): Promise<boolean> {
  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return false;

  const fullUrl = edgeFunctionAbsoluteUrl(req, "twilio-voice-inbound");

  const sortedKeys = Object.keys(params).sort();
  let signingString = fullUrl;
  for (const k of sortedKeys) signingString += k + params[k];

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingString),
  );
  const expected = bytesToBase64(new Uint8Array(sig));
  return timingSafeEqual(expected, signature);
}

async function parseFormBody(req: Request): Promise<Record<string, string>> {
  const raw = await req.text();
  const params: Record<string, string> = {};
  const search = new URLSearchParams(raw);
  for (const [k, v] of search.entries()) params[k] = v;
  return params;
}

function selfUrl(query: Record<string, string>): string {
  const qs = new URLSearchParams(query).toString();
  return `${supabasePublicOrigin()}/functions/v1/twilio-voice-inbound${qs ? `?${qs}` : ""}`;
}

function recordingStatusUrl(): string {
  return `${supabasePublicOrigin()}/functions/v1/twilio-recording-status`;
}

function claimCallbackBaseUrl(): string {
  return `${supabasePublicOrigin()}/functions/v1/inbound-call-claim`;
}

function digitsOnly(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

function last10(raw: string): string | null {
  const d = digitsOnly(raw);
  return d.length >= 10 ? d.slice(-10) : null;
}

function buildPhoneCandidates(raw: string): string[] {
  const out = new Set<string>();
  const trimmed = (raw || "").trim();
  if (!trimmed) return [];
  out.add(trimmed);
  const d = digitsOnly(trimmed);
  if (d.length === 10) {
    out.add(`+1${d}`);
    out.add(`1${d}`);
    out.add(d);
  } else if (d.length === 11 && d.startsWith("1")) {
    out.add(`+${d}`);
    out.add(d);
    out.add(d.slice(1));
    out.add(`+1${d.slice(1)}`);
  } else if (d.length > 0) {
    out.add(`+${d}`);
  }
  return [...out];
}

async function resolvePhoneNumberRow(
  supabase: SupabaseClient,
  toNumber: string,
): Promise<{ id: string; organization_id: string | null; assigned_to: string | null; is_direct_line: boolean | null } | null> {
  for (const cand of buildPhoneCandidates(toNumber)) {
    const { data, error } = await supabase
      .from("phone_numbers")
      .select("id, organization_id, assigned_to, is_direct_line")
      .eq("phone_number", cand)
      .maybeSingle();
    if (error) {
      console.warn(
        "[twilio-voice-inbound] phone_numbers lookup error:",
        cand,
        error.message,
      );
      continue;
    }
    if (data) return data as { id: string; organization_id: string | null; assigned_to: string | null; is_direct_line: boolean | null };
  }
  return null;
}

// ── Canonical ingest (plan rev5 §3.1.4): identity resolution + idempotency live in SQL ──────────────

interface IngestResult {
  call_row_id: string | null;
  inserted: boolean;
  resolution: string | null;
  contact_id: string | null;
  contact_type: string | null;
  contact_name: string | null;
  error?: string;
}

async function ingestInboundCall(
  supabase: SupabaseClient,
  callSid: string,
  organizationId: string,
  fromNumber: string,
  toNumber: string,
  autoCreate: boolean,
): Promise<IngestResult | null> {
  try {
    const { data, error } = await supabase.rpc("ingest_inbound_call", {
      p_twilio_call_sid: callSid,
      p_org_id: organizationId,
      p_from_number: fromNumber,
      p_to_number: toNumber,
      p_auto_create: autoCreate,
    });
    if (error) {
      console.error("[twilio-voice-inbound] ingest_inbound_call failed:", error.message);
      return null;
    }
    return (data ?? null) as IngestResult | null;
  } catch (err) {
    console.error("[twilio-voice-inbound] ingest_inbound_call threw:", err);
    return null;
  }
}

async function checkBusinessHours(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ isOpen: boolean; afterHoursSms: string | null }> {
  try {
    const { data: company } = await supabase
      .from("company_settings")
      .select("timezone")
      .eq("organization_id", organizationId)
      .maybeSingle();

    const timezone = company?.timezone || "UTC";

    const now = new Date();
    const longFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' });
    const weekdayLong = longFormatter.format(now);
    const dayMap: Record<string, number> = {
      "Sunday": 0, "Monday": 1, "Tuesday": 2, "Wednesday": 3, "Thursday": 4, "Friday": 5, "Saturday": 6
    };
    const dayOfWeek = dayMap[weekdayLong] ?? 0;

    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = timeFormatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || "0", 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || "0", 10);

    const { data: hours } = await supabase
      .from("business_hours")
      .select("is_open, open_time, close_time")
      .eq("organization_id", organizationId)
      .eq("day_of_week", dayOfWeek)
      .maybeSingle();

    if (!hours || !hours.is_open) return { isOpen: false, afterHoursSms: null };

    const currentTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`;
    const isOpen = currentTime >= (hours.open_time || "00:00:00") && currentTime <= (hours.close_time || "23:59:59");

    if (!isOpen) {
       const { data: settings } = await supabase
        .from("inbound_routing_settings")
        .select("after_hours_sms_enabled, after_hours_sms")
        .eq("organization_id", organizationId)
        .maybeSingle();

       if (settings?.after_hours_sms_enabled && settings.after_hours_sms) {
         return { isOpen: false, afterHoursSms: settings.after_hours_sms };
       }
    }

    return { isOpen, afterHoursSms: null };
  } catch (err) {
    console.error("[twilio-voice-inbound] business hours check failed:", err);
    return { isOpen: true, afterHoursSms: null }; // Default to open on error
  }
}

async function sendAfterHoursSms(
  supabase: SupabaseClient,
  organizationId: string,
  fromNumber: string,
  toNumber: string,
  message: string
) {
  try {
    await supabase.functions.invoke("twilio-sms", {
      body: {
        to: fromNumber,
        from: toNumber,
        body: message,
        organization_id: organizationId
      }
    });
    console.log("[twilio-voice-inbound] After-hours SMS sent to", fromNumber);
  } catch (err) {
    console.error("[twilio-voice-inbound] Failed to send after-hours SMS:", err);
  }
}

interface PhoneSettings {
  recording_enabled: boolean;
  voicemail_enabled: boolean;
  inbound_routing: string;
  fallback_action: string;
  voicemail_greeting_text: string;
  voicemail_greeting_url: string;
  forwarding_number: string;
  auto_create_lead: boolean;
  ring_timeout: number;
}

async function loadPhoneSettings(
  supabase: SupabaseClient,
  organizationId: string | null,
  phoneNumberId?: string | null,
): Promise<PhoneSettings> {
  const defaults: PhoneSettings = {
    recording_enabled: true,
    voicemail_enabled: true,
    inbound_routing: "assigned",
    fallback_action: "voicemail",
    voicemail_greeting_text: "Thank you for calling. No one is available to take your call right now. Please leave a message after the tone and we will return your call as soon as possible.",
    voicemail_greeting_url: "",
    forwarding_number: "",
    auto_create_lead: false,
    ring_timeout: 30,
  };
  if (!organizationId) return defaults;

  let numberOverrides: any = null;
  if (phoneNumberId) {
    try {
      const { data } = await supabase
        .from("phone_numbers")
        .select("inbound_routing_mode, voicemail_enabled, fallback_action, voicemail_greeting_text, voicemail_greeting_url, forwarding_number")
        .eq("id", phoneNumberId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (data) numberOverrides = data;
    } catch (err) {
      console.warn("[twilio-voice-inbound] phone_numbers override check failed:", err);
    }
  }

  let recording_enabled = true;
  let ring_timeout = defaults.ring_timeout;
  try {
    const { data } = await supabase
      .from("phone_settings")
      .select("recording_enabled, ring_timeout")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (data && data.recording_enabled !== null) {
      recording_enabled = data.recording_enabled;
    }
    // T19: honor phone_settings.ring_timeout on inbound (no per-number override column exists — §1.6)
    ring_timeout = clampRingTimeout((data as { ring_timeout?: number | null } | null)?.ring_timeout ?? null);
  } catch (_err) { /* defaults hold */ }

  let orgData: any = null;
  try {
    const { data, error } = await supabase
      .from("inbound_routing_settings")
      .select("routing_mode, fallback_action, voicemail_enabled, voicemail_greeting_text, voicemail_greeting_url, forwarding_number, auto_create_lead")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!error && data) {
      orgData = data;
    }
  } catch (err) {
    console.warn("[twilio-voice-inbound] inbound_routing_settings select threw:", err);
  }

  return {
    recording_enabled: recording_enabled,
    voicemail_enabled: numberOverrides?.voicemail_enabled ?? orgData?.voicemail_enabled ?? true,
    inbound_routing: numberOverrides?.inbound_routing_mode || orgData?.routing_mode || defaults.inbound_routing,
    fallback_action: numberOverrides?.fallback_action || orgData?.fallback_action || defaults.fallback_action,
    voicemail_greeting_text: numberOverrides?.voicemail_greeting_text || orgData?.voicemail_greeting_text || defaults.voicemail_greeting_text,
    voicemail_greeting_url: numberOverrides?.voicemail_greeting_url || orgData?.voicemail_greeting_url || defaults.voicemail_greeting_url,
    forwarding_number: numberOverrides?.forwarding_number || orgData?.forwarding_number || defaults.forwarding_number,
    auto_create_lead: orgData?.auto_create_lead ?? defaults.auto_create_lead,
    ring_timeout,
  };
}

// ── Ring-target resolution (T17/T18: same-org + Active + identity, uniformly) ───────────────────────

async function resolveAssignedTarget(
  supabase: SupabaseClient,
  assignedTo: string | null,
  organizationId: string,
): Promise<RingTargets> {
  if (!assignedTo) return EMPTY_RING_TARGETS;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, organization_id, status, twilio_client_identity")
    .eq("id", assignedTo)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    console.warn("[twilio-voice-inbound] profiles lookup (assigned) failed:", error.message);
    return EMPTY_RING_TARGETS;
  }
  const ident = validateAssignedProfile(data as never, organizationId);
  return ident && data
    ? { identities: [ident], agentIds: [(data as { id: string }).id] }
    : EMPTY_RING_TARGETS;
}

/**
 * R14: persist the exact wave BEFORE ringing it. append_call_routed_agents must succeed (true) or the
 * wave is suppressed and the caller takes the deterministic safe fallback. Never best-effort.
 */
async function persistRoutedAgents(
  supabase: SupabaseClient,
  callRowId: string,
  organizationId: string,
  agentIds: string[],
): Promise<boolean> {
  const unique = [...new Set(agentIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (!callRowId || !organizationId || unique.length === 0) return false;
  try {
    const { data, error } = await supabase.rpc("append_call_routed_agents", {
      p_call_id: callRowId,
      p_org_id: organizationId,
      p_agent_ids: unique,
    });
    if (error) {
      console.error("[twilio-voice-inbound] routed-persist FAILED (rpc error):", error.message);
      return false;
    }
    return data === true;
  } catch (err) {
    console.error("[twilio-voice-inbound] routed-persist FAILED (threw):", err);
    return false;
  }
}

async function resolveAllOrgIdentities(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<RingTargets> {
  // D8: all-ring now requires status='Active' (supersedes the 2026-05-19 scope freeze by approval).
  const { data, error } = await supabase
    .from("profiles")
    .select("id, organization_id, status, twilio_client_identity")
    .eq("organization_id", organizationId)
    .eq("status", "Active")
    .not("twilio_client_identity", "is", null);
  if (error) {
    console.warn("[twilio-voice-inbound] profiles lookup (all-ring) failed:", error.message);
    return EMPTY_RING_TARGETS;
  }
  return filterActiveRingTargets(data as never, organizationId);
}

const DEFAULT_FALLBACK_CHAIN: string[] = ["last_agent", "campaign_agents", "all_available"];
const VALID_TIERS = new Set(["last_agent", "campaign_agents", "state_licensed", "all_available"]);

async function loadFallbackChain(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("inbound_routing_settings")
      .select("inbound_fallback_chain")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error || !data) return [...DEFAULT_FALLBACK_CHAIN];
    const raw = (data as { inbound_fallback_chain: unknown }).inbound_fallback_chain;
    if (!Array.isArray(raw)) return [...DEFAULT_FALLBACK_CHAIN];
    const out: string[] = [];
    for (const v of raw) {
      if (typeof v === "string" && VALID_TIERS.has(v) && !out.includes(v)) out.push(v);
    }
    return out;
  } catch (err) {
    console.warn("[twilio-voice-inbound] loadFallbackChain failed:", err);
    return [...DEFAULT_FALLBACK_CHAIN];
  }
}

async function resolveActiveRingTargetsByAgentIds(
  supabase: SupabaseClient,
  agentIds: string[],
  organizationId: string,
): Promise<RingTargets> {
  if (agentIds.length === 0) return EMPTY_RING_TARGETS;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, organization_id, status, twilio_client_identity")
    .in("id", agentIds)
    .eq("organization_id", organizationId)   // defense in depth for tier-collected ids (§5.4)
    .eq("status", "Active")
    .not("twilio_client_identity", "is", null);
  if (error) {
    console.warn("[twilio-voice-inbound] resolveActiveRingTargetsByAgentIds failed:", error.message);
    return EMPTY_RING_TARGETS;
  }
  return filterActiveRingTargets(data as never, organizationId);
}

/**
 * R10/R18 last_agent tier: two-stage lookup via the canonical RPC — contact_id first, then normalized
 * contact_phone; caller_id_used is never consulted. The inbound row's resolved contact_id (if any) is
 * read from the call row itself.
 */
async function resolveLastAgentIdentities(
  supabase: SupabaseClient,
  organizationId: string,
  callRowId: string,
  fromNumber: string,
): Promise<RingTargets> {
  let contactId: string | null = null;
  if (callRowId) {
    const { data } = await supabase
      .from("calls")
      .select("contact_id")
      .eq("id", callRowId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    contactId = (data as { contact_id: string | null } | null)?.contact_id ?? null;
  }
  const l10 = last10(fromNumber);
  if (!contactId && !l10) return EMPTY_RING_TARGETS;
  try {
    const { data, error } = await supabase.rpc("find_last_agent_for_inbound", {
      p_org_id: organizationId,
      p_contact_id: contactId,
      p_last10: l10,
    });
    if (error) {
      console.warn("[twilio-voice-inbound] find_last_agent_for_inbound failed:", error.message);
      return EMPTY_RING_TARGETS;
    }
    const agentId = (data ?? null) as string | null;
    if (!agentId) return EMPTY_RING_TARGETS;
    return await resolveActiveRingTargetsByAgentIds(supabase, [agentId], organizationId);
  } catch (err) {
    console.warn("[twilio-voice-inbound] find_last_agent_for_inbound threw:", err);
    return EMPTY_RING_TARGETS;
  }
}

async function resolveCampaignAgentIdentities(
  supabase: SupabaseClient,
  organizationId: string,
  phoneNumberId: string,
): Promise<RingTargets> {
  if (!phoneNumberId) return EMPTY_RING_TARGETS;
  const { data: members, error: mErr } = await supabase
    .from("number_group_members")
    .select("number_group_id")
    .eq("phone_number_id", phoneNumberId);
  if (mErr) {
    console.warn("[twilio-voice-inbound] campaign tier: members lookup failed:", mErr.message);
    return EMPTY_RING_TARGETS;
  }
  const groupIds = ((members || []) as Array<{ number_group_id: string }>).map((m) => m.number_group_id);
  if (groupIds.length === 0) return EMPTY_RING_TARGETS;

  const { data: campaigns, error: cErr } = await supabase
    .from("campaigns")
    .select("assigned_agent_ids")
    .in("number_group_id", groupIds)
    .eq("status", "Active")
    .eq("organization_id", organizationId);
  if (cErr) {
    console.warn("[twilio-voice-inbound] campaign tier: campaigns lookup failed:", cErr.message);
    return EMPTY_RING_TARGETS;
  }
  const agentIds = new Set<string>();
  for (const c of (campaigns || []) as Array<{ assigned_agent_ids: unknown }>) {
    const arr = Array.isArray(c.assigned_agent_ids) ? c.assigned_agent_ids : [];
    for (const id of arr) {
      if (typeof id === "string" && id.length > 0) agentIds.add(id);
    }
  }
  return await resolveActiveRingTargetsByAgentIds(supabase, [...agentIds], organizationId);
}

async function resolveStateLicensedIdentities(
  supabase: SupabaseClient,
  organizationId: string,
  fromNumber: string,
): Promise<RingTargets> {
  if (!fromNumber) return EMPTY_RING_TARGETS;
  const l10 = last10(fromNumber);
  const areaCode = l10 ? l10.slice(0, 3) : "";
  if (!areaCode) return EMPTY_RING_TARGETS;

  const { data: ac, error: acErr } = await supabase
    .from("area_code_mapping")
    .select("state")
    .eq("area_code", areaCode)
    .maybeSingle();
  if (acErr) {
    console.warn("[twilio-voice-inbound] state tier: area_code lookup failed:", acErr.message);
    return EMPTY_RING_TARGETS;
  }
  const state = (ac as { state: string | null } | null)?.state;
  if (!state) return EMPTY_RING_TARGETS;

  const today = new Date().toISOString().slice(0, 10);
  const { data: licenses, error: lErr } = await supabase
    .from("agent_state_licenses")
    .select("agent_id, expiration_date")
    .eq("organization_id", organizationId)
    .eq("state", state);
  if (lErr) {
    console.warn("[twilio-voice-inbound] state tier: licenses lookup failed:", lErr.message);
    return EMPTY_RING_TARGETS;
  }
  const valid = ((licenses || []) as Array<{ agent_id: string; expiration_date: string | null }>)
    .filter((l) => !l.expiration_date || l.expiration_date >= today)
    .map((l) => l.agent_id);
  return await resolveActiveRingTargetsByAgentIds(supabase, valid, organizationId);
}

async function resolveAllAvailableIdentities(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<RingTargets> {
  return await resolveAllOrgIdentities(supabase, organizationId);
}

interface TierContext {
  supabase: SupabaseClient;
  organizationId: string;
  phoneNumberId: string;
  fromNumber: string;
  callRowId: string;
}

async function resolveTier(tierKey: string, ctx: TierContext): Promise<RingTargets> {
  switch (tierKey) {
    case "last_agent":
      return await resolveLastAgentIdentities(ctx.supabase, ctx.organizationId, ctx.callRowId, ctx.fromNumber);
    case "campaign_agents":
      return await resolveCampaignAgentIdentities(ctx.supabase, ctx.organizationId, ctx.phoneNumberId);
    case "state_licensed":
      return await resolveStateLicensedIdentities(ctx.supabase, ctx.organizationId, ctx.fromNumber);
    case "all_available":
      return await resolveAllAvailableIdentities(ctx.supabase, ctx.organizationId);
    default:
      return EMPTY_RING_TARGETS;
  }
}

async function resolveRoundRobinAgent(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<RingTargets> {
  const active = await resolveAllOrgIdentities(supabase, organizationId);
  if (active.agentIds.length === 0) return EMPTY_RING_TARGETS;

  const { data: latest, error: callsErr } = await supabase
    .from("calls")
    .select("agent_id, created_at")
    .eq("organization_id", organizationId)
    .in("direction", ["inbound", "incoming"])
    .in("agent_id", active.agentIds)
    .order("created_at", { ascending: false });
  if (callsErr) {
    console.warn("[twilio-voice-inbound] round_robin calls lookup failed:", callsErr.message);
  }
  const latestByAgent = new Map<string, string>();
  for (const row of (latest || []) as Array<{ agent_id: string | null; created_at: string }>) {
    if (row.agent_id && !latestByAgent.has(row.agent_id)) {
      latestByAgent.set(row.agent_id, row.created_at);
    }
  }
  const order = active.agentIds
    .map((id, i) => ({ id, identity: active.identities[i], last: latestByAgent.get(id) ?? null }))
    .sort((a, b) => {
      if (a.last === null && b.last === null) return 0;
      if (a.last === null) return -1;
      if (b.last === null) return 1;
      return a.last < b.last ? -1 : a.last > b.last ? 1 : 0;
    });
  const picked = order[0];
  console.log(`[round_robin] Selected agent ${picked.id} (last inbound: ${picked.last || "never"})`);
  return { identities: [picked.identity], agentIds: [picked.id] };
}

// ── Lifecycle: missed-marking + observable, retried terminal finalization (R17/§6.2/§6.4) ───────────

async function markMissedAndNotify(
  supabase: SupabaseClient,
  callRowId: string,
  organizationId: string,
): Promise<void> {
  if (!callRowId || !organizationId) return;
  try {
    const { data: callRow, error } = await supabase
      .from("calls")
      .update({ is_missed: true, updated_at: new Date().toISOString() })
      .eq("id", callRowId)
      .eq("organization_id", organizationId)
      .select("id, contact_id, contact_type, contact_name, contact_phone, organization_id, agent_id, caller_id_used, routed_agent_ids")
      .maybeSingle();
    if (error) {
      console.error("[twilio-voice-inbound] mark-missed failed:", error.message);
      return;
    }
    if (callRow) {
      await insertMissedCallNotifications(supabase, callRow as never);
    }
  } catch (err) {
    console.error("[twilio-voice-inbound] mark-missed/notify threw:", err);
  }
}

/**
 * R17: terminal finalization is never best-effort-swallowed. Bounded in-request retries (the TwiML
 * response does not depend on the result), 'already_terminal' is idempotent success, and ultimate
 * failure emits structured actionable telemetry. The parent status callback remains the second,
 * independent terminal writer.
 */
async function finalizeTerminalWithRetry(
  supabase: SupabaseClient,
  callRowId: string,
  organizationId: string,
  status: "completed" | "no-answer" | "failed",
  markMissed: boolean,
): Promise<boolean> {
  if (!callRowId || !organizationId) return false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data, error } = await supabase.rpc("finalize_inbound_call_terminal", {
        p_call_row_id: callRowId,
        p_org_id: organizationId,
        p_status: status,
        p_mark_missed: markMissed,
      });
      if (!error && data && typeof data === "object") {
        const d = data as { updated?: boolean; reason?: string };
        if (d.updated === true || d.reason === "already_terminal") return true;
        console.warn("[twilio-voice-inbound] finalize attempt rejected:", { attempt, callRowId, reason: d.reason });
      } else if (error) {
        console.warn("[twilio-voice-inbound] finalize attempt errored:", { attempt, callRowId, message: error.message });
      }
    } catch (err) {
      console.warn("[twilio-voice-inbound] finalize attempt threw:", { attempt, callRowId, err });
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 150 * attempt));
  }
  console.error("[twilio-voice-inbound] TERMINAL-FINALIZE FAILED", {
    callRowId, organizationId, targetStatus: status, markMissed,
  });
  return false;
}

// ── Terminal fallback emission (§6.4: missed only after the FINAL attempt fails) ────────────────────

async function emitTerminalFallback(
  supabase: SupabaseClient,
  callRowId: string,
  orgId: string,
  phoneNumberId: string,
  opts: { alreadyForwarded: boolean },
): Promise<Response> {
  const settings = await loadPhoneSettings(supabase, orgId || null, phoneNumberId || null);
  const action = resolveTerminalAction({
    fallbackAction: settings.fallback_action,
    voicemailEnabled: settings.voicemail_enabled,
    forwardingNumber: settings.forwarding_number,
    alreadyForwarded: opts.alreadyForwarded,
  });

  if (action === "forward") {
    // §6.4: do NOT mark missed before the forwarding attempt finishes — the return leg decides.
    const nextActionUrl = selfUrl({
      fallback: "voicemail",
      forwarded: "1",
      ...(callRowId ? { call_row_id: callRowId } : {}),
      ...(orgId ? { org_id: orgId } : {}),
      ...(phoneNumberId ? { phone_number_id: phoneNumberId } : {}),
    });
    return new Response(buildForwardTwiml(settings.forwarding_number, nextActionUrl), {
      status: 200, headers: twimlHeaders,
    });
  }

  if (action === "voicemail") {
    // All agent/forward attempts have failed: entering voicemail IS the missed moment.
    await markMissedAndNotify(supabase, callRowId, orgId);
    const hangupUrl = selfUrl({
      fallback: "hangup",
      ...(callRowId ? { call_row_id: callRowId } : {}),
      ...(orgId ? { org_id: orgId } : {}),
      ...(phoneNumberId ? { phone_number_id: phoneNumberId } : {}),
    });
    return new Response(
      buildVoicemailTwiml(recordingStatusUrl(), hangupUrl, settings.voicemail_greeting_text, settings.voicemail_greeting_url),
      { status: 200, headers: twimlHeaders },
    );
  }

  // hangup terminal (incl. T20: voicemail requested but disabled)
  await markMissedAndNotify(supabase, callRowId, orgId);
  await finalizeTerminalWithRetry(supabase, callRowId, orgId, "no-answer", true);
  return new Response(buildHangupTwiml(settings.voicemail_greeting_text || "Goodbye."), {
    status: 200, headers: twimlHeaders,
  });
}

// ── Wave emission with mandatory routed persistence (R14) ───────────────────────────────────────────

async function emitWaveOrFallback(
  supabase: SupabaseClient,
  targets: RingTargets,
  ctx: { callRowId: string; orgId: string; phoneNumberId: string; settings: PhoneSettings; actionUrl: string },
): Promise<Response | null> {
  if (targets.identities.length === 0) return null;
  const persisted = await persistRoutedAgents(supabase, ctx.callRowId, ctx.orgId, targets.agentIds);
  const plan = buildWavePlan(targets, persisted, { voicemailEnabled: ctx.settings.voicemail_enabled });
  if (plan.action === "ring") {
    const twiml = buildClientDialTwiml({
      targets: plan.targets.agentIds.map((agentId, i) => ({ agentId, identity: plan.targets.identities[i] })),
      callRowId: ctx.callRowId,
      timeoutSec: ctx.settings.ring_timeout,
      actionUrl: ctx.actionUrl,
      recordingEnabled: ctx.settings.recording_enabled,
      recordingStatusUrl: recordingStatusUrl(),
      claimCallbackBaseUrl: claimCallbackBaseUrl(),
    });
    return new Response(twiml, { status: 200, headers: twimlHeaders });
  }
  if (plan.action === "none") return null;
  // R14: routed persistence failed — never ring an agent whose claim is guaranteed to fail.
  console.error("[twilio-voice-inbound] routed-persist FAILED — wave suppressed", {
    callRowId: ctx.callRowId, orgId: ctx.orgId, wave: targets.agentIds, safePath: plan.action,
  });
  if (plan.action === "voicemail") {
    await markMissedAndNotify(supabase, ctx.callRowId, ctx.orgId);
    const hangupUrl = selfUrl({
      fallback: "hangup",
      ...(ctx.callRowId ? { call_row_id: ctx.callRowId } : {}),
      org_id: ctx.orgId,
      phone_number_id: ctx.phoneNumberId,
    });
    return new Response(
      buildVoicemailTwiml(recordingStatusUrl(), hangupUrl, ctx.settings.voicemail_greeting_text, ctx.settings.voicemail_greeting_url),
      { status: 200, headers: twimlHeaders },
    );
  }
  await markMissedAndNotify(supabase, ctx.callRowId, ctx.orgId);
  await finalizeTerminalWithRetry(supabase, ctx.callRowId, ctx.orgId, "no-answer", true);
  return new Response(buildHangupTwiml(ctx.settings.voicemail_greeting_text || "Goodbye."), {
    status: 200, headers: twimlHeaders,
  });
}

// ── Chain steps ─────────────────────────────────────────────────────────────────────────────────────

async function handleChainStep(
  _req: Request,
  supabase: SupabaseClient,
  url: URL,
  params: Record<string, string>,
): Promise<Response> {
  const callRowId = url.searchParams.get("call_row_id") || "";
  const orgId = url.searchParams.get("org_id") || "";
  const phoneNumberId = url.searchParams.get("phone_number_id") || "";
  const fromNumber = params["From"] || "";
  const dialStatus = params["DialCallStatus"] || "";

  if (isAnsweredDialStatus(dialStatus)) {
    console.log("[twilio-voice-inbound] chain: caller connected — ending chain", {
      callSid: params["CallSid"] || "(none)",
      dialStatus,
    });
    // §6.2: the answered dial has ended — finalize completed (duration stays Twilio's).
    await finalizeTerminalWithRetry(supabase, callRowId, orgId, "completed", false);
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }

  let chainStep = parseInt(url.searchParams.get("chain_step") || "0", 10);
  if (!Number.isFinite(chainStep) || chainStep < 0) chainStep = 0;

  console.log("[twilio-voice-inbound] chain step", {
    chainStep,
    dialStatus: dialStatus || "(initial-empty)",
    orgId: orgId || "(none)",
    phoneNumberId: phoneNumberId || "(none)",
    callRowId: callRowId || "(none)",
    callSid: params["CallSid"] || "(none)",
  });

  if (!orgId) {
    return await emitTerminalFallback(supabase, callRowId, orgId, phoneNumberId, { alreadyForwarded: false });
  }

  const settings = await loadPhoneSettings(supabase, orgId, phoneNumberId);
  const chain = await loadFallbackChain(supabase, orgId);

  // T21: agents rung in ANY earlier wave (persisted routed_agent_ids) are excluded from later waves.
  let alreadyRouted: string[] = [];
  if (callRowId) {
    const { data } = await supabase
      .from("calls")
      .select("routed_agent_ids")
      .eq("id", callRowId)
      .eq("organization_id", orgId)
      .maybeSingle();
    alreadyRouted = ((data as { routed_agent_ids: string[] | null } | null)?.routed_agent_ids) || [];
  }

  while (chainStep < chain.length) {
    const tierKey = chain[chainStep];
    const resolved = await resolveTier(tierKey, {
      supabase, organizationId: orgId, phoneNumberId, fromNumber, callRowId,
    });
    const targets = excludeAlreadyRoutedAgents(resolved, alreadyRouted);
    console.log(`[twilio-voice-inbound] chain tier "${tierKey}" → ${targets.identities.length} identities (resolved ${resolved.identities.length}, excluded ${resolved.identities.length - targets.identities.length})`);
    const actionUrl = selfUrl({
      fallback: "chain",
      chain_step: String(chainStep + 1),
      ...(callRowId ? { call_row_id: callRowId } : {}),
      org_id: orgId,
      phone_number_id: phoneNumberId,
    });
    const resp = await emitWaveOrFallback(supabase, targets, {
      callRowId, orgId, phoneNumberId, settings, actionUrl,
    });
    if (resp) return resp;
    chainStep++;
  }

  console.log("[twilio-voice-inbound] chain exhausted — terminal fallback");
  return await emitTerminalFallback(supabase, callRowId, orgId, phoneNumberId, { alreadyForwarded: false });
}

async function handleFallback(
  _req: Request,
  supabase: SupabaseClient,
  url: URL,
  params: Record<string, string>,
): Promise<Response> {
  const callRowId = url.searchParams.get("call_row_id") || "";
  const orgId = url.searchParams.get("org_id") || "";
  const phoneNumberId = url.searchParams.get("phone_number_id") || "";
  const dialCallStatus = params["DialCallStatus"] || "";
  const alreadyForwarded = url.searchParams.has("forwarded");

  console.log("[twilio-voice-inbound] fallback=voicemail", {
    callRowId: callRowId || "(none)",
    orgId: orgId || "(none)",
    phoneNumberId: phoneNumberId || "(none)",
    dialCallStatus,
    forwarded: alreadyForwarded,
    callSid: params["CallSid"] || "(none)",
  });

  // T22/§6.4: an answered dial or forward return is NOT missed — finalize completed and stop.
  if (isAnsweredDialStatus(dialCallStatus)) {
    await finalizeTerminalWithRetry(supabase, callRowId, orgId, "completed", false);
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }

  // Unanswered return (primary direct-line miss, or a failed forward attempt): missed semantics live
  // in the terminal emitter — voicemail entry marks missed, hangup marks missed + finalizes, and a
  // not-yet-attempted forward is emitted WITHOUT premature missed-marking (§6.4/T22).
  if (!shouldMarkMissedOnDialReturn(dialCallStatus)) {
    // unreachable (answered handled above) — defensive
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }
  return await emitTerminalFallback(supabase, callRowId, orgId, phoneNumberId, { alreadyForwarded });
}

// ── Initial inbound ─────────────────────────────────────────────────────────────────────────────────

async function handleInitialInbound(
  req: Request,
  supabase: SupabaseClient,
  params: Record<string, string>,
): Promise<Response> {
  const callSid = params["CallSid"] ?? "";
  const fromNumber = params["From"] ?? "";
  const toNumber = params["To"] ?? "";
  const callStatus = params["CallStatus"] ?? "";

  console.log("[twilio-voice-inbound] incoming", {
    callSid,
    from: fromNumber,
    to: toNumber,
    callStatus,
  });

  if (!toNumber) {
    console.error("[twilio-voice-inbound] Missing To param");
    return new Response(UNCONFIGURED_TWIML, { status: 200, headers: twimlHeaders });
  }

  const phoneRow = await resolvePhoneNumberRow(supabase, toNumber);
  if (!phoneRow || !phoneRow.organization_id) {
    console.warn(
      `[twilio-voice-inbound] No phone_numbers row (or missing organization_id) for To=${toNumber}`,
    );
    return new Response(UNCONFIGURED_TWIML, { status: 200, headers: twimlHeaders });
  }

  const organizationId = phoneRow.organization_id;
  const settings = await loadPhoneSettings(supabase, organizationId, phoneRow.id);

  // Canonical ingest: idempotent row + identity resolution + (gated) auto-create, all in SQL.
  const ingest = await ingestInboundCall(
    supabase, callSid, organizationId, fromNumber, toNumber, settings.auto_create_lead,
  );
  if (!ingest || ingest.error) {
    // Fail-closed replay/malformed-SID path (R16/R22): never ring agents against a wrong row.
    console.error("[twilio-voice-inbound] ingest refused — routing refused", {
      callSid, orgId: organizationId, error: ingest?.error ?? "rpc_unavailable",
    });
    return new Response(buildHangupTwiml("We're sorry, we can't take your call right now. Goodbye."), {
      status: 200, headers: twimlHeaders,
    });
  }
  const callRowId = ingest.call_row_id || "";
  console.log("[twilio-voice-inbound] identity resolution", {
    callRowId,
    inserted: ingest.inserted,
    resolution: ingest.resolution,
    linked: !!ingest.contact_id,
    contactType: ingest.contact_type,
  });

  // Business hours (semantics preserved; missed timing per §6.4 lives in the emitters).
  const { isOpen, afterHoursSms } = await checkBusinessHours(supabase, organizationId);
  if (!isOpen) {
    console.log("[twilio-voice-inbound] Organization is CLOSED. Routing to fallback.");
    if (afterHoursSms) {
      void sendAfterHoursSms(supabase, organizationId, fromNumber, toNumber, afterHoursSms);
    }
    return await emitTerminalFallback(supabase, callRowId, organizationId, phoneRow.id, {
      alreadyForwarded: false,
    });
  }

  // Direct lines bypass org routing AND the fallback chain (behavior preserved; owner now org+Active
  // validated — T18).
  if (phoneRow.is_direct_line) {
    console.log(`[inbound] Direct line for agent ${phoneRow.assigned_to} — bypassing org routing and fallback chain`);
    const targets = await resolveAssignedTarget(supabase, phoneRow.assigned_to, organizationId);
    const actionUrl = selfUrl({
      fallback: "voicemail",
      ...(callRowId ? { call_row_id: callRowId } : {}),
      org_id: organizationId,
      phone_number_id: phoneRow.id,
    });
    const resp = await emitWaveOrFallback(supabase, targets, {
      callRowId, orgId: organizationId, phoneNumberId: phoneRow.id, settings, actionUrl,
    });
    if (resp) return resp;
    return await emitTerminalFallback(supabase, callRowId, organizationId, phoneRow.id, {
      alreadyForwarded: false,
    });
  }

  // Primary routing — resolve targets per routing_mode.
  let targets: RingTargets = EMPTY_RING_TARGETS;
  const routing = settings.inbound_routing;
  if (routing === "all-ring") {
    targets = await resolveAllOrgIdentities(supabase, organizationId);
  } else if (routing === "round_robin") {
    targets = await resolveRoundRobinAgent(supabase, organizationId);
  } else {
    targets = await resolveAssignedTarget(supabase, phoneRow.assigned_to, organizationId);
  }

  const primaryActionUrl = selfUrl({
    fallback: "chain",
    chain_step: "0",
    ...(callRowId ? { call_row_id: callRowId } : {}),
    org_id: organizationId,
    phone_number_id: phoneRow.id,
  });

  const resp = await emitWaveOrFallback(supabase, targets, {
    callRowId, orgId: organizationId, phoneNumberId: phoneRow.id, settings, actionUrl: primaryActionUrl,
  });
  if (resp) return resp;

  // No primary identities — enter the fallback chain at step 0.
  console.warn(
    `[twilio-voice-inbound] No primary identities (routing=${routing}, assigned_to=${phoneRow.assigned_to}) — entering fallback chain at step 0`,
  );
  const chainUrl = new URL(req.url);
  chainUrl.searchParams.set("fallback", "chain");
  chainUrl.searchParams.set("chain_step", "0");
  if (callRowId) chainUrl.searchParams.set("call_row_id", callRowId);
  chainUrl.searchParams.set("org_id", organizationId);
  chainUrl.searchParams.set("phone_number_id", phoneRow.id);
  return await handleChainStep(req, supabase, chainUrl, params);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(EMPTY_TWIML, { status: 405, headers: twimlHeaders });
  }

  try {
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!authToken) {
      console.error("[twilio-voice-inbound] Missing TWILIO_AUTH_TOKEN");
      return new Response(EMPTY_TWIML, { status: 500, headers: twimlHeaders });
    }

    const params = await parseFormBody(req);

    const valid = await validateTwilioSignature(req, authToken, params);
    if (!valid) {
      console.warn("[twilio-voice-inbound] Signature validation failed");
      return new Response(EMPTY_TWIML, { status: 403, headers: twimlHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const url = new URL(req.url);
    const fallback = url.searchParams.get("fallback");

    if (fallback === "chain") {
      return await handleChainStep(req, supabase, url, params);
    }

    if (fallback === "voicemail") {
      return await handleFallback(req, supabase, url, params);
    }

    if (fallback === "hangup") {
      // End of <Record> action — the voicemail message is in; twilio-recording-status attaches the
      // recording. §6.2: finalize completed here so a lost parent callback cannot strand the row.
      console.log("[twilio-voice-inbound] fallback=hangup ack", {
        callSid: params["CallSid"] || "(none)",
        recordingSid: params["RecordingSid"] || "(none)",
      });
      const callRowId = url.searchParams.get("call_row_id") || "";
      const orgId = url.searchParams.get("org_id") || "";
      await finalizeTerminalWithRetry(supabase, callRowId, orgId, "completed", false);
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    return await handleInitialInbound(req, supabase, params);
  } catch (err) {
    console.error("[twilio-voice-inbound] Fatal error:", err);
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }
});
