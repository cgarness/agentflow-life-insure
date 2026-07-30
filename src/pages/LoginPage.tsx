import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { ArrowRight, CheckCircle2, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { resolvePostAuthDestination } from "@/lib/safe-redirect";
import { Input } from "@/components/ui/input";
import Logo from "@/components/shared/Logo";
import AuthShell from "@/components/auth/AuthShell";
import AuthField from "@/components/auth/AuthField";
import AuthAlert from "@/components/auth/AuthAlert";
import AuthPrimaryButton from "@/components/auth/AuthPrimaryButton";
import AuthDivider from "@/components/auth/AuthDivider";
import AuthBadgeRow from "@/components/auth/AuthBadgeRow";
import {
  AUTH_FIELD_CLASS,
  AUTH_FOCUS_RING_CLASS,
  AUTH_HEADING_CLASS,
  AUTH_LINK_CLASS,
  AUTH_SUBHEADING_CLASS,
} from "@/components/auth/authTheme";
import { cn } from "@/lib/utils";

/**
 * AgentFlow sign-in — centered card on a solid black page.
 *
 * Auth is unchanged: `useAuth().login` -> Supabase, then the destination comes from
 * `resolvePostAuthDestination`, which honors a VALIDATED internal `?redirect=` and
 * otherwise falls back to `resolvePostAuthPath`. Onboarding always wins over a
 * redirect. Zod gates the submit only; it never changes which credentials Supabase
 * accepts.
 */

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type FieldErrors = Partial<Record<"email" | "password", string>>;

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [accessGranted, setAccessGranted] = useState(false);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    },
    [],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || accessGranted) return;

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({ email: flat.email?.[0], password: flat.password?.[0] });
      setError("");
      return;
    }

    setFieldErrors({});
    setError("");
    setLoading(true);
    try {
      const signedInUser = await login(parsed.data.email, parsed.data.password);
      setAccessGranted(true);
      const destination = resolvePostAuthDestination(signedInUser, searchParams.get("redirect"));
      redirectTimer.current = setTimeout(() => navigate(destination), 1200);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  const busy = loading || accessGranted;

  return (
    <AuthShell>
      <div className="mb-8 flex justify-center">
        <Logo variant="full" themeOverride="dark" iconClassName="h-10 w-10" textClassName="h-5" />
      </div>

      <div className="space-y-2 text-center">
        <h1 className={AUTH_HEADING_CLASS}>Welcome Back</h1>
        <p className={AUTH_SUBHEADING_CLASS}>Sign in to your AgentFlow workspace.</p>
      </div>

      <AuthDivider className="my-6" />

      <AuthAlert className="mb-5 empty:mb-0">{error}</AuthAlert>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <AuthField id="login-email" label="Email" error={fieldErrors.email}>
          <Mail
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-400/70"
          />
          <Input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@agency.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
            className={cn(AUTH_FIELD_CLASS, "pl-11")}
          />
        </AuthField>

        <AuthField
          id="login-password"
          label="Password"
          error={fieldErrors.password}
          action={
            <Link to="/forgot-password" className={cn(AUTH_LINK_CLASS, "text-xs")}>
              Forgot password?
            </Link>
          }
        >
          <Lock
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-400/70"
          />
          <Input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
            className={cn(AUTH_FIELD_CLASS, "pl-11 pr-12")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            aria-controls="login-password"
            className={cn(
              "absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition-colors hover:text-blue-300",
              AUTH_FOCUS_RING_CLASS,
            )}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </AuthField>

        <AuthPrimaryButton loading={loading} success={accessGranted} loadingLabel="Signing in…">
          {accessGranted ? (
            <>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Signed in — redirecting…
            </>
          ) : (
            <>
              Sign in <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </>
          )}
        </AuthPrimaryButton>
      </form>

      <p className="mt-8 text-center text-sm text-slate-400">
        Don&apos;t have an account?{" "}
        <Link to="/signup" className={cn(AUTH_LINK_CLASS, "font-medium")}>
          Sign up
        </Link>
      </p>

      <AuthBadgeRow className="mt-7" />
    </AuthShell>
  );
};

export default LoginPage;
