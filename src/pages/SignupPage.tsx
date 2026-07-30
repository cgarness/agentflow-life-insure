import React, { useState, useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { ArrowRight, Check, Eye, EyeOff, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import { mapAuthError } from "@/utils/auth-errors";
import { Input } from "@/components/ui/input";
import Logo from "@/components/shared/Logo";
import AuthShell from "@/components/auth/AuthShell";
import AuthField from "@/components/auth/AuthField";
import AuthAlert from "@/components/auth/AuthAlert";
import AuthPrimaryButton from "@/components/auth/AuthPrimaryButton";
import {
  AUTH_FIELD_CLASS,
  AUTH_FOCUS_RING_CLASS,
  AUTH_HEADING_CLASS,
  AUTH_LINK_CLASS,
  AUTH_SUBHEADING_CLASS,
} from "@/components/auth/authTheme";
import { cn } from "@/lib/utils";

/**
 * Account creation.
 *
 * Both invitation paths are preserved: `?token=` (server lookup) and the legacy
 * base64 `?invite=` payload, each prefilling name/email/organization/upline/role/
 * licensed states/commission level. The `signup(...)` argument order, `mapAuthError`
 * mapping, and the `/confirmation` hand-off (carrying the email in router state)
 * are unchanged.
 *
 * PASSWORD POLICY IS UNCHANGED: 8+ characters, one uppercase, one number, one
 * special character — the same four rules the previous implementation enforced,
 * now also expressed in zod. (Note `/reset-password` independently enforces a
 * 6-character minimum; reconciling the two is a separate product decision.)
 */

/** The four live requirements, shown as a checklist while the user types. */
const PASSWORD_REQUIREMENTS = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "At least one uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "At least one number", test: (p: string) => /[0-9]/.test(p) },
  { label: "At least one special character", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
] as const;

const signupSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .regex(/[A-Z]/, "At least one uppercase letter")
    .regex(/[0-9]/, "At least one number")
    .regex(/[^A-Za-z0-9]/, "At least one special character"),
});

type FieldErrors = Partial<Record<"firstName" | "lastName" | "email" | "password", string>>;

