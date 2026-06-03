import { describe, expect, it } from "vitest";
import { computeAiTestCallCost } from "@/lib/aiTestingBilling";
import { TWILIO_RATES, DEEPGRAM_VOICE_AGENT_STANDARD_PER_MIN } from "@/lib/aiTestingBillingRates";

describe("computeAiTestCallCost", () => {
  it("computes Deepgram stack with measured usage", () => {
    const est = computeAiTestCallCost({
      stack: "deepgram_voice_agent",
      usage_metrics: {
        twilio: {
          call_duration_sec: 60,
          recording_duration_sec: 60,
          media_stream_sec: 55,
          inbound_audio_sec: 50,
          outbound_audio_sec: 45,
          media_in_count: 2500,
          media_out_count: 2250,
        },
        deepgram: { agent_ws_sec: 54 },
      },
    });

    const twilioVoice = est.lineItems.find((i) => i.line.includes("Outbound"));
    expect(twilioVoice?.subtotalUsd).toBeCloseTo(1 * TWILIO_RATES.outboundVoicePerMin, 4);

    const dg = est.lineItems.find((i) => i.vendor === "Deepgram");
    expect(dg?.subtotalUsd).toBeCloseTo(0.9 * DEEPGRAM_VOICE_AGENT_STANDARD_PER_MIN, 4);

    expect(est.totalUsd).toBeGreaterThan(0);
    expect(est.overallConfidence).not.toBe("estimated");
  });

  it("computes OpenAI stack with derived audio tokens", () => {
    const est = computeAiTestCallCost({
      stack: "openai_realtime",
      model_id: "gpt-realtime-2",
      usage_metrics: {
        twilio: {
          call_duration_sec: 30,
          inbound_audio_sec: 10,
          outbound_audio_sec: 5,
        },
        openai: {
          model: "gpt-realtime-2",
          input_audio_tokens: 100,
          output_audio_tokens: 100,
          usage_from_api: true,
        },
      },
    });

    const audioIn = est.lineItems.find((i) => i.line.includes("Audio input"));
    expect(audioIn?.confidence).toBe("measured");
    expect(est.openAiModel).toBe("gpt-realtime-2");
  });
});
