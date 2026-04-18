import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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

async function validateTwilioSignature(
  req: Request,
  authToken: string,
  params: Record<string, string>,
): Promise<boolean> {
  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return false;

  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return false;
  const url = new URL(req.url);
  const fullUrl = `${proto}://${host}${url.pathname}${url.search}`;

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

function baseUrl(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return `${proto}://${host}`;
}

function selfUrl(req: Request, query: Record<string, string>): string {
  const qs = new URLSearchParams(query).toString();
  return `${baseUrl(req)}/functions/v1/twilio-voice-inbound${qs ? `?${qs}` : ""}`;
}

function recordingStatusUrl(req: Request): string {
  return `${baseUrl(req)}/functions/v1/twilio-recording-status`;
}

function digitsOnly(raw: string): string {
  return (raw || "").replace(/\D/g, "");
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
): Promise<{ id: string; organization_id: string | null; assigned_to: string | null } | null> {
  for (const cand of buildPhoneCandidates(toNumber)) {
    const { data, error } = await supabase
      .from("phone_numbers")
      .select("id, organization_id, assigned_to")
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
    if (data) return data as { id: string; organization_id: string | null; assigned_to: string | null };
  }
  return null;
}

async function resolveInboundContact(
  supabase: SupabaseClient,
  fromRaw: string,
  organizationId: string,
): Promise<{
  contact_id: string;
  contact_name: string;
  contact_type: "lead" | "client" | "recruit";
  contact_phone: string;
} | null> {
  if (!fromRaw || !organizationId) return null;
  const d = digitsOnly(fromRaw);
  if (d.length < 10) return null;
  const last10 = d.slice(-10);
  const variants = new Set<string>([`+1${last10}`, `1${last10}`, last10]);
  if (d.length === 11 && d.startsWith("1")) variants.add(`+${d}`);
  else if (d.length > 11) variants.add(`+${d}`);

  const tables: Array<{ table: "leads" | "clients" | "recruits"; type: "lead" | "client" | "recruit" }> = [
    { table: "leads", type: "lead" },
    { table: "clients", type: "client" },
    { table: "recruits", type: "recruit" },
  ];

  for (const { table, type } of tables) {
    for (const phone of variants) {
      const { data, error } = await supabase
        .from(table)
        .select("id, first_name, last_name, phone")
        .eq("organization_id", organizationId)
        .eq("phone", phone)
        .maybeSingle();
      if (error) {
        console.warn(
          `[twilio-voice-inbound] ${table} exact lookup error:`,
          phone,
          error.message,
        );
        continue;
      }
      if (data?.id) {
        const name = `${data.first_name || ""} ${data.last_name || ""}`.trim() || type;
        return {
          contact_id: data.id,
          contact_name: name,
          contact_type: type,
          contact_phone: data.phone || fromRaw,
        };
      }
    }

    const { data: fuzzy, error: fuzzyErr } = await supabase
      .from(table)
      .select("id, first_name, last_name, phone")
      .eq("organization_id", organizationId)
      .ilike("phone", `%${last10}`)
      .limit(1)
      .maybeSingle();
    if (fuzzyErr) {
      console.warn(
        `[twilio-voice-inbound] ${table} fuzzy lookup error:`,
        fuzzyErr.message,
      );
      continue;
    }
    if (fuzzy?.id) {
      const name = `${fuzzy.first_name || ""} ${fuzzy.last_name || ""}`.trim() || type;
      return {
        contact_id: fuzzy.id,
        contact_name: name,
        contact_type: type,
        contact_phone: fuzzy.phone || fromRaw,
      };
    }
  }

  return null;
}

async function loadPhoneSettings(
  supabase: SupabaseClient,
  organizationId: string | null,
): Promise<{ recording_enabled: boolean; inbound_routing: string }> {
  // inbound_routing column does not exist yet — request it but tolerate failure.
  // Fall back to a second query without it on error.
  const defaults = { recording_enabled: true, inbound_routing: "assigned" };
  if (!organizationId) return defaults;

  try {
    const { data, error } = await supabase
      .from("phone_settings")
      .select("recording_enabled, inbound_routing")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!error && data) {
      const row = data as { recording_enabled: boolean | null; inbound_routing: string | null };
      return {
        recording_enabled: row.recording_enabled !== false,
        inbound_routing: row.inbound_routing || "assigned",
      };
    }
    if (error) {
      console.warn(
        "[twilio-voice-inbound] phone_settings select (with inbound_routing) failed, retrying without:",
        error.message,
      );
    }
  } catch (err) {
    console.warn("[twilio-voice-inbound] phone_settings select threw:", err);
  }

  try {
    const { data, error } = await supabase
      .from("phone_settings")
      .select("recording_enabled")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) {
      console.warn(
        "[twilio-voice-inbound] phone_settings fallback select failed:",
        error.message,
      );
      return defaults;
    }
    return {
      recording_enabled: data?.recording_enabled !== false,
      inbound_routing: "assigned",
    };
  } catch (err) {
    console.warn("[twilio-voice-inbound] phone_settings fallback threw:", err);
    return defaults;
  }
}

