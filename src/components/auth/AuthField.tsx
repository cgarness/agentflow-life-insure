import React from "react";
import { Label } from "@/components/ui/label";
import { AUTH_FIELD_ERROR_CLASS, AUTH_LABEL_CLASS } from "@/components/auth/authTheme";

interface AuthFieldProps {
  /** Must match the `id` of the control rendered as `children`. */
  id: string;
  label: string;
  /** Inline validation message; rendered as `${id}-error` for `aria-describedby`. */
  error?: string;
  /** Optional trailing control on the label row (e.g. a forgot-password link). */
  action?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Field chrome for the auth pages — label row, control slot, and inline error.
 *
 * Presentational only: the control and all of its auth-facing props stay in the
 * page so the form wiring reads in one place. The control slot is `relative` so a
 * page can absolutely position a trailing affordance (show/hide password).
 */
const AuthField: React.FC<AuthFieldProps> = ({ id, label, error, action, children }) => (
  <div className="space-y-2">
    <div className="flex items-baseline justify-between gap-3">
      <Label htmlFor={id} className={AUTH_LABEL_CLASS}>
        {label}
      </Label>
      {action}
    </div>
    <div className="relative">{children}</div>
    {error && (
      <p id={`${id}-error`} className={AUTH_FIELD_ERROR_CLASS}>
        {error}
      </p>
    )}
  </div>
);

export default AuthField;
