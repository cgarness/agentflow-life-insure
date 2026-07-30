import React, { useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { ArrowLeft, MailCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import Logo from "@/components/shared/Logo";
import AuthShell from "@/components/auth/AuthShell";
import AuthField from "@/components/auth/AuthField";
import AuthAlert from "@/components/auth/AuthAlert";
import AuthPrimaryButton from "@/components/auth/AuthPrimaryButton";
import AuthStatusState from "@/components/auth/AuthStatusState";
import {
  AUTH_FIELD_CLASS,
  AUTH_HEADING_CLASS,
  AUTH_LINK_CLASS,
  AUTH_SUBHEADING_CLASS,
} from "@/components/auth/authTheme";
import { cn } from "@/lib/utils";

/**
 * Request a password-reset link.
 *
 * Behavior is unchanged: `useAuth().resetPassword(email)` -> Supabase, then the
 * sent state echoes the submitted address. Account existence is never disclosed
 * beyond whatever the auth service itself returns.
 */

const forgotSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
});

const ForgotPassword: React.FC = () => {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const parsed = forgotSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError(parsed.error.flatten().fieldErrors.email?.[0]);
      setError("");
      return;
    }

    setFieldError(undefined);
    setError("");
    setLoading(true);
    try {
      await resetPassword(parsed.data.email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Could not send the reset link.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthShell>
        <AuthStatusState
          icon={MailCheck}
          tone="success"
          live
          title="Check your email"
          description={
            <>
              We&apos;ve sent a password reset link to{" "}
              <span className="font-medium text-slate-100">{email}</span>.
            </>
          }
        >
          <Link to="/login" className={cn(AUTH_LINK_CLASS, "inline-flex items-center gap-2 text-sm font-medium")}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to login
          </Link>
        </AuthStatusState>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mb-8 flex justify-center">
        <Logo variant="full" themeOverride="dark" iconClassName="h-9 w-9" textClassName="h-5" />
      </div>

      <div className="space-y-2 text-center">
        <h1 className={AUTH_HEADING_CLASS}>Reset Your Password</h1>
        <p className={AUTH_SUBHEADING_CLASS}>
          Enter your email and we&apos;ll send you a password reset link.
        </p>
      </div>

      <AuthAlert className="mt-6 empty:mt-0">{error}</AuthAlert>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
        <AuthField id="forgot-email" label="Email" error={fieldError}>
          <Input
            id="forgot-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@agency.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? "forgot-email-error" : undefined}
            className={AUTH_FIELD_CLASS}
          />
        </AuthField>

        <AuthPrimaryButton loading={loading} loadingLabel="Sending…">
          Send reset link
        </AuthPrimaryButton>
      </form>

      <p className="mt-8 text-center text-sm">
        <Link to="/login" className={cn(AUTH_LINK_CLASS, "inline-flex items-center gap-2")}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to login
        </Link>
      </p>
    </AuthShell>
  );
};

export default ForgotPassword;
