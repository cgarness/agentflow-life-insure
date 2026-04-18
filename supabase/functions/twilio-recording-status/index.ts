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
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingString));
  const expected = bytesToBase64(new Uint8Array(sig));
  return timingSafeEqual(expected, signature);
}

async function parseFormBody(req: Request): Promise<Record<string, string>> {
  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw).entries()) params[k] = v;
  return params;
}

function buildBasicAuth(accountSid: string, authToken: string): string {
  return "Basic " + btoa(`${accountSid}:${authToken}`);
}

function buildStoragePath(orgId: string, callSid: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${orgId}/${yyyy}${mm}${dd}/${callSid}.mp3`;
}

async function updateCallsRow(
  supabase: ReturnType<typeof createClient>,
  callSid: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("calls")
    .update(patch)
    .eq("twilio_call_sid", callSid);
  if (error) {
    console.error(
      `[twilio-recording-status] calls UPDATE failed for CallSid=${callSid}:`,
      error.message,
    );
  }
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
    if (!authToken || !accountSid) {
      console.error("[twilio-recording-status] Missing TWILIO_AUTH_TOKEN or TWILIO_ACCOUNT_SID");
      return new Response(EMPTY_TWIML, { status: 500, headers: twimlHeaders });
    }

    // Parse body first — signature validation requires the same params.
    const params = await parseFormBody(req);

    // (1) VALIDATE — reject any non-Twilio caller immediately.
    const valid = await validateTwilioSignature(req, authToken, params);
    if (!valid) {
      console.warn("[twilio-recording-status] Signature validation failed");
      return new Response(EMPTY_TWIML, { status: 403, headers: twimlHeaders });
    }

    // (2) PARSE key fields.
    const recordingSid = params["RecordingSid"] ?? "";
    const recordingUrl = params["RecordingUrl"] ?? "";
    const recordingStatus = params["RecordingStatus"] ?? "";
    const recordingDuration = params["RecordingDuration"] ?? "0";
    const callSid = params["CallSid"] ?? "";
    const callAccountSid = params["AccountSid"] ?? accountSid;

    console.log(
      `[twilio-recording-status] Received recording ${recordingSid} for call ${callSid} (status=${recordingStatus})`,
    );

    // (3) SKIP if not completed — Twilio sends intermediate events too.
    if (recordingStatus !== "completed") {
      console.log(
        `[twilio-recording-status] Skipping non-completed status: ${recordingStatus}`,
      );
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // (4) LOOK UP CALLS ROW.
    let callRowId: string | null = null;
    let orgId = "unmatched";

    if (callSid) {
      const { data, error } = await supabase
        .from("calls")
        .select("id, organization_id")
        .eq("twilio_call_sid", callSid)
        .maybeSingle();
      if (error) {
        console.warn(
          `[twilio-recording-status] calls lookup error for CallSid=${callSid}:`,
          error.message,
        );
      } else if (data) {
        callRowId = (data as { id: string; organization_id: string | null }).id ?? null;
        const rowOrg = (data as { id: string; organization_id: string | null }).organization_id;
        if (rowOrg) orgId = rowOrg;
      } else {
        console.warn(
          `[twilio-recording-status] No calls row found for CallSid=${callSid} — recording will be stored under 'unmatched'`,
        );
      }
    }

    const storagePath = buildStoragePath(orgId, callSid || recordingSid);

    // (5) DOWNLOAD RECORDING FROM TWILIO.
    const downloadUrl = `${recordingUrl}.mp3`;
    let audioBytes: Uint8Array;

    try {
      const dlRes = await fetch(downloadUrl, {
        headers: { Authorization: buildBasicAuth(accountSid, authToken) },
      });
      if (!dlRes.ok) {
        throw new Error(`HTTP ${dlRes.status} ${dlRes.statusText}`);
      }
      audioBytes = new Uint8Array(await dlRes.arrayBuffer());
      console.log(
        `[twilio-recording-status] Downloaded ${audioBytes.byteLength} bytes from Twilio`,
      );
    } catch (err) {
      console.error(
        `[twilio-recording-status] Download failed for ${recordingSid}:`,
        err,
      );
      if (callRowId) {
        await updateCallsRow(supabase, callSid, {
          recording_url: "__recording_failed__",
          updated_at: new Date().toISOString(),
        });
      }
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    // (6) UPLOAD TO SUPABASE STORAGE.
    try {
      const { error: uploadError } = await supabase.storage
        .from("call-recordings")
        .upload(storagePath, audioBytes, {
          contentType: "audio/mpeg",
          upsert: true,
        });
      if (uploadError) throw uploadError;
      console.log(`[twilio-recording-status] Uploaded to storage: ${storagePath}`);
    } catch (err) {
      console.error(
        `[twilio-recording-status] Upload failed for ${recordingSid}:`,
        err,
      );
      if (callRowId) {
        await updateCallsRow(supabase, callSid, {
          recording_url: "__recording_upload_failed__",
          updated_at: new Date().toISOString(),
        });
      }
      return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
    }

    // (7) UPDATE CALLS ROW with storage path and duration.
    if (callRowId) {
      const duration = parseInt(recordingDuration, 10);
      await updateCallsRow(supabase, callSid, {
        recording_storage_path: storagePath,
        recording_duration: isNaN(duration) ? null : duration,
        recording_url: `storage:${storagePath}`,
        updated_at: new Date().toISOString(),
      });
      console.log(
        `[twilio-recording-status] Updated calls row ${callRowId} with storage path`,
      );
    }

    // (8) DELETE RECORDING FROM TWILIO to avoid ongoing storage charges.
    try {
      const deleteUrl = `https://api.twilio.com/2010-04-01/Accounts/${callAccountSid}/Recordings/${recordingSid}`;
      const delRes = await fetch(deleteUrl, {
        method: "DELETE",
        headers: { Authorization: buildBasicAuth(accountSid, authToken) },
      });
      if (!delRes.ok && delRes.status !== 404) {
        // 404 is fine — already deleted or never existed.
        throw new Error(`HTTP ${delRes.status} ${delRes.statusText}`);
      }
      console.log(`[twilio-recording-status] Deleted recording ${recordingSid} from Twilio`);
    } catch (err) {
      // Non-fatal: recording is safely in our storage.
      console.warn(
        `[twilio-recording-status] Twilio delete failed for ${recordingSid} (non-fatal):`,
        err,
      );
    }

    // (9) RETURN success.
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  } catch (err) {
    console.error("[twilio-recording-status] Fatal error:", err);
    // Always return 200 + TwiML so Twilio does not retry-flood.
    return new Response(EMPTY_TWIML, { status: 200, headers: twimlHeaders });
  }
});
