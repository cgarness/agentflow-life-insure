import React from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AuthPrimaryButtonProps extends ButtonProps {
  /** Async request in flight — shows a spinner and blocks re-submission. */
  loading?: boolean;
  /** Terminal success — locks the button and switches it to the success colour. */
  success?: boolean;
  /** Replaces the label while `loading`. */
  loadingLabel?: string;
}

/**
 * Primary call to action for the auth pages.
 *
 * The spinner stays animated under `prefers-reduced-motion` because it is
 * essential status feedback (WCAG 2.2 SC 2.3.3 exempts essential animation).
 * Hover/focus feedback is colour-only (`transition-colors`) — no movement.
 * Disabling is driven by `loading || success` so a page cannot double-submit.
 */
const AuthPrimaryButton: React.FC<AuthPrimaryButtonProps> = ({
  loading = false,
  success = false,
  loadingLabel = "Working…",
  disabled,
  className,
  children,
  asChild,
  type,
  ...props
}) => (
  <Button
    asChild={asChild}
    // With `asChild` the props are spread onto the child element (usually a
    // `<Link>`), where `type`/`disabled` are invalid attributes on an anchor.
    type={asChild ? undefined : (type ?? "submit")}
    disabled={asChild ? undefined : (disabled ?? (loading || success))}
    className={cn(
      "h-12 w-full rounded-xl text-sm font-semibold tracking-wide text-white ring-offset-slate-900 transition-colors focus-visible:ring-blue-400",
      success
        ? "bg-emerald-500 hover:bg-emerald-500"
        : "bg-gradient-to-r from-blue-600 via-blue-500 to-violet-500 shadow-lg shadow-blue-950/50 hover:from-blue-500 hover:via-blue-400 hover:to-violet-400",
      className,
    )}
    {...props}
  >
    {loading ? (
      <>
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {loadingLabel}
      </>
    ) : (
      children
    )}
  </Button>
);

export default AuthPrimaryButton;
