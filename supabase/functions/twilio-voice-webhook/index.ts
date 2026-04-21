import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const twimlHeaders = { ...corsHeaders, "Content-Type": "text/xml" };

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

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

/**
 * Validate Twilio webhook signature per
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 * URL + sorted key/value pairs, HMAC-SHA1 with auth token, base64.
 */
async function validateTwilioSignature(
  req: Request,
  authToken: string,
  params: Record<string, string>,
): Promise<boolean> {
  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return false;

  const fullUrl =
    "https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/twilio-voice-webhook" +
    new URL(req.url).search;

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

function normalizePhoneCandidates(value: string): string[] {
  const raw = value.trim();
  const out = new Set<string>([raw]);
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    out.add(`+1${digits}`);
    out.add(`1${digits}`);
  } else if (digits.length === 11 && digits.startsWith("1")) {
    out.add(`+${digits}`);
  }
  return [...out];
}

async function resolveOrgFromPhoneNumber(
  supabase: ReturnType<typeof createClient>,
  fromNumber: string | undefined,
): Promise<string | null> {
  if (!fromNumber) return null;
  for (const cand of normalizePhoneCandidates(fromNumber)) {
    const { data, error } = await supabase
      .from("phone_numbers")
      .select("organization_id")
      .eq("phone_number", cand)
      .maybeSingle();
    if (error) {
      console.warn("[twilio-voice-webhook] phone_numbers lookup failed:", cand, error.message);
      continue;
    }
    if (data?.organization_id) return data.organization_id as string;
  }
  return null;
}

function buildStatusCallbackUrl(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return `${proto}://${host}/functions/v1/twilio-voice-status`;
}

function buildDialTwiml(toNumber: string, callerId: string, statusCallbackUrl: string): string {
  const safeTo = xmlEscape(toNumber);
  const safeCaller = xmlEscape(callerId);
  const safeAction = xmlEscape(statusCallbackUrl);

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    // answerOnBridge: PSTN leg rings without bridging audio until pickup — Voice.js stays in
    // "ringing" / non-open until answered, so ring-timeout watchdog can run through that phase.
    `<Dial answerOnBridge="true" callerId="${safeCaller}" action="${safeAction}" method="POST">` +
    `<Number>${safeTo}</Number>` +
    `</Dial>` +
    `</Response>`
  );
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
      console.error("[twilio-voice-webhook] Missing TWILIO_AUTH_TOKEN");
      return new Response(EMPTY_TWIML, { status: 500, headers: twimlHeaders });
    }

    const params = await parseFormBody(req);

    const valid = await validateTwilioSignature(req, authToken, params);
    if (!valid) {
      console.warn("[twilio-voice-webhook] Signature validation failed");
      return new Response(EMPTY_TWIML, { status: 403, headers: twimlHeaders });
    }

    const callSid = params["CallSid"] ?? "";
    const toNumber = params["To"] ?? "";
    const fromParam = params["From"] ?? "";
    const callerIdParam = params["CallerId"] ?? "";
    const callRowId = params["CallRowId"] ?? "";
    const orgIdParam = params["OrgId"] ?? "";

    const outboundCallerId = callerIdParam || fromParam;

    console.log("[twilio-voice-webhook] incoming", {
      callSid,
      to: toNumber,
      from: fromParam,
      callerId: callerIdParam,
      callRowId: callRowId || "(none)",
      orgId: orgIdParam || "(none)",
    });

    if (!toNumber) {
      console.error("[twilio-voice-webhook] Missing To param");
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    let organizationId: string | null = orgIdParam || null;
    if (!organizationId) {
      organizationId = await resolveOrgFromPhoneNumber(supabase, outboundCallerId);
    }

    if (callRowId) {
      const { error: updateError } = await supabase
        .from("calls")
        .update({
          twilio_call_sid: callSid,
          status: "ringing",
          updated_at: new Date().toISOString(),
        })
        .eq("id", callRowId);
      if (updateError) {
        console.error(
          `[twilio-voice-webhook] Failed to update calls row ${callRowId}:`,
          updateError.message,
        );
      }
    } else {
      console.warn(
        "[twilio-voice-webhook] No CallRowId on webhook — creating fallback calls row",
      );
      const { error: insertError } = await supabase.from("calls").insert({
        twilio_call_sid: callSid,
        direction: "outbound",
        status: "ringing",
        from_number: outboundCallerId,
        to_number: toNumber,
        organization_id: organizationId,
        started_at: new Date().toISOString(),
      });
      if (insertError) {
        console.error(
          "[twilio-voice-webhook] Fallback calls insert failed:",
          insertError.message,
        );
      }
    }

    const statusCallbackUrl = buildStatusCallbackUrl(req);

    const twiml = buildDialTwiml(toNumber, outboundCallerId, statusCallbackUrl);

    return new Response(twiml, { status: 200, headers: twimlHeaders });
  } catch (err) {
    console.error("[twilio-voice-webhook] Fatal error:", err);
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }
});
