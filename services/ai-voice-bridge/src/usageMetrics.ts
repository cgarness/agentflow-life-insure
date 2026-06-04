import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranscriptEntry } from "./session.js";

/** Twilio µ-law 8 kHz: 160-byte frames ≈ 20 ms. */
export const TWILIO_MULAW_FRAME_SEC = 0.02;

export type UsageMetricsTwilio = {
  call_duration_sec?: number;
  recording_duration_sec?: number;
  media_stream_sec?: number;
  inbound_audio_sec?: number;
  outbound_audio_sec?: number;
  media_in_count?: number;
  media_out_count?: number;
};

export type UsageMetricsDeepgram = {
  agent_ws_sec?: number;
  settings_snapshot?: Record<string, unknown>;
};

export type UsageMetricsOpenai = {
  model?: string;
  inbound_audio_sec?: number;
  outbound_audio_sec?: number;
  input_audio_tokens?: number;
  output_audio_tokens?: number;
  text_input_tokens?: number;
  text_output_tokens?: number;
  usage_from_api?: boolean;
};

export type UsageMetricsInworld = {
  router_model?: string;
  llm_model?: string;
  tts_model?: string;
  stt_model?: string;
  voice_id?: string;
  bridge_session_sec?: number;
  stt_audio_sec?: number;
  tts_audio_sec?: number;
  tts_characters?: number;
  input_tokens?: number;
  output_tokens?: number;
  usage_from_api?: boolean;
};

export type AiTestUsageMetrics = {
  measured_at?: string;
  twilio?: UsageMetricsTwilio;
  deepgram?: UsageMetricsDeepgram;
  openai?: UsageMetricsOpenai;
  inworld?: UsageMetricsInworld;
  transcript?: { user_chars: number; assistant_chars: number };
  prompt_chars?: number;
};

function parseExisting(raw: unknown): AiTestUsageMetrics {
  if (!raw || typeof raw !== "object") return {};
  return raw as AiTestUsageMetrics;
}

function deepMerge(
  base: AiTestUsageMetrics,
  patch: Partial<AiTestUsageMetrics>,
): AiTestUsageMetrics {
  return {
    ...base,
    ...patch,
    measured_at: patch.measured_at ?? base.measured_at ?? new Date().toISOString(),
    twilio: { ...base.twilio, ...patch.twilio },
    deepgram: { ...base.deepgram, ...patch.deepgram },
    openai: { ...base.openai, ...patch.openai },
    inworld: { ...base.inworld, ...patch.inworld },
    transcript: patch.transcript
      ? {
          user_chars: patch.transcript.user_chars ?? base.transcript?.user_chars ?? 0,
          assistant_chars:
            patch.transcript.assistant_chars ?? base.transcript?.assistant_chars ?? 0,
        }
      : base.transcript,
  };
}

export function transcriptCharCounts(transcript: TranscriptEntry[]): {
  user_chars: number;
  assistant_chars: number;
} {
  let user_chars = 0;
  let assistant_chars = 0;
  for (const e of transcript) {
    const len = e.text?.length ?? 0;
    if (e.role === "user") user_chars += len;
    else if (e.role === "assistant") assistant_chars += len;
  }
  return { user_chars, assistant_chars };
}

export function audioSecFromPacketCount(count: number): number {
  return Math.round(count * TWILIO_MULAW_FRAME_SEC * 1000) / 1000;
}

export function openAiAudioTokensFromSeconds(
  inboundSec: number,
  outboundSec: number,
): { input_audio_tokens: number; output_audio_tokens: number } {
  return {
    input_audio_tokens: Math.ceil(inboundSec * 10),
    output_audio_tokens: Math.ceil(outboundSec * 20),
  };
}

export function extractInworldUsageFromMessage(
  msg: Record<string, unknown>,
): Partial<UsageMetricsInworld> | null {
  const response = msg.response as Record<string, unknown> | undefined;
  const usage = (response?.usage ?? msg.usage) as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== "object") return null;

  const llm = usage.llm as Record<string, unknown> | undefined;
  const tts = usage.tts as Record<string, unknown> | undefined;
  const stt = usage.stt as Record<string, unknown> | undefined;

  return {
    llm_model: llm?.model != null ? String(llm.model) : undefined,
    tts_model: tts?.model != null ? String(tts.model) : undefined,
    stt_model: stt?.model != null ? String(stt.model) : undefined,
    stt_audio_sec: Number(stt?.audio_seconds ?? 0) || undefined,
    tts_audio_sec: Number(tts?.audio_seconds ?? 0) || undefined,
    tts_characters: Number(tts?.characters ?? 0) || undefined,
    input_tokens: Number(usage.input_tokens ?? 0) || undefined,
    output_tokens: Number(usage.output_tokens ?? 0) || undefined,
    usage_from_api: true,
  };
}

export function extractOpenAiUsageFromMessage(msg: Record<string, unknown>): Partial<UsageMetricsOpenai> | null {
  const response = msg.response as Record<string, unknown> | undefined;
  const usage = (response?.usage ?? msg.usage) as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== "object") return null;

  const inputDetails = usage.input_token_details as Record<string, unknown> | undefined;
  const outputDetails = usage.output_token_details as Record<string, unknown> | undefined;

  const inputAudio =
    Number(inputDetails?.audio_tokens ?? usage.input_audio_tokens ?? 0) || 0;
  const outputAudio =
    Number(outputDetails?.audio_tokens ?? usage.output_audio_tokens ?? 0) || 0;
  const textIn = Number(usage.input_tokens ?? 0) - inputAudio;
  const textOut = Number(usage.output_tokens ?? 0) - outputAudio;

  return {
    input_audio_tokens: inputAudio,
    output_audio_tokens: outputAudio,
    text_input_tokens: Math.max(0, textIn),
    text_output_tokens: Math.max(0, textOut),
    usage_from_api: true,
  };
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
      .select("usage_metrics, prompt, transcript")
      .eq("id", sessionId)
      .maybeSingle();
    const existing = parseExisting(row?.usage_metrics);
    const merged = deepMerge(existing, patch);

    if (!merged.transcript?.user_chars && !merged.transcript?.assistant_chars) {
      const transcript = Array.isArray(row?.transcript)
        ? (row.transcript as TranscriptEntry[])
        : [];
      merged.transcript = transcriptCharCounts(transcript);
    }
    if (merged.prompt_chars === undefined && typeof row?.prompt === "string") {
      merged.prompt_chars = row.prompt.length;
    }
    merged.measured_at = new Date().toISOString();

    await supabase
      .from("ai_test_sessions")
      .update({ usage_metrics: merged, updated_at: new Date().toISOString() })
      .eq("id", sessionId);
  } catch (err) {
    console.error("[ai-voice-bridge] usage_metrics merge failed", err);
  }
}

export function buildTwilioStreamPatch(opts: {
  streamStartedAtMs: number | null;
  streamEndedAtMs: number;
  mediaIn: number;
  mediaOut: number;
}): Partial<AiTestUsageMetrics> {
  const inbound_audio_sec = audioSecFromPacketCount(opts.mediaIn);
  const outbound_audio_sec = audioSecFromPacketCount(opts.mediaOut);
  let media_stream_sec: number | undefined;
  if (opts.streamStartedAtMs != null) {
    media_stream_sec =
      Math.round(((opts.streamEndedAtMs - opts.streamStartedAtMs) / 1000) * 1000) / 1000;
  }
  return {
    twilio: {
      media_in_count: opts.mediaIn,
      media_out_count: opts.mediaOut,
      inbound_audio_sec,
      outbound_audio_sec,
      media_stream_sec,
    },
  };
}
