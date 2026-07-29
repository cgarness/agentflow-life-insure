import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolvePostAuthPath } from "@/lib/onboarding-wizard";
import AuthShell from "@/components/auth/AuthShell";
import AuthStatusState from "@/components/auth/AuthStatusState";
import AuthPrimaryButton from "@/components/auth/AuthPrimaryButton";

/**
 * Supabase email-confirmation / OAuth landing route.
 *
 * Behavior unchanged: exchange `?code` for a session when present, otherwise fall
 * back to the existing session, then resolve the destination through
 * `resolvePostAuthPath` after a 3s success beat. Raw auth errors are never
 * surfaced or logged — the catch is intentionally opaque.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          const { error } = await supabase.auth.getSession();
          if (error) throw error;
        }
        setStatus("success");
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const nextPath = resolvePostAuthPath(session?.user);
        redirectTimer.current = setTimeout(() => navigate(nextPath), 3000);
      } catch {
        setStatus("error");
      }
    };
    handleCallback();
  }, [navigate]);

  // Clear the redirect so an unmounted component can never navigate.
  useEffect(
    () => () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    },
    [],
  );

  if (status === "loading") {
    return (
      <AuthShell>
        <AuthStatusState icon={Loader2} spin live title="Confirming your account…" />
      </AuthShell>
    );
  }

  if (status === "success") {
    return (
      <AuthShell>
        <AuthStatusState
          icon={CheckCircle2}
          tone="success"
          live
          title="Email confirmed"
          description="Your account is ready. Taking you to AgentFlow…"
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthStatusState
        icon={XCircle}
        tone="error"
        live
        title="Confirmation failed"
        description="This link may have expired or already been used."
      >
        <AuthPrimaryButton asChild>
          <Link to="/login">Back to login</Link>
        </AuthPrimaryButton>
      </AuthStatusState>
    </AuthShell>
  );
}
