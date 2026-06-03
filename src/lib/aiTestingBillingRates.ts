/** Vendor rate card — sources fetched June 2026. Update RATES_AS_OF when prices change. */

export const RATES_AS_OF = "2026-06-03";

export const BILLING_SOURCE_URLS = {
  twilio: "https://www.twilio.com/en-us/voice/pricing/us",
  deepgram: "https://deepgram.com/pricing",
  openai: "https://openai.com/api/pricing/",
  openaiRealtimeCosts: "https://developers.openai.com/api/docs/guides/realtime-costs",
  openrouter: "https://openrouter.ai/models",
  inworld: "https://inworld.ai/tts",
  fennec: "https://fennec-asr.com/pricing",
} as const;

/** US pay-as-you-go (June 2026). */
export const TWILIO_RATES = {
  outboundVoicePerMin: 0.014,
  mediaStreamPerMin: 0.004,
  recordingPerMin: 0.0025,
} as const;

/** Deepgram Voice Agent Standard — websocket connection time. */
export const DEEPGRAM_VOICE_AGENT_STANDARD_PER_MIN = 0.075;

/** Deepgram Flux streaming STT (Pipeline stack) — estimate per minute of audio. */
export const DEEPGRAM_FLUX_ASR_PER_MIN = 0.0059;

export type OpenAiRealtimeRateRow = {
  modelId: string;
  audioInputPer1M: number;
  audioOutputPer1M: number;
  audioCachedInputPer1M: number;
  textInputPer1M: number;
  textOutputPer1M: number;
};

/** June 2026 OpenAI API pricing page — Realtime family. */
export const OPENAI_REALTIME_RATES: OpenAiRealtimeRateRow[] = [
  {
    modelId: "gpt-realtime-2",
    audioInputPer1M: 32,
    audioOutputPer1M: 64,
    audioCachedInputPer1M: 0.4,
    textInputPer1M: 4,
    textOutputPer1M: 24,
  },
  {
    modelId: "gpt-realtime",
    audioInputPer1M: 32,
    audioOutputPer1M: 64,
    audioCachedInputPer1M: 0.4,
    textInputPer1M: 4,
    textOutputPer1M: 24,
  },
  {
    modelId: "gpt-realtime-1.5",
    audioInputPer1M: 32,
    audioOutputPer1M: 64,
    audioCachedInputPer1M: 0.4,
    textInputPer1M: 4,
    textOutputPer1M: 24,
  },
];

const DEFAULT_OPENAI_MODEL = "gpt-realtime";

export function getOpenAiRealtimeRates(modelId: string | null | undefined): OpenAiRealtimeRateRow {
  const id = (modelId ?? DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
  return (
    OPENAI_REALTIME_RATES.find((r) => r.modelId === id) ??
    OPENAI_REALTIME_RATES.find((r) => r.modelId === DEFAULT_OPENAI_MODEL)!
  );
}

// ---------------------------------------------------------------------------
// Hypercheap stack (Fennec ASR → OpenRouter LLM → Inworld TTS).
// These are ESTIMATES — provider invoices remain authoritative. Update when
// confirmed list prices land.
// ---------------------------------------------------------------------------

/** Fennec ASR streaming — per minute of audio transcribed. */
export const FENNEC_ASR_PER_MIN = 0.006;

/** Inworld TTS (inworld-tts-1) — per 1,000 generated characters. */
export const INWORLD_TTS_PER_1K_CHARS = 0.005;

export type OpenRouterRateRow = {
  modelId: string;
  promptPer1M: number;
  completionPer1M: number;
};

/** OpenRouter list prices for the curated fast/cheap models (USD per 1M tokens). */
export const OPENROUTER_RATES: OpenRouterRateRow[] = [
  { modelId: "google/gemini-2.0-flash-001", promptPer1M: 0.1, completionPer1M: 0.4 },
  { modelId: "google/gemini-2.0-flash-lite-001", promptPer1M: 0.075, completionPer1M: 0.3 },
  { modelId: "google/gemini-2.5-flash", promptPer1M: 0.15, completionPer1M: 0.6 },
  { modelId: "google/gemini-2.5-flash-lite", promptPer1M: 0.1, completionPer1M: 0.4 },
  { modelId: "openai/gpt-4.1-nano", promptPer1M: 0.1, completionPer1M: 0.4 },
  { modelId: "openai/gpt-4o-mini", promptPer1M: 0.15, completionPer1M: 0.6 },
  { modelId: "openai/gpt-4.1-mini", promptPer1M: 0.4, completionPer1M: 1.6 },
  { modelId: "openai/gpt-4o", promptPer1M: 2.5, completionPer1M: 10 },
  { modelId: "anthropic/claude-3-5-haiku", promptPer1M: 0.8, completionPer1M: 4 },
  { modelId: "anthropic/claude-3-5-haiku-20241022", promptPer1M: 0.8, completionPer1M: 4 },
  { modelId: "anthropic/claude-3-haiku", promptPer1M: 0.25, completionPer1M: 1.25 },
  { modelId: "deepseek/deepseek-chat", promptPer1M: 0.14, completionPer1M: 0.28 },
  { modelId: "deepseek/deepseek-chat-v3-0324", promptPer1M: 0.14, completionPer1M: 0.28 },
  { modelId: "meta-llama/llama-3.3-70b-instruct", promptPer1M: 0.12, completionPer1M: 0.3 },
  { modelId: "meta-llama/llama-3.1-8b-instruct", promptPer1M: 0.05, completionPer1M: 0.08 },
  { modelId: "meta-llama/llama-3.2-3b-instruct", promptPer1M: 0.04, completionPer1M: 0.06 },
  { modelId: "mistralai/mistral-small-3.1-24b-instruct", promptPer1M: 0.1, completionPer1M: 0.3 },
  { modelId: "mistralai/mistral-small-3.2-24b-instruct", promptPer1M: 0.1, completionPer1M: 0.3 },
  { modelId: "qwen/qwen-2.5-7b-instruct", promptPer1M: 0.04, completionPer1M: 0.1 },
  { modelId: "moonshotai/kimi-latest", promptPer1M: 0.4, completionPer1M: 1.9 },
  { modelId: "moonshotai/kimi-k2.5", promptPer1M: 0.4, completionPer1M: 1.9 },
  { modelId: "moonshotai/kimi-k2-0905", promptPer1M: 0.6, completionPer1M: 2.5 },
  { modelId: "moonshotai/kimi-k2-0711", promptPer1M: 0.6, completionPer1M: 2.5 },
  { modelId: "moonshotai/kimi-k2.6", promptPer1M: 0.45, completionPer1M: 2.25 },
];

const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.0-flash-001";

export function getOpenRouterRates(modelId: string | null | undefined): OpenRouterRateRow {
  const id = (modelId ?? DEFAULT_OPENROUTER_MODEL).trim() || DEFAULT_OPENROUTER_MODEL;
  return (
    OPENROUTER_RATES.find((r) => r.modelId === id) ??
    // Unknown/free-text model — fall back to the cheap default rate row but keep
    // the requested id so the UI shows what the user picked.
    { ...OPENROUTER_RATES.find((r) => r.modelId === DEFAULT_OPENROUTER_MODEL)!, modelId: id }
  );
}
