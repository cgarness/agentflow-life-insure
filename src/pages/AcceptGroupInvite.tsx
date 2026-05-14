import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Loader2, XCircle, Sparkles, ShieldCheck, ArrowRight } from "lucide-react";
import AnimatedBackground from "@/components/AnimatedBackground";
import { useAuth } from "@/contexts/AuthContext";
import { agencyGroupApi } from "@/components/settings/agency-group/api";

type Preview = {
  group_name: string | null;
  master_org_name: string | null;
  invite_email: string | null;
  expires_at: string | null;
};

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
    agencyGroupApi.preview(token).then((res) => {
      if (!res.ok) {
        setError(res.data?.error ?? "Invitation not found or expired.");
      } else {
        setPreview(res.data);
      }
      setLoading(false);
    });
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    if (!isAuthenticated) {
      navigate(`/login?redirect=${encodeURIComponent(`/accept-group-invite?token=${token}`)}`);
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
      navigate(`/login?redirect=${encodeURIComponent(`/accept-group-invite?token=${token}`)}`);
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
      <div className="relative min-h-screen bg-[#020408] overflow-hidden flex items-center justify-center">
        <AnimatedBackground />
        <div className="relative z-10 text-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
          <p className="text-slate-300 text-sm">Verifying invitation…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#020408] overflow-hidden">
      <AnimatedBackground />
      <div className="relative z-10 max-w-md mx-auto pt-24 px-6">
        <div className="rounded-2xl p-8 text-center border border-blue-500/30 bg-[rgba(13,25,48,0.4)] backdrop-blur-xl">
          {error ? (
            <>
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                <XCircle className="w-10 h-10 text-red-400" />
              </div>
              <h1 className="text-2xl font-bold text-slate-100 mb-2">Invitation Unavailable</h1>
              <p className="text-sm text-slate-400 mb-6">{error}</p>
              <Link to="/login" className="inline-flex items-center justify-center gap-2 w-full h-12 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 font-semibold text-sm">
                Return to Login <ArrowRight className="w-4 h-4" />
              </Link>
            </>
          ) : (
            <>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-6 rounded-full bg-blue-500/10 border border-blue-500/25">
                <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-[11px] font-bold tracking-widest text-blue-400">AGENCY GROUP INVITATION</span>
              </div>
              <h1 className="text-3xl font-extrabold text-slate-100 mb-3 leading-tight">
                Join <span className="text-blue-400">{preview?.master_org_name ?? "an AgentFlow agency"}</span>'s Agency Group
              </h1>
              <p className="text-sm text-slate-400 mb-2">
                Group: <span className="text-slate-200 font-semibold">{preview?.group_name ?? "—"}</span>
              </p>
              <p className="text-sm text-slate-400 mb-6">
                As a member, your agency will appear on the shared leaderboard and get access to shared training resources. Your contacts, phone numbers, billing, and settings remain 100% yours.
              </p>
              {!isAuthenticated && (
                <p className="text-xs text-amber-400 mb-4">Log in as your agency's Admin to accept.</p>
              )}
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="w-full h-12 rounded-lg bg-gradient-to-br from-blue-700 via-blue-500 to-purple-700 text-white font-extrabold text-sm tracking-wide inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {accepting ? "Working…" : isAuthenticated ? "Accept Invitation" : "Log in to Accept"}
                <ArrowRight className="w-4 h-4" />
              </button>
              {isAuthenticated && (
                <button
                  onClick={handleDecline}
                  disabled={accepting}
                  className="w-full mt-3 h-10 rounded-lg bg-white/5 border border-white/10 text-slate-300 font-semibold text-xs tracking-wide disabled:opacity-60 hover:bg-white/10"
                >
                  Decline
                </button>
              )}
              <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-blue-300">
                <ShieldCheck className="w-3 h-3" /> Secure invite · expires {preview?.expires_at ? new Date(preview.expires_at).toLocaleDateString() : "in 7 days"}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AcceptGroupInvite;
