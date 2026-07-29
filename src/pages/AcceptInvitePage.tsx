import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Ban, CheckCircle2, Clock, Loader2, MailCheck, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import AuthShell from "@/components/auth/AuthShell";
import AuthStatusState from "@/components/auth/AuthStatusState";
import AuthPrimaryButton from "@/components/auth/AuthPrimaryButton";
import { AUTH_LINK_CLASS } from "@/components/auth/authTheme";
import { cn } from "@/lib/utils";

/**
 * Agency invitation landing page.
 *
 * Behavior preserved: token lookup, the five failure states, and forwarding an
 * accepted invitation to `/signup?token=...`.
 *
 * REMOVED (behavioral cleanup, approved 2026-07-28): a purely cosmetic 2200ms
 * `setTimeout` that delayed the lookup so four fake progress steps
 * ("Decrypting Invitation Token…", "Finalizing Secure Handshake…") could play.
 * That was 2.2s of invented latency on every invitation open and described
 * operations the product does not perform. The lookup now starts immediately.
 */

type InviteError = { title: string; message: string; icon: LucideIcon; tone: "error" | "warning" | "info" };

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Invitation = any;

const AcceptInvitePage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<InviteError | null>(null);
  const [invite, setInvite] = useState<Invitation>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");

    if (!token) {
      setError({
        title: "Missing token",
        message: "No invitation token was provided in the URL. Please check your email link.",
        icon: XCircle,
        tone: "error",
      });
      setLoading(false);
      return;
    }

    let cancelled = false;

    usersApi
      .getInvitationByToken(token)
      .then((inv) => {
        if (cancelled) return;
        if (!inv) {
          setError({
            title: "Invalid invitation",
            message: "This invitation link is invalid or has been malformed.",
            icon: XCircle,
            tone: "error",
          });
        } else if (inv.status === "Revoked") {
          setError({
            title: "Invitation revoked",
            message: "This invitation has been revoked by an administrator.",
            icon: Ban,
            tone: "error",
          });
        } else if (inv.status === "Expired" || new Date(inv.expires_at) < new Date()) {
          setError({
            title: "Invitation expired",
            message: "This invitation expired after 7 days. Please request a new link.",
            icon: Clock,
            tone: "warning",
          });
        } else if (inv.status === "Accepted") {
          setError({
            title: "Already used",
            message: "This invitation has already been used to create an account. Please log in instead.",
            icon: CheckCircle2,
            tone: "info",
          });
        } else {
          setInvite(inv);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Failed to fetch invitation:", e);
        setError({
          title: "Verification failed",
          message: "We couldn't verify this invitation. Please try again in a moment.",
          icon: XCircle,
          tone: "error",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [location.search]);

  const handleAccept = () => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    navigate(`/signup?token=${token}`);
  };

  if (loading) {
    return (
      <AuthShell>
        <AuthStatusState icon={Loader2} spin live title="Verifying your invitation…" />
      </AuthShell>
    );
  }

  if (error) {
    return (
      <AuthShell>
        <AuthStatusState icon={error.icon} tone={error.tone} live title={error.title} description={error.message}>
          <Link to="/login" className={cn(AUTH_LINK_CLASS, "inline-flex items-center gap-2 text-sm font-medium")}>
            Return to login <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </AuthStatusState>
      </AuthShell>
    );
  }

  const orgName = invite.org_name || invite.organizations?.name || "AgentFlow";

  return (
    <AuthShell>
      <AuthStatusState
        icon={MailCheck}
        tone="info"
        title={`You're invited to ${orgName}`}
        description={
          <>
            Hi <span className="font-medium text-slate-100">{invite.first_name}</span> — you&apos;ve been
            invited to join the team as a{" "}
            <span className="font-medium text-slate-100">{invite.role}</span>.
          </>
        }
      >
        <AuthPrimaryButton type="button" onClick={handleAccept}>
          Accept &amp; create account <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </AuthPrimaryButton>
      </AuthStatusState>
    </AuthShell>
  );
};

export default AcceptInvitePage;
