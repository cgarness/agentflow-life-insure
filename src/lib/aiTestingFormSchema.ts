import { z } from "zod";

export const InterruptionSensitivitySchema = z.enum(["low", "medium", "high"]);
export type InterruptionSensitivity = z.infer<typeof InterruptionSensitivitySchema>;

export const TuningSchema = z.object({
  voice_id: z.string().min(1, "Pick a voice"),
  temperature: z.number().min(0).max(1.2),
  speaking_rate: z.number().min(0.5).max(1.5),
  interruption_sensitivity: InterruptionSensitivitySchema,
});
export type Tuning = z.infer<typeof TuningSchema>;

/** OpenAI Realtime via Render bridge (`openai_realtime`). */
export const PlaceOpenAICallSchema = z.object({
  stack: z.literal("openai_realtime"),
  prompt: z.string().min(10, "Prompt must be at least 10 characters"),
  to: z.string().min(8, "Enter the To phone number"),
  from: z.string().min(8, "Enter the From phone number"),
  tuning: TuningSchema,
});
export type PlaceOpenAICallForm = z.infer<typeof PlaceOpenAICallSchema>;

/** Deepgram Voice Agent via Render bridge (`deepgram_voice_agent`). */
export const PlaceDeepgramCallSchema = z.object({
  stack: z.literal("deepgram_voice_agent"),
  prompt: z.string().min(10, "Prompt must be at least 10 characters"),
  to: z.string().min(8, "Enter the To phone number"),
  from: z.string().min(8, "Enter the From phone number"),
  tuning: TuningSchema.partial().optional(),
});
export type PlaceDeepgramCallForm = z.infer<typeof PlaceDeepgramCallSchema>;

/** @deprecated Use PlaceOpenAICallSchema or PlaceDeepgramCallSchema */
export const PlaceCallFormSchema = PlaceOpenAICallSchema;
export type PlaceCallForm = PlaceOpenAICallForm;

export const DEFAULT_TUNING: Tuning = {
  voice_id: "",
  temperature: 0.7,
  speaking_rate: 1.0,
  interruption_sensitivity: "medium",
};
