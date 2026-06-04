import type { DebugLogEntry } from "@/components/ai-testing/AITestingDebugPanel";
import {
  BILLING_SOURCE_URLS,
  DEEPGRAM_FLUX_ASR_PER_MIN,
  DEEPGRAM_VOICE_AGENT_STANDARD_PER_MIN,
  FENNEC_ASR_PER_MIN,
  getOpenAiRealtimeRates,
  getOpenRouterRates,
  INWORLD_REALTIME_STT_PER_MIN,
  INWORLD_REALTIME_TTS1_PER_MIN,
  INWORLD_REALTIME_TTS2_PER_MIN,
  INWORLD_ROUTER_LLM_COMPLETION_PER_1M,
  INWORLD_ROUTER_LLM_PROMPT_PER_1M,
  INWORLD_TTS_PER_1K_CHARS,
  RATES_AS_OF,
  TWILIO_RATES,
} from "@/lib/aiTestingBillingRates";
import {
  type AiTestUsageMetrics,
  parseUsageMetrics,
} from "@/lib/aiTestingUsageMetrics";

export type BillingConfidence = "measured" | "derived" | "estimated";

export type BillingLineItem = {
  vendor: string;
  line: string;
  quantity: number;
  unit: string;
  rateUsd: number;
  subtotalUsd: number;
  confidence: BillingConfidence;
};

export type BillingEstimate = {
  lineItems: BillingLineItem[];
  totalUsd: number;
  overallConfidence: BillingConfidence;
  ratesAsOf: string;
  stack: string;
  openAiModel?: string;
  metricsSource: "usage_metrics" | "debug_log";
};

const TWILIO_MULAW_FRAME_SEC = 0.02;

export type SessionForBilling = {
  stack: string;
  model_id?: string | null;
  prompt?: string;
  transcript?: { role: string; text: string }[];
  usage_metrics?: unknown;
  debug_log?: DebugLogEntry[];
  created_at?: string | null;
  updated_at?: string | null;
};

function minFromSec(sec: number | undefined): number {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return 0;
  return sec / 60;
}

function addLine(
  items: BillingLineItem[],
  vendor: string,
  line: string,
  quantity: number,
  unit: string,
  rateUsd: number,
  confidence: BillingConfidence,
): void {
  if (quantity <= 0) return;
  items.push({
    vendor,
    line,
    quantity: Math.round(quantity * 10000) / 10000,
    unit,
    rateUsd,
    subtotalUsd: Math.round(quantity * rateUsd * 10000) / 10000,
    confidence,
  });
}

function worstConfidence(items: BillingLineItem[]): BillingConfidence {
  if (items.some((i) => i.confidence === "estimated")) return "estimated";
  if (items.some((i) => i.confidence === "derived")) return "derived";
  return "measured";
}

