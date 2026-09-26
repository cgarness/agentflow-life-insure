import React from "react";
import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatStatusTime } from "@/lib/leaderboardStatusCopy";
import type { DashboardSectionState } from "@/hooks/useDashboardSection";

type NoticeState = Pick<
  DashboardSectionState<unknown>,
  "failed" | "offline" | "refreshing" | "complete" | "updatedAt"
>;

interface DashboardSectionNoticeProps {
  state: NoticeState;
  /** What the section shows, lower case: "stats", "your schedule", "missed calls"… */
  label: string;
  className?: string;
}

/**
 * One line over a section's data when that data is not current: a failed or
 * offline refresh keeps the rows and says from when they are; a running refresh
 * shows (visually only) that it is refreshing. The live region stays mounted, so
 * a failure that appears later is announced; nothing renders when data is current.
 */
export const DashboardSectionNotice: React.FC<DashboardSectionNoticeProps> = ({ state, label, className }) => {
  const at = state.updatedAt !== null ? formatStatusTime(state.updatedAt) : null;
  let Icon = AlertTriangle;
  let text: string | null = null;
  let announced = true;
  if (state.refreshing && !state.offline) {
    // Several sections refresh at once: shown, not announced six times over.
    Icon = RefreshCw;
    text = "Refreshing…";
    announced = false;
  } else if (!state.complete) {
    // A partial first load never claims to be a snapshot "from h:mm".
    text = `Some ${label} couldn't be loaded — what's shown may be incomplete.`;
  } else if (state.offline) {
    Icon = WifiOff;
    text = at
      ? `You're offline — showing ${label} from ${at}.`
      : `You're offline — ${label} will load when you reconnect.`;
  } else if (state.failed) {
    text = at ? `Couldn't refresh — showing ${label} from ${at}.` : `Couldn't load ${label}. Use Refresh to try again.`;
  }
  return (
    <div role="status" aria-live="polite" className={cn(text && className)}>
      {text && (
        <p
          aria-hidden={announced ? undefined : true}
          className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground"
        >
          <Icon className={cn("h-3 w-3 shrink-0", !announced && "animate-spin")} />
          <span>{text}</span>
        </p>
      )}
    </div>
  );
};

interface DashboardSectionUnavailableProps {
  state: Pick<DashboardSectionState<unknown>, "offline">;
  /** Lower case, as in the sentence "Couldn't load your schedule". */
  label: string;
}

/**
 * Nothing for this section is on screen and it could not load (or is waiting
 * for the connection). Never the section's valid-empty message.
 */
export const DashboardSectionUnavailable: React.FC<DashboardSectionUnavailableProps> = ({ state, label }) => {
  const Icon = state.offline ? WifiOff : AlertTriangle;
  const sentence = label.charAt(0).toUpperCase() + label.slice(1);
  return (
    <div role="status" aria-live="polite" className="text-center py-10 flex flex-col items-center">
      <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-amber-500" />
      </div>
      <p className="text-sm text-foreground font-semibold">
        {state.offline ? "You're offline" : `Couldn't load ${label}`}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {state.offline ? `${sentence} will load when you reconnect.` : "Use Refresh to try again."}
      </p>
    </div>
  );
};
