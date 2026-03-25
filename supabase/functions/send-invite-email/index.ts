import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@3.2.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InviteEmailPayload {
  email: string;
  firstName: string;
  role: string;
  inviteURL: string;
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
    const payload: InviteEmailPayload = await req.json();
    const { email, firstName, role, inviteURL } = payload;

    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>You're Invited to AgentFlow</title>
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
        .inviter-badge {
            display: inline-block;
            padding: 8px 16px;
            background: rgba(59, 130, 246, 0.1);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 30px;
            color: #3B82F6;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 24px;
        }
        .cta-container {
            padding: 40px;
            text-align: center;
        }
        .btn {
            display: inline-block;
            padding: 16px 32px;
            background: linear-gradient(135deg, #1D4ED8, #3B82F6);
            color: #FFFFFF !important;
            text-decoration: none;
            font-weight: 700;
            border-radius: 12px;
            font-size: 16px;
            box-shadow: 0 10px 20px rgba(59, 130, 246, 0.3);
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
            <div class="inviter-badge">New Team Invitation</div>
            <h1>Join Our Agency</h1>
            <p class="subtitle">Hi {{ .FirstName }}, you've been invited to join the AgentFlow team as a <strong>{{ .Role }}</strong>. Click the button below to complete your registration.</p>
        </div>

        <div class="cta-container">
            <a href="{{ .InviteURL }}" class="btn">Accept Invitation</a>
        </div>

        <div class="footer">
            <p>Transform your insurance business with AgentFlow.</p>
            <p>© 2026 AgentFlow Inc. All Rights Reserved.</p>
        </div>
    </div>
</body>
</html>`;
    
    // Simple template replacement
    const personalizedHtml = html
      .replace("{{ .FirstName }}", firstName || "there")
      .replace("{{ .Role }}", role || "Agent")
      .replace("{{ .InviteURL }}", inviteURL);

    const { data, error } = await resend.emails.send({
      from: "AgentFlow <onboarding@resend.dev>", // Replace with verified domain in production
      to: [email],
      subject: "Invitation to join AgentFlow",
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
