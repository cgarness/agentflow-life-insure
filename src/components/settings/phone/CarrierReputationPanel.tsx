import React from "react";
import { Badge } from "@/components/ui/badge";

export const CarrierReputationPanel: React.FC<{ data: unknown }> = ({ data }) => {
  if (!data || (typeof data === "object" && Object.keys(data as object).length === 0)) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No carrier data available. Run a reputation check to load carrier breakdown when Twilio exposes it.
      </p>
    );
  }

  const d = data as Record<string, unknown>;
  const carriers = (d.carriers ?? d.carrier_results) as unknown[] | undefined;
  const networkAnalysis = d.network_analysis as Record<string, unknown> | undefined;

  return (
    <div className="space-y-4">
      <h5 className="text-sm font-semibold text-foreground">Carrier view (partial data)</h5>
      {carriers && Array.isArray(carriers) ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {carriers.map((c: unknown, i: number) => {
            const row = c as Record<string, unknown>;
            const name = String(row.name ?? row.carrier ?? "Unknown");
            const blocking = row.blocking_rate;
            return (
              <div key={i} className="bg-card border rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground capitalize">{name}</span>
                  {blocking != null && (
                    <Badge
                      className={
                        Number(blocking) > 5
                          ? "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30"
                          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                      }
                    >
                      {String(blocking)}% blocked
                    </Badge>
                  )}
                </div>
                {row.spam_label != null && (
                  <p className="text-xs text-red-500 font-medium">{String(row.spam_label)}</p>
                )}
                {row.completion_rate != null && (
                  <p className="text-xs text-muted-foreground">Completion: {String(row.completion_rate)}%</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">No carrier breakdown available.</p>
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
              <div key={s.label} className="bg-card border rounded-lg p-3 text-center">
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
