import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, EyeOff, Loader2, Mail, Lock, ArrowRight } from "lucide-react";
import GlobeBackground from "@/components/GlobeBackground";

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#020408', overflow: 'hidden' }}>
      <GlobeBackground />

      {/* Centered card */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)', zIndex: 10,
        width: '420px',
        background: 'rgba(8,18,35,0.88)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(59,130,246,0.25)',
        borderRadius: '16px',
        padding: '40px',
        boxShadow: '0 0 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(59,130,246,0.1), inset 0 1px 0 rgba(255,255,255,0.04)',
        animation: 'cardEntrance 0.45s ease-out forwards'
      }}>

        {/* Wordmark */}
        <div style={{ textAlign: 'center', marginBottom: '4px' }}>
          <span style={{ color: '#F1F5F9', fontWeight: 700, fontSize: '26px', fontFamily: 'Inter, sans-serif' }}>Agent</span>
          <span style={{ color: '#3B82F6', fontWeight: 700, fontSize: '26px', fontFamily: 'Inter, sans-serif' }}>Flow</span>
        </div>

        {/* Divider */}
        <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.3), transparent)', margin: '16px 0' }} />

        {/* Welcome text */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ color: '#F1F5F9', fontSize: '22px', fontWeight: 700 }}>Welcome Back</div>
          <div style={{ color: '#94A3B8', fontSize: '13px', marginTop: '4px' }}>Sign in to continue to your dashboard</div>
        </div>

        {/* Error banner — keep existing error state wired */}
        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: '6px', padding: '10px 14px', marginBottom: '16px',
            color: '#EF4444', fontSize: '13px'
          }}>
            {error}
          </div>
        )}

        {/* Email field */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', fontWeight: 500, marginBottom: '6px' }}>Email</label>
          <div style={{ position: 'relative' }}>
            <Mail size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#64748B' }} />
            <input
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{
                width: '100%', height: '44px', background: 'rgba(30,41,59,0.8)',
                border: '1px solid #334155', borderRadius: '8px',
                padding: '0 14px 0 42px', color: '#F1F5F9', fontSize: '14px',
                outline: 'none', boxSizing: 'border-box'
              }}
            />
          </div>
        </div>

        {/* Password field */}
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', fontWeight: 500, marginBottom: '6px' }}>Password</label>
          <div style={{ position: 'relative' }}>
            <Lock size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#64748B' }} />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{
                width: '100%', height: '44px', background: 'rgba(30,41,59,0.8)',
                border: '1px solid #334155', borderRadius: '8px',
                padding: '0 42px 0 42px', color: '#F1F5F9', fontSize: '14px',
                outline: 'none', boxSizing: 'border-box'
              }}
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)}
              style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 0 }}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Forgot password */}
        <div style={{ textAlign: 'right', marginBottom: '24px' }}>
          <Link to="/forgot-password" style={{ fontSize: '12px', color: '#3B82F6', textDecoration: 'none' }}>
            Forgot password?
          </Link>
        </div>

        {/* Submit button */}
        <form onSubmit={handleSubmit}>
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', height: '46px', borderRadius: '8px',
              background: 'linear-gradient(135deg, #1D4ED8, #3B82F6)',
              color: 'white', fontWeight: 600, fontSize: '14px',
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              opacity: loading ? 0.8 : 1,
              transition: 'all 0.15s ease'
            }}
          >
            {loading ? (
              <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Signing in...</>
            ) : (
              <><span>Sign In</span><ArrowRight size={16} /></>
            )}
          </button>
        </form>

        {/* Sign up link */}
        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: '#64748B' }}>
          Don't have an account?{' '}
          <Link to="/register" style={{ color: '#3B82F6', textDecoration: 'none' }}>Sign up</Link>
        </div>

      </div>

      {/* Card entrance keyframe */}
      <style>{`
        @keyframes cardEntrance {
          from { opacity: 0; transform: translate(-50%, calc(-50% + 16px)); }
          to { opacity: 1; transform: translate(-50%, -50%); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        input:focus {
          border-color: #3B82F6 !important;
          box-shadow: 0 0 0 3px rgba(59,130,246,0.12) !important;
        }
        a:hover { text-decoration: underline; }
      `}</style>
    </div>
  );
};

export default LoginPage;
