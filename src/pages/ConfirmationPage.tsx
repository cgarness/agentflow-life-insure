import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Mail, ArrowRight } from "lucide-react";
import AnimatedBackground from "@/components/AnimatedBackground";

const ConfirmationPage: React.FC = () => {
  const location = useLocation();
  const email = location.state?.email || "your email";

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#020408', overflow: 'hidden' }}>
      <AnimatedBackground />

      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)', zIndex: 10,
        width: '440px',
        animation: 'cardEntrance 0.7s ease-out forwards',
        opacity: 0,
      }}>
        <div style={{
          background: 'rgba(13,25,48,0.38)',
          backdropFilter: 'blur(36px) saturate(200%) brightness(1.15)',
          border: '1px solid rgba(99,155,255,0.3)',
          borderRadius: '20px',
          padding: '44px',
          animation: 'glowPulse 5s ease-in-out infinite',
          position: 'relative',
          overflow: 'hidden',
          textAlign: 'center',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
            background: 'linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.3) 30%, rgba(120,180,255,0.5) 50%, rgba(255,255,255,0.3) 70%, transparent 95%)',
          }} />

          {/* Wordmark */}
          <div style={{ marginBottom: '24px' }}>
            <span style={{ color: '#F1F5F9', fontWeight: 800, fontSize: '30px', fontFamily: '-apple-system, sans-serif' }}>Agent</span>
            <span style={{ color: '#3B82F6', fontWeight: 800, fontSize: '30px', fontFamily: '-apple-system, sans-serif', textShadow: '0 0 20px rgba(59,130,246,0.7)' }}>Flow</span>
          </div>

          <div style={{ 
            width: 72, height: 72, background: 'rgba(59, 130, 246, 0.1)', 
            borderRadius: '50%', display: 'flex', alignItems: 'center', 
            justifyContent: 'center', margin: '0 auto 24px', border: '1px solid rgba(59, 130, 246, 0.3)',
            boxShadow: '0 0 30px rgba(59, 130, 246, 0.2)'
          }}>
            <Mail size={32} color="#3B82F6" />
          </div>

          <div style={{ color: '#F1F5F9', fontSize: '24px', fontWeight: 700, marginBottom: '12px' }}>Verify your email</div>
          
          <div style={{ color: '#94A3B8', fontSize: '14px', lineHeight: '1.6', marginBottom: '32px' }}>
            We've sent a verification link to <strong style={{ color: '#F8FAFC' }}>{email}</strong>. 
            Please check your inbox and click the link to activate your account.
          </div>

          <Link to="/login" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            width: '100%', height: '48px', borderRadius: '10px', border: 'none',
            background: 'linear-gradient(135deg, #1D4ED8, #3B82F6, #6D28D9)',
            color: 'white', fontWeight: 700, fontSize: '14px', letterSpacing: '0.06em',
            textDecoration: 'none', boxShadow: '0 0 22px rgba(59,130,246,0.35)',
            transition: 'all 0.3s ease',
          }}>
            BACK TO LOGIN <ArrowRight size={16} />
          </Link>
          
          <div style={{ color: '#64748B', fontSize: '12px', marginTop: '24px' }}>
            Didn't receive an email? Check your spam folder.
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
      `}</style>
    </div>
  );
};

export default ConfirmationPage;
