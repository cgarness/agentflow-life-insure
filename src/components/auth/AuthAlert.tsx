import React from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type AuthAlertVariant = "error" | "success" | "info";

interface AuthAlertProps {
  variant?: AuthAlertVariant;
  /** When empty/undefined nothing renders, but the live region stays mounted. */
  children?: React.ReactNode;
  className?: string;
}

const VARIANTS: Record<AuthAlertVariant, { wrapper: string; Icon: typeof AlertCircle }> = {
  error: { wrapper: "border-rose-500/30 bg-rose-500/10 text-rose-200", Icon: AlertCircle },
  success: { wrapper: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200", Icon: CheckCircle2 },
  info: { wrapper: "border-blue-500/25 bg-blue-500/10 text-blue-100", Icon: Info },
};

/**
 * Announced status message for the auth pages.
 *
 * The live region is ALWAYS mounted (even when empty) so assistive technology
 * observes the mutation when a message later appears — a region inserted at the
 * same time as its content is frequently missed by screen readers.
 *
 * The icon is decorative; the text carries the meaning, so colour is never the
 * sole signal.
 */
const AuthAlert: React.FC<AuthAlertProps> = ({ variant = "error", children, className }) => {
  const { wrapper, Icon } = VARIANTS[variant];
  return (
    <div role="alert" aria-live="polite" className={className}>
      {children ? (
        <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", wrapper)}>
          <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{children}</span>
        </div>
      ) : null}
    </div>
  );
};

export default AuthAlert;
