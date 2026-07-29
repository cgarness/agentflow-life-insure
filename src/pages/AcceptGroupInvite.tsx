import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, Users, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { agencyGroupApi } from "@/components/settings/agency-group/api";
import { Button } from "@/components/ui/button";
import AuthShell from "@/components/auth/AuthShell";
import AuthStatusState from "@/components/auth/AuthStatusState";
import AuthPrimaryButton from "@/components/auth/AuthPrimaryButton";
import { AUTH_LINK_CLASS } from "@/components/auth/authTheme";
import { cn } from "@/lib/utils";

type Preview = {
  group_name: string | null;
  master_org_name: string | null;
  invite_email: string | null;
  expires_at: string | null;
};

/**
 * Agency Group invitation landing page.
 *
 * Unauthenticated visitors are sent to `/login?redirect=<this page>`; that return
 * path is now honored by `resolvePostAuthDestination` (it was previously produced
 * here and read by nothing — see WORK_LOG 2026-07-28). The Agency Group API is
 * untouched.
 */
const AcceptGroupInvite: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  const token = new URLSearchParams(location.search).get("token");

  useEffect(() => {
    if (!token) {
      setError("This invitation link is missing its token.");
      setLoading(false);
      return;
    }
    // `preview` uses a raw fetch, which REJECTS on network failure (offline, DNS,
    // CORS) — without the .catch the page would sit on the spinner forever.
    let cancelled = false;
    agencyGroupApi
      .preview(token)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(res.data?.error ?? "Invitation not found or expired.");
        } else {
          setPreview(res.data);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError("We couldn't verify this invitation. Please try again in a moment.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const loginWithReturnPath = () => {
    navigate(`/login?redirect=${encodeURIComponent(`/accept-group-invite?token=${token}`)}`);
  };

  const handleAccept = async () => {
    if (!token) return;
    if (!isAuthenticated) {
      loginWithReturnPath();
      return;
    }
    setAccepting(true);
    const res = await agencyGroupApi.accept(token);
    setAccepting(false);
    if (!res.ok) {
      setError(res.data?.error ?? "Failed to accept invitation.");
      return;
    }
    navigate("/settings?section=agency-group");
  };

  const handleDecline = async () => {
    if (!token) return;
    if (!isAuthenticated) {
      loginWithReturnPath();
      return;
    }
    setAccepting(true);
    const res = await agencyGroupApi.decline(token);
    setAccepting(false);
    if (!res.ok) {
      setError(res.data?.error ?? "Failed to decline invitation.");
      return;
    }
    navigate("/dashboard");
  };

  if (loading || authLoading) {
    return (
      <AuthShell>
        <AuthStatusState icon={Loader2} spin live title="Verifying invitation…" />
      </AuthShell>
    );
  }

  if (error) {
    return (
      <AuthShell>
        <AuthStatusState icon={XCircle} tone="error" live title="Invitation unavailable" description={error}>
          <Link to="/login" className={cn(AUTH_LINK_CLASS, "inline-flex items-center gap-2 text-sm font-medium")}>
            Return to login <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </AuthStatusState>
      </AuthShell>
    );
  }

  const expiry = preview?.expires_at ? new Date(preview.expires_at).toLocaleDateString() : "in 7 days";

  return (
    <AuthShell>
      <AuthStatusState
        icon={Users}
        tone="info"
        title={`Join ${preview?.master_org_name ?? "an AgentFlow agency"}'s Agency Group`}
        description={
          <>
            <span className="block">
              Group: <span className="font-medium text-slate-100">{preview?.group_name ?? "—"}</span>
            </span>
            <span className="mt-3 block">
              As a member, your agency appears on the shared leaderboard and gets access to shared
              training resources. Your contacts, phone numbers, billing, and settings remain 100% yours.
            </span>
          </>
        }
      >
        {!isAuthenticated && (
          <p className="text-xs text-amber-300">Log in as your agency&apos;s Admin to accept.</p>
        )}

        <AuthPrimaryButton type="button" onClick={handleAccept} loading={accepting} loadingLabel="Working…">
          {isAuthenticated ? "Accept invitation" : "Log in to accept"}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </AuthPrimaryButton>

        {isAuthenticated && (
          <Button
            type="button"
            variant="ghost"
            onClick={handleDecline}
            disabled={accepting}
            className="h-10 w-full rounded-xl border border-white/10 bg-white/5 text-xs font-semibold tracking-wide text-slate-300 ring-offset-slate-900 hover:bg-white/10 hover:text-slate-100"
          >
            Decline
          </Button>
        )}

        <p className="text-[11px] text-slate-500">Invitation expires {expiry}</p>
      </AuthStatusState>
    </AuthShell>
  );
};

export default AcceptGroupInvite;
