// Optional recording callback for AI test calls — ack only (no CRM storage in POC).
import { loadOutboundTwilioCreds } from "../_shared/twilioOutboundCreds.ts";
import {
  twilioFormParams,
  validateTwilioSignature,
} from "../_shared/aiTestingTwilio.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  const url = new URL(req.url);
  const sessionId = (url.searchParams.get("sessionId") ?? "").trim();
  if (!sessionId) return new Response("ok");

  const params = await twilioFormParams(req.clone());
  const credsResult = loadOutboundTwilioCreds();
  if (!credsResult.ok) return new Response("ok");

  const valid = await validateTwilioSignature(
    req,
    credsResult.creds.authToken,
    params,
    "ai-testing-recording-status",
  );
  if (!valid) return new Response("Forbidden", { status: 403 });

  return new Response("ok");
});
