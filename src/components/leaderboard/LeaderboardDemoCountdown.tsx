import React, { useEffect, useState } from "react";
import { Timer } from "lucide-react";

const INTERVAL_SEC = Math.max(
  3,
  Math.round(Number(import.meta.env.VITE_LEADERBOARD_DEMO_INTERVAL_MS || 15000) / 1000),
);

interface LeaderboardDemoCountdownProps {
  /** Bumps when a new win arrives (realtime) — resets the countdown */
  resetKey: string | null;
}

const LeaderboardDemoCountdown: React.FC<LeaderboardDemoCountdownProps> = ({ resetKey }) => {
  const [secondsLeft, setSecondsLeft] = useState(INTERVAL_SEC);

  useEffect(() => {
    if (resetKey) setSecondsLeft(INTERVAL_SEC);
  }, [resetKey]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? INTERVAL_SEC : prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const urgent = secondsLeft <= 3;

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full border px-4 py-2 shadow-lg backdrop-blur-sm ${
        urgent
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-card/95 text-foreground"
      }`}
      aria-live="polite"
    >
      <Timer className={`h-4 w-4 shrink-0 ${urgent ? "animate-pulse" : ""}`} />
      <span className="text-sm font-semibold tabular-nums">
        Next scoreboard refresh in <span className="font-black">{secondsLeft}s</span>
      </span>
    </div>
  );
};

export default LeaderboardDemoCountdown;
