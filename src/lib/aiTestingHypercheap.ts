/**
 * Hypercheap Voice Agent (Fennec ASR → OpenRouter LLM → Inworld TTS) — frontend
 * defaults + catalogs. AI Testing only. Provider keys live on Render, never here.
 *
 * Safe defaults (per spec): Fennec 16k / mono, OpenRouter OpenAI-compatible base
 * URL + a fast/cheap model, Inworld inworld-tts-1. The Render service holds the
 * authoritative defaults; these drive the UI and per-session overrides.
 */

export type VadAggressiveness = "low" | "medium" | "high";

export const FENNEC_SAMPLE_RATE = 16000;
export const FENNEC_CHANNELS = 1;
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const INWORLD_MODEL_ID = "inworld-tts-1";

/** Default fast + cheap OpenRouter model (first-token latency optimized). */
export const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.0-flash-001";

/** Curated fast/cheap OpenRouter models, selectable in the UI dropdown. */
export type OpenRouterModelEntry = { id: string; label: string };
export const OPENROUTER_MODEL_SUGGESTIONS: OpenRouterModelEntry[] = [
  { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash — fastest, cheapest" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash — fast, smarter" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini — fast, cheap" },
  { id: "openai/gpt-4.1-mini", label: "GPT-4.1 mini — balanced" },
  { id: "anthropic/claude-3-5-haiku", label: "Claude 3.5 Haiku — fast, strong" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek Chat — very cheap" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B — open, cheap" },
  { id: "mistralai/mistral-small-3.1-24b-instruct", label: "Mistral Small 3.1 — fast" },
];

export const DEFAULT_MAX_RESPONSE_TOKENS = 256;
export const DEFAULT_VAD_AGGRESSIVENESS: VadAggressiveness = "medium";

export type HypercheapTuning = {
  voice_id: string;
  model_id: string;
  temperature: number;
  max_response_tokens: number;
  vad_aggressiveness: VadAggressiveness;
};

export const DEFAULT_HYPERCHEAP_TUNING: HypercheapTuning = {
  voice_id: "Ashley",
  model_id: DEFAULT_OPENROUTER_MODEL,
  temperature: 0.7,
  max_response_tokens: DEFAULT_MAX_RESPONSE_TOKENS,
  vad_aggressiveness: DEFAULT_VAD_AGGRESSIVENESS,
};
