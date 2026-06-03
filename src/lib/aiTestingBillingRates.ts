/** Vendor rate card — sources fetched June 2026. Update RATES_AS_OF when prices change. */

export const RATES_AS_OF = "2026-06-03";

export const BILLING_SOURCE_URLS = {
  twilio: "https://www.twilio.com/en-us/voice/pricing/us",
  deepgram: "https://deepgram.com/pricing",
  openai: "https://openai.com/api/pricing/",
  openaiRealtimeCosts: "https://developers.openai.com/api/docs/guides/realtime-costs",
} as const;

/** US pay-as-you-go (June 2026). */
export const TWILIO_RATES = {
  outboundVoicePerMin: 0.014,
  mediaStreamPerMin: 0.004,
  recordingPerMin: 0.0025,
} as const;

/** Deepgram Voice Agent Standard — websocket connection time. */
export const DEEPGRAM_VOICE_AGENT_STANDARD_PER_MIN = 0.075;

export type OpenAiRealtimeRateRow = {
  modelId: string;
  audioInputPer1M: number;
  audioOutputPer1M: number;
  audioCachedInputPer1M: number;
  textInputPer1M: number;
  textOutputPer1M: number;
};

/** June 2026 OpenAI API pricing page — Realtime family. */
export const OPENAI_REALTIME_RATES: OpenAiRealtimeRateRow[] = [
  {
    modelId: "gpt-realtime-2",
    audioInputPer1M: 32,
    audioOutputPer1M: 64,
    audioCachedInputPer1M: 0.4,
    textInputPer1M: 4,
    textOutputPer1M: 24,
  },
  {
    modelId: "gpt-realtime",
    audioInputPer1M: 32,
    audioOutputPer1M: 64,
    audioCachedInputPer1M: 0.4,
    textInputPer1M: 4,
    textOutputPer1M: 24,
  },
  {
    modelId: "gpt-realtime-1.5",
    audioInputPer1M: 32,
    audioOutputPer1M: 64,
    audioCachedInputPer1M: 0.4,
    textInputPer1M: 4,
    textOutputPer1M: 24,
  },
];

const DEFAULT_OPENAI_MODEL = "gpt-realtime";

export function getOpenAiRealtimeRates(modelId: string | null | undefined): OpenAiRealtimeRateRow {
  const id = (modelId ?? DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
  return (
    OPENAI_REALTIME_RATES.find((r) => r.modelId === id) ??
    OPENAI_REALTIME_RATES.find((r) => r.modelId === DEFAULT_OPENAI_MODEL)!
  );
}
