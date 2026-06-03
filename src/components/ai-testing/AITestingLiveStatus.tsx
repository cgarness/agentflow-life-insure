import React from "react";

export type TranscriptEntry = { role: string; text: string; at: string };

interface Props {
  status: string;
  callSid?: string | null;
  errorMessage?: string | null;
  transcript: TranscriptEntry[];
  stackLabel?: string | null;
}

export const AITestingLiveStatus: React.FC<Props> = ({
  status,
  callSid,
  errorMessage,
  transcript,
  stackLabel,
}) => (
  <section className="rounded-xl border border-border bg-card p-4 space-y-4">
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <h2 className="text-sm font-medium text-foreground">Live status</h2>
      <div className="flex items-center gap-2">
        {stackLabel && (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {stackLabel}
          </span>
        )}
        <span className="text-xs font-mono uppercase text-muted-foreground">{status}</span>
      </div>
    </div>
    {callSid && (
      <p className="text-xs text-muted-foreground font-mono">Call SID: {callSid}</p>
    )}
    {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
    <div className="space-y-2 max-h-64 overflow-y-auto">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Transcript</h3>
      {transcript.length ? (
        transcript.map((entry, i) => (
          <div
            key={`${entry.at}-${i}`}
            className={`text-sm rounded-md px-3 py-2 ${
              entry.role === "user" ? "bg-muted" : "bg-primary/10"
            }`}
          >
            <span className="text-[10px] uppercase font-medium text-muted-foreground mr-2">
              {entry.role}
            </span>
            {entry.text}
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Answer your phone and start talking — transcript will appear here.
        </p>
      )}
    </div>
  </section>
);
