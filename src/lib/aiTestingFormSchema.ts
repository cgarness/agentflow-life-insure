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

export const PlaceCallFormSchema = z.object({
  stack: z.enum(["twilio_cr", "xai_s2s", "openai_realtime", "openai_sip"]),
  prompt: z.string().min(10, "Prompt must be at least 10 characters"),
  to: z.string().min(8, "Enter the To phone number"),
  from: z.string().min(8, "Enter the From phone number"),
  tuning: TuningSchema,
});
export type PlaceCallForm = z.infer<typeof PlaceCallFormSchema>;

export const DEFAULT_TUNING: Tuning = {
  voice_id: "",
  temperature: 0.7,
  speaking_rate: 1.0,
  interruption_sensitivity: "medium",
};
