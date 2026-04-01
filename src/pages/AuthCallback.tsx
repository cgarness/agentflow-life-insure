import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  useEffect(() => {
    const handleCallback = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          const { error } = await supabase.auth.getSession();
          if (error) throw error;
        }
        setStatus("success");
        setTimeout(() => navigate("/dashboard"), 3000);
      } catch {
        setStatus("error");
      }
    };
    handleCallback();
  }, [navigate]);
  if (status === "loading") {
    return (
      <div style={{
        minHeight: "100vh", backgroundColor: "#0F172A",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        fontFamily: "Inter, sans-serif"
      }}>
        <div style={{ marginBottom: "24px", color: "#3B82F6", fontSize: "18px", fontWeight: 600 }}>
          ⚡ AgentFlow
        </div>
        <div style={{
          width: "48px", height: "48px", border: "3px solid #334155",
          borderTopColor: "#3B82F6", borderRadius: "50%",
          animation: "spin 0.8s linear infinite", marginBottom: "20px"
        }} />
        <p style={{ color: "#94A3B8", fontSize: "15px" }}>Confirming your account...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  if (status === "success") {
    return (
      <div style={{
        minHeight: "100vh", backgroundColor: "#0F172A",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        fontFamily: "Inter, sans-serif", padding: "24px"
      }}>
        <div style={{ marginBottom: "32px", color: "#3B82F6", fontSize: "18px", fontWeight: 600 }}>
          ⚡ AgentFlow
        </div>
        <div style={{
          width: "80px", height: "80px", borderRadius: "50%",
          backgroundColor: "#052e16", border: "3px solid #22C55E",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: "24px", animation: "scaleIn 0.4s ease-out"
        }}>
          <span style={{ fontSize: "36px", color: "#22C55E" }}>✓</span>
        </div>
        <h1 style={{ color: "#F1F5F9", fontSize: "26px", fontWeight: 700, margin: "0 0 8px", textAlign: "center" }}>
          Email Confirmed!
        </h1>
        <p style={{ color: "#94A3B8", fontSize: "15px", margin: "0 0 32px", textAlign: "center" }}>
          Your account is ready. Taking you to the login page...
        </p>
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: "3px", backgroundColor: "#1E293B" }}>
          <div style={{ height: "100%", backgroundColor: "#3B82F6", animation: "progress 3s linear forwards" }} />
        </div>
        <style>{`
          @keyframes scaleIn { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
          @keyframes progress { from { width: 0%; } to { width: 100%; } }
        `}</style>
      </div>
    );
  }
  return (
    <div style={{
      minHeight: "100vh", backgroundColor: "#0F172A",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "Inter, sans-serif", padding: "24px"
    }}>
      <div style={{ marginBottom: "32px", color: "#3B82F6", fontSize: "18px", fontWeight: 600 }}>
        ⚡ AgentFlow
      </div>
      <div style={{
        width: "80px", height: "80px", borderRadius: "50%",
        backgroundColor: "#2d0a0a", border: "3px solid #EF4444",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: "24px"
      }}>
        <span style={{ fontSize: "36px", color: "#EF4444" }}>✕</span>
      </div>
      <h1 style={{ color: "#F1F5F9", fontSize: "26px", fontWeight: 700, margin: "0 0 8px", textAlign: "center" }}>
        Confirmation Failed
      </h1>
      <p style={{ color: "#94A3B8", fontSize: "15px", margin: "0 0 32px", textAlign: "center" }}>
        This link may have expired or already been used.
      </p>
      <a href="/login" style={{
        display: "inline-block", padding: "12px 28px",
        backgroundColor: "#3B82F6", color: "#FFFFFF",
        borderRadius: "8px", textDecoration: "none",
        fontSize: "15px", fontWeight: 600
      }}>
        Back to Login
      </a>
    </div>
  );
}
