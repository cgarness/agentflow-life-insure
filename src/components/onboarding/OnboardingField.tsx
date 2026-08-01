import React from "react";
import { AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  ONBOARDING_ERROR_CLASS,
  ONBOARDING_HELPER_CLASS,
  ONBOARDING_LABEL_CLASS,
} from "@/components/onboarding/onboardingTheme";

interface OnboardingFieldProps {
  /** Must match the `id` of the control rendered as `children`. */
  id: string;
  label: string;
  /** Marks the field optional in the label row (never as a placeholder). */
  optional?: boolean;
  /** Guidance rendered as `${id}-helper`. */
  helper?: React.ReactNode;
  /** Validation message rendered as `${id}-error`. */
  error?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Field chrome for the onboarding wizard — label row, control slot, helper text
 * and inline error.
 *
 * Presentational only: the control and all of its wiring stay in the step
 * component. The error carries an icon and text so a failure is never signalled
 * by border colour alone, and both helper and error use stable ids so controls
 * can point at them with `aria-describedby`.
 */
const OnboardingField: React.FC<OnboardingFieldProps> = ({
  id,
  label,
  optional = false,
  helper,
  error,
  className,
  children,
}) => (
  <div className={cn("space-y-2", className)}>
    <div className="flex items-baseline justify-between gap-3">
      <Label htmlFor={id} className={ONBOARDING_LABEL_CLASS}>
        {label}
      </Label>
      {optional && <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Optional</span>}
    </div>
    {children}
    {helper && (
      <p id={`${id}-helper`} className={ONBOARDING_HELPER_CLASS}>
        {helper}
      </p>
    )}
    {error && (
      <p id={`${id}-error`} className={ONBOARDING_ERROR_CLASS}>
        <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{error}</span>
      </p>
    )}
  </div>
);

export default OnboardingField;
