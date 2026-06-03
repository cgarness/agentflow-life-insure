import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Mirrors bridge usage_metrics shape for Edge merges. */

export type AiTestUsageMetrics = {
  measured_at?: string;
  twilio?: {
    call_duration_sec?: number;
    recording_duration_sec?: number;
    media_stream_sec?: number;
    inbound_audio_sec?: number;
    outbound_audio_sec?: number;
    media_in_count?: number;
    media_out_count?: number;
  };
  deepgram?: {
    agent_ws_sec?: number;
    settings_snapshot?: Record<string, unknown>;
  };
  openai?: Record<string, unknown>;
  transcript?: { user_chars: number; assistant_chars: number };
  prompt_chars?: number;
};

function parseExisting(raw: unknown): AiTestUsageMetrics {
  if (!raw || typeof raw !== "object") return {};
  return raw as AiTestUsageMetrics;
}

export async function mergeUsageMetrics(
  supabase: SupabaseClient,
  sessionId: string,
  patch: Partial<AiTestUsageMetrics>,
): Promise<void> {
  if (!sessionId) return;
  try {
    const { data: row } = await supabase
      .from("ai_test_sessions")
      .select("usage_metrics")
      .eq("id", sessionId)
      .maybeSingle();
    const existing = parseExisting(row?.usage_metrics);
    const merged: AiTestUsageMetrics = {
      ...existing,
      ...patch,
      measured_at: new Date().toISOString(),
      twilio: { ...existing.twilio, ...patch.twilio },
      deepgram: { ...existing.deepgram, ...patch.deepgram },
      openai: { ...existing.openai, ...patch.openai },
      transcript: { ...existing.transcript, ...patch.transcript },
    };
    await supabase
      .from("ai_test_sessions")
      .update({ usage_metrics: merged, updated_at: new Date().toISOString() })
      .eq("id", sessionId);
  } catch (err) {
    console.error("[AI-TEST-WS] usage_metrics merge failed", err);
  }
}
