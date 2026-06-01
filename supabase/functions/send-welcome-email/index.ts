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
    const siteUrl = Deno.env.get("PUBLIC_SITE_URL") || "https://agentflow-life-insure.vercel.app";
    const logoUrl = `${siteUrl}/agentflow-logo-full.png`;

    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Welcome to AgentFlow</title>
    <style>
        body { margin: 0; padding: 0; background-color: #F1F5F9; }
        a { text-decoration: none; }
        img { border: 0; line-height: 100%; outline: none; }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F1F5F9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <div style="background-color: #F1F5F9; padding: 32px 16px;">
        <div style="max-width: 560px; margin: 0 auto; background-color: #FFFFFF; border-radius: 8px; border: 1px solid #E2E8F0; box-shadow: 0 2px 8px rgba(0,0,0,0.06); overflow: hidden;">
            <div style="height: 4px; line-height: 4px; font-size: 0; background-color: #2563EB;">&nbsp;</div>
            <div style="background-color: #FFFFFF; padding: 32px 40px 0; text-align: center;">
                <img src="${logoUrl}" alt="AgentFlow" width="auto" height="36" style="height: 36px; width: auto; display: inline-block;" />
            </div>
            <div style="padding: 28px 40px 24px; text-align: center;">
                <h1 style="font-size: 26px; font-weight: 800; color: #0F172A; line-height: 1.2; margin: 0 0 12px;">Welcome to AgentFlow, {{ .FirstName }}!</h1>
                <p style="font-size: 15px; color: #475569; line-height: 1.7; margin: 0;">Your workspace is ready. You're now set up to manage leads, run your dialer, and track your team — all in one place.</p>
            </div>
            <div style="padding: 0 40px 8px;">
                <div style="border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px; background-color: #FAFAFA;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
                        <tr>
                            <td valign="top" style="width: 58px;">
                                <div style="width: 44px; height: 44px; background-color: #EFF6FF; border-radius: 8px; text-align: center; line-height: 44px; font-size: 22px;">📞</div>
                            </td>
                            <td valign="top" style="padding-left: 14px;">
                                <div style="font-size: 15px; font-weight: 700; color: #0F172A; margin-bottom: 4px;">Power Dialer</div>
                                <div style="font-size: 13px; color: #475569; line-height: 1.6;">300+ dials per day with single-click calling and automatic disposition logging.</div>
                            </td>
                        </tr>
                    </table>
                </div>
                <div style="border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px; background-color: #FAFAFA;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
                        <tr>
                            <td valign="top" style="width: 58px;">
                                <div style="width: 44px; height: 44px; background-color: #F0FDF4; border-radius: 8px; text-align: center; line-height: 44px; font-size: 22px;">👥</div>
                            </td>
                            <td valign="top" style="padding-left: 14px;">
                                <div style="font-size: 15px; font-weight: 700; color: #0F172A; margin-bottom: 4px;">Lead Management</div>
                                <div style="font-size: 13px; color: #475569; line-height: 1.6;">Organize leads, clients, and recruits with full pipeline tracking.</div>
                            </td>
                        </tr>
                    </table>
                </div>
                <div style="border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 12px; background-color: #FAFAFA;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
                        <tr>
                            <td valign="top" style="width: 58px;">
                                <div style="width: 44px; height: 44px; background-color: #FEF9C3; border-radius: 8px; text-align: center; line-height: 44px; font-size: 22px;">📊</div>
                            </td>
                            <td valign="top" style="padding-left: 14px;">
                                <div style="font-size: 15px; font-weight: 700; color: #0F172A; margin-bottom: 4px;">Team Insights</div>
                                <div style="font-size: 13px; color: #475569; line-height: 1.6;">Leaderboards, reports, and activity logs keep your team accountable.</div>
                            </td>
                        </tr>
                    </table>
                </div>
            </div>
            <div style="padding: 16px 40px 32px; text-align: center;">
                <a href="{{ .SiteURL }}" style="display: inline-block; background-color: #2563EB; color: #FFFFFF; padding: 14px 32px; border-radius: 8px; font-weight: 700; font-size: 15px; text-decoration: none; box-shadow: 0 2px 6px rgba(37,99,235,0.4);">Go to Dashboard &rarr;</a>
            </div>
            <div style="border-top: 1px solid #E2E8F0; padding: 24px 40px; background-color: #F8FAFC; text-align: center;">
                <p style="font-size: 11px; font-weight: 600; letter-spacing: 0.15em; color: #94A3B8; margin: 0 0 8px;">LIFE INSURANCE CRM &amp; POWER DIALER</p>
                <p style="font-size: 12px; color: #94A3B8; margin: 0 0 10px;">&copy; 2026 AgentFlow Inc. All Rights Reserved.</p>
                <p style="font-size: 12px; color: #94A3B8; margin: 0;">
                    <a href="${siteUrl}/support" style="color: #94A3B8; text-decoration: none;">Support</a>
                    &nbsp;|&nbsp;
                    <a href="${siteUrl}/privacy" style="color: #94A3B8; text-decoration: none;">Privacy</a>
                    &nbsp;|&nbsp;
                    <a href="${siteUrl}/terms" style="color: #94A3B8; text-decoration: none;">Terms</a>
                </p>
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
      from: "AgentFlow <team@fflagent.com>",
      to: [email],
      subject: "Welcome to AgentFlow — You're all set",
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
