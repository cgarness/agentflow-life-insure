import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Loader2, CheckCircle2, ArrowRight, ShieldCheck, Zap, Globe, Sparkles, XCircle } from "lucide-react";
import AnimatedBackground from "@/components/AnimatedBackground";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";

const AcceptInvitePage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<any>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    
    if (!token) {
      setError("No invitation token provided.");
      setLoading(false);
      return;
    }

    usersApi.getInvitationByToken(token)
      .then(inv => {
        if (!inv) {
          setError("This invitation link is invalid or has expired.");
        } else {
          setInvite(inv);
        }
      })
      .catch(e => {
        console.error("Failed to fetch invitation:", e);
        setError("Could not verify invitation. Please try again later.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [location.search]);

  const handleAccept = () => {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    navigate(`/signup?token=${token}`);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#020617', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin text-primary" size={48} />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#020617', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
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
            <div style={{ width: 80, height: 80, background: 'rgba(239, 68, 68, 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <XCircle size={40} color="#EF4444" />
            </div>
            <h1 style={{ color: '#F8FAFC', fontSize: 28, fontWeight: 800, marginBottom: 12 }}>Invitation Error</h1>
            <p style={{ color: '#94A3B8', fontSize: 16, lineHeight: 1.6, marginBottom: 32 }}>{error}</p>
            <Link to="/login" style={{ color: '#3B82F6', fontWeight: 600 }}>Return to Login</Link>
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