function retrofitMetricsFromDebugLog(
  session: SessionForBilling,
): AiTestUsageMetrics | null {
  const entries = session.debug_log ?? [];
  if (!entries.length) return null;

  const metrics: AiTestUsageMetrics = { measured_at: new Date().toISOString() };
  const twilio: NonNullable<AiTestUsageMetrics["twilio"]> = {};

  for (const e of entries) {
    const d = (e.data ?? {}) as Record<string, unknown>;
    if (e.event === "call.completed" || e.event === "status.callback") {
      const dur = Number(d.CallDuration);
      if (Number.isFinite(dur) && dur > 0) twilio.call_duration_sec = dur;
    }
    if (e.event === "recording_status.callback") {
      const rec = Number(d.RecordingDuration);
      if (Number.isFinite(rec) && rec > 0) twilio.recording_duration_sec = rec;
    }
    if (
      e.event === "twilio.stream.closed" ||
      e.event === "stream_ws.twilio_socket_close" ||
      e.event === "twilio.stream.stop" ||
      e.event === "stream_ws.twilio_stop"
    ) {
      const mi = Number(d.media_in_count ?? d.mediaIn);
      const mo = Number(d.media_out_count ?? d.mediaOut);
      if (Number.isFinite(mi)) {
        twilio.media_in_count = mi;
        twilio.inbound_audio_sec = mi * TWILIO_MULAW_FRAME_SEC;
      }
      if (Number.isFinite(mo)) {
        twilio.media_out_count = mo;
        twilio.outbound_audio_sec = mo * TWILIO_MULAW_FRAME_SEC;
      }
    }
    if (e.event === "deepgram.settings_snapshot" && d && typeof d === "object") {
      metrics.deepgram = { settings_snapshot: d as Record<string, unknown> };
    }
  }

  if (Object.keys(twilio).length) metrics.twilio = twilio;

  if (
    !metrics.twilio?.call_duration_sec &&
    session.created_at &&
    session.updated_at
  ) {
    const wall =
      (new Date(session.updated_at).getTime() - new Date(session.created_at).getTime()) /
      1000;
    if (wall > 0) twilio.call_duration_sec = Math.round(wall);
    metrics.twilio = twilio;
  }

  const transcript = session.transcript ?? [];
  let user_chars = 0;
  let assistant_chars = 0;
  for (const t of transcript) {
    const len = t.text?.length ?? 0;
    if (t.role === "user") user_chars += len;
    else if (t.role === "assistant") assistant_chars += len;
  }
  metrics.transcript = { user_chars, assistant_chars };
  metrics.prompt_chars = session.prompt?.length ?? 0;

  return metrics;
}

function hasMeasurableUsage(m: AiTestUsageMetrics): boolean {
  const t = m.twilio;
  return Boolean(
    t?.call_duration_sec ||
      t?.recording_duration_sec ||
      t?.inbound_audio_sec ||
      t?.media_stream_sec ||
      m.deepgram?.agent_ws_sec ||
      m.openai?.input_audio_tokens ||
      m.hypercheap?.bridge_session_sec ||
      m.hypercheap?.fennec_asr_sec ||
      m.hypercheap?.inworld_chars ||
      m.pipeline?.bridge_session_sec ||
      m.pipeline?.deepgram_flux_asr_sec ||
      m.pipeline?.inworld_chars ||
      m.inworld?.bridge_session_sec ||
      m.inworld?.stt_audio_sec ||
      m.inworld?.tts_audio_sec,
  );
}

export function resolveUsageMetrics(session: SessionForBilling): {
  metrics: AiTestUsageMetrics;
  source: "usage_metrics" | "debug_log";
} {
  const parsed = parseUsageMetrics(session.usage_metrics);
  if (hasMeasurableUsage(parsed)) {
    return { metrics: parsed, source: "usage_metrics" };
  }
  const retro = retrofitMetricsFromDebugLog(session);
  if (retro && hasMeasurableUsage(retro)) {
    return { metrics: retro, source: "debug_log" };
  }
  return { metrics: parsed, source: "usage_metrics" };
}