async function resolveAssignedIdentity(
  supabase: SupabaseClient,
  assignedTo: string | null,
): Promise<string | null> {
  if (!assignedTo) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("twilio_client_identity")
    .eq("id", assignedTo)
    .maybeSingle();
  if (error) {
    console.warn(
      "[twilio-voice-inbound] profiles lookup (assigned) failed:",
      error.message,
    );
    return null;
  }
  const ident = (data as { twilio_client_identity: string | null } | null)?.twilio_client_identity;
  return ident || null;
}

async function resolveAllOrgIdentities(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("twilio_client_identity")
    .eq("organization_id", organizationId)
    .not("twilio_client_identity", "is", null);
  if (error) {
    console.warn(
      "[twilio-voice-inbound] profiles lookup (all-ring) failed:",
      error.message,
    );
    return [];
  }
  const rows = (data || []) as Array<{ twilio_client_identity: string | null }>;
  return rows
    .map((r) => r.twilio_client_identity || "")
    .filter((s) => s.length > 0);
}

function buildDialTwiml(
  identities: string[],
  actionUrl: string,
  recordingEnabled: boolean,
  recordingUrl: string,
): string {
  const safeAction = xmlEscape(actionUrl);
  const safeRec = xmlEscape(recordingUrl);
  const recordAttrs = recordingEnabled
    ? ` record="record-from-answer-dual" recordingStatusCallback="${safeRec}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"`
    : "";
  const clients = identities
    .map((id) => `<Client>${xmlEscape(id)}</Client>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Dial timeout="30" action="${safeAction}" method="POST"${recordAttrs}>` +
    `${clients}` +
    `</Dial>` +
    `</Response>`
  );
}

