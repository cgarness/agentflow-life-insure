export type DeepgramLlmProvider = "open_ai" | "anthropic" | "google";

const FALLBACK = { provider: "open_ai" as const, model: "gpt-4o-mini" };
const ALLOWED_PROVIDERS = new Set<DeepgramLlmProvider>(["open_ai", "anthropic", "google"]);

const LEGACY_OPENAI_MODELS = new Set([
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1-mini",
  "gpt-5-mini",
]);

/** Parse session.model_id into Deepgram think.provider fields (mirrors frontend rules). */
export function parseDeepgramLlmSelection(raw: string | null | undefined): {
  provider: DeepgramLlmProvider;
  model: string;
} {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ...FALLBACK };

  const colonIdx = trimmed.indexOf(":");
  if (colonIdx === -1) {
    if (LEGACY_OPENAI_MODELS.has(trimmed)) {
      return { provider: "open_ai", model: trimmed };
    }
    return { ...FALLBACK };
  }

  const providerRaw = trimmed.slice(0, colonIdx);
  const model = trimmed.slice(colonIdx + 1).trim();
  if (!model || !ALLOWED_PROVIDERS.has(providerRaw as DeepgramLlmProvider)) {
    return { ...FALLBACK };
  }

  return { provider: providerRaw as DeepgramLlmProvider, model };
}

export function deepgramLlmTier(raw: string | null | undefined): string | undefined {
  const trimmed = String(raw ?? "").trim();
  const entryTier = (() => {
    const parsed = parseDeepgramLlmSelection(trimmed);
    const composite = `${parsed.provider}:${parsed.model}`;
    const tiers: Record<string, string> = {
      "open_ai:gpt-4o-mini": "Standard",
      "open_ai:gpt-4o": "Advanced",
      "open_ai:gpt-4.1-mini": "Standard",
      "open_ai:gpt-5-mini": "Standard",
      "anthropic:claude-4-5-haiku": "Standard",
      "anthropic:claude-sonnet-4-5": "Advanced",
      "anthropic:claude-sonnet-4-6": "Advanced",
      "google:gemini-2.5-flash": "Standard",
      "google:gemini-3.5-flash": "Standard",
    };
    return tiers[composite];
  })();
  return entryTier;
}
