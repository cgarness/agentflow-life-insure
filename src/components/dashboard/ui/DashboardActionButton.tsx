import React, { useId } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DASHBOARD_ACTIONS, type DashboardActionVariant } from "@/components/dashboard/ui/dashboardTones";

interface DashboardActionButtonProps {
  variant: DashboardActionVariant;
  icon?: React.ElementType;
  /** Visible text. */
  children: React.ReactNode;
  /** Accessible name (e.g. "Clear callback for Pat Lee"). */
  label: string;
  onClick: () => void;
  /**
   * Why the action cannot run. The button stays FOCUSABLE (`aria-disabled`), screen readers get
   * the reason, and activating it says why instead of doing nothing.
   */
  blockedReason?: string | null;
  /** The action is running: announced, and further clicks are ignored (focus is kept). */
  busy?: boolean;
  /** Hide the text below `sm` (icon only; the accessible name stays). */
  compact?: boolean;
  /** What the action does, as a tooltip and a screen-reader description. */
  hint?: string;
  /** Marks the row's main action for focus recovery after a row is removed. */
  rowFocus?: boolean;
  testId?: string;
}

/**
 * The Dashboard row action (plan §4.2): primary call (Calls blue), secondary, clear (green hover)
 * and quiet variants with visible focus rings, 36 px targets and reduced-motion-safe transitions.
 * It never uses `disabled`, so a blocked or busy action keeps keyboard focus and its reason.
 */
export const DashboardActionButton: React.FC<DashboardActionButtonProps> = ({
  variant, icon: Icon, children, label, onClick, blockedReason = null, busy = false, compact = false, rowFocus = false, hint, testId,
}) => {
  const reasonId = useId();
  const hintId = useId();
  const blocked = !!blockedReason;
  const describedBy = [blocked ? reasonId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <>
      <button
        type="button"
        data-testid={testId}
        data-row-focus={rowFocus ? "" : undefined}
        aria-label={label}
        aria-disabled={blocked || busy ? "true" : undefined}
        aria-busy={busy ? "true" : undefined}
        aria-describedby={describedBy}
        title={hint}
        onClick={() => {
          if (busy) return;
          if (blocked) {
            toast.error(blockedReason);
            return;
          }
          onClick();
        }}
        className={cn(
          "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium",
          "transition-colors motion-reduce:transition-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          DASHBOARD_ACTIONS[variant],
          (blocked || busy) && "cursor-not-allowed opacity-60",
        )}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className={cn(compact && "sr-only sm:not-sr-only")}>{children}</span>
      </button>
      {blocked && <span id={reasonId} className="sr-only">{blockedReason}</span>}
      {hint && <span id={hintId} className="sr-only">{hint}</span>}
    </>
  );
};
