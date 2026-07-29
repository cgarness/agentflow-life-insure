import React from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, MailCheck } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import AuthStatusState from "@/components/auth/AuthStatusState";
import AuthPrimaryButton from "@/components/auth/AuthPrimaryButton";

/**
 * Post-signup "verify your email" screen.
 *
 * The address arrives via router location state from `SignupPage`
 * (`navigate("/confirmation", { state: { email } })`) and falls back to generic
 * wording on direct navigation.
 */
const ConfirmationPage: React.FC = () => {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email;

  return (
    <AuthShell>
      <AuthStatusState
        icon={MailCheck}
        tone="info"
        title="Verify your email"
        description={
          <>
            We&apos;ve sent a verification link to{" "}
            <span className="font-medium text-slate-100">{email || "your email"}</span>. Check your
            inbox and click the link to activate your account.
          </>
        }
      >
        <AuthPrimaryButton asChild>
          <Link to="/login">
            Back to login <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </AuthPrimaryButton>
        <p className="text-xs text-slate-500">Didn&apos;t receive an email? Check your spam folder.</p>
      </AuthStatusState>
    </AuthShell>
  );
};

export default ConfirmationPage;
