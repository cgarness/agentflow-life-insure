import React from "react";
import { Loader2, Mic, Square, Radio } from "lucide-react";
import { AITestingDebugPanel, type DebugLogEntry } from "@/components/ai-testing/AITestingDebugPanel";
import type { TranscriptEntry } from "@/components/ai-testing/AITestingLiveStatus";
import type { BrowserSessionState } from "@/hooks/useAITestingBrowserSession";

interface Props {
  state: BrowserSessionState;
  micActive: boolean;
  isRunning: boolean;
  stackLabel: string;
  status?: string | null;
  errorMessage?: string | null;
  transcript: TranscriptEntry[];
  debugLog: DebugLogEntry[];
  callStartIso?: string | null;
  onStart: () => void;
  onStop: () => void;
}

const STATE_COPY: Record<BrowserSessionState, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  active: "Live",
  stopping: "Stopping…",
  error: "Error",
};

export const AITestingBrowserPanel: React.FC<Props> = ({
  state,
  micActive,
  isRunning,
  stackLabel,
  status,
  errorMessage,
  transcript,
  debugLog,
  callStartIso,
  onStart,
  onStop,
}) => (
  <div className="space-y-6 lg:sticky lg:top-6">
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-foreground">Browser voice test</h2>
            <p className="text-xs text-muted-foreground">{stackLabel}</p>
          </div>
        </div>
        <span
          className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${
            state === "active"
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : state === "error"
                ? "bg-destructive/15 text-destructive"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {STATE_COPY[state]}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {isRunning ? (
          <button
            type="button"
            onClick={onStop}
            disabled={state === "stopping"}
            className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium border border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10 h-10 px-5 disabled:opacity-50"
          >
            {state === "stopping" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
            {state === "stopping" ? "Stopping…" : "Stop test"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={state === "connecting"}
            className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium border border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 h-10 px-5 disabled:opacity-50"
          >
            {state === "connecting" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
            {state === "connecting" ? "Connecting…" : "Start browser test"}
          </button>
        )}
        {micActive && (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Mic live
          </span>
        )}
      </div>

      {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

      <div className="space-y-2 max-h-80 overflow-y-auto">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Transcript</h3>
        {transcript.length ? (
          transcript.map((entry, i) => (
            <div
              key={`${entry.at}-${i}`}
              className={`text-sm rounded-md px-3 py-2 ${
                entry.role === "user" ? "bg-muted" : "bg-primary/10"
              }`}
            >
              <span className="text-[10px] uppercase font-medium text-muted-foreground mr-2">{entry.role}</span>
              {entry.text}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground italic">
            {isRunning
              ? "Allow mic access and start talking — the agent will greet you."
              : "Start the test, grant microphone access, and speak to the agent right in your browser."}
          </p>
        )}
      </div>
    </section>

    <AITestingDebugPanel entries={debugLog} callStartIso={callStartIso} />
  </div>
);
