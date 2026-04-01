import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Loader2, CheckCircle2, ArrowRight, ShieldCheck, Zap, Globe, Sparkles, XCircle, Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import AnimatedBackground from "@/components/AnimatedBackground";
import { supabase } from "@/integrations/supabase/client";

interface InviteData {
  email: string;
  role: string;
  first_name: string;
  last_name: string;
  organization_id: string;
  invitation_id: string;
}

const AcceptInvitePage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");

    if (!token) {
      setError("No invitation token provided.");
      setLoading(false);
      return;
    }

    supabase.functions
      .invoke("accept-invite", { body: { token } })
      .then(({ data, error: fnError }) => {
        if (fnError) {
          setError(`Error: ${fnError.message}`);
          return;
        }
        if (!data?.success) {
          setError(data?.error || "Invitation not found or expired.");
          return;
        }
        setInvite({
          email: data.email,
          role: data.role,
          first_name: data.first_name,
          last_name: data.last_name,
          organization_id: data.organization_id,
          invitation_id: data.invitation_id,
        });
      })
      .catch((e: Error) => {
        setError(`Failed to verify invitation: ${e.message}`);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [location.search]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite) return;
    setSubmitting(true);
    setError(null);

    const params = new URLSearchParams(location.search);
    const token = params.get("token");

    try {
      const { data, error: fnError } = await supabase.functions.invoke("accept-invite", {
        body: { token, action: "accept", password },
      });

      if (fnError) throw fnError;
      if (!data?.success) {
        setError(data?.error || "Failed to create account.");
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        window.location.href = "/login";
      }, 2000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Signup failed";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 52,
    background: "rgba(15, 23, 42, 0.4)",
    border: "1px solid rgba(148, 163, 184, 0.1)",
    borderRadius: 16,
    padding: "0 48px 0 48px",
    color: "#F8FAFC",
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box",
    backdropFilter: "blur(8px)",
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#020617", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 className="animate-spin text-primary" size={48} />
      </div>
    );
  }

  return (
    <div style={{ position: "relative", minHeight: "100vh", background: "#020617", overflow: "hidden", fontFamily: "Inter, system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        .accept-card { animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1); }
        .premium-btn {
          background: linear-gradient(135deg, #2563EB, #7C3AED);
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .premium-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 12px 24px -6px rgba(59, 130, 246, 0.5);
        }
        .invite-input:focus {
          border-color: #3B82F6 !important;
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1) !important;
        }
      `}</style>

      <AnimatedBackground />

      <div className="accept-card" style={{
        width: "100%",
        maxWidth: 520,
        background: "rgba(15, 23, 42, 0.3)",
        backdropFilter: "blur(24px) saturate(180%)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: 32,
        padding: "56px 48px",
        position: "relative",
        zIndex: 10,
        textAlign: "center",
      }}>
        {error ? (
          <>
            <div style={{ width: 80, height: 80, background: "rgba(239, 68, 68, 0.1)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
              <XCircle size={40} color="#EF4444" />
            </div>
            <h1 style={{ color: "#F8FAFC", fontSize: 28, fontWeight: 800, marginBottom: 12 }}>Invitation Error</h1>
            <p style={{ color: "#94A3B8", fontSize: 15, lineHeight: 1.6, marginBottom: 8, wordBreak: "break-word" }}>{error}</p>
            <Link to="/login" style={{ color: "#3B82F6", fontWeight: 600, fontSize: 14 }}>Return to Login</Link>
          </>
        ) : success ? (
          <>
            <div style={{ width: 80, height: 80, background: "rgba(34, 197, 94, 0.1)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", border: "1px solid rgba(34, 197, 94, 0.2)" }}>
              <CheckCircle2 size={40} color="#22C55E" />
            </div>
            <h1 style={{ color: "#F8FAFC", fontSize: 28, fontWeight: 800, marginBottom: 12 }}>Account Created!</h1>
            <p style={{ color: "#94A3B8", fontSize: 16, lineHeight: 1.6, marginBottom: 24 }}>
              Account created! You can now log in. Redirecting…
            </p>
            <Link to="/login" style={{ color: "#3B82F6", fontWeight: 600 }}>Go to Login</Link>
          </>
        ) : invite ? (
          <>
            <div style={{ display: "inline-flex", padding: "8px 16px", background: "rgba(59, 130, 246, 0.1)", border: "1px solid rgba(59, 130, 246, 0.2)", borderRadius: 100, marginBottom: 28, alignItems: "center", gap: 8 }}>
              <Sparkles size={14} color="#3B82F6" />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#3B82F6", letterSpacing: "0.05em" }}>OFFICIAL INVITATION</span>
            </div>

            <h1 style={{ color: "#F8FAFC", fontSize: 28, fontWeight: 900, marginBottom: 8, letterSpacing: "-0.03em" }}>
              Welcome, <span style={{ color: "#3B82F6" }}>{invite.first_name}</span>
            </h1>
            <p style={{ color: "#64748B", fontSize: 14, marginBottom: 32 }}>
              You've been invited as a <span style={{ color: "#94A3B8", fontWeight: 600 }}>{invite.role}</span>. Set a password to create your account.
            </p>

            {error && (
              <div style={{ background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.15)", borderRadius: 12, padding: "12px 16px", color: "#EF4444", fontSize: 13, marginBottom: 20, textAlign: "left" }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ textAlign: "left" }}>
              {/* Read-only name fields */}
              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600, display: "block", marginBottom: 6, marginLeft: 4 }}>First Name</label>
                  <div style={{ position: "relative" }}>
                    <User size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#475569" }} />
                    <input
                      style={{ ...inputStyle, color: "#64748B", cursor: "default", padding: "0 16px 0 40px" }}
                      value={invite.first_name}
                      readOnly
                    />
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600, display: "block", marginBottom: 6, marginLeft: 4 }}>Last Name</label>
                  <div style={{ position: "relative" }}>
                    <User size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#475569" }} />
                    <input
                      style={{ ...inputStyle, color: "#64748B", cursor: "default", padding: "0 16px 0 40px" }}
                      value={invite.last_name}
                      readOnly
                    />
                  </div>
                </div>
              </div>

              {/* Read-only email */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600, display: "block", marginBottom: 6, marginLeft: 4 }}>Email Address</label>
                <div style={{ position: "relative" }}>
                  <Mail size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#475569" }} />
                  <input
                    type="email"
                    style={{ ...inputStyle, color: "#64748B", cursor: "default" }}
                    value={invite.email}
                    readOnly
                  />
                </div>
              </div>

              {/* Password */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600, display: "block", marginBottom: 6, marginLeft: 4 }}>Create Password</label>
                <div style={{ position: "relative" }}>
                  <Lock size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#475569" }} />
                  <input
                    className="invite-input"
                    type={showPassword ? "text" : "password"}
                    style={inputStyle}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="Create a strong password"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#64748B", padding: 4, display: "flex", alignItems: "center" }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="premium-btn"
                style={{
                  width: "100%",
                  height: 56,
                  borderRadius: 16,
                  border: "none",
                  color: "white",
                  fontWeight: 700,
                  fontSize: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  cursor: submitting ? "default" : "pointer",
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <>Create Account <ArrowRight size={18} /></>
                )}
              </button>
            </form>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, paddingTop: 24, marginTop: 24, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ textAlign: "center" }}>
                <ShieldCheck size={18} color="#64748B" style={{ margin: "0 auto 6px" }} />
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>SECURE</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <Globe size={18} color="#64748B" style={{ margin: "0 auto 6px" }} />
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>GLOBAL</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <Zap size={18} color="#64748B" style={{ margin: "0 auto 6px" }} />
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>REAL-TIME</div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default AcceptInvitePage;
