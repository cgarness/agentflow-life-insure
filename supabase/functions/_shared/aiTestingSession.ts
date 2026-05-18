import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildAgentPrompt,
  type LeadContext,
  normalizeLeadContext,
} from "./aiTestingPrompt.ts";

export type AiTestStack = "twilio_cr" | "xai_s2s" | "openai_realtime";

export type TranscriptEntry = {
  role: "user" | "assistant" | "system";
  text: string;
  at: string;
};

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
      "id, organization_id, stack, prompt, lead_context, to_number, from_number, twilio_call_sid, status, transcript, error_message",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    ...data,
    lead_context: normalizeLeadContext(data.lead_context),
    transcript: Array.isArray(data.transcript) ? data.transcript as TranscriptEntry[] : [],
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
