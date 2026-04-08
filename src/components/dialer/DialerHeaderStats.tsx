import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface DialerHeaderStatsProps {
  statsLoading: boolean;
  sessionStartedAt: string | null | undefined;
  sessionElapsed: number;
  sessionStats: {
    calls_made: number;
    calls_connected: number;
    total_talk_seconds: number;
    policies_sold: number;
  };
  fmtSessionDuration: (seconds: number) => string;
  fmtDuration: (seconds: number) => string;
}

export const DialerHeaderStats: React.FC<DialerHeaderStatsProps> = ({
  statsLoading,
  sessionStartedAt,
  sessionElapsed,
  sessionStats,
  fmtSessionDuration,
  fmtDuration,
}) => {
  if (statsLoading) {
    return (
      <div className="flex items-center justify-center flex-1 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center px-3 py-1 bg-accent/30 border border-border/50 rounded-xl min-w-[70px]">
            <Skeleton className="h-2 w-10 mb-1" />
            <Skeleton className="h-2.5 w-6" />
          </div>
        ))}
      </div>
    );
  }

  const stats = [
    { label: "Session Duration", value: fmtSessionDuration(sessionElapsed) },
    { label: "Calls Made", value: sessionStats.calls_made },
    { label: "Connected", value: sessionStats.calls_connected },
    { label: "Answer Rate", value: sessionStats.calls_made > 0 ? `${Math.round(sessionStats.calls_connected / sessionStats.calls_made * 100)}%` : "—" },
    { label: "Policies Sold", value: sessionStats.policies_sold },
    { label: "Avg Talk Time", value: sessionStats.calls_connected > 0 ? fmtDuration(Math.round(sessionStats.total_talk_seconds / sessionStats.calls_connected)) : "—" },
  ];

  return (
    <div className="flex items-center justify-center flex-1 gap-2 overflow-hidden">
      {stats.map((s) => (
        <div
          key={s.label}
          className="flex flex-col items-center px-3 py-1 bg-accent/30 border border-border/50 rounded-xl min-w-0 h-14 justify-center transition-all hover:bg-accent/50"
        >
          <div className="text-[8px] text-muted-foreground uppercase tracking-wider font-semibold truncate w-full text-center">{s.label}</div>
          <div className="text-xs font-bold font-mono text-foreground truncate">{s.value}</div>
        </div>
      ))}
    </div>
  );
};
