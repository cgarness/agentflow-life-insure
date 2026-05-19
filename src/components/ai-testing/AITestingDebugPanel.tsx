import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Bug } from "lucide-react";

export type DebugLogEntry = {
  at: string;
  level: "info" | "warn" | "error";
  event: string;
  data?: unknown;
};

interface Props {
  entries: DebugLogEntry[];
  callStartIso?: string | null;
}

const LEVEL_STYLES: Record<DebugLogEntry["level"], string> = {
  info: "text-muted-foreground",
  warn: "text-amber-500",
  error: "text-destructive",
};

function relativeMs(at: string, base?: string | null): string {
  if (!base) return "";
  try {
    const ms = new Date(at).getTime() - new Date(base).getTime();
    if (!Number.isFinite(ms)) return "";
    const sign = ms < 0 ? "-" : "+";
    return `${sign}${(Math.abs(ms) / 1000).toFixed(2)}s`;
  } catch {
    return "";
  }
}

export const AITestingDebugPanel: React.FC<Props> = ({ entries, callStartIso }) => {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const reversed = useMemo(() => [...entries].reverse(), [entries]);

  return (
    <section className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Bug className="w-4 h-4" />
          Debug log
          <span className="text-xs font-normal text-muted-foreground">
            ({entries.length} {entries.length === 1 ? "entry" : "entries"})
          </span>
        </span>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {open && (
        <div className="border-t border-border max-h-96 overflow-y-auto p-3 space-y-1">
          {reversed.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-2 py-3">
              No debug entries yet — place a test call to populate the bridge lifecycle log.
            </p>
          ) : (
            reversed.map((entry, i) => {
              const idx = reversed.length - 1 - i;
              const isOpen = expanded[idx] ?? false;
              return (
                <div
                  key={`${entry.at}-${idx}`}
                  className="rounded-md border border-border/60 bg-background/50"
                >
                  <button
                    type="button"
                    onClick={() => setExpanded((s) => ({ ...s, [idx]: !isOpen }))}
                    className="w-full flex items-start gap-2 px-3 py-1.5 text-left text-xs font-mono"
                  >
                    <span className="text-muted-foreground shrink-0 w-16">
                      {relativeMs(entry.at, callStartIso) || entry.at.slice(11, 19)}
                    </span>
                    <span className={`shrink-0 w-12 uppercase ${LEVEL_STYLES[entry.level]}`}>
                      {entry.level}
                    </span>
                    <span className="text-foreground break-all">{entry.event}</span>
                  </button>
                  {isOpen && entry.data !== undefined && (
                    <pre className="px-3 pb-2 pt-0 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all">
                      {(() => {
                        try {
                          return JSON.stringify(entry.data, null, 2);
                        } catch {
                          return String(entry.data);
                        }
                      })()}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
};
