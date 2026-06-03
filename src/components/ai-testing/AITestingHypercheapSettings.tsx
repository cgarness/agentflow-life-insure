import React from "react";
import { Zap } from "lucide-react";
import { VOICE_CATALOG } from "@/lib/aiTestingVoices";
import {
  openRouterModelGroups,
  type HypercheapTuning,
  type VadAggressiveness,
} from "@/lib/aiTestingHypercheap";

interface Props {
  value: HypercheapTuning;
  onChange: (next: HypercheapTuning) => void;
}

const VAD_LEVELS: VadAggressiveness[] = ["low", "medium", "high"];

export const AITestingHypercheapSettings: React.FC<Props> = ({ value, onChange }) => {
  const voices = VOICE_CATALOG.hypercheap_voice_agent;

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-amber-500" />
        <h2 className="text-sm font-medium text-foreground">Hypercheap call settings</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Fennec ASR → OpenRouter LLM → Inworld TTS. Provider keys live on Render only. Optimized
        for first-token latency over raw intelligence.
      </p>

      {/* Inworld voice */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Inworld voice</label>
        <select
          value={value.voice_id}
          onChange={(e) => onChange({ ...value, voice_id: e.target.value })}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label} — {v.gender}, {v.accent}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          Inworld model <code className="text-[10px]">inworld-tts-1</code>. Server default
          (<code className="text-[10px]">INWORLD_VOICE_ID</code>) applies if left unset.
        </p>
      </div>

      {/* OpenRouter model (selectable) */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">OpenRouter model</label>
        <select
          value={value.model_id}
          onChange={(e) => onChange({ ...value, model_id: e.target.value })}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {openRouterModelGroups(value.model_id).map((group) => (
            <optgroup key={group.provider} label={group.label}>
              {group.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          OpenAI-compatible streaming chat completions via{" "}
          <code className="text-[10px]">https://openrouter.ai/api/v1</code>. Optimized for
          first-token latency.
        </p>
      </div>

      {/* Fennec VAD aggressiveness */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Fennec VAD aggressiveness</label>
        <div className="grid grid-cols-3 gap-1 rounded-md border border-border p-1">
          {VAD_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => onChange({ ...value, vad_aggressiveness: level })}
              className={`text-xs font-medium uppercase tracking-wider py-1.5 rounded-sm ${
                value.vad_aggressiveness === level
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {level}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Higher = quicker to detect speech start and barge in over the agent.
        </p>
      </div>

      {/* Max response tokens */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <label className="font-medium text-foreground">Max response tokens</label>
          <span className="font-mono text-muted-foreground">{value.max_response_tokens}</span>
        </div>
        <input
          type="range"
          min={32}
          max={1024}
          step={32}
          value={value.max_response_tokens}
          onChange={(e) =>
            onChange({ ...value, max_response_tokens: Number(e.target.value) })
          }
          className="w-full"
        />
        <p className="text-[11px] text-muted-foreground">
          Caps each LLM turn — keep low for short, snappy phone replies.
        </p>
      </div>

      {/* Temperature */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <label className="font-medium text-foreground">Temperature</label>
          <span className="font-mono text-muted-foreground">{value.temperature.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={1.2}
          step={0.1}
          value={value.temperature}
          onChange={(e) => onChange({ ...value, temperature: Number(e.target.value) })}
          className="w-full"
        />
        <p className="text-[11px] text-muted-foreground">Higher = more varied replies.</p>
      </div>
    </section>
  );
};
