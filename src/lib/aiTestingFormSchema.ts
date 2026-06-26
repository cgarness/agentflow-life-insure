import { z } from "zod";
import { isAllowedDeepgramLlmSelection } from "@/lib/aiTestingDeepgramModels";

export const InterruptionSensitivitySchema = z.enum(["low", "medium", "high"]);
export type InterruptionSensitivity = z.infer<typeof InterruptionSensitivitySchema>;

export const TuningSchema = z.object({
  voice_id: z.string().min(1, "Pick a voice"),
  temperature: z.number().min(0).max(1.2),
  speaking_rate: z.number().min(0.5).max(1.5),
  interruption_sensitivity: InterruptionSensitivitySchema,
});
export type Tuning = z.infer<typeof TuningSchema>;

/** Curated Deepgram managed LLM selection (composite id or legacy raw OpenAI model). */
export const DeepgramModelIdSchema = z
  .string()
  .min(1, "Pick an LLM model")
  .refine(isAllowedDeepgramLlmSelection, { message: "Pick a supported Deepgram LLM model" });

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
  tuning: TuningSchema,
  model_id: DeepgramModelIdSchema,
});
export type PlaceDeepgramCallForm = z.infer<typeof PlaceDeepgramCallSchema>;

/** Hypercheap Voice Agent via Render Python bridge (`hypercheap_voice_agent`). */
export const PlaceHypercheapCallSchema = z.object({
  stack: z.literal("hypercheap_voice_agent"),
  prompt: z.string().min(10, "Prompt must be at least 10 characters"),
  to: z.string().min(8, "Enter the To phone number"),
  from: z.string().min(8, "Enter the From phone number"),
  voice_id: z.string().min(1, "Pick an Inworld voice"),
  model_id: z.string().min(1, "Enter an OpenRouter model id"),
  temperature: z.number().min(0).max(1.2),
  max_response_tokens: z.number().int().min(32).max(2048),
  vad_aggressiveness: z.enum(["low", "medium", "high"]),
});
export type PlaceHypercheapCallForm = z.infer<typeof PlaceHypercheapCallSchema>;

/** Pipeline: Deepgram Flux ASR → OpenRouter → Inworld via Python Render bridge. */
export const PlacePipelineCallSchema = z.object({
  stack: z.literal("pipeline_voice_agent"),
  prompt: z.string().min(10, "Prompt must be at least 10 characters"),
  to: z.string().min(8, "Enter the To phone number"),
  from: z.string().min(8, "Enter the From phone number"),
  voice_id: z.string().min(1, "Pick an Inworld voice"),
  model_id: z.string().min(1, "Enter an OpenRouter model id"),
  temperature: z.number().min(0).max(1.2),
  max_response_tokens: z.number().int().min(32).max(2048),
  interruption_sensitivity: InterruptionSensitivitySchema,
});
export type PlacePipelineCallForm = z.infer<typeof PlacePipelineCallSchema>;

/** Inworld Realtime speech-to-speech via Node bridge (`inworld_realtime_agent`). */
export const PlaceInworldCallSchema = z.object({
  stack: z.literal("inworld_realtime_agent"),
  prompt: z.string().min(10, "Prompt must be at least 10 characters"),
  to: z.string().min(8, "Enter the To phone number"),
  from: z.string().min(8, "Enter the From phone number"),
  voice_id: z.string().min(1, "Pick an Inworld voice"),
  model_id: z.string().min(1, "Pick a router or LLM model"),
  tts_model: z.enum(["inworld-tts-1", "inworld-tts-2"]),
  temperature: z.number().min(0).max(1.2),
  max_response_tokens: z.number().int().min(32).max(2048),
  interruption_sensitivity: InterruptionSensitivitySchema,
});
export type PlaceInworldCallForm = z.infer<typeof PlaceInworldCallSchema>;

/** Browser mic/speaker test — Deepgram Voice Agent, no phone numbers. */
export const StartBrowserDeepgramSchema = z.object({
  stack: z.literal("deepgram_voice_agent"),
  prompt: z.string().min(10, "Prompt must be at least 10 characters"),
  tuning: TuningSchema,
  model_id: DeepgramModelIdSchema,
});
export type StartBrowserDeepgramForm = z.infer<typeof StartBrowserDeepgramSchema>;

/** Browser mic/speaker test — Inworld Realtime, no phone numbers. */
export const StartBrowserInworldSchema = z.object({
  stack: z.literal("inworld_realtime_agent"),
  prompt: z.string().min(10, "Prompt must be at least 10 characters"),
  voice_id: z.string().min(1, "Pick an Inworld voice"),
  model_id: z.string().min(1, "Pick a router or LLM model"),
  tts_model: z.enum(["inworld-tts-1", "inworld-tts-2"]),
  temperature: z.number().min(0).max(1.2),
  max_response_tokens: z.number().int().min(32).max(2048),
  interruption_sensitivity: InterruptionSensitivitySchema,
});
export type StartBrowserInworldForm = z.infer<typeof StartBrowserInworldSchema>;

/** Browser mic/speaker test — OpenAI Realtime, no phone numbers. */
export const StartBrowserOpenAISchema = z.object({
  stack: z.literal("openai_realtime"),
  prompt: z.string().min(10, "Prompt must be at least 10 characters"),
  tuning: TuningSchema,
});
export type StartBrowserOpenAIForm = z.infer<typeof StartBrowserOpenAISchema>;

/** Browser-only ambient playback during Deepgram AI Testing. */
export const BackgroundSoundSchema = z.enum(["off", "light_office"]);
export type BackgroundSound = z.infer<typeof BackgroundSoundSchema>;

/** Deepgram browser test mic + local playback options (not sent to bridge). */
export const DeepgramBrowserAudioOptionsSchema = z.object({
  echoCancellation: z.boolean(),
  noiseSuppression: z.boolean(),
  autoGainControl: z.boolean(),
  backgroundSound: BackgroundSoundSchema,
  backgroundVolume: z.number().min(0).max(0.15),
  playbackJitterBufferMs: z.number().int().min(0).max(500).optional(),
});
export type DeepgramBrowserAudioOptions = z.infer<typeof DeepgramBrowserAudioOptionsSchema>;

export const DEFAULT_DEEPGRAM_BROWSER_AUDIO_OPTIONS: DeepgramBrowserAudioOptions = {
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: true,
  backgroundSound: "off",
  backgroundVolume: 0.06,
};

/** @deprecated Use PlaceOpenAICallSchema or PlaceDeepgramCallSchema */
export const PlaceCallFormSchema = PlaceOpenAICallSchema;
export type PlaceCallForm = PlaceOpenAICallForm;

export const DEFAULT_TUNING: Tuning = {
  voice_id: "",
  temperature: 0.7,
  speaking_rate: 1.0,
  interruption_sensitivity: "medium",
};
