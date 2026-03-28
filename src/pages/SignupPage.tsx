import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react";
import AnimatedBackground from "@/components/AnimatedBackground";
import { Mail, Lock, User, ArrowRight } from "lucide-react";

const SignupPage: React.FC = () => {
  const { signup } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [uplineId, setUplineId] = useState<string | null>(null);
  const [role, setRole] = useState<string>("Agent");
  const [licensedStates, setLicensedStates] = useState<any[]>([]);
  const [commissionLevel, setCommissionLevel] = useState<string>("0%");
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const inviteData = params.get("invite");
    if (inviteData) {
      try {
        // Try to decode as base64 JSON
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
        // If it's just a string ID, we can't do much without fetching, 
        // but the new system passes encoded objects.
        console.error("Failed to decode invite data:", e);
      }
    }
  }, [location.search]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signup(email, password, firstName, lastName, organizationId, uplineId, role, licensedStates, commissionLevel);
      setSuccess(true);
    } catch (err: any) /* eslint-disable-line @typescript-eslint/no-explicit-any */ {
      setError(err.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 44,
    background: 'rgba(8,18,36,0.65)',
    border: '1px solid rgba(40,70,120,0.7)',
    borderRadius: 10,
    padding: '0 14px 0 42px',
    color: '#F1F5F9',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: 500,
    marginBottom: 6,
    display: 'block',
  };

  const iconLeftStyle: React.CSSProperties = {
    position: 'absolute',
    left: 14,
    top: '50%',
    transform: 'translateY(-50%)',
    pointerEvents: 'none',
  };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#020408', overflow: 'hidden', fontFamily: '-apple-system, sans-serif' }}>
      <style>{`
        @keyframes cardEntrance { from { opacity:0; transform:translate(-50%,calc(-50% + 24px)) scale(0.96); } to { opacity:1; transform:translate(-50%,-50%) scale(1); } }
        @keyframes glowPulse { 0%,100% { border-color:rgba(59,130,246,0.3); box-shadow:0 8px 40px rgba(0,0,0,0.5),0 0 35px rgba(59,130,246,0.18),0 0 80px rgba(59,130,246,0.07); } 50% { border-color:rgba(168,85,247,0.3); box-shadow:0 8px 40px rgba(0,0,0,0.5),0 0 35px rgba(168,85,247,0.18),0 0 80px rgba(168,85,247,0.07); } }
        @keyframes shimmer { from { background-position:0% 50%; } to { background-position:100% 50%; } }
        @keyframes underlineGrow { from { width:0; } to { width:72%; } }
        @keyframes badgePulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.45; transform:scale(0.75); } }
        @keyframes accessGrantedFade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .signup-input:focus { border-color: #3B82F6 !important; box-shadow: 0 0 0 3px rgba(59,130,246,0.15) !important; }
      `}</style>
      <AnimatedBackground />
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 10, width: 460, animation: 'cardEntrance 0.7s ease-out forwards', opacity: 0 }}>
        <div style={{
          background: 'rgba(13,25,48,0.38)',
          backdropFilter: 'blur(36px) saturate(200%) brightness(1.15)',
          WebkitBackdropFilter: 'blur(36px) saturate(200%) brightness(1.15)',
          border: '1px solid rgba(99,155,255,0.3)',
          borderRadius: 20,
          padding: 44,
          position: 'relative',
          overflow: 'hidden',
          animation: 'glowPulse 5s ease-in-out infinite',
        }}>
          {/* Glass top highlight */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.3) 30%, rgba(120,180,255,0.5) 50%, rgba(255,255,255,0.3) 70%, transparent 95%)' }} />

          {success ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                marginBottom: '20px', padding: '14px 18px', borderRadius: '10px',
                border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.08)',
                color: '#22C55E', fontSize: '16px', fontWeight: 700, letterSpacing: '0.06em',
                boxShadow: '0 0 20px rgba(34,197,94,0.2)',
                animation: 'accessGrantedFade 0.4s ease-out forwards',
              }}>
                ✓ ACCOUNT CREATED
              </div>
              <CheckCircle2 size={48} color="#22C55E" style={{ margin: '0 auto 16px' }} />
              <h2 style={{ color: '#F1F5F9', fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Check Your Email</h2>
              <p style={{ color: '#94A3B8', fontSize: 13, marginBottom: 16 }}>
                We've sent a confirmation link to <span style={{ color: '#F1F5F9', fontWeight: 500 }}>{email}</span>. Click the link to activate your account.
              </p>
              <Link to="/login" style={{ color: '#3B82F6', fontSize: 13, textDecoration: 'none', fontWeight: 500 }}>Back to Login</Link>
            </div>
          ) : (
            <>
              {/* Wordmark */}
              <div style={{ textAlign: 'center', marginBottom: 6 }}>
                <span style={{ color: '#F1F5F9', fontWeight: 800, fontSize: 30 }}>Agent</span>
                <span style={{ color: '#3B82F6', fontWeight: 800, fontSize: 30, textShadow: '0 0 20px rgba(59,130,246,0.7)' }}>Flow</span>
              </div>

              {/* Underline bar */}
              <div style={{ height: 2, background: 'linear-gradient(90deg,transparent,#3B82F6,#A855F7,transparent)', borderRadius: 2, margin: '0 auto 18px', width: 0, animation: 'underlineGrow 0.9s 0.35s ease-out forwards', boxShadow: '0 0 12px rgba(59,130,246,0.5)' }} />

              {/* Heading */}
              <div style={{ color: '#F1F5F9', fontSize: 22, fontWeight: 700, textAlign: 'center' }}>Create Your Account</div>
              <div style={{ color: '#64748B', fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 28 }}>Get started with AgentFlow</div>

              {/* Error banner */}
              {error && (
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, padding: '10px 14px', color: '#EF4444', fontSize: 13, marginBottom: 16 }}>
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                {/* First Name + Last Name */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                  <div style={{ width: '50%' }}>
                    <label style={labelStyle}>First Name</label>
                    <div style={{ position: 'relative' }}>
                      <span style={iconLeftStyle}><User size={16} color="#3B82F6" /></span>
                      <input
                        className="signup-input"
                        type="text"
                        value={firstName}
                        onChange={e => setFirstName(e.target.value)}
                        required
                        placeholder="John"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                  <div style={{ width: '50%' }}>
                    <label style={labelStyle}>Last Name</label>
                    <div style={{ position: 'relative' }}>
                      <span style={iconLeftStyle}><User size={16} color="#3B82F6" /></span>
                      <input
                        className="signup-input"
                        type="text"
                        value={lastName}
                        onChange={e => setLastName(e.target.value)}
                        required
                        placeholder="Doe"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                </div>

                {/* Email */}
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Email</label>
                  <div style={{ position: 'relative' }}>
                    <span style={iconLeftStyle}><Mail size={16} color="#3B82F6" /></span>
                    <input
                      className="signup-input"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      placeholder="you@company.com"
                      style={inputStyle}
                    />
                  </div>
                </div>

                {/* Password */}
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Password</label>
                  <div style={{ position: 'relative' }}>
                    <span style={iconLeftStyle}><Lock size={16} color="#3B82F6" /></span>
                    <input
                      className="signup-input"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      minLength={6}
                      placeholder="Min 6 characters"
                      style={{ ...inputStyle, paddingRight: 42 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      {showPassword ? <EyeOff size={16} color="#64748B" /> : <Eye size={16} color="#64748B" />}
                    </button>
                  </div>
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    marginTop: 24,
                    width: '100%',
                    height: 48,
                    borderRadius: 10,
                    border: 'none',
                    background: 'linear-gradient(135deg,#1D4ED8,#3B82F6,#6D28D9)',
                    backgroundSize: '200%',
                    animation: 'shimmer 3s ease-in-out infinite alternate',
                    color: 'white',
                    fontWeight: 700,
                    fontSize: 14,
                    letterSpacing: '0.06em',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxShadow: '0 0 22px rgba(59,130,246,0.35)',
                    position: 'relative',
                    overflow: 'hidden',
                    cursor: loading ? 'default' : 'pointer',
                    opacity: loading ? 0.75 : 1,
                  }}
                >
                  {loading ? (
                    <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> CREATING ACCOUNT...</>
                  ) : (
                    <>CREATE ACCOUNT <ArrowRight size={16} /></>
                  )}
                </button>
              </form>

              {/* Badges */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', border: '1px solid rgba(59,130,246,0.45)', color: '#93C5FD', background: 'rgba(59,130,246,0.1)' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#3B82F6', animation: 'badgePulse 2s ease-in-out infinite' }} />SECURE
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', border: '1px solid rgba(20,184,166,0.45)', color: '#5EEAD4', background: 'rgba(20,184,166,0.1)' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#14B8A6', animation: 'badgePulse 2s ease-in-out infinite', animationDelay: '0.7s' }} />ENCRYPTED
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', border: '1px solid rgba(168,85,247,0.45)', color: '#D8B4FE', background: 'rgba(168,85,247,0.1)' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#A855F7', animation: 'badgePulse 2s ease-in-out infinite', animationDelay: '1.4s' }} />AI POWERED
                </span>
              </div>

              {/* Sign in link */}
              <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: '#64748B' }}>
                Already have an account?{' '}
                <Link to="/login" style={{ color: '#3B82F6', textDecoration: 'none' }}>Sign In</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
