import { defaultVoiceFor } from "@/lib/aiTestingVoices";
import { DEFAULT_OPENROUTER_MODEL, openRouterModelGroups } from "@/lib/aiTestingHypercheap";
import type { InterruptionSensitivity } from "@/lib/aiTestingFormSchema";

export type PipelineTuning = {
  voice_id: string;
  model_id: string;
  temperature: number;
  max_response_tokens: number;
  interruption_sensitivity: InterruptionSensitivity;
};

export const DEFAULT_PIPELINE_TUNING: PipelineTuning = {
  voice_id: defaultVoiceFor("pipeline_voice_agent"),
  model_id: DEFAULT_OPENROUTER_MODEL,
  temperature: 0.7,
  max_response_tokens: 256,
  interruption_sensitivity: "medium",
};

export { openRouterModelGroups };
