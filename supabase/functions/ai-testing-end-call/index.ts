import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import {
  aiTestingCorsHeaders,
  aiTestingJson,
  requireSuperAdminAuth,
} from "../_shared/aiTestingAuth.ts";
import { loadOutboundTwilioCreds } from "../_shared/twilioOutboundCreds.ts";

const FN = "[ai-testing-end-call]";

const BodySchema = z.object({
  sessionId: z.string().uuid(),
});

const ENDABLE_STATUSES = new Set([
  "queued",
  "placing",
  "ringing",
  "in-progress",
]);

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

  const { data: session, error: loadErr } = await ctx.supabase
    .from("ai_test_sessions")
    .select("id, organization_id, status, twilio_call_sid, transport")
    .eq("id", body.sessionId)
    .maybeSingle();

  if (loadErr || !session) {
    return aiTestingJson({ success: false, error: "Session not found" }, 404);
  }
  if (session.organization_id !== ctx.organizationId) {
    return aiTestingJson({ success: false, error: "Session not found" }, 404);
  }

  const status = String(session.status ?? "");
  if (!ENDABLE_STATUSES.has(status)) {
    return aiTestingJson({ success: false, error: `Call is already ${status || "ended"}` }, 409);
  }

  const callSid = String(session.twilio_call_sid ?? "").trim();
  if (callSid) {
    const credsResult = loadOutboundTwilioCreds();
    if (!credsResult.ok) {
      return aiTestingJson(
        { success: false, error: credsResult.error, code: credsResult.code },
        credsResult.status,
      );
    }
    const { accountSid, authToken } = credsResult.creds;

    const twilioStatus = status === "in-progress" ? "completed" : "canceled";
    const form = new URLSearchParams({ Status: twilioStatus });
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );

    if (!twilioRes.ok) {
      const twilioData = await twilioRes.json().catch(() => ({})) as Record<string, unknown>;
      const errMsg = String(twilioData.message ?? "Twilio could not end the call");
      console.error(`${FN} update call failed:`, errMsg);
      return aiTestingJson({ success: false, error: errMsg }, 502);
    }
  }

  // Browser sessions never dialed out — a clean stop is a completed session,
  // not a canceled call. Phone sessions stay "canceled".
  const finalStatus = session.transport === "browser" ? "completed" : "canceled";

  await ctx.supabase
    .from("ai_test_sessions")
    .update({
      status: finalStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.sessionId);

  console.log(`${FN} ended session=${body.sessionId} callSid=${callSid || "(none)"} status=${finalStatus}`);

  return aiTestingJson({ success: true, sessionId: body.sessionId, status: finalStatus });
});
