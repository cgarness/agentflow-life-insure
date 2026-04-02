import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Loader2, CheckCircle2, ArrowRight, ShieldCheck, Zap, Globe, Sparkles, XCircle, Clock, Ban } from "lucide-react";
import AnimatedBackground from "@/components/AnimatedBackground";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";

const AcceptInvitePage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<{ title: string; message: string; icon: React.ReactNode } | null>(null);
  const [invite, setInvite] = useState<any>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const loadingSteps = [
    "Establishing Secure Connection...",
    "Decrypting Invitation Token...",
    "Validating Organization Credentials...",
    "Finalizing Secure Handshake..."
  ];

  useEffect(() => {
    let stepInterval: NodeJS.Timeout;
    if (loading) {
      stepInterval = setInterval(() => {
        setLoadingStep(prev => (prev < loadingSteps.length - 1 ? prev + 1 : prev));
      }, 700);
    }
    return () => clearInterval(stepInterval);
  }, [loading]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    
    if (!token) {
      setError({
        title: "Missing Token",
        message: "No invitation token was provided in the URL. Please check your email link.",
        icon: <XCircle size={40} color="#EF4444" />
      });
      setLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      usersApi.getInvitationByToken(token)
        .then(inv => {
          if (!inv) {
            setError({
              title: "Invalid Invitation",
              message: "This invitation link is invalid or has been malformed.",
              icon: <XCircle size={40} color="#EF4444" />
            });
          } else if (inv.status === "Revoked") {
            setError({
              title: "Invitation Revoked",
              message: "This invitation has been revoked by an administrator.",
              icon: <Ban size={40} color="#EF4444" />
            });
          } else if (inv.status === "Expired" || new Date(inv.expires_at) < new Date()) {
            setError({
              title: "Invitation Expired",
              message: "This invitation expired after 7 days for security reasons. Please request a new link.",
              icon: <Clock size={40} color="#F59E0B" />
            });
          } else if (inv.status === "Accepted") {
            setError({
              title: "Already Consumed",
              message: "This invitation has already been used to create an account. Please log in instead.",
              icon: <CheckCircle2 size={40} color="#3B82F6" />
            });
          } else {
            setInvite(inv);
          }
        })
        .catch(e => {
          console.error("Failed to fetch invitation:", e);
          setError({
            title: "Verification Failed",
            message: "Could not verify invitation. Our security servers may be temporarily reachable.",
            icon: <XCircle size={40} color="#EF4444" />
          });
        })
        .finally(() => {
          setLoading(false);
        });
    }, 2200);

    return () => clearTimeout(timer);
  }, [location.search]);

  const handleAccept = () => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    navigate(`/signup?token=${token}`);
  };

  if (loading) {
    return (
      <div style={{ position: 'relative', minHeight: '100vh', background: '#020408', overflow: 'hidden' }}>
        <AnimatedBackground />
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10, textAlign: 'center' }}>
          <div style={{ position: 'relative', margin: '0 auto 24px', width: 80, height: 80 }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(59, 130, 246, 0.1)', borderTopColor: '#3B82F6', animation: 'spin 1.5s linear infinite' }} />
            <ShieldCheck style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#3B82F6' }} size={32} />
          </div>
          <p style={{ color: '#F1F5F9', fontSize: '18px', fontWeight: 600, marginBottom: '12px', animation: 'pulseText 2s infinite' }}>
            {loadingSteps[loadingStep]}
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            {loadingSteps.map((_, i) => (
              <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: i <= loadingStep ? '#3B82F6' : 'rgba(255,255,255,0.1)', transition: 'all 0.4s ease', boxShadow: i <= loadingStep ? '0 0 10px rgba(59,130,246,0.5)' : 'none' }} />
            ))}
          </div>
        </div>
        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes pulseText { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        `}</style>
      </div>
    );
  }

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
          textAlign: 'center'
        }}>
          {/* Top highlight line */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
            background: 'linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.3) 30%, rgba(120,180,255,0.5) 50%, rgba(255,255,255,0.3) 70%, transparent 95%)',
          }} />

          {error ? (
            <>
              <div style={{ width: 80, height: 80, background: 'rgba(255, 255, 255, 0.03)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                {error.icon}
              </div>
              <h1 style={{ color: '#F1F5F9', fontSize: '28px', fontWeight: 800, marginBottom: '12px' }}>{error.title}</h1>
              <p style={{ color: '#94A3B8', fontSize: '14px', lineHeight: '1.6', marginBottom: '32px' }}>{error.message}</p>
              <Link to="/login" style={{ 
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                width: '100%', height: '48px', borderRadius: '10px', textDecoration: 'none',
                background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)',
                color: '#3B82F6', fontWeight: 700, fontSize: '14px', letterSpacing: '0.06em',
                boxShadow: '0 0 15px rgba(59,130,246,0.1)', transition: 'all 0.3s ease'
              }}>
                RETURN TO LOGIN <ArrowRight size={16} />
              </Link>
            </>
          ) : (
            <>
              <div style={{ display: 'inline-flex', padding: '6px 14px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.25)', borderRadius: '100px', marginBottom: '32px', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={14} color="#3B82F6" />
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#3B82F6', letterSpacing: '0.1em' }}>OFFICIAL INVITATION</span>
              </div>

              <div style={{ color: '#F1F5F9', fontSize: '32px', fontWeight: 900, marginBottom: '16px', letterSpacing: '-0.04em', lineHeight: 1.2 }}>
                Welcome to <br/><span style={{ color: '#3B82F6', textShadow: '0 0 20px rgba(59,130,246,0.5)' }}>{invite.org_name || invite.organizations?.name || "AgentFlow"}</span>
              </div>
              
              <div style={{ color: '#94A3B8', fontSize: '15px', lineHeight: '1.6', marginBottom: '40px', padding: '0 10px' }}>
                Hello <span style={{ color: '#F1F5F9', fontWeight: 600 }}>{invite.first_name}</span>! You've been personally invited to join the team as a <span style={{ color: '#F1F5F9', fontWeight: 600 }}>{invite.role}</span>.
              </div>

              <button
                onClick={handleAccept}
                style={{
                  width: '100%', height: '56px', borderRadius: '10px', border: 'none',
                  background: 'linear-gradient(135deg, #1D4ED8, #3B82F6, #6D28D9)',
                  backgroundSize: '200%',
                  animation: 'shimmer 3s ease-in-out infinite alternate',
                  color: 'white', fontWeight: 800, fontSize: '15px', letterSpacing: '0.04em',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  boxShadow: '0 0 25px rgba(59,130,246,0.4)',
                  position: 'relative', overflow: 'hidden', cursor: 'pointer',
                  marginBottom: '24px'
                }}
              >
                ACCEPT & CREATE ACCOUNT <ArrowRight size={18} />
              </button>

              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '20px' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 11px',
                  borderRadius: '20px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
                  border: '1px solid rgba(59,130,246,0.45)', color: '#93C5FD', background: 'rgba(59,130,246,0.1)',
                }}>
                  <ShieldCheck size={12} /> SECURE
                </span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 11px',
                  borderRadius: '20px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
                  border: '1px solid rgba(20,184,166,0.45)', color: '#5EEAD4', background: 'rgba(20,184,166,0.1)',
                }}>
                  <Globe size={12} /> GLOBAL
                </span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 11px',
                  borderRadius: '20px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
                  border: '1px solid rgba(168,85,247,0.45)', color: '#D8B4FE', background: 'rgba(168,85,247,0.1)',
                }}>
                  <Zap size={12} /> REAL-TIME
                </span>
              </div>
            </>
          )}

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
        button:hover {
          filter: brightness(1.1);
        }
      `}</style>
    </div>
  );
};

export default AcceptInvitePage;