function buildVoicemailTwiml(
  recordingUrl: string,
  hangupActionUrl: string,
): string {
  const safeRec = xmlEscape(recordingUrl);
  const safeAction = xmlEscape(hangupActionUrl);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say voice="Polly.Joanna">Thank you for calling. No one is available to take your call right now. Please leave a message after the tone and we will return your call as soon as possible.</Say>` +
    `<Record maxLength="120" playBeep="true" recordingStatusCallback="${safeRec}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed" action="${safeAction}" method="POST"/>` +
    `<Say voice="Polly.Joanna">We did not receive a message. Goodbye.</Say>` +
    `<Hangup/>` +
    `</Response>`
  );
}

async function handleFallback(
  req: Request,
  supabase: SupabaseClient,
  url: URL,
  params: Record<string, string>,
): Promise<Response> {
  const callRowId = url.searchParams.get("call_row_id") || "";
  const orgId = url.searchParams.get("org_id") || "";
  const dialCallStatus = params["DialCallStatus"] || "";

  console.log("[twilio-voice-inbound] fallback=voicemail", {
    callRowId: callRowId || "(none)",
    orgId: orgId || "(none)",
    dialCallStatus,
    callSid: params["CallSid"] || "(none)",
  });

  // If the agent actually answered, do not roll to voicemail.
  // twilio-voice-status updates the calls row based on parent CallSid.
  if (dialCallStatus === "completed" || dialCallStatus === "answered") {
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }

  if (callRowId) {
    const patch: Record<string, unknown> = {
      is_missed: true,
      updated_at: new Date().toISOString(),
    };
    // If there will be no voicemail recording (call ended without any connected leg),
    // mark as completed now. twilio-recording-status will overwrite recording_storage_path
    // later if a voicemail is left.
    if (dialCallStatus === "no-answer" || dialCallStatus === "busy" || dialCallStatus === "failed" || dialCallStatus === "canceled") {
      patch.status = "completed";
      patch.ended_at = new Date().toISOString();
    }
    const { error } = await supabase
      .from("calls")
      .update(patch)
      .eq("id", callRowId);
    if (error) {
      console.error(
        `[twilio-voice-inbound] fallback update failed for ${callRowId}:`,
        error.message,
      );
    }
  }

  const hangupUrl = selfUrl(req, {
    fallback: "hangup",
    ...(callRowId ? { call_row_id: callRowId } : {}),
    ...(orgId ? { org_id: orgId } : {}),
  });

  const twiml = buildVoicemailTwiml(recordingStatusUrl(req), hangupUrl);
  return new Response(twiml, { status: 200, headers: twimlHeaders });
}

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
  const settings = await loadPhoneSettings(supabase, organizationId);

  // Create the calls row first so we have the row id for the Dial action URL.
  const nowIso = new Date().toISOString();
  let callRowId: string | null = null;

  const insertPayload: Record<string, unknown> = {
    twilio_call_sid: callSid,
    direction: "inbound",
    status: "ringing",
    contact_phone: fromNumber,
    caller_id_used: toNumber,
    organization_id: organizationId,
    agent_id: null,
    started_at: nowIso,
    created_at: nowIso,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("calls")
    .insert(insertPayload)
    .select("id")
    .maybeSingle();

  if (insertError) {
    console.error(
      "[twilio-voice-inbound] calls insert failed:",
      insertError.message,
    );
  } else if (inserted?.id) {
    callRowId = inserted.id;
  }

  // Try to enrich with contact info — best effort; do not block routing on failure.
  try {
    const contact = await resolveInboundContact(supabase, fromNumber, organizationId);
    if (contact && callRowId) {
      const { error: enrichErr } = await supabase
        .from("calls")
        .update({
          contact_id: contact.contact_id,
          contact_name: contact.contact_name,
          contact_type: contact.contact_type,
          contact_phone: contact.contact_phone,
        })
        .eq("id", callRowId);
      if (enrichErr) {
        console.warn(
          "[twilio-voice-inbound] contact enrich update failed:",
          enrichErr.message,
        );
      }
    }
  } catch (err) {
    console.warn("[twilio-voice-inbound] contact resolution threw:", err);
  }

  // Resolve identities based on routing strategy.
  let identities: string[] = [];
  const routing = settings.inbound_routing;
  if (routing === "all-ring") {
    identities = await resolveAllOrgIdentities(supabase, organizationId);
  } else {
    // "assigned" (default) and "round-robin" (TODO: needs online-presence tracking —
    // until then, treat round-robin the same as assigned so calls still route).
    const ident = await resolveAssignedIdentity(supabase, phoneRow.assigned_to);
    if (ident) identities = [ident];
  }

  if (identities.length === 0) {
    console.warn(
      `[twilio-voice-inbound] No identities resolvable (routing=${routing}, assigned_to=${phoneRow.assigned_to}) — going straight to voicemail`,
    );
    if (callRowId) {
      const { error } = await supabase
        .from("calls")
        .update({ is_missed: true, updated_at: new Date().toISOString() })
        .eq("id", callRowId);
      if (error) {
        console.error(
          "[twilio-voice-inbound] calls is_missed update failed:",
          error.message,
        );
      }
    }
    const hangupUrl = selfUrl(req, {
      fallback: "hangup",
      ...(callRowId ? { call_row_id: callRowId } : {}),
      org_id: organizationId,
    });
    const twiml = buildVoicemailTwiml(recordingStatusUrl(req), hangupUrl);
    return new Response(twiml, { status: 200, headers: twimlHeaders });
  }

  const actionUrl = selfUrl(req, {
    fallback: "voicemail",
    ...(callRowId ? { call_row_id: callRowId } : {}),
    org_id: organizationId,
  });

  const twiml = buildDialTwiml(
    identities,
    actionUrl,
    settings.recording_enabled,
    recordingStatusUrl(req),
  );
  return new Response(twiml, { status: 200, headers: twimlHeaders });
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

    if (fallback === "voicemail") {
      return await handleFallback(req, supabase, url, params);
    }

    if (fallback === "hangup") {
      // End of <Record> action — nothing left to do; twilio-recording-status will
      // attach the recording. Respond with empty TwiML so Twilio proceeds with the
      // next verbs in the voicemail response (the trailing Say + Hangup).
      console.log("[twilio-voice-inbound] fallback=hangup ack", {
        callSid: params["CallSid"] || "(none)",
        recordingSid: params["RecordingSid"] || "(none)",
      });
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    return await handleInitialInbound(req, supabase, params);
  } catch (err) {
    console.error("[twilio-voice-inbound] Fatal error:", err);
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }
});
