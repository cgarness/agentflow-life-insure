import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AiTestSessionRow, InterruptionSensitivity } from "./aiTestingSession.ts";
import {
  appendDebugLog,
  loadSession,
  sessionAgentInstructions,
} from "./aiTestingSession.ts";
import { normalizeLeadContext, welcomeGreetingFromLead } from "./aiTestingPrompt.ts";

export function openaiRealtimeModel(): string {
  return (Deno.env.get("OPENAI_REALTIME_MODEL") ?? "gpt-realtime-2").trim();
}

export function vadFromInterruption(level: InterruptionSensitivity | null) {
  switch (level) {
    case "low":
      return { type: "server_vad" as const, threshold: 0.7, silence_duration_ms: 800 };
    case "high":
      return { type: "server_vad" as const, threshold: 0.3, silence_duration_ms: 200 };
    case "medium":
    default:
      return { type: "server_vad" as const };
  }
}

/** Body for POST /v1/realtime/calls/{call_id}/accept (SIP incoming). */
export function buildSipAcceptPayload(session: AiTestSessionRow): Record<string, unknown> {
  const voice = session.voice_id?.trim() || "alloy";
  return {
    type: "realtime",
    model: openaiRealtimeModel(),
    instructions: sessionAgentInstructions(session),
    output_modalities: ["audio"],
    audio: {
      input: {
        format: { type: "audio/pcmu" },
        turn_detection: vadFromInterruption(session.interruption_sensitivity),
      },
      output: {
        format: { type: "audio/pcmu" },
        voice,
      },
    },
    ...(session.temperature != null ? { temperature: session.temperature } : {}),
  };
}

/** Plain SIP URI — Twilio rejects query-string headers on Dial Sip (error 13224 / SIP 400). */
export function openaiSipUri(): string {
  const projectId = (Deno.env.get("OPENAI_PROJECT_ID") ?? "").trim();
  if (!projectId) return "";
  return `sip:${projectId}@sip.api.openai.com;transport=tls`;
}

export function sipHeaderValue(
  sipHeaders: Array<{ name?: string; value?: string }> | undefined,
  headerName: string,
): string | null {
  if (!Array.isArray(sipHeaders)) return null;
  const target = headerName.toLowerCase();
  for (const h of sipHeaders) {
    if ((h.name ?? "").toLowerCase() === target) {
      const v = (h.value ?? "").trim();
      return v || null;
    }
  }
  return null;
}

function greetingInstructions(session: AiTestSessionRow): string {
  const line = welcomeGreetingFromLead(session.lead_context);
  return `You just connected on an outbound call. Say this greeting first, naturally: "${line}" Then follow your system instructions to book a 15-minute appointment.`;
}

/**
 * Control WebSocket (no media) — required so the agent speaks first on SIP.
 * Matches OpenAI's realtime-twilio-sip example: accept + response.create over WS.
 */
export async function runOpenAiSipControl(
  supabase: SupabaseClient,
  sessionId: string,
  callId: string,
  session: AiTestSessionRow,
): Promise<void> {
  const apiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  if (!apiKey) return;

  const wsUrl = `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`;
  await appendDebugLog(supabase, sessionId, "info", "openai_sip.control_ws.connecting", {
    callId,
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (event: string, extra?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      void appendDebugLog(supabase, sessionId, "info", event, { callId, ...extra });
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve();
    };

    let ws: WebSocket;
    try {
      // Deno Edge: second arg is subprotocol list, not { headers } (throws "Invalid protocol value").
      ws = new WebSocket(wsUrl, [
        "realtime",
        `openai-insecure-api-key.${apiKey}`,
        "openai-beta.realtime-v1",
      ]);
    } catch (err) {
      reject(err);
      return;
    }

    const guard = setTimeout(() => {
      finish("openai_sip.control_ws.timeout");
    }, 1_800_000);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        type: "response.create",
        response: { instructions: greetingInstructions(session) },
      }));
      void appendDebugLog(supabase, sessionId, "info", "openai_sip.control_ws.greeting_sent", {
        callId,
      });
    });

    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        const type = String(msg.type ?? "");
        if (type === "response.done" || type === "response.completed") {
          void appendDebugLog(supabase, sessionId, "info", "openai_sip.control_ws.response_done", {
            callId,
            type,
          });
        }
        if (type === "error") {
          void appendDebugLog(supabase, sessionId, "error", "openai_sip.control_ws.error", {
            callId,
            error: msg.error ?? msg,
          });
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(guard);
      void appendDebugLog(supabase, sessionId, "error", "openai_sip.control_ws.socket_error", {
        callId,
      });
      finish("openai_sip.control_ws.socket_error");
    });

    ws.addEventListener("close", () => {
      clearTimeout(guard);
      finish("openai_sip.control_ws.closed");
    });
  });
}

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

/** Correlate webhook → session via X-Twilio-CallSid (parent leg) when SIP URI has no custom header. */
export async function resolveSessionForSipWebhook(
  supabase: SupabaseClient,
  sipHeaders: Array<{ name?: string; value?: string }> | undefined,
): Promise<{ sessionId: string; session: AiTestSessionRow } | null> {
  const fromHeader = sipHeaderValue(sipHeaders, "X-AiTestSessionId")?.trim() ?? "";
  if (fromHeader) {
    const session = await loadSession(supabase, fromHeader);
    if (session) return { sessionId: fromHeader, session };
  }

  const twilioCallSid = sipHeaderValue(sipHeaders, "X-Twilio-CallSid")?.trim() ?? "";
  if (!twilioCallSid) return null;

  const { data, error } = await supabase
    .from("ai_test_sessions")
    .select(
      "id, organization_id, stack, prompt, lead_context, to_number, from_number, twilio_call_sid, status, transcript, error_message, voice_id, temperature, speaking_rate, interruption_sensitivity",
    )
    .eq("twilio_call_sid", twilioCallSid)
    .eq("stack", "openai_sip")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const session = {
    ...data,
    lead_context: normalizeLeadContext(data.lead_context),
    transcript: Array.isArray(data.transcript) ? data.transcript : [],
  } as AiTestSessionRow;
  return { sessionId: data.id as string, session };
}

export function deferOpenAiSipControl(
  supabase: SupabaseClient,
  sessionId: string,
  callId: string,
  session: AiTestSessionRow,
): void {
  const task = runOpenAiSipControl(supabase, sessionId, callId, session).catch((err) => {
    void appendDebugLog(supabase, sessionId, "error", "openai_sip.control_ws.task_failed", {
      callId,
      message: err instanceof Error ? err.message : String(err),
    });
  });
  try {
    EdgeRuntime.waitUntil(task);
  } catch {
    void task;
  }
}
