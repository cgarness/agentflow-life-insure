import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, EyeOff, Loader2, Mail, Lock, ArrowRight } from "lucide-react";
import AnimatedBackground from "@/components/AnimatedBackground";

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
    } catch (err: any) /* eslint-disable-line @typescript-eslint/no-explicit-any */ {
      setError(err.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#020408', overflow: 'hidden' }}>
      <AnimatedBackground />

      {/* Centered card wrapper */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)', zIndex: 10,
        width: '440px',
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
          {/* Top highlight line (::before pseudo) */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
            background: 'linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.3) 30%, rgba(120,180,255,0.5) 50%, rgba(255,255,255,0.3) 70%, transparent 95%)',
          }} />

          {/* Wordmark */}
          <div style={{ textAlign: 'center', marginBottom: '4px' }}>
            <span style={{ color: '#F1F5F9', fontWeight: 800, fontSize: '30px', fontFamily: '-apple-system, sans-serif' }}>Agent</span>
            <span style={{ color: '#3B82F6', fontWeight: 800, fontSize: '30px', fontFamily: '-apple-system, sans-serif', textShadow: '0 0 20px rgba(59,130,246,0.7)' }}>Flow</span>
          </div>

          {/* Underline bar */}
          <div style={{
            height: '2px',
            background: 'linear-gradient(90deg, transparent, #3B82F6, #A855F7, transparent)',
            borderRadius: '2px',
            margin: '0 auto 18px',
            width: 0,
            animation: 'underlineGrow 0.9s 0.35s ease-out forwards',
            boxShadow: '0 0 12px rgba(59,130,246,0.5)',
          }} />

          {/* Welcome text */}
          <div style={{ color: '#F1F5F9', fontSize: '22px', fontWeight: 700, textAlign: 'center' }}>Welcome Back</div>
          <div style={{ color: '#64748B', fontSize: '13px', textAlign: 'center', marginTop: '4px', marginBottom: '28px' }}>Sign in to continue to your dashboard</div>

          {/* Error banner */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: '6px', padding: '10px 14px', color: '#EF4444', fontSize: '13px', marginBottom: '16px',
            }}>
              {error}
            </div>
          )}

          {/* Email field */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', fontWeight: 500, marginBottom: '6px' }}>Email</label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#3B82F6' }} />
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={{
                  width: '100%', height: '44px', background: 'rgba(8,18,36,0.65)',
                  border: '1px solid rgba(40,70,120,0.7)', borderRadius: '10px',
                  padding: '0 14px 0 42px', color: '#F1F5F9', fontSize: '14px',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Password field */}
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: '#94A3B8', fontWeight: 500, marginBottom: '6px' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#3B82F6' }} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{
                  width: '100%', height: '44px', background: 'rgba(8,18,36,0.65)',
                  border: '1px solid rgba(40,70,120,0.7)', borderRadius: '10px',
                  padding: '0 42px 0 42px', color: '#F1F5F9', fontSize: '14px',
                  outline: 'none', boxSizing: 'border-box',
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
                width: '100%', height: '48px', borderRadius: '10px', border: 'none',
                background: 'linear-gradient(135deg, #1D4ED8, #3B82F6, #6D28D9)',
                backgroundSize: '200%',
                animation: 'shimmer 3s ease-in-out infinite alternate',
                color: 'white', fontWeight: 700, fontSize: '14px', letterSpacing: '0.06em',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                boxShadow: '0 0 22px rgba(59,130,246,0.35)',
                position: 'relative', overflow: 'hidden',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.75 : 1,
              }}
            >
              {loading ? (
                <><Loader2 size={16} className="animate-spin" /> AUTHENTICATING...</>
              ) : (
                <>SIGN IN <ArrowRight size={16} /></>
              )}
            </button>
          </form>

          {/* Badges */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '20px' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 11px',
              borderRadius: '20px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
              border: '1px solid rgba(59,130,246,0.45)', color: '#93C5FD', background: 'rgba(59,130,246,0.1)',
            }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#3B82F6', boxShadow: '0 0 7px #3B82F6', animation: 'badgePulse 2s ease-in-out infinite' }} />
              SECURE
            </span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 11px',
              borderRadius: '20px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
              border: '1px solid rgba(20,184,166,0.45)', color: '#5EEAD4', background: 'rgba(20,184,166,0.1)',
            }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#14B8A6', boxShadow: '0 0 7px #14B8A6', animation: 'badgePulse 2s ease-in-out infinite', animationDelay: '0.7s' }} />
              ENCRYPTED
            </span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 11px',
              borderRadius: '20px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
              border: '1px solid rgba(168,85,247,0.45)', color: '#D8B4FE', background: 'rgba(168,85,247,0.1)',
            }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#A855F7', boxShadow: '0 0 7px #A855F7', animation: 'badgePulse 2s ease-in-out infinite', animationDelay: '1.4s' }} />
              AI POWERED
            </span>
          </div>

          {/* Sign up link */}
          <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px', color: '#64748B' }}>
            Don't have an account?{' '}
            <Link to="/signup" style={{ color: '#3B82F6', textDecoration: 'none' }}>Sign up</Link>
          </div>

        </div>
      </div>

      {/* Keyframe animations */}
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
        @keyframes badgePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.45; transform: scale(0.75); }
        }
        input:focus {
          border-color: #3B82F6 !important;
          box-shadow: 0 0 0 3px rgba(59,130,246,0.15) !important;
        }
        a:hover { text-decoration: underline; }
      `}</style>
    </div>
  );
};

export default LoginPage;
