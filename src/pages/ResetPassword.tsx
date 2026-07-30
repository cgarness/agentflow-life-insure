import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { CheckCircle2, Eye, EyeOff, Lock, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import Logo from "@/components/shared/Logo";
import AuthShell from "@/components/auth/AuthShell";
import AuthField from "@/components/auth/AuthField";
import AuthAlert from "@/components/auth/AuthAlert";
import AuthPrimaryButton from "@/components/auth/AuthPrimaryButton";
import AuthStatusState from "@/components/auth/AuthStatusState";
import AuthDivider from "@/components/auth/AuthDivider";
import {
  AUTH_FIELD_CLASS,
  AUTH_FOCUS_RING_CLASS,
  AUTH_HEADING_CLASS,
  AUTH_LINK_CLASS,
  AUTH_SUBHEADING_CLASS,
} from "@/components/auth/authTheme";
import { cn } from "@/lib/utils";

/**
 * Complete a password reset from a Supabase recovery link.
 *
 * PASSWORD POLICY IS UNCHANGED: the previous implementation enforced a 6-character
 * minimum via native `minLength={6}` on both inputs, so the zod schema below uses
 * exactly 6. This deliberately does NOT match the signup policy (8 + uppercase +
 * number + special) — reconciling the two is a separate product/security decision,
 * not a visual refresh (see WORK_LOG 2026-07-28).
 */

const RESET_MIN_LENGTH = 6;

const resetSchema = z
  .object({
    password: z.string().min(RESET_MIN_LENGTH, `Password must be at least ${RESET_MIN_LENGTH} characters`),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FieldErrors = Partial<Record<"password" | "confirmPassword", string>>;

const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Check if this is a recovery flow
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setIsRecovery(true);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Clear the post-success redirect so an unmounted component can never navigate.
  useEffect(
    () => () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    },
    [],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || success) return;

    const parsed = resetSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({ password: flat.password?.[0], confirmPassword: flat.confirmPassword?.[0] });
      setError("");
      return;
    }

    setFieldErrors({});
    setError("");
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: parsed.data.password });
      if (updateError) throw updateError;
      setSuccess(true);
      redirectTimer.current = setTimeout(() => navigate("/login"), 3000);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  if (!isRecovery && !success) {
    return (
      <AuthShell>
        <AuthStatusState
          icon={ShieldAlert}
          tone="error"
          title="Invalid reset link"
          description="This link is invalid or has expired."
        >
          <Link to="/forgot-password" className={cn(AUTH_LINK_CLASS, "text-sm font-medium")}>
            Request a new reset link
          </Link>
        </AuthStatusState>
      </AuthShell>
    );
  }

  if (success) {
    return (
      <AuthShell>
        <AuthStatusState
          icon={CheckCircle2}
          tone="success"
          live
          title="Password updated"
          description="Redirecting you to sign in…"
        >
          <Link to="/login" className={cn(AUTH_LINK_CLASS, "text-sm font-medium")}>
            Go to login now
          </Link>
        </AuthStatusState>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mb-8 flex justify-center">
        <Logo variant="full" themeOverride="dark" iconClassName="h-10 w-10" textClassName="h-5" />
      </div>

      <div className="space-y-2 text-center">
        <h1 className={AUTH_HEADING_CLASS}>Set a new password</h1>
        <p className={AUTH_SUBHEADING_CLASS}>Choose a strong password for your account.</p>
      </div>

      <AuthDivider className="my-6" />

      <AuthAlert className="mb-5 empty:mb-0">{error}</AuthAlert>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <AuthField id="reset-password" label="New password" error={fieldErrors.password}>
          <Lock
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-400/70"
          />
          <Input
            id="reset-password"
            name="new-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder={`At least ${RESET_MIN_LENGTH} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? "reset-password-error" : undefined}
            className={cn(AUTH_FIELD_CLASS, "pl-11 pr-12")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            aria-controls="reset-password"
            className={cn(
              "absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition-colors hover:text-blue-300",
              AUTH_FOCUS_RING_CLASS,
            )}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </AuthField>

        <AuthField id="reset-confirm" label="Confirm password" error={fieldErrors.confirmPassword}>
          <Lock
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-400/70"
          />
          <Input
            id="reset-confirm"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            placeholder="Repeat your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading}
            aria-invalid={Boolean(fieldErrors.confirmPassword)}
            aria-describedby={fieldErrors.confirmPassword ? "reset-confirm-error" : undefined}
            className={cn(AUTH_FIELD_CLASS, "pl-11")}
          />
        </AuthField>

        <AuthPrimaryButton loading={loading} loadingLabel="Updating…">
          Update password
        </AuthPrimaryButton>
      </form>
    </AuthShell>
  );
};

export default ResetPassword;
