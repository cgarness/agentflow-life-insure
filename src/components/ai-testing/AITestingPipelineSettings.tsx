import React from "react";
import { GitBranch } from "lucide-react";
import { VOICE_CATALOG } from "@/lib/aiTestingVoices";
import {
  openRouterModelGroups,
  type PipelineTuning,
} from "@/lib/aiTestingPipeline";
import type { InterruptionSensitivity } from "@/lib/aiTestingFormSchema";

interface Props {
  value: PipelineTuning;
  onChange: (next: PipelineTuning) => void;
}

const INTERRUPTION_LEVELS: InterruptionSensitivity[] = ["low", "medium", "high"];

export const AITestingPipelineSettings: React.FC<Props> = ({ value, onChange }) => {
  const voices = VOICE_CATALOG.pipeline_voice_agent;

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-emerald-500" />
        <h2 className="text-sm font-medium text-foreground">Pipeline call settings</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Deepgram Flux ASR → OpenRouter LLM → Inworld TTS. Same Python Render bridge as
        Hypercheap, path <code className="text-[10px]">/twilio/pipeline</code>.{" "}
        <code className="text-[10px]">DEEPGRAM_API_KEY</code> on Render only.
      </p>

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
      </div>

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
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Interruption sensitivity</label>
        <div className="grid grid-cols-3 gap-1 rounded-md border border-border p-1">
          {INTERRUPTION_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => onChange({ ...value, interruption_sensitivity: level })}
              className={`text-xs font-medium uppercase tracking-wider py-1.5 rounded-sm ${
                value.interruption_sensitivity === level
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {level}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Maps to Deepgram Flux end-of-turn (eot_threshold / timeout). Higher = faster barge-in.
        </p>
      </div>

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
      </div>

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
      </div>
    </section>
  );
};
