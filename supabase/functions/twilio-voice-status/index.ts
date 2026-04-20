import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const twimlHeaders = { ...corsHeaders, "Content-Type": "text/xml" };
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

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

  const fullUrl =
    "https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/twilio-voice-status" +
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

function parseDurationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
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
      console.error("[twilio-voice-status] Missing TWILIO_AUTH_TOKEN");
      return new Response(EMPTY_TWIML, { status: 500, headers: twimlHeaders });
    }

    const params = await parseFormBody(req);

    const valid = await validateTwilioSignature(req, authToken, params);
    if (!valid) {
      console.warn("[twilio-voice-status] Signature validation failed");
      return new Response(EMPTY_TWIML, { status: 403, headers: twimlHeaders });
    }

    const callSid = params["CallSid"] ?? "";
    const callStatus = params["CallStatus"] ?? "";
    const callDuration = parseDurationSeconds(params["CallDuration"]);
    const sipResponseCode = params["SipResponseCode"] ?? "";
    const from = params["From"] ?? "";
    const to = params["To"] ?? "";

    console.log("[twilio-voice-status] event", {
      callSid,
      callStatus,
      callDuration,
      sipResponseCode: sipResponseCode || "(none)",
      from,
      to,
    });

    if (!callSid) {
      console.warn("[twilio-voice-status] Missing CallSid — acking anyway");
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const nowIso = new Date().toISOString();

    const { data: existing, error: selectError } = await supabase
      .from("calls")
      .select("id, started_at, duration, status")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();

    if (selectError) {
      console.error(
        `[twilio-voice-status] calls lookup failed for ${callSid}:`,
        selectError.message,
      );
    }

    if (!existing) {
      console.warn(
        `[twilio-voice-status] No calls row matches twilio_call_sid=${callSid} (status=${callStatus})`,
      );
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    const patch: Record<string, unknown> = { updated_at: nowIso };

    switch (callStatus) {
      case "ringing": {
        patch.status = "ringing";
        if (!existing.started_at) patch.started_at = nowIso;
        break;
      }
      case "in-progress": {
        patch.status = "connected";
        break;
      }
      case "completed": {
        patch.status = "completed";
        patch.ended_at = nowIso;
        if (callDuration !== null) {
          patch.duration = callDuration;
        } else if (existing.started_at) {
          const startMs = new Date(existing.started_at).getTime();
          const computed = Math.max(0, Math.round((Date.now() - startMs) / 1000));
          patch.duration = computed;
        }
        break;
      }
      case "busy": {
        patch.status = "completed";
        patch.outcome = "busy";
        patch.ended_at = nowIso;
        break;
      }
      case "no-answer": {
        patch.status = "no-answer";
        patch.ended_at = nowIso;
        break;
      }
      case "failed":
      case "canceled": {
        patch.status = "failed";
        patch.ended_at = nowIso;
        if (sipResponseCode) patch.provider_error_code = sipResponseCode;
        break;
      }
      default: {
        console.log(
          `[twilio-voice-status] Unhandled CallStatus=${callStatus} for ${callSid} — no DB write`,
        );
        return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
      }
    }

    const { error: updateError } = await supabase
      .from("calls")
      .update(patch)
      .eq("twilio_call_sid", callSid);

    if (updateError) {
      console.error(
        `[twilio-voice-status] calls update failed for ${callSid}:`,
        updateError.message,
      );
    }

    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  } catch (err) {
    console.error("[twilio-voice-status] Fatal error:", err);
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }
});
