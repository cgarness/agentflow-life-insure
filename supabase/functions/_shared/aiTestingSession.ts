import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildAgentPrompt,
  type LeadContext,
  normalizeLeadContext,
} from "./aiTestingPrompt.ts";

export type AiTestStack =
  | "twilio_cr"
  | "xai_s2s"
  | "openai_realtime"
  | "openai_sip"
  | "deepgram_voice_agent"
  | "hypercheap_voice_agent";

export type TranscriptEntry = {
  role: "user" | "assistant" | "system";
  text: string;
  at: string;
};

export type InterruptionSensitivity = "low" | "medium" | "high";

export type AiTestSessionRow = {
  id: string;
  organization_id: string;
  stack: AiTestStack;
  prompt: string;
  lead_context: LeadContext;
  to_number: string;
  from_number: string;
  twilio_call_sid: string | null;
  status: string;
  transcript: TranscriptEntry[];
  error_message: string | null;
  voice_id: string | null;
  temperature: number | null;
  speaking_rate: number | null;
  interruption_sensitivity: InterruptionSensitivity | null;
  bridge_token: string | null;
  model_id: string | null;
  tunables: Record<string, unknown>;
};

/** Full system instructions for the LLM / voice agent. */
export function sessionAgentInstructions(session: AiTestSessionRow): string {
  return buildAgentPrompt(session.prompt, session.lead_context);
}

export async function loadSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<AiTestSessionRow | null> {
  const { data, error } = await supabase
    .from("ai_test_sessions")
    .select(
      "id, organization_id, stack, prompt, lead_context, to_number, from_number, twilio_call_sid, status, transcript, error_message, voice_id, model_id, temperature, speaking_rate, interruption_sensitivity, bridge_token, tunables",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    ...data,
    lead_context: normalizeLeadContext(data.lead_context),
    transcript: Array.isArray(data.transcript) ? data.transcript as TranscriptEntry[] : [],
    tunables: data.tunables && typeof data.tunables === "object"
      ? data.tunables as Record<string, unknown>
      : {},
  } as AiTestSessionRow;
}

export async function updateSession(
  supabase: SupabaseClient,
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from("ai_test_sessions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
}

export async function appendTranscript(
  supabase: SupabaseClient,
  sessionId: string,
  entry: TranscriptEntry,
): Promise<void> {
  const session = await loadSession(supabase, sessionId);
  if (!session) return;
  const transcript = [...session.transcript, entry];
  await updateSession(supabase, sessionId, { transcript });
}

export type DebugLogLevel = "info" | "warn" | "error";
export type DebugLogEntry = {
  at: string;
  level: DebugLogLevel;
  event: string;
  data?: unknown;
};

/**
 * Append a structured entry to ai_test_sessions.debug_log. Best-effort,
 * never throws — bridge code must keep running even if the DB write fails.
 * Also console.logs with the [AI-TEST-WS] prefix so it shows up in Edge logs.
 */
export async function appendDebugLog(
  supabase: SupabaseClient,
  sessionId: string,
  level: DebugLogLevel,
  event: string,
  data?: unknown,
): Promise<void> {
  const entry: DebugLogEntry = {
    at: new Date().toISOString(),
    level,
    event,
    data: data === undefined ? undefined : safeData(data),
  };
  const consoleFn = level === "error"
    ? console.error
    : level === "warn"
    ? console.warn
    : console.log;
  try {
    consoleFn(`[AI-TEST-WS] ${event} session=${sessionId}`, entry.data ?? "");
  } catch {
    // ignore console failures
  }
  if (!sessionId) return;
  try {
    const { data: row } = await supabase
      .from("ai_test_sessions")
      .select("debug_log")
      .eq("id", sessionId)
      .maybeSingle();
    const existing = Array.isArray(row?.debug_log) ? row!.debug_log as DebugLogEntry[] : [];
    // Cap the log to avoid runaway row size — last 500 entries.
    const next = [...existing, entry].slice(-500);
    await supabase
      .from("ai_test_sessions")
      .update({ debug_log: next, updated_at: new Date().toISOString() })
      .eq("id", sessionId);
  } catch (err) {
    try {
      console.error(`[AI-TEST-WS] debug_log write failed`, err);
    } catch {
      // ignore
    }
  }
}

function safeData(data: unknown): unknown {
  try {
    if (data instanceof Error) {
      return { message: data.message, stack: data.stack?.split("\n").slice(0, 8).join("\n") };
    }
    // Strip non-serializable values via round-trip.
    return JSON.parse(JSON.stringify(data, (_k, v) => {
      if (typeof v === "string" && v.length > 2000) return v.slice(0, 2000) + "...[truncated]";
      return v;
    }));
  } catch {
    return String(data);
  }
}
