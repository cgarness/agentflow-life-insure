import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { loadOutboundTwilioCreds } from "../_shared/twilioOutboundCreds.ts";
import {
  aiTestingCorsHeaders,
  aiTestingJson,
  requireSuperAdminAuth,
} from "../_shared/aiTestingAuth.ts";
import { edgeFunctionUrl, toE164Plus } from "../_shared/aiTestingTwilio.ts";
import { appendDebugLog, type AiTestStack } from "../_shared/aiTestingSession.ts";
import { normalizeLeadContext } from "../_shared/aiTestingPrompt.ts";

const FN = "[ai-testing-place-call]";

const LeadContextSchema = z.object({
  first_name: z.string().max(80).optional(),
  last_name: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(40).optional(),
  age: z.string().max(20).optional(),
  lead_source: z.string().max(120).optional(),
  product_interest: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
  agency_name: z.string().max(120).optional(),
  agent_name: z.string().max(80).optional(),
}).optional();

const BodySchema = z.object({
  to: z.string().min(8),
  from: z.string().min(8),
  stack: z.enum(["twilio_cr", "xai_s2s", "openai_realtime"]),
  prompt: z.string().min(10).max(12000),
  lead_context: LeadContextSchema,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: aiTestingCorsHeaders });
  if (req.method !== "POST") return aiTestingJson({ success: false, error: "Method not allowed" }, 405);

  const auth = await requireSuperAdminAuth(req);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid body";
    return aiTestingJson({ success: false, error: msg }, 400);
  }

  const to = toE164Plus(body.to);
  const from = toE164Plus(body.from);
  if (!to || !from) {
    return aiTestingJson({ success: false, error: "Invalid To or From phone number" }, 400);
  }

  const stack = body.stack as AiTestStack;

  if (stack === "twilio_cr" && !Deno.env.get("OPENAI_API_KEY")) {
    return aiTestingJson({ success: false, error: "OPENAI_API_KEY not configured on server" }, 503);
  }
  if (stack === "xai_s2s" && !Deno.env.get("XAI_API_KEY")) {
    return aiTestingJson({ success: false, error: "XAI_API_KEY not configured on server" }, 503);
  }
  if (stack === "openai_realtime" && !Deno.env.get("OPENAI_API_KEY")) {
    return aiTestingJson({ success: false, error: "OPENAI_API_KEY not configured on server" }, 503);
  }

  const credsResult = loadOutboundTwilioCreds();
  if (!credsResult.ok) {
    return aiTestingJson(
      { success: false, error: credsResult.error, code: credsResult.code },
      credsResult.status,
    );
  }
  const { accountSid, authToken } = credsResult.creds;

  const { data: session, error: insertErr } = await ctx.supabase
    .from("ai_test_sessions")
    .insert({
      organization_id: ctx.organizationId,
      created_by: ctx.user.id,
      stack,
      prompt: body.prompt.trim(),
      lead_context: normalizeLeadContext(body.lead_context ?? {}),
      to_number: to,
      from_number: from,
      status: "queued",
      transcript: [],
    })
    .select("id")
    .single();

  if (insertErr || !session?.id) {
    console.error(`${FN} insert failed:`, insertErr?.message);
    return aiTestingJson({ success: false, error: "Could not create test session" }, 500);
  }

  const sessionId = session.id as string;
  const twimlUrl = edgeFunctionUrl(
    "ai-testing-twiml",
    `sessionId=${encodeURIComponent(sessionId)}`,
  );
  const statusUrl = edgeFunctionUrl(
    "ai-testing-status",
    `sessionId=${encodeURIComponent(sessionId)}`,
  );

  await appendDebugLog(ctx.supabase, sessionId, "info", "place_call.start", {
    stack,
    to,
    from,
    twimlUrl,
    statusUrl,
    accountSid: accountSid.slice(0, 6) + "…",
    promptLength: body.prompt.length,
  });

  const form = new URLSearchParams({
    To: to,
    From: from,
    Url: twimlUrl,
    Method: "POST",
    StatusCallback: statusUrl,
    StatusCallbackMethod: "POST",
    StatusCallbackEvent: "initiated ringing answered completed",
  });

  const twilioRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
  );

  const twilioData = await twilioRes.json().catch(() => ({})) as Record<string, unknown>;
  if (!twilioRes.ok) {
    const errMsg = String(twilioData.message ?? "Twilio rejected the call");
    console.error(`${FN} calls.create failed:`, errMsg);
    await appendDebugLog(ctx.supabase, sessionId, "error", "place_call.twilio_rejected", {
      status: twilioRes.status,
      error: errMsg,
      twilioCode: twilioData.code,
      twilioMoreInfo: twilioData.more_info,
    });
    await ctx.supabase
      .from("ai_test_sessions")
      .update({
        status: "failed",
        error_message: errMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    return aiTestingJson({ success: false, error: errMsg }, 502);
  }

  const callSid = String(twilioData.sid ?? "");
  await ctx.supabase
    .from("ai_test_sessions")
    .update({
      twilio_call_sid: callSid,
      status: "ringing",
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
  await appendDebugLog(ctx.supabase, sessionId, "info", "place_call.placed", {
    callSid,
    twilioStatus: twilioData.status,
  });

  console.log(`${FN} placed call`, { sessionId, stack, callSid, to, from });

  return aiTestingJson({
    success: true,
    sessionId,
    callSid,
    stack,
  });
});
