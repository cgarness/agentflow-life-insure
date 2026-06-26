export type DeepgramLlmProvider = "open_ai" | "anthropic" | "google";
export type DeepgramLlmTier = "Standard" | "Advanced";

export type DeepgramLlmEntry = {
  /** Stable composite value stored in ai_test_sessions.model_id */
  id: string;
  provider: DeepgramLlmProvider;
  model: string;
  label: string;
  tier: DeepgramLlmTier;
  description: string;
  recommended?: boolean;
};

export type DeepgramLlmGroup = {
  label: string;
  entries: DeepgramLlmEntry[];
};

const FALLBACK_SELECTION = {
  provider: "open_ai" as const,
  model: "gpt-4o-mini",
  tier: "Standard" as const,
};

const ALLOWED_PROVIDERS = new Set<DeepgramLlmProvider>(["open_ai", "anthropic", "google"]);

/** Managed LLM models via Deepgram Voice Agent think.provider (no custom endpoints). */
export const DEEPGRAM_LLM_CATALOG: DeepgramLlmEntry[] = [
  {
    id: "open_ai:gpt-4o-mini",
    provider: "open_ai",
    model: "gpt-4o-mini",
    label: "GPT-4o mini — Fast baseline",
    tier: "Standard",
    description: "Fast, lower-cost baseline",
  },
  {
    id: "open_ai:gpt-4o",
    provider: "open_ai",
    model: "gpt-4o",
    label: "GPT-4o — Premium baseline",
    tier: "Advanced",
    description: "Higher-quality current baseline",
  },
  {
    id: "open_ai:gpt-4.1-mini",
    provider: "open_ai",
    model: "gpt-4.1-mini",
    label: "GPT-4.1 mini — Fast OpenAI",
    tier: "Standard",
    description: "Standard-tier OpenAI alternative",
  },
  {
    id: "open_ai:gpt-5-mini",
    provider: "open_ai",
    model: "gpt-5-mini",
    label: "GPT-5 mini — Fast OpenAI",
    tier: "Standard",
    description: "Newer Standard-tier OpenAI option",
  },
  {
    id: "anthropic:claude-4-5-haiku",
    provider: "anthropic",
    model: "claude-4-5-haiku",
    label: "Claude Haiku — Natural fast",
    tier: "Standard",
    description: "Recommended first test for natural appointment-setting flow",
    recommended: true,
  },
  {
    id: "anthropic:claude-sonnet-4-5",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5 — Premium natural",
    tier: "Advanced",
    description: "Premium natural conversation and objection handling",
  },
  {
    id: "anthropic:claude-sonnet-4-6",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6 — Premium latest",
    tier: "Advanced",
    description: "Latest premium Anthropic option",
  },
  {
    id: "google:gemini-2.5-flash",
    provider: "google",
    model: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash — Fast Google",
    tier: "Standard",
    description: "Fast Standard-tier Google benchmark",
  },
  {
    id: "google:gemini-3.5-flash",
    provider: "google",
    model: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash — Fast Google latest",
    tier: "Standard",
    description: "Latest fast Google benchmark",
  },
];

export const DEEPGRAM_LLM_BY_ID = new Map(DEEPGRAM_LLM_CATALOG.map((entry) => [entry.id, entry]));

const LEGACY_OPENAI_MODELS = new Set(DEEPGRAM_LLM_CATALOG.filter((e) => e.provider === "open_ai").map((e) => e.model));

export const DEEPGRAM_LLM_GROUPS: DeepgramLlmGroup[] = [
  {
    label: "OpenAI",
    entries: DEEPGRAM_LLM_CATALOG.filter((e) => e.provider === "open_ai"),
  },
  {
    label: "Anthropic",
    entries: DEEPGRAM_LLM_CATALOG.filter((e) => e.provider === "anthropic"),
  },
  {
    label: "Google",
    entries: DEEPGRAM_LLM_CATALOG.filter((e) => e.provider === "google"),
  },
];

export const DEFAULT_DEEPGRAM_LLM = "open_ai:gpt-4o-mini";

export function parseDeepgramLlmSelection(value: string): {
  provider: DeepgramLlmProvider;
  model: string;
  tier: DeepgramLlmTier;
} {
  const trimmed = value.trim();
  if (!trimmed) return { ...FALLBACK_SELECTION };

  const colonIdx = trimmed.indexOf(":");
  if (colonIdx === -1) {
    if (LEGACY_OPENAI_MODELS.has(trimmed)) {
      const entry = DEEPGRAM_LLM_CATALOG.find((e) => e.provider === "open_ai" && e.model === trimmed);
      return {
        provider: "open_ai",
        model: trimmed,
        tier: entry?.tier ?? "Standard",
      };
    }
    return { ...FALLBACK_SELECTION };
  }

  const providerRaw = trimmed.slice(0, colonIdx);
  const model = trimmed.slice(colonIdx + 1).trim();
  if (!model || !ALLOWED_PROVIDERS.has(providerRaw as DeepgramLlmProvider)) {
    return { ...FALLBACK_SELECTION };
  }

  const provider = providerRaw as DeepgramLlmProvider;
  const entry = DEEPGRAM_LLM_BY_ID.get(`${provider}:${model}`);
  return {
    provider,
    model,
    tier: entry?.tier ?? "Standard",
  };
}

/** Map legacy raw OpenAI ids to composite catalog ids for the picker. */
export function normalizeDeepgramLlmSelection(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_DEEPGRAM_LLM;
  if (DEEPGRAM_LLM_BY_ID.has(trimmed)) return trimmed;

  const parsed = parseDeepgramLlmSelection(trimmed);
  const composite = `${parsed.provider}:${parsed.model}`;
  return DEEPGRAM_LLM_BY_ID.has(composite) ? composite : DEFAULT_DEEPGRAM_LLM;
}

export function isAllowedDeepgramLlmSelection(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (DEEPGRAM_LLM_BY_ID.has(trimmed)) return true;
  if (!trimmed.includes(":") && LEGACY_OPENAI_MODELS.has(trimmed)) return true;
  return false;
}
