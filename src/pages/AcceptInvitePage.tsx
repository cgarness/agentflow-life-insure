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
      }, 800);
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

    // Artificial delay for premium feel
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
    }, 2500);

    return () => clearTimeout(timer);
  }, [location.search]);

  const handleAccept = () => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    navigate(`/signup?token=${token}`);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#020617', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <AnimatedBackground />
        <div style={{ position: 'relative' }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', border: '2px solid rgba(59, 130, 246, 0.1)', borderTopColor: '#3B82F6', animation: 'spin 1.5s linear infinite' }} />
          <ShieldCheck style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#3B82F6' }} size={32} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#F8FAFC', fontSize: 18, fontWeight: 600, marginBottom: 8, animation: 'pulse 2s infinite' }}>
            {loadingSteps[loadingStep]}
          </p>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
            {loadingSteps.map((_, i) => (
              <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: i <= loadingStep ? '#3B82F6' : 'rgba(255,255,255,0.1)', transition: 'all 0.4s ease' }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#020617', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .accept-card { animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1); }
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
      `}</style>
      
      <AnimatedBackground />

      <div className="accept-card" style={{
        width: '100%',
        maxWidth: 540,
        background: 'rgba(15, 23, 42, 0.3)',
        backdropFilter: 'blur(24px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 32,
        padding: '64px 48px',
        position: 'relative',
        zIndex: 10,
        textAlign: 'center'
      }}>
        {error ? (
          <>
            <div style={{ width: 80, height: 80, background: 'rgba(255, 255, 255, 0.03)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              {error.icon}
            </div>
            <h1 style={{ color: '#F8FAFC', fontSize: 28, fontWeight: 800, marginBottom: 12 }}>{error.title}</h1>
            <p style={{ color: '#94A3B8', fontSize: 16, lineHeight: 1.6, marginBottom: 32 }}>{error.message}</p>
            <Link to="/login" style={{ 
              display: 'inline-flex', alignItems: 'center', gap: 8, color: '#3B82F6', 
              fontSize: 15, textDecoration: 'none', fontWeight: 600, padding: '12px 24px',
              background: 'rgba(59, 130, 246, 0.05)', borderRadius: 12, border: '1px solid rgba(59, 130, 246, 0.1)'
            }}>
              Return to Login <ArrowRight size={18} />
            </Link>
          </>
        ) : (
          <>
            <div style={{ display: 'inline-flex', padding: '8px 16px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: 100, marginBottom: 32, alignItems: 'center', gap: 8 }}>
              <Sparkles size={14} color="#3B82F6" />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#3B82F6', letterSpacing: '0.05em' }}>OFFICIAL INVITATION</span>
            </div>

            <h1 style={{ color: '#F8FAFC', fontSize: 40, fontWeight: 900, marginBottom: 16, letterSpacing: '-0.04em', lineHeight: 1 }}>
              Welcome to <span style={{ color: '#3B82F6' }}>{invite.organizations?.name}</span>
            </h1>
            
            <p style={{ color: '#94A3B8', fontSize: 18, lineHeight: 1.6, marginBottom: 40, maxWidth: '90%', margin: '0 auto 40px' }}>
              Hello <span style={{ color: '#F8FAFC', fontWeight: 600 }}>{invite.first_name}</span>! You've been personally invited to join the team as a <span style={{ color: '#F8FAFC', fontWeight: 600 }}>{invite.role}</span>.
            </p>

            <button
              onClick={handleAccept}
              className="premium-btn"
              style={{
                width: '100%',
                height: 64,
                borderRadius: 20,
                border: 'none',
                color: 'white',
                fontWeight: 800,
                fontSize: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                cursor: 'pointer',
                marginBottom: 32
              }}
            >
              Accept & Create Account <ArrowRight size={22} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, padding: '24px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ textAlign: 'center' }}>
                <ShieldCheck size={20} color="#64748B" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em' }}>SECURE</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <Globe size={20} color="#64748B" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em' }}>GLOBAL</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <Zap size={20} color="#64748B" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em' }}>REAL-TIME</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AcceptInvitePage;