export function computeAiTestCallCost(session: SessionForBilling): BillingEstimate {
  const { metrics, source } = resolveUsageMetrics(session);
  const stack = session.stack ?? "unknown";
  const items: BillingLineItem[] = [];
  const tw = metrics.twilio ?? {};
  const streamConf: BillingConfidence =
    source === "usage_metrics" ? "measured" : "estimated";

  const callMin = minFromSec(tw.call_duration_sec);
  const recordingMin = minFromSec(tw.recording_duration_sec);
  const streamMin = minFromSec(
    tw.media_stream_sec ??
      Math.max(tw.inbound_audio_sec ?? 0, tw.outbound_audio_sec ?? 0),
  );

  addLine(
    items,
    "Twilio",
    "Outbound voice (local)",
    callMin,
    "min",
    TWILIO_RATES.outboundVoicePerMin,
    tw.call_duration_sec ? (source === "usage_metrics" ? "measured" : "estimated") : "estimated",
  );
  addLine(
    items,
    "Twilio",
    "Media Streams",
    streamMin,
    "min",
    TWILIO_RATES.mediaStreamPerMin,
    streamConf,
  );
  addLine(
    items,
    "Twilio",
    "Call recording",
    recordingMin,
    "min",
    TWILIO_RATES.recordingPerMin,
    tw.recording_duration_sec ? (source === "usage_metrics" ? "measured" : "estimated") : "estimated",
  );

  if (stack === "deepgram_voice_agent") {
    const dgSec =
      metrics.deepgram?.agent_ws_sec ??
      tw.media_stream_sec ??
      Math.max(tw.inbound_audio_sec ?? 0, callMin * 60);
    const dgMin = minFromSec(typeof dgSec === "number" ? dgSec : undefined);
    addLine(
      items,
      "Deepgram",
      "Voice Agent (Standard)",
      dgMin,
      "min",
      DEEPGRAM_VOICE_AGENT_STANDARD_PER_MIN,
      metrics.deepgram?.agent_ws_sec ? "measured" : "estimated",
    );
  }

  if (stack === "hypercheap_voice_agent") {
    const hc = metrics.hypercheap ?? {};

    // Fennec ASR — seconds of caller audio transcribed; fall back to inbound
    // audio seconds, then call duration.
    const fennecSec =
      hc.fennec_asr_sec ??
      tw.inbound_audio_sec ??
      tw.media_stream_sec ??
      callMin * 60;
    addLine(
      items,
      "Fennec",
      "ASR streaming",
      minFromSec(typeof fennecSec === "number" ? fennecSec : undefined),
      "min",
      FENNEC_ASR_PER_MIN,
      hc.fennec_asr_sec ? (source === "usage_metrics" ? "measured" : "estimated") : "estimated",
    );

    // Inworld TTS — generated characters (preferred) or derived from assistant
    // transcript characters.
    const inworldChars =
      hc.inworld_chars ?? metrics.transcript?.assistant_chars ?? 0;
    addLine(
      items,
      "Inworld",
      "TTS (inworld-tts-1)",
      inworldChars / 1000,
      "1K chars",
      INWORLD_TTS_PER_1K_CHARS,
      hc.inworld_chars ? (source === "usage_metrics" ? "measured" : "estimated") : "estimated",
    );

    // OpenRouter LLM — prompt/completion tokens when usage is returned, else
    // derived from prompt + transcript characters (≈4 chars/token).
    const orModel = hc.openrouter_model ?? session.model_id ?? "google/gemini-2.0-flash-001";
    const orRates = getOpenRouterRates(orModel);
    const promptTokens =
      hc.openrouter_prompt_tokens ??
      Math.ceil(
        ((metrics.prompt_chars ?? session.prompt?.length ?? 0) +
          (metrics.transcript?.user_chars ?? 0)) /
          4,
      );
    const completionTokens =
      hc.openrouter_completion_tokens ??
      Math.ceil((metrics.transcript?.assistant_chars ?? 0) / 4);
    const orConf: BillingConfidence = hc.usage_from_api
      ? "measured"
      : hc.openrouter_prompt_tokens
        ? "derived"
        : "estimated";
    addLine(
      items,
      "OpenRouter",
      `Prompt tokens (${orModel})`,
      promptTokens / 1_000_000,
      "M tokens",
      orRates.promptPer1M,
      orConf,
    );
    addLine(
      items,
      "OpenRouter",
      `Completion tokens (${orModel})`,
      completionTokens / 1_000_000,
      "M tokens",
      orRates.completionPer1M,
      orConf,
    );
  }

  if (stack === "pipeline_voice_agent") {
    const pl = metrics.pipeline ?? {};
    const fluxSec =
      pl.deepgram_flux_asr_sec ??
      tw.inbound_audio_sec ??
      tw.media_stream_sec ??
      callMin * 60;
    addLine(
      items,
      "Deepgram",
      "Flux ASR (streaming)",
      minFromSec(typeof fluxSec === "number" ? fluxSec : undefined),
      "min",
      DEEPGRAM_FLUX_ASR_PER_MIN,
      pl.deepgram_flux_asr_sec ? (source === "usage_metrics" ? "measured" : "estimated") : "estimated",
    );

    const inworldChars =
      pl.inworld_chars ?? metrics.transcript?.assistant_chars ?? 0;
    addLine(
      items,
      "Inworld",
      "TTS (inworld-tts-1)",
      inworldChars / 1000,
      "1K chars",
      INWORLD_TTS_PER_1K_CHARS,
      pl.inworld_chars ? (source === "usage_metrics" ? "measured" : "estimated") : "estimated",
    );

    const orModel = pl.openrouter_model ?? session.model_id ?? "google/gemini-2.0-flash-001";
    const orRates = getOpenRouterRates(orModel);
    const promptTokens =
      pl.openrouter_prompt_tokens ??
      Math.ceil(
        ((metrics.prompt_chars ?? session.prompt?.length ?? 0) +
          (metrics.transcript?.user_chars ?? 0)) /
          4,
      );
    const completionTokens =
      pl.openrouter_completion_tokens ??
      Math.ceil((metrics.transcript?.assistant_chars ?? 0) / 4);
    const orConf: BillingConfidence = pl.usage_from_api
      ? "measured"
      : pl.openrouter_prompt_tokens
        ? "derived"
        : "estimated";
    addLine(
      items,
      "OpenRouter",
      `Prompt tokens (${orModel})`,
      promptTokens / 1_000_000,
      "M tokens",
      orRates.promptPer1M,
      orConf,
    );
    addLine(
      items,
      "OpenRouter",
      `Completion tokens (${orModel})`,
      completionTokens / 1_000_000,
      "M tokens",
      orRates.completionPer1M,
      orConf,
    );
  }

  if (stack === "inworld_realtime_agent") {
    const iw = metrics.inworld ?? {};
    const sttSec =
      iw.stt_audio_sec ?? tw.inbound_audio_sec ?? tw.media_stream_sec ?? callMin * 60;
    addLine(
      items,
      "Inworld",
      "Realtime STT",
      minFromSec(typeof sttSec === "number" ? sttSec : undefined),
      "min",
      INWORLD_REALTIME_STT_PER_MIN,
      iw.stt_audio_sec ? (source === "usage_metrics" ? "measured" : "estimated") : "estimated",
    );

    const ttsModel = iw.tts_model ?? "inworld-tts-2";
    const ttsRate =
      ttsModel === "inworld-tts-1" ? INWORLD_REALTIME_TTS1_PER_MIN : INWORLD_REALTIME_TTS2_PER_MIN;
    const ttsSec =
      iw.tts_audio_sec ?? tw.outbound_audio_sec ?? (iw.tts_characters ? undefined : 0);
    if (ttsSec && ttsSec > 0) {
      addLine(
        items,
        "Inworld",
        `Realtime TTS (${ttsModel})`,
        minFromSec(ttsSec),
        "min",
        ttsRate,
        iw.tts_audio_sec ? (source === "usage_metrics" ? "measured" : "estimated") : "estimated",
      );
    } else {
      const chars = iw.tts_characters ?? metrics.transcript?.assistant_chars ?? 0;
      addLine(
        items,
        "Inworld",
        `TTS chars (${ttsModel})`,
        chars / 1000,
        "1K chars",
        INWORLD_TTS_PER_1K_CHARS,
        iw.tts_characters ? (source === "usage_metrics" ? "measured" : "estimated") : "estimated",
      );
    }

    const routerLabel = iw.router_model ?? session.model_id ?? "inworld/router";
    const promptTokens =
      iw.input_tokens ??
      Math.ceil(
        ((metrics.prompt_chars ?? session.prompt?.length ?? 0) +
          (metrics.transcript?.user_chars ?? 0)) /
          4,
      );
    const completionTokens =
      iw.output_tokens ?? Math.ceil((metrics.transcript?.assistant_chars ?? 0) / 4);
    const llmConf: BillingConfidence = iw.usage_from_api
      ? "measured"
      : iw.input_tokens
        ? "derived"
        : "estimated";
    addLine(
      items,
      "Inworld",
      `LLM/router prompt (${routerLabel})`,
      promptTokens / 1_000_000,
      "M tokens",
      INWORLD_ROUTER_LLM_PROMPT_PER_1M,
      llmConf,
    );
    addLine(
      items,
      "Inworld",
      `LLM/router completion (${routerLabel})`,
      completionTokens / 1_000_000,
      "M tokens",
      INWORLD_ROUTER_LLM_COMPLETION_PER_1M,
      llmConf,
    );
  }

  let openAiModel: string | undefined;
  if (stack === "openai_realtime") {
    openAiModel = metrics.openai?.model ?? session.model_id ?? "gpt-realtime";
    const rates = getOpenAiRealtimeRates(openAiModel);
    const oa = metrics.openai ?? {};
    const inAudio = oa.input_audio_tokens ?? 0;
    const outAudio = oa.output_audio_tokens ?? 0;
    const inText = oa.text_input_tokens ?? 0;
    const outText = oa.text_output_tokens ?? 0;

    const audioConf: BillingConfidence = oa.usage_from_api
      ? "measured"
      : inAudio || outAudio
        ? "derived"
        : "estimated";

    if (!inAudio && !outAudio && (tw.inbound_audio_sec || tw.outbound_audio_sec)) {
      const derivedIn = Math.ceil((tw.inbound_audio_sec ?? 0) * 10);
      const derivedOut = Math.ceil((tw.outbound_audio_sec ?? 0) * 20);
      addLine(
        items,
        "OpenAI",
        `Audio input (${openAiModel})`,
        derivedIn / 1_000_000,
        "M tokens",
        rates.audioInputPer1M,
        "derived",
      );
      addLine(
        items,
        "OpenAI",
        `Audio output (${openAiModel})`,
        derivedOut / 1_000_000,
        "M tokens",
        rates.audioOutputPer1M,
        "derived",
      );
    } else {
      addLine(
        items,
        "OpenAI",
        `Audio input (${openAiModel})`,
        inAudio / 1_000_000,
        "M tokens",
        rates.audioInputPer1M,
        audioConf,
      );
      addLine(
        items,
        "OpenAI",
        `Audio output (${openAiModel})`,
        outAudio / 1_000_000,
        "M tokens",
        rates.audioOutputPer1M,
        audioConf,
      );
    }

    const textIn =
      inText ||
      Math.ceil(
        ((metrics.prompt_chars ?? session.prompt?.length ?? 0) +
          (metrics.transcript?.user_chars ?? 0)) /
          4,
      );
    const textOut =
      outText || Math.ceil((metrics.transcript?.assistant_chars ?? 0) / 4);

    addLine(
      items,
      "OpenAI",
      `Text input (${openAiModel})`,
      textIn / 1_000_000,
      "M tokens",
      rates.textInputPer1M,
      inText ? audioConf : "estimated",
    );
    addLine(
      items,
      "OpenAI",
      `Text output (${openAiModel})`,
      textOut / 1_000_000,
      "M tokens",
      rates.textOutputPer1M,
      outText ? audioConf : "estimated",
    );
  }

  const totalUsd = items.reduce((s, i) => s + i.subtotalUsd, 0);

  return {
    lineItems: items,
    totalUsd: Math.round(totalUsd * 10000) / 10000,
    overallConfidence: worstConfidence(items),
    ratesAsOf: RATES_AS_OF,
    stack,
    openAiModel,
    metricsSource: source,
  };
}

export { BILLING_SOURCE_URLS };
