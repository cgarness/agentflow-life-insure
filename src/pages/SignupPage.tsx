import React, { useState, useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, EyeOff, Loader2, Mail, Lock, User, ArrowRight, ShieldCheck, Zap, Globe, Check, X } from "lucide-react";
import AnimatedBackground from "@/components/AnimatedBackground";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import { mapAuthError } from "@/utils/auth-errors";

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
  const [loading, setLoading] = useState(false);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [uplineId, setUplineId] = useState<string | null>(null);
  const [role, setRole] = useState<string>("Agent");
  const [licensedStates, setLicensedStates] = useState<any[]>([]);
  const [commissionLevel, setCommissionLevel] = useState<string>("0%");

  const passwordRequirements = useMemo(() => [
    { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
    { label: "At least one uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
    { label: "At least one number", test: (p: string) => /[0-9]/.test(p) },
    { label: "At least one special character", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
  ], []);

  const isPasswordStrong = useMemo(() => 
    passwordRequirements.every(req => req.test(password)),
  [password, passwordRequirements]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    const inviteData = params.get("invite");
    
    if (token) {
      usersApi.getInvitationByToken(token).then(inv => {
        if (inv) {
          if (inv.first_name) setFirstName(inv.first_name);
          if (inv.last_name) setLastName(inv.last_name);
          if (inv.email) setEmail(inv.email);
          if (inv.organization_id) setOrganizationId(inv.organization_id);
          if (inv.organizations?.name) setOrganizationName(inv.organizations.name);
          if (inv.upline_id) setUplineId(inv.upline_id);
          if (inv.role) setRole(inv.role);
          if (inv.licensed_states) setLicensedStates(inv.licensed_states);
          if (inv.commission_level) setCommissionLevel(inv.commission_level);
        }
      }).catch(e => {
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
    if (!isPasswordStrong) {
      setError("Please ensure your password meets all requirements before continuing.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await signup(email, password, firstName, lastName, organizationId, uplineId, role, licensedStates, commissionLevel);
      navigate("/confirmation", { state: { email } });
    } catch (err: any) {
      setError(mapAuthError(err));
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', height: '44px', background: 'rgba(8,18,36,0.65)',
    border: '1px solid rgba(40,70,120,0.7)', borderRadius: '10px',
    padding: '0 14px 0 42px', color: '#F1F5F9', fontSize: '14px',
    outline: 'none', boxSizing: 'border-box',
    transition: 'all 0.3s ease'
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '11px', color: '#94A3B8', fontWeight: 500, marginBottom: '6px'
  };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#020408', overflow: 'hidden' }}>
      <AnimatedBackground />

      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)', zIndex: 10,
        width: '500px', maxWidth: '90vw',
        animation: 'cardEntrance 0.7s ease-out forwards',
        opacity: 0,
      }}>
        {/* Card */}
        <div style={{
          background: 'rgba(13,25,48,0.38)',
          backdropFilter: 'blur(36px) saturate(200%) brightness(1.15)',
          border: '1px solid rgba(99,155,255,0.3)',
          borderRadius: '20px',
          padding: '44px',
          animation: 'glowPulse 5s ease-in-out infinite',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Top highlight line */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
            background: 'linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.3) 30%, rgba(120,180,255,0.5) 50%, rgba(255,255,255,0.3) 70%, transparent 95%)',
          }} />

          {/* Wordmark */}
          <div style={{ textAlign: 'center', marginBottom: '4px' }}>
            <span style={{ color: '#F1F5F9', fontWeight: 800, fontSize: '30px', fontFamily: '-apple-system, sans-serif' }}>Agent</span>
            <span style={{ color: '#3B82F6', fontWeight: 800, fontSize: '30px', fontFamily: '-apple-system, sans-serif', textShadow: '0 0 20px rgba(59,130,246,0.7)' }}>Flow</span>
          </div>

          <div style={{
            height: '2px',
            background: 'linear-gradient(90deg, transparent, #3B82F6, #A855F7, transparent)',
            borderRadius: '2px',
            margin: '0 auto 18px',
            width: 0,
            animation: 'underlineGrow 0.9s 0.35s ease-out forwards',
            boxShadow: '0 0 12px rgba(59,130,246,0.5)',
          }} />

          <div style={{ color: '#F1F5F9', fontSize: '22px', fontWeight: 700, textAlign: 'center' }}>
            {organizationName ? `Join ${organizationName}` : "Create Your Account"}
          </div>
          <div style={{ color: '#64748B', fontSize: '13px', textAlign: 'center', marginTop: '4px', marginBottom: '28px' }}>
            {organizationName ? `You've been invited as a ${role}` : "Start your journey as an independent agent"}
          </div>

          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: '6px', padding: '10px 14px', color: '#EF4444', fontSize: '13px', marginBottom: '16px',
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>First Name</label>
                <div style={{ position: 'relative' }}>
                  <User size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#3B82F6' }} />
                  <input
                    type="text"
                    required
                    placeholder="First name"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Last Name</label>
                <div style={{ position: 'relative' }}>
                  <User size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#3B82F6' }} />
                  <input
                    type="text"
                    required
                    placeholder="Last name"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>Email Address</label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#3B82F6' }} />
                <input
                  type="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ marginBottom: password.length > 0 ? '12px' : '24px' }}>
              <label style={labelStyle}>Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#3B82F6' }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Create a strong password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={inputStyle}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 0 }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {password.length > 0 && (
              <div style={{ 
                background: 'rgba(8,18,36,0.5)', padding: '12px 14px', borderRadius: '10px', 
                border: '1px solid rgba(40,70,120,0.5)', marginBottom: '24px' 
              }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', marginBottom: '8px' }}>SECURITY PROTOCOLS</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  {passwordRequirements.map((req, i) => {
                    const met = req.test(password);
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: met ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${met ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.15)'}` }}>
                          {met ? <Check size={8} color="#22C55E" /> : <X size={8} color="#EF4444" />}
                        </div>
                        <span style={{ fontSize: '10px', fontWeight: 500, color: met ? '#22C55E' : '#64748B' }}>
                          {req.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (password.length > 0 && !isPasswordStrong)}
              style={{
                width: '100%', height: '48px', borderRadius: '10px', border: 'none',
                background: 'linear-gradient(135deg, #1D4ED8, #3B82F6, #6D28D9)',
                backgroundSize: '200%',
                animation: 'shimmer 3s ease-in-out infinite alternate',
                color: 'white', fontWeight: 700, fontSize: '14px', letterSpacing: '0.06em',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                boxShadow: '0 0 22px rgba(59,130,246,0.35)',
                position: 'relative', overflow: 'hidden',
                cursor: (loading || (password.length > 0 && !isPasswordStrong)) ? 'not-allowed' : 'pointer',
                opacity: (loading || (password.length > 0 && !isPasswordStrong)) ? 0.75 : 1,
                transition: 'all 0.4s ease',
              }}
            >
              {loading ? (
                <><Loader2 size={16} className="animate-spin" /> ESTABLISHING...</>
              ) : (
                <>SIGN UP <ArrowRight size={16} /></>
              )}
            </button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginTop: '24px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><ShieldCheck size={14} color="#3B82F6" /><span style={{ fontSize: '10px', color: '#64748B', fontWeight: 600, letterSpacing: '0.05em' }}>SECURE</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Globe size={14} color="#3B82F6" /><span style={{ fontSize: '10px', color: '#64748B', fontWeight: 600, letterSpacing: '0.05em' }}>GLOBAL</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Zap size={14} color="#3B82F6" /><span style={{ fontSize: '10px', color: '#64748B', fontWeight: 600, letterSpacing: '0.05em' }}>FAST</span></div>
          </div>

          <div style={{ textAlign: 'center', fontSize: '13px', color: '#64748B' }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: '#3B82F6', textDecoration: 'none' }}>Sign in</Link>
          </div>

        </div>
      </div>

      <style>{`
        @keyframes cardEntrance {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 24px)) scale(0.96); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes glowPulse {
          0%, 100% { border-color: rgba(59,130,246,0.3); box-shadow: 0 8px 40px rgba(0,0,0,0.5), 0 0 35px rgba(59,130,246,0.18), 0 0 80px rgba(59,130,246,0.07); }
          50% { border-color: rgba(168,85,247,0.3); box-shadow: 0 8px 40px rgba(0,0,0,0.5), 0 0 35px rgba(168,85,247,0.18), 0 0 80px rgba(168,85,247,0.07); }
        }
        @keyframes shimmer {
          from { background-position: 0% 50%; }
          to { background-position: 100% 50%; }
        }
        @keyframes underlineGrow {
          from { width: 0; }
          to { width: 72%; }
        }
        input:focus {
          border-color: #3B82F6 !important;
          box-shadow: 0 0 0 3px rgba(59,130,246,0.15) !important;
        }
      `}</style>
    </div>
  );
};

export default SignupPage;
