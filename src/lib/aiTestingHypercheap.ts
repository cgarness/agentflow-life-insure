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

export type OpenRouterModelEntry = {
  id: string;
  label: string;
  provider:
    | "google"
    | "openai"
    | "anthropic"
    | "deepseek"
    | "meta"
    | "mistral"
    | "qwen"
    | "moonshot";
};

/** Curated fast/cheap OpenRouter models for the Hypercheap stack dropdown. */
export const OPENROUTER_MODEL_CATALOG: OpenRouterModelEntry[] = [
  {
    id: "google/gemini-2.0-flash-001",
    label: "Gemini 2.0 Flash — fastest, cheapest",
    provider: "google",
  },
  {
    id: "google/gemini-2.0-flash-lite-001",
    label: "Gemini 2.0 Flash Lite — ultra cheap",
    provider: "google",
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash — fast, smarter",
    provider: "google",
  },
  {
    id: "google/gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite — lowest latency",
    provider: "google",
  },
  {
    id: "openai/gpt-4.1-nano",
    label: "GPT-4.1 Nano — fastest OpenAI",
    provider: "openai",
  },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini — fast, cheap", provider: "openai" },
  { id: "openai/gpt-4.1-mini", label: "GPT-4.1 mini — balanced", provider: "openai" },
  { id: "openai/gpt-4o", label: "GPT-4o — higher quality", provider: "openai" },
  {
    id: "anthropic/claude-3-5-haiku",
    label: "Claude 3.5 Haiku — fast, strong",
    provider: "anthropic",
  },
  {
    id: "anthropic/claude-3-5-haiku-20241022",
    label: "Claude 3.5 Haiku (Oct 2024) — versioned slug",
    provider: "anthropic",
  },
  { id: "anthropic/claude-3-haiku", label: "Claude 3 Haiku — legacy fast", provider: "anthropic" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek Chat — very cheap", provider: "deepseek" },
  {
    id: "deepseek/deepseek-chat-v3-0324",
    label: "DeepSeek Chat V3 (0324)",
    provider: "deepseek",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    label: "Llama 3.3 70B — open, cheap",
    provider: "meta",
  },
  {
    id: "meta-llama/llama-3.1-8b-instruct",
    label: "Llama 3.1 8B — smallest Meta",
    provider: "meta",
  },
  {
    id: "meta-llama/llama-3.2-3b-instruct",
    label: "Llama 3.2 3B — ultra small",
    provider: "meta",
  },
  {
    id: "mistralai/mistral-small-3.1-24b-instruct",
    label: "Mistral Small 3.1 — fast",
    provider: "mistral",
  },
  {
    id: "mistralai/mistral-small-3.2-24b-instruct",
    label: "Mistral Small 3.2 — newer",
    provider: "mistral",
  },
  { id: "qwen/qwen-2.5-7b-instruct", label: "Qwen 2.5 7B — fast, cheap", provider: "qwen" },
  {
    id: "moonshotai/kimi-latest",
    label: "Kimi Latest — always newest Moonshot model",
    provider: "moonshot",
  },
  {
    id: "moonshotai/kimi-k2.5",
    label: "Kimi K2.5 — Moonshot multimodal (good default)",
    provider: "moonshot",
  },
  {
    id: "moonshotai/kimi-k2-0905",
    label: "Kimi K2 (Sep 2025) — strong MoE, 256k context",
    provider: "moonshot",
  },
  {
    id: "moonshotai/kimi-k2-0711",
    label: "Kimi K2 (Jul 2025) — agentic MoE",
    provider: "moonshot",
  },
  {
    id: "moonshotai/kimi-k2.6",
    label: "Kimi K2.6 — newest (slower; best for complex turns)",
    provider: "moonshot",
  },
];

/** @deprecated Use OPENROUTER_MODEL_CATALOG */
export const OPENROUTER_MODEL_SUGGESTIONS = OPENROUTER_MODEL_CATALOG;

const PROVIDER_LABELS: Record<OpenRouterModelEntry["provider"], string> = {
  google: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  meta: "Meta Llama",
  mistral: "Mistral",
  qwen: "Qwen",
  moonshot: "Moonshot AI (Kimi)",
};

export type OpenRouterModelGroup = { provider: OpenRouterModelEntry["provider"]; label: string; models: OpenRouterModelEntry[] };

/** Grouped catalog for `<optgroup>` in the Hypercheap model select. */
export function openRouterModelGroups(selectedId?: string): OpenRouterModelGroup[] {
  const id = selectedId?.trim();
  const order: OpenRouterModelEntry["provider"][] = [
    "google",
    "openai",
    "anthropic",
    "deepseek",
    "meta",
    "mistral",
    "qwen",
    "moonshot",
  ];
  const groups = order
    .map((provider) => ({
      provider,
      label: PROVIDER_LABELS[provider],
      models: OPENROUTER_MODEL_CATALOG.filter((m) => m.provider === provider),
    }))
    .filter((g) => g.models.length > 0);

  if (id && !OPENROUTER_MODEL_CATALOG.some((m) => m.id === id)) {
    groups.push({
      provider: "qwen",
      label: "Saved model",
      models: [{ id, label: id, provider: "qwen" }],
    });
  }
  return groups;
}

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
