import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { amountsPreferenceKey, onAmountsHiddenChange, readAmountsHidden, writeAmountsHidden } from "@/lib/commission/amountsPreference";
import { cn } from "@/lib/utils";
import { AmountsContext, useAmounts } from "./amountsContext";

/**
 * "Hide amounts" for screen sharing across the Commissions Center (tabs, drawer, dialogs, calculator). Outside the
 * provider (e.g. the contact view) amounts are always shown, so the reused commission components behave as before.
 * Hidden amounts are replaced by one placeholder everywhere (text, labels, tooltips, accessible tables); plots of money
 * are replaced by a neutral panel. Editing needs an explicit "Show amounts" first; forms stay mounted while hidden so
 * typed values, request ids and unresolved-save recovery survive. A display preference only, not a security control.
 */

/** Reads the identity's stored choice before the first render (no flash of amounts) and follows other tabs. */
export function AmountsVisibilityProvider({ userId, organizationId, children }: {
  userId: string | null; organizationId: string | null; children: ReactNode;
}) {
  const key = userId && organizationId ? amountsPreferenceKey(userId, organizationId) : null;
  const [state, setState] = useState(() => ({ key, hidden: readAmountsHidden(key) }));
  // Another identity never inherits this one's choice, even without a remount.
  const hidden = state.key === key ? state.hidden : readAmountsHidden(key);
  if (state.key !== key) setState({ key, hidden });
  useEffect(() => onAmountsHiddenChange(key, (next) => setState({ key, hidden: next })), [key]);
  const setHidden = useCallback((next: boolean) => {
    setState({ key, hidden: next });
    writeAmountsHidden(key, next);
  }, [key]);
  const value = useMemo(() => ({ hidden, setHidden }), [hidden, setHidden]);
  return <AmountsContext.Provider value={value}>{children}</AmountsContext.Provider>;
}

/** The one eye control (beside the Commissions heading). */
export function AmountsToggle() {
  const { hidden, setHidden } = useAmounts();
  const [announcement, setAnnouncement] = useState("");
  const label = hidden ? "Show amounts" : "Hide amounts";
  const Icon = hidden ? EyeOff : Eye;
  return (
    <>
      <Button type="button" variant="ghost" size="icon" aria-label={label} title={label}
        className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
        onClick={() => { setHidden(!hidden); setAnnouncement(hidden ? "Amounts shown" : "Amounts hidden"); }}>
        <Icon className="h-4 w-4" aria-hidden />
      </Button>
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </>
  );
}

/** Shown instead of a financial form or action while amounts are hidden: an explicit reveal, never an automatic one. */
export function AmountsHiddenGate({ className }: { className?: string }) {
  const { setHidden } = useAmounts();
  return (
    <div role="status" className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-sm", className)}>
      <span className="flex items-center gap-2 text-muted-foreground"><EyeOff className="h-4 w-4" aria-hidden />Amounts are hidden</span>
      <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setHidden(false)}>Show amounts</Button>
    </div>
  );
}

/**
 * Financial editing: while amounts are hidden the children stay mounted but are not rendered (`hidden`, so nothing is
 * visible, focusable or read aloud) and the gate is shown instead.
 */
export function WhenAmountsShown({ children, gate = true }: { children: ReactNode; gate?: boolean }) {
  const { hidden } = useAmounts();
  return (
    <>
      {hidden && gate && <AmountsHiddenGate />}
      {/* No display utility while hidden: a class such as `contents` would override the `hidden` attribute. */}
      <div hidden={hidden} className={hidden ? undefined : "contents"}>{children}</div>
    </>
  );
}

/** A neutral stand-in for a plot of money (no axis, bar or label that could reveal a value). */
export function AmountsHiddenPanel({ className }: { className?: string }) {
  return (
    <div role="status" className={cn("flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 text-sm text-muted-foreground", className)}>
      <EyeOff className="h-5 w-5" aria-hidden />
      Amounts hidden
    </div>
  );
}
