/** Defaults and catalogs for Inworld Realtime (`inworld_realtime_agent`). */

export const DEFAULT_INWORLD_ROUTER_MODEL = "inworld/latency-optimizer-ab-test";

export const INWORLD_ROUTER_CATALOG = [
  {
    id: DEFAULT_INWORLD_ROUTER_MODEL,
    label: "Inworld latency optimizer (A/B)",
    hint: "Cost/latency router — recommended default for telephony benchmarks.",
  },
  {
    id: "google-ai-studio/gemini-2.5-flash",
    label: "Gemini 2.5 Flash (direct)",
    hint: "Inworld platform default LLM when no router is set.",
  },
  {
    id: "openai/gpt-4o-mini",
    label: "GPT-4o mini (direct)",
    hint: "Direct provider route via Inworld Realtime.",
  },
] as const;

export type InworldTtsModel = "inworld-tts-1" | "inworld-tts-2";

export const INWORLD_TTS_CATALOG: { id: InworldTtsModel; label: string; hint: string }[] = [
  {
    id: "inworld-tts-2",
    label: "Inworld TTS-2 (Max quality)",
    hint: "Default for this benchmark — best voice quality.",
  },
  {
    id: "inworld-tts-1",
    label: "Inworld TTS-1 (lower cost)",
    hint: "Use later for cost comparison vs TTS-2.",
  },
];

export type InworldTuning = {
  voice_id: string;
  model_id: string;
  tts_model: InworldTtsModel;
  temperature: number;
  max_response_tokens: number;
  interruption_sensitivity: "low" | "medium" | "high";
};

export const DEFAULT_INWORLD_TUNING: InworldTuning = {
  voice_id: "Sarah",
  model_id: DEFAULT_INWORLD_ROUTER_MODEL,
  tts_model: "inworld-tts-2",
  temperature: 0.7,
  max_response_tokens: 512,
  interruption_sensitivity: "medium",
};
