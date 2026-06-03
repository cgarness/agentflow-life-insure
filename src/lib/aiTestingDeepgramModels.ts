export type DeepgramLlmEntry = {
  id: string;
  label: string;
};

/** Managed OpenAI models via Deepgram Voice Agent `think.provider`. */
export const DEEPGRAM_LLM_CATALOG: DeepgramLlmEntry[] = [
  { id: "gpt-4o-mini", label: "GPT-4o mini (fast)" },
  { id: "gpt-4o", label: "GPT-4o (higher quality)" },
];

export const DEFAULT_DEEPGRAM_LLM = DEEPGRAM_LLM_CATALOG[0]?.id ?? "gpt-4o-mini";
