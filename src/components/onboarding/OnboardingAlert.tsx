import React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface OnboardingAlertProps {
  /** When empty nothing renders, but the live region stays mounted. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Announced status message for the onboarding card.
 *
 * The live region is ALWAYS mounted (even when empty) so assistive technology
 * observes the mutation when a message later appears — a region inserted at the
 * same time as its content is frequently missed by screen readers.
 *
 * The icon is decorative; the text carries the meaning, so colour is never the
 * sole signal.
 */
const OnboardingAlert: React.FC<OnboardingAlertProps> = ({ children, className }) => (
  <div role="alert" aria-live="polite" className={className}>
    {children ? (
      <div
        className={cn(
          "flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200",
        )}
      >
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">{children}</span>
      </div>
    ) : null}
  </div>
);

export default OnboardingAlert;
