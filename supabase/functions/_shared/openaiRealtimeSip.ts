import type { AiTestSessionRow, InterruptionSensitivity } from "./aiTestingSession.ts";
import { sessionAgentInstructions } from "./aiTestingSession.ts";

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
    audio: {
      input: {
        turn_detection: vadFromInterruption(session.interruption_sensitivity),
      },
      output: {
        voice,
      },
    },
    ...(session.temperature != null ? { temperature: session.temperature } : {}),
  };
}

export function openaiSipUri(sessionId: string): string {
  const projectId = (Deno.env.get("OPENAI_PROJECT_ID") ?? "").trim();
  if (!projectId) return "";
  const header = `X-AiTestSessionId=${encodeURIComponent(sessionId)}`;
  return `sip:${projectId}@sip.api.openai.com;transport=tls?${header}`;
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
