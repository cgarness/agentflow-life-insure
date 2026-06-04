/** Persisted on ai_test_sessions.usage_metrics — written by bridge + Edge callbacks. */

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
  hypercheap?: {
    bridge_session_sec?: number;
    fennec_asr_sec?: number;
    inworld_chars?: number;
    inworld_audio_sec?: number;
    openrouter_prompt_tokens?: number;
    openrouter_completion_tokens?: number;
    openrouter_model?: string;
    usage_from_api?: boolean;
  };
  pipeline?: {
    bridge_session_sec?: number;
    deepgram_flux_asr_sec?: number;
    inworld_chars?: number;
    inworld_audio_sec?: number;
    openrouter_prompt_tokens?: number;
    openrouter_completion_tokens?: number;
    openrouter_model?: string;
    usage_from_api?: boolean;
  };
  openai?: {
    model?: string;
    inbound_audio_sec?: number;
    outbound_audio_sec?: number;
    input_audio_tokens?: number;
    output_audio_tokens?: number;
    text_input_tokens?: number;
    text_output_tokens?: number;
    usage_from_api?: boolean;
  };
  inworld?: {
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
  transcript?: {
    user_chars: number;
    assistant_chars: number;
  };
  prompt_chars?: number;
};

export function emptyUsageMetrics(): AiTestUsageMetrics {
  return {};
}

export function parseUsageMetrics(raw: unknown): AiTestUsageMetrics {
  if (!raw || typeof raw !== "object") return {};
  return raw as AiTestUsageMetrics;
}
