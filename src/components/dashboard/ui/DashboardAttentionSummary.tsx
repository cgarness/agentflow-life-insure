import React from "react";
import { ChevronRight, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A widget's one-line queue summary (plan §3.7): the exact active count, and — when the viewer
 * cleared or dismissed some — a link to that history. It is also the list's focus fallback, so
 * focus lands here when the last row is cleared.
 */
export const DashboardAttentionSummary: React.FC<{
  /** "12 pending callbacks", "4 missed calls in the last 24 hours". */
  activeText: string;
  /** How many the viewer hid (0 hides the link). */
  hiddenCount: number;
  /** "cleared" or "dismissed". */
  hiddenWord: "cleared" | "dismissed";
  /** Accent text class of the widget's tone. */
  toneText: string;
  onOpenHidden?: () => void;
}> = ({ activeText, hiddenCount, hiddenWord, toneText, onOpenHidden }) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <p tabIndex={-1} data-list-focus-fallback="" className="text-xs font-medium text-muted-foreground outline-none">
      {activeText}
    </p>
    {hiddenCount > 0 && onOpenHidden && (
      <button
        type="button"
        onClick={onOpenHidden}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold transition-colors motion-reduce:transition-none",
          "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          toneText,
        )}
      >
        <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
        {hiddenCount} {hiddenWord}
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    )}
  </div>
);
