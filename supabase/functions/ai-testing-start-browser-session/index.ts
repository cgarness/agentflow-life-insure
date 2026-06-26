import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import {
  aiTestingCorsHeaders,
  aiTestingJson,
  requireSuperAdminAuth,
} from "../_shared/aiTestingAuth.ts";
import {
  aiVoiceMonitorWssBase,
  buildBrowserDeepgramStreamUrl,
  buildBrowserInworldStreamUrl,
  buildBrowserOpenAIStreamUrl,
  generateBridgeToken,
  inworldBridgeWssBase,
} from "../_shared/aiTestingBridgeToken.ts";
import { appendDebugLog } from "../_shared/aiTestingSession.ts";
import { normalizeLeadContext } from "../_shared/aiTestingPrompt.ts";

const FN = "[ai-testing-start-browser-session]";

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
  stack: z.enum(["deepgram_voice_agent", "inworld_realtime_agent", "openai_realtime"]),
  prompt: z.string().min(10).max(12000),
  lead_context: LeadContextSchema,
  voice_id: z.string().min(1).max(120).optional(),
  model_id: z.string().min(1).max(120).optional(),
  temperature: z.number().min(0).max(1.2).optional(),
  speaking_rate: z.number().min(0.5).max(1.5).optional(),
  interruption_sensitivity: z.enum(["low", "medium", "high"]).optional(),
  max_response_tokens: z.number().int().min(32).max(2048).optional(),
  tts_model: z.enum(["inworld-tts-1", "inworld-tts-2"]).optional(),
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

  const stack = body.stack;

  if (stack === "deepgram_voice_agent" && !aiVoiceMonitorWssBase()) {
    return aiTestingJson({
      success: false,
      error: "AI_VOICE_MONITOR_URL (or AI_VOICE_BRIDGE_WSS_URL) not configured on server",
    }, 503);
  }
  if (stack === "inworld_realtime_agent" && !inworldBridgeWssBase()) {
    return aiTestingJson({
      success: false,
      error: "INWORLD_VOICE_BRIDGE_WSS_URL (or AI_VOICE_MONITOR_URL) not configured on server",
    }, 503);
  }
  if (stack === "openai_realtime" && !aiVoiceMonitorWssBase()) {
    return aiTestingJson({
      success: false,
      error: "AI_VOICE_MONITOR_URL (or AI_VOICE_BRIDGE_WSS_URL) not configured on server",
    }, 503);
  }

  const bridgeToken = generateBridgeToken();

  const tunables: Record<string, unknown> = {};
  if (stack === "inworld_realtime_agent") {
    if (body.max_response_tokens !== undefined) tunables.max_response_tokens = body.max_response_tokens;
    if (body.tts_model !== undefined) tunables.tts_model = body.tts_model;
  }

  const { data: session, error: insertErr } = await ctx.supabase
    .from("ai_test_sessions")
    .insert({
      organization_id: ctx.organizationId,
      created_by: ctx.user.id,
      stack,
      transport: "browser",
      prompt: body.prompt.trim(),
      lead_context: normalizeLeadContext(body.lead_context ?? {}),
      to_number: null,
      from_number: null,
      status: "queued",
      transcript: [],
      voice_id: body.voice_id ?? null,
      model_id: body.model_id ?? null,
      temperature: body.temperature ?? null,
      speaking_rate: body.speaking_rate ?? null,
      interruption_sensitivity: body.interruption_sensitivity ?? null,
      bridge_token: bridgeToken,
      tunables,
    })
    .select("id")
    .single();

  if (insertErr || !session?.id) {
    console.error(`${FN} insert failed:`, insertErr?.message);
    return aiTestingJson({ success: false, error: "Could not create test session" }, 500);
  }

  const sessionId = session.id as string;

  const wsUrl =
    stack === "deepgram_voice_agent"
      ? buildBrowserDeepgramStreamUrl(sessionId)
      : stack === "inworld_realtime_agent"
        ? buildBrowserInworldStreamUrl(sessionId)
        : buildBrowserOpenAIStreamUrl(sessionId);

  if (!wsUrl) {
    await ctx.supabase
      .from("ai_test_sessions")
      .update({ status: "failed", error_message: "Bridge URL not configured", updated_at: new Date().toISOString() })
      .eq("id", sessionId);
    return aiTestingJson({ success: false, error: "Bridge URL not configured on server" }, 503);
  }

  await appendDebugLog(ctx.supabase, sessionId, "info", "session.created", {
    stack,
    transport: "browser",
    hasBridgeToken: true,
  });

  console.log(`${FN} created browser session`, { sessionId, stack });

  return aiTestingJson({
    success: true,
    sessionId,
    bridgeToken,
    wsUrl,
    stack,
  });
});
