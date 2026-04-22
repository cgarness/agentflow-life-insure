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

function buildBasicAuth(accountSid: string, authToken: string): string {
  return "Basic " + btoa(`${accountSid}:${authToken}`);
}

function normalizeStirShakenLevel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).toUpperCase().trim();
  if (s === "A" || s === "B" || s === "C" || s === "U") return s;
  const token = s.match(/(?:^|[-_\s])([ABCU])(?:$|[-_\s])/);
  if (token?.[1]) return token[1];
  const letters = s.replace(/[^ABCU]/g, "");
  if (letters.includes("A")) return "A";
  if (letters.includes("B")) return "B";
  if (letters.includes("C")) return "C";
  if (letters.includes("U")) return "U";
  return null;
}

async function fetchTwilioStirShakenLevel(
  accountSid: string,
  authToken: string,
  callSid: string,
): Promise<string | null> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(callSid)}.json`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: buildBasicAuth(accountSid, authToken),
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  const twilioRaw =
    (typeof json.stir_verstat === "string" ? json.stir_verstat : null) ??
    (typeof json.stir_status === "string" ? json.stir_status : null) ??
    (typeof json.stirStatus === "string" ? json.stirStatus : null) ??
    (typeof json.shaken_stir === "string" ? json.shaken_stir : null) ??
    (typeof json.shakenStir === "string" ? json.shakenStir : null);
  return normalizeStirShakenLevel(twilioRaw);
}

/** Twilio <Dial action> posts DialCallStatus, not CallStatus — map into the same terminal handling. */
function mapDialCallStatusToCallStatus(dialCallStatus: string): string | null {
  const d = dialCallStatus.trim().toLowerCase();
  if (!d) return null;
  if (d === "completed" || d === "answered") return "completed";
  if (d === "busy") return "busy";
  if (d === "no-answer") return "no-answer";
  if (d === "failed" || d === "canceled") return d;
  return null;
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
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
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

    const parentCallSid = params["CallSid"] ?? "";
    const dialCallSid = params["DialCallSid"] ?? "";
    const dialCallStatus = params["DialCallStatus"] ?? "";
    const callStatusFromForm = params["CallStatus"] ?? "";
    const mappedFromDial = mapDialCallStatusToCallStatus(dialCallStatus);
    const callStatus = mappedFromDial ?? callStatusFromForm;
    const callDuration = parseDurationSeconds(
      params["CallDuration"] ?? params["DialCallDuration"],
    );
    const sipResponseCode = params["SipResponseCode"] ?? "";
    const webhookStirRaw =
      params["StirVerstat"] ??
      params["StirStatus"] ??
      params["StirShakenStatus"] ??
      params["StirShaken"] ??
      "";
    const from = params["From"] ?? "";
    const to = params["To"] ?? "";

    console.log("[twilio-voice-status] event", {
      parentCallSid,
      dialCallSid: dialCallSid || "(none)",
      dialCallStatus: dialCallStatus || "(none)",
      callStatusFromForm: callStatusFromForm || "(none)",
      effectiveCallStatus: callStatus || "(none)",
      callDuration,
      sipResponseCode: sipResponseCode || "(none)",
      stirShaken: webhookStirRaw || "(none)",
      from,
      to,
    });

    if (!parentCallSid && !dialCallSid) {
      console.warn("[twilio-voice-status] Missing CallSid/DialCallSid — acking anyway");
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const nowIso = new Date().toISOString();

    let matchTwilioSid = "";
    let existing: { id: string; started_at: string | null; duration: number | null; status: string | null } | null =
      null;

    const tryLookup = async (sid: string) => {
      if (!sid) return;
      const { data, error: selectError } = await supabase
        .from("calls")
        .select("id, started_at, duration, status")
        .eq("twilio_call_sid", sid)
        .maybeSingle();
      if (selectError) {
        console.error(
          `[twilio-voice-status] calls lookup failed for ${sid}:`,
          selectError.message,
        );
        return;
      }
      if (data) {
        existing = data;
        matchTwilioSid = sid;
      }
    };

    await tryLookup(parentCallSid);
    if (!existing && dialCallSid && dialCallSid !== parentCallSid) {
      await tryLookup(dialCallSid);
    }

    if (!existing) {
      console.warn(
        `[twilio-voice-status] No calls row matches twilio_call_sid parent=${parentCallSid || "(none)"} dial=${dialCallSid || "(none)"} (effectiveStatus=${callStatus})`,
      );
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    const patch: Record<string, unknown> = { updated_at: nowIso };
    const webhookStir = normalizeStirShakenLevel(webhookStirRaw);
    if (webhookStir) patch.shaken_stir = webhookStir;

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
        if (!patch.shaken_stir && accountSid) {
          // PSTN leg (child) usually carries STIR/SHAKEN; parent Voice SDK leg may not.
          const stirSid = dialCallSid || parentCallSid;
          let fetched = await fetchTwilioStirShakenLevel(accountSid, authToken, stirSid);
          if (!fetched && dialCallSid && parentCallSid && stirSid === dialCallSid) {
            fetched = await fetchTwilioStirShakenLevel(accountSid, authToken, parentCallSid);
          }
          if (fetched) patch.shaken_stir = fetched;
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
          `[twilio-voice-status] Unhandled effectiveCallStatus=${callStatus} (form CallStatus=${callStatusFromForm}, DialCallStatus=${dialCallStatus}) for parent=${parentCallSid} — no DB write`,
        );
        return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
      }
    }

    const { error: updateError } = await supabase
      .from("calls")
      .update(patch)
      .eq("twilio_call_sid", matchTwilioSid);

    if (updateError) {
      console.error(
        `[twilio-voice-status] calls update failed for ${matchTwilioSid}:`,
        updateError.message,
      );
    }

    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  } catch (err) {
    console.error("[twilio-voice-status] Fatal error:", err);
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }
});
