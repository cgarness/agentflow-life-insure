// Optional recording callback for AI test calls — ack only (no CRM storage in POC).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadOutboundTwilioCreds } from "../_shared/twilioOutboundCreds.ts";
import {
  twilioFormParams,
  validateTwilioSignatureDebug,
} from "../_shared/aiTestingTwilio.ts";
import { appendDebugLog } from "../_shared/aiTestingSession.ts";
import { mergeUsageMetrics } from "../_shared/aiTestingUsageMetrics.ts";

const FN = "[ai-testing-recording-status]";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  const url = new URL(req.url);
  const sessionId = (url.searchParams.get("sessionId") ?? "").trim();
  if (!sessionId) return new Response("ok");

  const params = await twilioFormParams(req.clone());
  const credsResult = loadOutboundTwilioCreds();
  if (!credsResult.ok) return new Response("ok");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

  const sigDebug = await validateTwilioSignatureDebug(
    req,
    credsResult.creds.authToken,
    params,
    "ai-testing-recording-status",
  );
  if (supabase) {
    await appendDebugLog(
      supabase,
      sessionId,
      sigDebug.valid ? "info" : "warn",
      "recording_status.callback",
      {
        RecordingStatus: params.RecordingStatus,
        RecordingSid: params.RecordingSid,
        RecordingDuration: params.RecordingDuration,
        signatureValid: sigDebug.valid,
        signatureReason: sigDebug.reason,
      },
    );
  }
  if (!sigDebug.valid) {
    console.warn(`${FN} invalid signature: ${sigDebug.reason}`);
    return new Response("Forbidden", { status: 403 });
  }

  const recordingSec = Number(params.RecordingDuration);
  if (supabase && Number.isFinite(recordingSec) && recordingSec > 0) {
    await mergeUsageMetrics(supabase, sessionId, {
      twilio: { recording_duration_sec: recordingSec },
    });
  }

  return new Response("ok");
});
