import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadOutboundTwilioCreds } from "../_shared/twilioOutboundCreds.ts";
import {
  twilioFormParams,
  validateTwilioSignature,
} from "../_shared/aiTestingTwilio.ts";

const FN = "[ai-testing-status]";

const STATUS_MAP: Record<string, string> = {
  queued: "queued",
  initiated: "ringing",
  ringing: "ringing",
  "in-progress": "in-progress",
  completed: "completed",
  busy: "busy",
  "no-answer": "no-answer",
  failed: "failed",
  canceled: "canceled",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("ok", { status: 405 });
  }

  const url = new URL(req.url);
  const sessionId = (url.searchParams.get("sessionId") ?? "").trim();
  const params = await twilioFormParams(req.clone());
  const callStatus = (params.CallStatus ?? "").trim();

  if (!sessionId) {
    return new Response("ok");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return new Response("ok");

  const supabase = createClient(supabaseUrl, serviceKey);
  const credsResult = loadOutboundTwilioCreds();
  if (!credsResult.ok) return new Response("ok");

  const valid = await validateTwilioSignature(
    req,
    credsResult.creds.authToken,
    params,
    "ai-testing-status",
  );
  if (!valid) {
    console.warn(`${FN} invalid signature session=${sessionId}`);
    return new Response("Forbidden", { status: 403 });
  }

  const mapped = STATUS_MAP[callStatus] ?? callStatus;
  if (mapped) {
    await supabase
      .from("ai_test_sessions")
      .update({
        status: mapped,
        twilio_call_sid: params.CallSid ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    console.log(`${FN} session=${sessionId} status=${mapped}`);
  }

  return new Response("ok");
});