const SignupPage: React.FC = () => {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [uplineId, setUplineId] = useState<string | null>(null);
  const [role, setRole] = useState<string>("Agent");
  const [licensedStates, setLicensedStates] = useState<any[]>([]);
  const [commissionLevel, setCommissionLevel] = useState<string>("0%");
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  const requirementResults = useMemo(
    () => PASSWORD_REQUIREMENTS.map((req) => ({ label: req.label, met: req.test(password) })),
    [password],
  );
  const isPasswordStrong = useMemo(() => requirementResults.every((r) => r.met), [requirementResults]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    const inviteData = params.get("invite");

    if (token) {
      setInviteToken(token);
      usersApi
        .getInvitationByToken(token)
        .then((inv) => {
          if (inv) {
            if (inv.first_name) setFirstName(inv.first_name);
            if (inv.last_name) setLastName(inv.last_name);
            if (inv.email) setEmail(inv.email);
            if (inv.organization_id) setOrganizationId(inv.organization_id);
            if (inv.org_name || inv.organizations?.name) setOrganizationName(inv.org_name || inv.organizations?.name);
            if (inv.upline_id) setUplineId(inv.upline_id);
            if (inv.role) setRole(inv.role);
            if (inv.licensed_states) setLicensedStates(inv.licensed_states);
            if (inv.commission_level) setCommissionLevel(inv.commission_level);
          }
        })
        .catch((e) => {
          console.error("Failed to fetch invitation:", e);
          setError("This invitation link may be invalid or expired.");
        });
    } else if (inviteData) {
      try {
        const decoded = JSON.parse(atob(inviteData));
        if (decoded.firstName) setFirstName(decoded.firstName);
        if (decoded.lastName) setLastName(decoded.lastName);
        if (decoded.email) setEmail(decoded.email);
        if (decoded.organizationId) setOrganizationId(decoded.organizationId);
        if (decoded.uplineId) setUplineId(decoded.uplineId);
        if (decoded.role) setRole(decoded.role);
        if (decoded.licensedStates) setLicensedStates(decoded.licensedStates);
        if (decoded.commissionLevel) setCommissionLevel(decoded.commissionLevel);
      } catch (e) {
        console.error("Failed to decode legacy invite data:", e);
      }
    }
  }, [location.search]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const parsed = signupSchema.safeParse({ firstName, lastName, email, password });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        firstName: flat.firstName?.[0],
        lastName: flat.lastName?.[0],
        email: flat.email?.[0],
        password: flat.password?.[0],
      });
      setError("");
      return;
    }

    setFieldErrors({});
    setError("");
    setLoading(true);
    try {
      await signup(
        parsed.data.email,
        parsed.data.password,
        parsed.data.firstName,
        parsed.data.lastName,
        organizationId,
        uplineId,
        role,
        licensedStates,
        commissionLevel,
        inviteToken,
      );
      // Intentionally leaves `loading` true — the component navigates away.
      navigate("/confirmation", { state: { email: parsed.data.email } });
    } catch (err) {
      setError(mapAuthError(err));
      setLoading(false);
    }
  };

  return (
    <AuthShell contentWidth="lg">
      <div className="mb-8 flex justify-center">
        <Logo variant="full" themeOverride="dark" iconClassName="h-9 w-9" textClassName="h-5" />
      </div>

      <div className="space-y-2 text-center">
        <h1 className={AUTH_HEADING_CLASS}>
          {organizationName ? `Join ${organizationName}` : "Create Your Account"}
        </h1>
        <p className={AUTH_SUBHEADING_CLASS}>
          {organizationName ? `You've been invited as a ${role}.` : "Start your journey as an independent agent."}
        </p>
      </div>

      <AuthAlert className="mt-6 empty:mt-0">{error}</AuthAlert>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <AuthField id="signup-first-name" label="First name" error={fieldErrors.firstName}>
            <Input
              id="signup-first-name"
              name="given-name"
              type="text"
              autoComplete="given-name"
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={loading}
              aria-invalid={Boolean(fieldErrors.firstName)}
              aria-describedby={fieldErrors.firstName ? "signup-first-name-error" : undefined}
              className={AUTH_FIELD_CLASS}
            />
          </AuthField>

          <AuthField id="signup-last-name" label="Last name" error={fieldErrors.lastName}>
            <Input
              id="signup-last-name"
              name="family-name"
              type="text"
              autoComplete="family-name"
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={loading}
              aria-invalid={Boolean(fieldErrors.lastName)}
              aria-describedby={fieldErrors.lastName ? "signup-last-name-error" : undefined}
              className={AUTH_FIELD_CLASS}
            />
          </AuthField>
        </div>

        <AuthField id="signup-email" label="Email" error={fieldErrors.email}>
          <Input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@agency.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "signup-email-error" : undefined}
            className={AUTH_FIELD_CLASS}
          />
        </AuthField>

        <AuthField id="signup-password" label="Password" error={fieldErrors.password}>
          <Input
            id="signup-password"
            name="new-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Create a password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={cn(
              fieldErrors.password ? "signup-password-error" : "",
              password.length > 0 ? "signup-password-requirements" : "",
            ).trim() || undefined}
            className={cn(AUTH_FIELD_CLASS, "pr-12")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            aria-controls="signup-password"
            className={cn(
              "absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition-colors hover:text-blue-300",
              AUTH_FOCUS_RING_CLASS,
            )}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </AuthField>

        {password.length > 0 && (
          <div
            id="signup-password-requirements"
            className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
          >
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Password requirements</p>
            <ul className="mt-3 space-y-1.5">
              {requirementResults.map(({ label, met }) => (
                <li key={label} className="flex items-center gap-2 text-xs">
                  {met ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                  ) : (
                    <X className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                  )}
                  <span className={met ? "text-emerald-300" : "text-slate-400"}>{label}</span>
                  <span className="sr-only">{met ? " — met" : " — not met"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <AuthPrimaryButton
          loading={loading}
          loadingLabel="Creating account…"
          disabled={loading || (password.length > 0 && !isPasswordStrong)}
        >
          Create account <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </AuthPrimaryButton>
      </form>

      <p className="mt-8 text-center text-sm text-slate-400">
        Already have an account?{" "}
        <Link to="/login" className={cn(AUTH_LINK_CLASS, "font-medium")}>
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
};

export default SignupPage;
