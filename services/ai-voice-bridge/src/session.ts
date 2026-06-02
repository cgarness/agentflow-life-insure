import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAgentPrompt, normalizeLeadContext, type LeadContext } from "./prompt.js";

export type InterruptionSensitivity = "low" | "medium" | "high";

export type TranscriptEntry = {
  role: "user" | "assistant" | "system";
  text: string;
  at: string;
};

export type AiTestSessionRow = {
  id: string;
  organization_id: string;
  stack: string;
  prompt: string;
  lead_context: LeadContext;
  status: string;
  transcript: TranscriptEntry[];
  voice_id: string | null;
  temperature: number | null;
  speaking_rate: number | null;
  interruption_sensitivity: InterruptionSensitivity | null;
};

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
      "id, organization_id, stack, prompt, lead_context, status, transcript, voice_id, temperature, speaking_rate, interruption_sensitivity",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    ...data,
    lead_context: normalizeLeadContext(data.lead_context),
    transcript: Array.isArray(data.transcript) ? (data.transcript as TranscriptEntry[]) : [],
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
  const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  consoleFn(`[AI-TEST-WS] ${event} session=${sessionId}`, entry.data ?? "");

  if (!sessionId) return;
  try {
    const { data: row } = await supabase
      .from("ai_test_sessions")
      .select("debug_log")
      .eq("id", sessionId)
      .maybeSingle();
    const existing = Array.isArray(row?.debug_log) ? (row.debug_log as DebugLogEntry[]) : [];
    const next = [...existing, entry].slice(-500);
    await supabase
      .from("ai_test_sessions")
      .update({ debug_log: next, updated_at: new Date().toISOString() })
      .eq("id", sessionId);
  } catch (err) {
    console.error("[AI-TEST-WS] debug_log write failed", err);
  }
}

function safeData(data: unknown): unknown {
  try {
    if (data instanceof Error) {
      return { message: data.message, stack: data.stack?.split("\n").slice(0, 8).join("\n") };
    }
    return JSON.parse(
      JSON.stringify(data, (_k, v) => {
        if (typeof v === "string" && v.length > 2000) return `${v.slice(0, 2000)}...[truncated]`;
        return v;
      }),
    );
  } catch {
    return String(data);
  }
}
