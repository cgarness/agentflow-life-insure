export type DeepgramLlmProvider = "open_ai" | "anthropic" | "google";

const FALLBACK = { provider: "open_ai" as const, model: "gpt-4o-mini" };

const LEGACY_OPENAI_MODELS = new Set([
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1-mini",
  "gpt-5-mini",
]);

/** Exact curated catalog composite ids — bridge is the final whitelist boundary. */
const ALLOWED_CATALOG_IDS = new Set([
  "open_ai:gpt-4o-mini",
  "open_ai:gpt-4o",
  "open_ai:gpt-4.1-mini",
  "open_ai:gpt-5-mini",
  "anthropic:claude-4-5-haiku",
  "anthropic:claude-sonnet-4-5",
  "anthropic:claude-sonnet-4-6",
  "google:gemini-2.5-flash",
  "google:gemini-3.5-flash",
]);

const CATALOG_TIERS: Record<string, string> = {
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

function catalogCompositeToProviderModel(composite: string): {
  provider: DeepgramLlmProvider;
  model: string;
} {
  const colonIdx = composite.indexOf(":");
  return {
    provider: composite.slice(0, colonIdx) as DeepgramLlmProvider,
    model: composite.slice(colonIdx + 1),
  };
}

/** Parse session.model_id into Deepgram think.provider fields (exact catalog whitelist only). */
export function parseDeepgramLlmSelection(raw: string | null | undefined): {
  provider: DeepgramLlmProvider;
  model: string;
} {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ...FALLBACK };

  if (ALLOWED_CATALOG_IDS.has(trimmed)) {
    return catalogCompositeToProviderModel(trimmed);
  }

  if (LEGACY_OPENAI_MODELS.has(trimmed)) {
    return { provider: "open_ai", model: trimmed };
  }

  return { ...FALLBACK };
}

export function deepgramLlmTier(raw: string | null | undefined): string | undefined {
  const trimmed = String(raw ?? "").trim();
  if (ALLOWED_CATALOG_IDS.has(trimmed)) {
    return CATALOG_TIERS[trimmed];
  }
  if (LEGACY_OPENAI_MODELS.has(trimmed)) {
    return CATALOG_TIERS[`open_ai:${trimmed}`];
  }
  return undefined;
}
