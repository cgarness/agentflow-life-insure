import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  appendDebugLog,
  loadSession,
  updateSession,
} from "../_shared/aiTestingSession.ts";
import {
  buildSipAcceptPayload,
  deferOpenAiSipControl,
  sipHeaderValue,
} from "../_shared/openaiRealtimeSip.ts";
import { verifyOpenAIWebhook } from "../_shared/openaiWebhookVerify.ts";

const FN = "[ai-testing-openai-webhook]";
const SESSION_HEADER = "X-AiTestSessionId";

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return null;
  return createClient(url, key);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  const webhookSecret = (Deno.env.get("OPENAI_WEBHOOK_SECRET") ?? "").trim();
  if (!apiKey || !webhookSecret) {
    console.error(`${FN} missing OPENAI_API_KEY or OPENAI_WEBHOOK_SECRET`);
    return new Response("Server misconfigured", { status: 503 });
  }

  const rawBody = await req.text();
  const verified = await verifyOpenAIWebhook(rawBody, req.headers, webhookSecret);
  if (!verified.ok) {
    console.warn(`${FN} signature failed: ${verified.reason}`);
    return new Response(verified.reason, { status: 400 });
  }

  const event = verified.event;
  const eventType = String(event.type ?? "");

  if (eventType !== "realtime.call.incoming") {
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = getSupabase();
  if (!supabase) {
    console.error(`${FN} supabase env missing`);
    return new Response("Server error", { status: 500 });
  }

  const data = (event.data && typeof event.data === "object")
    ? event.data as Record<string, unknown>
    : {};
  const callId = String(data.call_id ?? "").trim();
  const sipHeaders = data.sip_headers as Array<{ name?: string; value?: string }> | undefined;
  const sessionId = sipHeaderValue(sipHeaders, SESSION_HEADER)?.trim() ?? "";

  if (!callId) {
    console.warn(`${FN} missing call_id on incoming event`);
    return new Response("Missing call_id", { status: 400 });
  }

  if (!sessionId) {
    console.warn(`${FN} missing ${SESSION_HEADER} in sip_headers`);
    return new Response("Missing session correlation header", { status: 400 });
  }

  await appendDebugLog(supabase, sessionId, "info", "openai_webhook.incoming", {
    callId,
    eventId: event.id,
    sipHeaderNames: Array.isArray(sipHeaders)
      ? sipHeaders.map((h) => h.name).filter(Boolean)
      : [],
  });

  const session = await loadSession(supabase, sessionId);
  if (!session) {
    await appendDebugLog(supabase, sessionId, "error", "openai_webhook.session_not_found", {
      callId,
    });
    return new Response("Session not found", { status: 404 });
  }

  if (session.stack !== "openai_sip") {
    await appendDebugLog(supabase, sessionId, "warn", "openai_webhook.wrong_stack", {
      stack: session.stack,
      callId,
    });
  }

  const acceptBody = buildSipAcceptPayload(session);
  const acceptRes = await fetch(
    `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/accept`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(acceptBody),
    },
  );

  const acceptText = await acceptRes.text().catch(() => "");
  if (!acceptRes.ok) {
    const errMsg = acceptText.slice(0, 500) || `OpenAI accept failed (${acceptRes.status})`;
    console.error(`${FN} accept failed:`, errMsg);
    await appendDebugLog(supabase, sessionId, "error", "openai_webhook.accept_failed", {
      callId,
      status: acceptRes.status,
      body: errMsg,
    });
    await updateSession(supabase, sessionId, {
      status: "failed",
      error_message: errMsg,
    });
    return new Response(errMsg, { status: 502 });
  }

  await updateSession(supabase, sessionId, {
    status: "in-progress",
    error_message: null,
  });
  await appendDebugLog(supabase, sessionId, "info", "openai_webhook.accepted", {
    callId,
    model: acceptBody.model,
    voice: (acceptBody.audio as Record<string, unknown>)?.output,
  });

  deferOpenAiSipControl(supabase, sessionId, callId, session);

  console.log(`${FN} accepted call ${callId} for session ${sessionId}`);

  return new Response(JSON.stringify({ received: true, accepted: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
