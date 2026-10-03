import { verifyOutboundDncAdmission } from "./dncGuard.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const twimlHeaders = { ...corsHeaders, "Content-Type": "text/xml" };

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Public API origin (no trailing slash) — Twilio signs this host; must match embedded TwiML URLs. */
function supabasePublicOrigin(): string {
  return (Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
}

function edgeFunctionAbsoluteUrl(req: Request, slug: string): string {
  const origin = supabasePublicOrigin();
  const search = new URL(req.url).search;
  return `${origin}/functions/v1/${slug}${search}`;
}

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

  const fullUrl = edgeFunctionAbsoluteUrl(req, "twilio-voice-webhook");

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

    const toNumber = params["To"] ?? "";
    const outboundCallerId = params["CallerId"] ?? "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const admitted = await verifyOutboundDncAdmission(params, (args) =>
      supabase.rpc("admit_twilio_outbound", args),
    );
    if (!admitted) {
      console.warn("[twilio-voice-webhook] Outbound admission refused");
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    const statusCallbackUrl = `${supabasePublicOrigin()}/functions/v1/twilio-voice-status`;

    const twiml = buildDialTwiml(toNumber, outboundCallerId, statusCallbackUrl);

    return new Response(twiml, { status: 200, headers: twimlHeaders });
  } catch (err) {
    console.error("[twilio-voice-webhook] Fatal error:", err);
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }
});
