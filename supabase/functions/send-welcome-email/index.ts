import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@3.2.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface WelcomeEmailPayload {
  email: string;
  firstName: string;
}

serve(async (req: Request) => {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set.");
    return new Response(JSON.stringify({ error: "Email service not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const resend = new Resend(RESEND_API_KEY);

  try {
    const payload: WelcomeEmailPayload = await req.json();
    const { email, firstName } = payload;

    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to AgentFlow</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background-color: #020408;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            color: #F1F5F9;
        }
        .container {
            max-width: 600px;
            margin: 40px auto;
            background: rgba(13, 25, 48, 0.4);
            border: 1px solid rgba(99, 155, 255, 0.2);
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
        }
        .header {
            padding: 40px 40px 20px;
            text-align: center;
        }
        .logo {
            font-size: 32px;
            font-weight: 800;
            margin-bottom: 24px;
        }
        .logo-agent { color: #F1F5F9; }
        .logo-flow { color: #3B82F6; }
        .hero {
            padding: 0 40px 40px;
            text-align: center;
        }
        h1 {
            font-size: 32px;
            font-weight: 700;
            margin: 0 0 16px;
            background: linear-gradient(90deg, #F1F5F9, #94A3B8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p.subtitle {
            font-size: 16px;
            color: #94A3B8;
            line-height: 1.6;
            margin: 0;
        }
        .features {
            padding: 40px;
            background: rgba(8, 18, 36, 0.4);
            display: flex;
            flex-direction: column;
            gap: 24px;
        }
        .feature-item {
            display: flex;
            align-items: center;
            gap: 20px;
            padding: 20px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 16px;
        }
        .feature-icon {
            width: 48px;
            height: 48px;
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(168, 85, 247, 0.1));
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
        }
        .feature-text h3 {
            font-size: 16px;
            font-weight: 600;
            margin: 0 0 4px;
            color: #F1F5F9;
        }
        .feature-text p {
            font-size: 14px;
            color: #64748B;
            margin: 0;
        }
        .cta-container {
            padding: 40px;
            text-align: center;
        }
        .btn {
            display: inline-block;
            padding: 16px 32px;
            background: linear-gradient(135deg, #1D4ED8, #3B82F6);
            color: #FFFFFF;
            text-decoration: none;
            font-weight: 700;
            border-radius: 12px;
            font-size: 16px;
            box-shadow: 0 10px 20px rgba(59, 130, 246, 0.3);
            transition: transform 0.2s;
        }
        .footer {
            padding: 40px;
            text-align: center;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
        }
        .footer p {
            font-size: 12px;
            color: #475569;
            margin: 0 0 12px;
        }
        .social-links {
            margin-top: 20px;
        }
        .social-links a {
            color: #64748B;
            text-decoration: none;
            margin: 0 8px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">
                <span class="logo-agent">Agent</span><span class="logo-flow">Flow</span>
            </div>
        </div>
        
        <div class="hero">
            <h1>Welcome to AgentFlow</h1>
            <p class="subtitle">We're thrilled to have you! Explore the powerful tools designed to elevate your life insurance business.</p>
        </div>

        <div class="features">
            <div class="feature-item">
                <div class="feature-icon">👥</div>
                <div class="feature-text">
                    <h3>Client Management</h3>
                    <p>Streamline client data. Manage leads, contacts, and policies seamlessly.</p>
                </div>
            </div>
            <div class="feature-item">
                <div class="feature-icon">📅</div>
                <div class="feature-text">
                    <h3>Policy Tracking</h3>
                    <p>Track policy stages. Monitor status from application to issuance.</p>
                </div>
            </div>
            <div class="feature-item">
                <div class="feature-icon">📊</div>
                <div class="feature-text">
                    <h3>Report Generation</h3>
                    <p>Generate performance insights. Analyze growth with detailed reports.</p>
                </div>
            </div>
        </div>

        <div class="cta-container">
            <a href="{{ .SiteURL }}" class="btn">Get Started</a>
        </div>

        <div class="footer">
            <p>Transform your insurance business with AgentFlow.</p>
            <p>© 2026 AgentFlow Inc. All Rights Reserved.</p>
            <div class="social-links">
                <a href="#">Support</a> | <a href="#">Privacy</a> | <a href="#">Terms</a>
            </div>
        </div>
    </div>
</body>
</html>`;
    
    // Simple template replacement
    const personalizedHtml = html
      .replace("{{ .FirstName }}", firstName || "there")
      .replace("{{ .SiteURL }}", Deno.env.get("PUBLIC_SITE_URL") || "https://agentflow.app");

    const { data, error } = await resend.emails.send({
      from: "AgentFlow <onboarding@resend.dev>", // Replace with your verified domain
      to: [email],
      subject: "Welcome to AgentFlow!",
      html: personalizedHtml,
    });

    if (error) {
      console.error("Resend error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Function error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
