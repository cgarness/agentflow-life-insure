import React from "react";
import { Badge } from "@/components/ui/badge";

function healthBadgeClass(display: string): string {
  const u = display.toLowerCase();
  if (u.includes("healthy") || u === "clean") {
    return "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  }
  if (u.includes("watch") || u.includes("risk") || u === "evaluating") {
    return "border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-400";
  }
  if (u.includes("spam") || u.includes("flagged")) {
    return "border-red-500/30 bg-red-500/15 text-red-700 dark:text-red-400";
  }
  return "border-border bg-muted/40 text-muted-foreground";
}

const TwilioV2Panel: React.FC<{ d: Record<string, unknown> }> = ({ d }) => {
  const window = d.window as Record<string, unknown> | undefined;
  const computed = d.computed as Record<string, unknown> | undefined;
  const penalties = Array.isArray(computed?.penalties) ? (computed.penalties as string[]) : [];
  const metrics = computed?.metrics as Record<string, unknown> | undefined;
  const carriers = (d.carriers ?? d.carrier_results) as unknown[] | undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="text-sm font-semibold text-foreground">Twilio details</h5>
        {typeof computed?.spam_status === "string" && (
          <Badge className={`border ${healthBadgeClass(String(computed.spam_status))}`}>{String(computed.spam_status)}</Badge>
        )}
      </div>
      {window && (
        <p className="text-xs text-muted-foreground">
          7-day window: {String(window.start ?? "")} to {String(window.end ?? "")} (UTC)
        </p>
      )}
      {metrics && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Total calls", metrics.total_calls],
            ["Block rate %", metrics.block_rate_pct],
            ["Short calls %", metrics.short_call_pct],
            ["Answer rate %", metrics.asr_pct],
          ].map(([label, val]) => (
            <div key={String(label)} className="rounded-lg border bg-card px-2 py-1.5 text-center">
              <p className="text-[10px] text-muted-foreground">{label}</p>
              <p className="text-sm font-semibold tabular-nums">{val != null ? String(val) : "—"}</p>
            </div>
          ))}
        </div>
      )}
      {penalties.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-foreground">Score factors</p>
          <ul className="list-inside list-disc text-xs text-muted-foreground">
            {penalties.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <h5 className="text-sm font-semibold text-foreground">Carrier view</h5>
      {carriers && Array.isArray(carriers) ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {carriers.map((c: unknown, i: number) => {
            const row = c as Record<string, unknown>;
            const name = String(row.name ?? row.carrier ?? "Unknown");
            const blocking = row.blocking_rate;
            return (
              <div key={i} className="space-y-1.5 rounded-lg border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{name}</span>
                  {blocking != null && (
                    <Badge
                      className={
                        Number(blocking) > 5
                          ? "border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-400"
                          : "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      }
                    >
                      {String(blocking)}% blocked
                    </Badge>
                  )}
                </div>
                {row.spam_label != null && (
                  <p className="text-xs text-muted-foreground">{String(row.spam_label)}</p>
                )}
                {row.completion_rate != null && (
                  <p className="text-xs text-muted-foreground">Completion: {String(row.completion_rate)}%</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm italic text-muted-foreground">No carrier breakdown available.</p>
      )}
    </div>
  );
};

export const CarrierReputationPanel: React.FC<{ data: unknown }> = ({ data }) => {
  if (!data || (typeof data === "object" && Object.keys(data as object).length === 0)) {
    return (
      <p className="text-sm italic text-muted-foreground">
        No carrier data yet. Run a reputation check to pull Twilio Voice Insights.
      </p>
    );
  }

  const d = data as Record<string, unknown>;
  if (Number(d.schema_version) === 2) {
    return <TwilioV2Panel d={d} />;
  }

  const carriers = (d.carriers ?? d.carrier_results) as unknown[] | undefined;
  const networkAnalysis = d.network_analysis as Record<string, unknown> | undefined;

  return (
    <div className="space-y-4">
      <h5 className="text-sm font-semibold text-foreground">Carrier view (legacy)</h5>
      {carriers && Array.isArray(carriers) ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {carriers.map((c: unknown, i: number) => {
            const row = c as Record<string, unknown>;
            const name = String(row.name ?? row.carrier ?? "Unknown");
            const blocking = row.blocking_rate;
            return (
              <div key={i} className="space-y-1.5 rounded-lg border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground capitalize">{name}</span>
                  {blocking != null && (
                    <Badge
                      className={
                        Number(blocking) > 5
                          ? "border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-400"
                          : "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      }
                    >
                      {String(blocking)}% blocked
                    </Badge>
                  )}
                </div>
                {row.spam_label != null && (
                  <p className="text-xs font-medium text-red-500">{String(row.spam_label)}</p>
                )}
                {row.completion_rate != null && (
                  <p className="text-xs text-muted-foreground">Completion: {String(row.completion_rate)}%</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm italic text-muted-foreground">No carrier breakdown available.</p>
      )}

      {networkAnalysis && (
        <div className="pt-2">
          <h5 className="text-sm font-semibold text-foreground mb-2">Network analysis</h5>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total calls", value: networkAnalysis.total_calls },
              { label: "Flagged calls", value: networkAnalysis.flagged_calls },
              {
                label: "Avg answer rate",
                value:
                  networkAnalysis.average_answer_rate != null
                    ? `${networkAnalysis.average_answer_rate}%`
                    : "N/A",
              },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border bg-card p-3 text-center">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold text-foreground">{s.value != null ? String(s.value) : "—"}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
