import React, { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, EyeOff, Loader2, CheckCircle2, Mail, Lock, User, ArrowRight, ShieldCheck, Zap, Globe, Sparkles, Check, X } from "lucide-react";
import AnimatedBackground from "@/components/AnimatedBackground";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import { mapAuthError } from "@/utils/auth-errors";

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
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [uplineId, setUplineId] = useState<string | null>(null);
  const [role, setRole] = useState<string>("Agent");
  const [licensedStates, setLicensedStates] = useState<any[]>([]);
  const [commissionLevel, setCommissionLevel] = useState<string>("0%");
  const location = useLocation();

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
    const inviteData = params.get("invite"); // Legacy support
    
    if (token) {
      // New Stateful Invitation System
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
      // Legacy Base64 System
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
      setSuccess(true);
    } catch (err: any) {
      setError(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const inputContainerStyle: React.CSSProperties = {
    position: 'relative',
    marginBottom: 20,
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 52,
    background: 'rgba(15, 23, 42, 0.4)',
    border: '1px solid rgba(148, 163, 184, 0.1)',
    borderRadius: 16,
    padding: '0 16px 0 48px',
    color: '#F8FAFC',
    fontSize: 15,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'all 0.3s ease',
    backdropFilter: 'blur(8px)',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: 600,
    marginBottom: 8,
    display: 'block',
    marginLeft: 4,
    letterSpacing: '0.025em',
  };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#020617', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <style>{`
        @keyframes fadeInOut { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes glow { 0%, 100% { box-shadow: 0 0 20px rgba(59, 130, 246, 0.2); } 50% { box-shadow: 0 0 40px rgba(59, 130, 246, 0.4); } }
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        
        .signup-card {
          animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }
        .signup-input:focus {
          border-color: #3B82F6 !important;
          background: rgba(15, 23, 42, 0.6) !important;
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1) !important;
        }
        .signup-input:focus + .input-icon {
          color: #3B82F6 !important;
          transform: translateY(-50%) scale(1.1);
        }
        .premium-btn {
          background: linear-gradient(135deg, #2563EB, #7C3AED);
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          background-size: 200% auto;
        }
        .premium-btn:hover {
          background-position: right center;
          transform: translateY(-2px);
          box-shadow: 0 12px 24px -6px rgba(59, 130, 246, 0.5);
        }
        .premium-btn:active {
          transform: translateY(0);
        }
      `}</style>
      
      <AnimatedBackground />

      {/* Decorative Orbs */}
      <div style={{ position: 'absolute', top: '10%', left: '15%', width: 300, height: 300, background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)', filter: 'blur(60px)', animation: 'fadeInOut 8s infinite' }} />
      <div style={{ position: 'absolute', bottom: '10%', right: '15%', width: 400, height: 400, background: 'radial-gradient(circle, rgba(124,58,237,0.1) 0%, transparent 70%)', filter: 'blur(80px)', animation: 'fadeInOut 10s infinite delay-2s' }} />

      <div className="signup-card" style={{
        width: '100%',
        maxWidth: 520,
        background: 'rgba(15, 23, 42, 0.3)',
        backdropFilter: 'blur(24px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 32,
        padding: '48px 40px',
        position: 'relative',
        zIndex: 10,
      }}>
        {success ? (
          <div style={{ textAlign: 'center', animation: 'slideUp 0.6s ease-out' }}>
            <div style={{ 
              width: 80, height: 80, background: 'rgba(34, 197, 94, 0.1)', 
              borderRadius: '50%', display: 'flex', alignItems: 'center', 
              justifyContent: 'center', margin: '0 auto 24px', border: '1px solid rgba(34, 197, 94, 0.2)' 
            }}>
              <CheckCircle2 size={40} color="#22C55E" />
            </div>
            <h2 style={{ color: '#F8FAFC', fontSize: 28, fontWeight: 800, marginBottom: 12, letterSpacing: '-0.02em' }}>Account Created!</h2>
            <p style={{ color: '#94A3B8', fontSize: 16, lineHeight: 1.6, marginBottom: 32 }}>
              Your account for <span style={{ color: '#F8FAFC', fontWeight: 600 }}>{email}</span> is ready. You can now log in.
            </p>
            <Link to="/login" style={{ 
              display: 'inline-flex', alignItems: 'center', gap: 8, color: '#3B82F6', 
              fontSize: 15, textDecoration: 'none', fontWeight: 600, padding: '12px 24px',
              background: 'rgba(59, 130, 246, 0.05)', borderRadius: 12, border: '1px solid rgba(59, 130, 246, 0.1)'
            }}>
              Back to Login <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 40 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, marginBottom: 16 }}>
                <div style={{ width: 40, height: 40, background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 16px rgba(59, 130, 246, 0.3)' }}>
                  <Sparkles size={20} color="white" />
                </div>
                <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: '-0.05em' }}>
                  <span style={{ color: '#F8FAFC' }}>Agent</span>
                  <span style={{ color: '#3B82F6' }}>Flow</span>
                </div>
              </div>
              <h1 style={{ color: '#F8FAFC', fontSize: 24, fontWeight: 800, marginBottom: 8, letterSpacing: '-0.02em' }}>
                {organizationName ? `Join ${organizationName}` : "Create Your Account"}
              </h1>
              <p style={{ color: '#64748B', fontSize: 14, fontWeight: 500 }}>
                {organizationName ? `You've been invited as a ${role}` : "Start your journey as an independent agent."}
              </p>
            </div>

            {error && (
              <div style={{ 
                background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.15)', 
                borderRadius: 14, padding: '12px 16px', color: '#EF4444', 
                fontSize: 13, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10,
                animation: 'slideUp 0.3s ease-out'
              }}>
                <div style={{ width: 6, height: 6, background: '#EF4444', borderRadius: '50%' }} />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ ...inputContainerStyle, flex: 1 }}>
                  <label style={labelStyle}>First Name</label>
                  <div style={{ position: 'relative' }}>
                    <User className="input-icon" size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none', transition: 'all 0.3s ease' }} />
                    <input
                      className="signup-input"
                      style={inputStyle}
                      value={firstName}
                      onChange={e => setFirstName(e.target.value)}
                      required
                      placeholder="First name"
                    />
                  </div>
                </div>
                <div style={{ ...inputContainerStyle, flex: 1 }}>
                  <label style={labelStyle}>Last Name</label>
                  <div style={{ position: 'relative' }}>
                    <User className="input-icon" size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none', transition: 'all 0.3s ease' }} />
                    <input
                      className="signup-input"
                      style={inputStyle}
                      value={lastName}
                      onChange={e => setLastName(e.target.value)}
                      required
                      placeholder="Last name"
                    />
                  </div>
                </div>
              </div>

              <div style={inputContainerStyle}>
                <label style={labelStyle}>Email Address</label>
                <div style={{ position: 'relative' }}>
                  <Mail className="input-icon" size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none', transition: 'all 0.3s ease' }} />
                  <input
                    className="signup-input"
                    type="email"
                    style={inputStyle}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    placeholder="name@company.com"
                  />
                </div>
              </div>

              <div style={{ ...inputContainerStyle, marginBottom: password.length > 0 ? 12 : 32 }}>
                <label style={labelStyle}>Password</label>
                <div style={{ position: 'relative' }}>
                  <Lock className="input-icon" size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none', transition: 'all 0.3s ease' }} />
                  <input
                    className="signup-input"
                    type={showPassword ? 'text' : 'password'}
                    style={{ ...inputStyle, paddingRight: 52 }}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="Create a strong password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Password Strength Requirements */}
              {password.length > 0 && (
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '16px 20px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)', marginBottom: 32, animation: 'slideUp 0.4s ease' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', marginBottom: 12 }}>SECURITY PROTOCOLS</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
                    {passwordRequirements.map((req, i) => {
                      const met = req.test(password);
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 14, height: 14, borderRadius: '50%', background: met ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${met ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.1)'}`, transition: 'all 0.3s ease' }}>
                            {met ? <Check size={8} color="#22C55E" /> : <X size={8} color="#EF4444" />}
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 500, color: met ? '#22C55E' : '#64748B', transition: 'all 0.3s ease' }}>
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
                className="premium-btn"
                style={{
                  width: '100%',
                  height: 56,
                  borderRadius: 16,
                  border: 'none',
                  color: 'white',
                  fontWeight: 700,
                  fontSize: 16,
                  letterSpacing: '0.01em',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  marginTop: 12,
                  cursor: (loading || (password.length > 0 && !isPasswordStrong)) ? 'not-allowed' : 'pointer',
                  opacity: (loading || (password.length > 0 && !isPasswordStrong)) ? 0.6 : 1,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {loading ? (
                  <Loader2 size={24} style={{ animation: 'spin-slow 2s linear infinite' }} />
                ) : (
                  <>Get Started <ArrowRight size={20} /></>
                )}
              </button>
            </form>

            <div style={{ marginTop: 32, textAlign: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldCheck size={14} color="#3B82F6" />
                  <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600, letterSpacing: '0.05em' }}>SECURE</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Globe size={14} color="#3B82F6" />
                  <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600, letterSpacing: '0.05em' }}>GLOBAL</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Zap size={14} color="#3B82F6" />
                  <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600, letterSpacing: '0.05em' }}>FAST</span>
                </div>
              </div>
              
              <div style={{ fontSize: 14, color: '#64748B', fontWeight: 500 }}>
                Already have an account?{' '}
                <Link to="/login" style={{ color: '#3B82F6', textDecoration: 'none', fontWeight: 700 }}>Sign In</Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SignupPage;
