import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const FN = "[twilio-sms-webhook]";

const twimlHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "text/xml",
};

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

// ---------------------------------------------------------------------------
// Twilio HMAC-SHA1 Signature Validation
// (Same pattern as twilio-voice-inbound / twilio-voice-webhook)
// ---------------------------------------------------------------------------

function supabasePublicOrigin(): string {
  return (Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
}

function edgeFunctionAbsoluteUrl(req: Request): string {
  const origin = supabasePublicOrigin();
  const search = new URL(req.url).search;
  return `${origin}/functions/v1/twilio-sms-webhook${search}`;
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

  const fullUrl = edgeFunctionAbsoluteUrl(req);

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

// ---------------------------------------------------------------------------
// Phone-number & contact resolution
// (Mirrors twilio-voice-inbound resolvePhoneNumberRow / resolveInboundContact)
// ---------------------------------------------------------------------------

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

async function resolveOrgFromToNumber(
  supabase: SupabaseClient,
  toNumber: string,
): Promise<string | null> {
  for (const cand of buildPhoneCandidates(toNumber)) {
    const { data, error } = await supabase
      .from("phone_numbers")
      .select("organization_id")
      .eq("phone_number", cand)
      .maybeSingle();
    if (error) {
      console.warn(`${FN} phone_numbers lookup error:`, cand, error.message);
      continue;
    }
    if (data?.organization_id) return data.organization_id as string;
  }
  return null;
}

async function resolveContactByPhone(
  supabase: SupabaseClient,
  fromRaw: string,
  organizationId: string,
): Promise<{
  contact_id: string;
  contact_name: string;
  contact_type: "lead" | "client" | "recruit";
} | null> {
  if (!fromRaw || !organizationId) return null;
  const d = digitsOnly(fromRaw);
  if (d.length < 10) return null;
  const last10 = d.slice(-10);
  const variants = new Set<string>([`+1${last10}`, `1${last10}`, last10]);
  if (d.length === 11 && d.startsWith("1")) variants.add(`+${d}`);
  else if (d.length > 11) variants.add(`+${d}`);

  const tables: Array<{
    table: "leads" | "clients" | "recruits";
    type: "lead" | "client" | "recruit";
  }> = [
    { table: "leads", type: "lead" },
    { table: "clients", type: "client" },
    { table: "recruits", type: "recruit" },
  ];

  for (const { table, type } of tables) {
    // Exact match first
    for (const phone of variants) {
      const { data, error } = await supabase
        .from(table)
        .select("id, first_name, last_name")
        .eq("organization_id", organizationId)
        .eq("phone", phone)
        .maybeSingle();
      if (error) {
        console.warn(`${FN} ${table} exact lookup error:`, phone, error.message);
        continue;
      }
      if (data?.id) {
        const name =
          `${data.first_name || ""} ${data.last_name || ""}`.trim() || type;
        return { contact_id: data.id, contact_name: name, contact_type: type };
      }
    }

    // Fuzzy fallback (last 10 digits)
    const { data: fuzzy, error: fuzzyErr } = await supabase
      .from(table)
      .select("id, first_name, last_name")
      .eq("organization_id", organizationId)
      .ilike("phone", `%${last10}`)
      .limit(1)
      .maybeSingle();
    if (fuzzyErr) {
      console.warn(`${FN} ${table} fuzzy lookup error:`, fuzzyErr.message);
      continue;
    }
    if (fuzzy?.id) {
      const name =
        `${fuzzy.first_name || ""} ${fuzzy.last_name || ""}`.trim() || type;
      return { contact_id: fuzzy.id, contact_name: name, contact_type: type };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: twimlHeaders });
  }
  if (req.method !== "POST") {
    return new Response(EMPTY_TWIML, { status: 405, headers: twimlHeaders });
  }

  try {
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!authToken) {
      console.error(`${FN} Missing TWILIO_AUTH_TOKEN`);
      return new Response(EMPTY_TWIML, { status: 500, headers: twimlHeaders });
    }

    const params = await parseFormBody(req);

    // ── Signature validation ──
    const valid = await validateTwilioSignature(req, authToken, params);
    if (!valid) {
      console.warn(`${FN} Signature validation failed`);
      return new Response(EMPTY_TWIML, { status: 403, headers: twimlHeaders });
    }

    // ── Extract fields ──
    const fromNumber = params["From"] ?? "";
    const toNumber = params["To"] ?? "";
    const body = params["Body"] ?? "";
    const messageSid = params["MessageSid"] ?? "";

    console.log(`${FN} inbound`, {
      from: fromNumber,
      to: toNumber,
      messageSid,
      bodyLen: body.length,
    });

    if (!fromNumber || !toNumber) {
      console.warn(`${FN} Missing From or To`);
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // ── Resolve organization from the To number ──
    const organizationId = await resolveOrgFromToNumber(supabase, toNumber);
    if (!organizationId) {
      console.warn(`${FN} No org found for To=${toNumber} — dropping message`);
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    // ── Resolve contact (leads → clients → recruits) ──
    let contactId: string | null = null;
    let contactType: string | null = null;
    let contactName: string | null = null;

    try {
      const contact = await resolveContactByPhone(
        supabase,
        fromNumber,
        organizationId,
      );
      if (contact) {
        contactId = contact.contact_id;
        contactType = contact.contact_type;
        contactName = contact.contact_name;
      }
    } catch (err) {
      console.warn(`${FN} Contact resolution threw:`, err);
    }

    // ── Insert message row ──
    const messageRow: Record<string, unknown> = {
      direction: "inbound",
      body: body || "(empty)",
      from_number: fromNumber,
      to_number: toNumber,
      status: "received",
      provider_message_id: messageSid || null,
      organization_id: organizationId,
      created_by: null, // System-inserted, not a user action
      sent_at: new Date().toISOString(),
    };

    if (contactId) {
      messageRow.contact_id = contactId;
      messageRow.contact_type = contactType;
      // Also set lead_id for backward compatibility if contact is a lead
      if (contactType === "lead") {
        messageRow.lead_id = contactId;
      }
    }

    const { error: insertError } = await supabase
      .from("messages")
      .insert(messageRow);

    if (insertError) {
      console.error(`${FN} messages insert failed:`, insertError.message);
    } else {
      console.log(`${FN} message stored`, {
        org: organizationId,
        contact: contactId || "(unmatched)",
        contactType: contactType || "unknown",
      });
    }

    // ── Activity log (only when contact is matched) ──
    if (contactId && contactType) {
      const truncated =
        body.length > 50 ? `${body.slice(0, 50)}…` : body || "(empty)";
      const { error: actError } = await supabase
        .from("contact_activities")
        .insert({
          activity_type: "sms",
          description: `Received SMS: ${truncated}`,
          contact_id: contactId,
          contact_type: contactType,
          organization_id: organizationId,
        });
      if (actError) {
        console.warn(`${FN} contact_activities insert:`, actError.message);
      }
    }

    // ── Return empty TwiML — no auto-reply ──
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  } catch (err) {
    console.error(`${FN} Fatal:`, err);
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }
});
