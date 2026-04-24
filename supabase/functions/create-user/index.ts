import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@3.2.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildConfirmEmailHtml(firstName: string, actionLink: string): string {
  const safeName = escapeHtml(firstName);
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirm your AgentFlow account</title>
    <style>
        body { margin: 0; padding: 0; background-color: #020408; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #F1F5F9; }
        .container { max-width: 600px; margin: 40px auto; background: rgba(13, 25, 48, 0.4); border: 1px solid rgba(99, 155, 255, 0.2); border-radius: 24px; overflow: hidden; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5); }
        .header { padding: 40px 40px 20px; text-align: center; }
        .logo { font-size: 32px; font-weight: 800; margin-bottom: 24px; }
        .logo-agent { color: #F1F5F9; } .logo-flow { color: #3B82F6; }
        .hero { padding: 0 40px 32px; text-align: center; }
        h1 { font-size: 28px; font-weight: 700; margin: 0 0 16px; color: #F1F5F9; }
        p.subtitle { font-size: 16px; color: #94A3B8; line-height: 1.6; margin: 0; }
        .cta-container { padding: 0 40px 32px; text-align: center; }
        .btn { display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #1D4ED8, #3B82F6); color: #FFFFFF !important; text-decoration: none; font-weight: 700; border-radius: 12px; font-size: 16px; box-shadow: 0 10px 20px rgba(59, 130, 246, 0.3); }
        .link-fallback { padding: 0 40px 40px; text-align: center; }
        .link-fallback p { font-size: 12px; color: #64748B; margin: 0 0 8px; }
        .link-fallback a { font-size: 12px; color: #3B82F6; word-break: break-all; }
        .footer { padding: 32px 40px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.05); }
        .footer p { font-size: 12px; color: #475569; margin: 0 0 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header"><div class="logo"><span class="logo-agent">Agent</span><span class="logo-flow">Flow</span></div></div>
        <div class="hero">
            <h1>Confirm your email</h1>
            <p class="subtitle">Hi ${safeName}, thanks for signing up. Click the button below to verify your email and activate your AgentFlow account.</p>
        </div>
        <div class="cta-container"><a href="${actionLink}" class="btn">Confirm email</a></div>
        <div class="link-fallback">
            <p>If the button does not work, copy and paste this link into your browser:</p>
            <a href="${actionLink}">${escapeHtml(actionLink)}</a>
        </div>
        <div class="footer">
            <p>Life insurance CRM and power dialer built for agencies.</p>
            <p>&copy; 2026 AgentFlow Inc. All Rights Reserved.</p>
        </div>
    </div>
</body>
</html>`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const body = await req.json();
    const { email, password, first_name, last_name, organization_id, upline_id, role, licensed_states, commission_level } = body;

    if (!email || !password) {
      return new Response(
        JSON.stringify({ success: false, error: "Email and password are required" }),
        { status: 400, headers }
      );
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: {
        first_name,
        last_name,
        organization_id,
        upline_id: upline_id || null,
        role: role || "Agent",
        licensed_states: licensed_states || [],
        commission_level: commission_level || "0%",
      },
    });

    if (error) {
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 400, headers }
      );
    }

    let emailSent = false;
    const siteUrl = Deno.env.get("PUBLIC_SITE_URL") || "https://agentflow-life-insure.vercel.app";
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: {
        redirectTo: `${siteUrl}/dashboard`,
      },
    });

    if (linkError) {
      console.error("create-user: generateLink failed:", linkError.message);
    } else {
      const actionLink = (linkData as { properties?: { action_link?: string } })?.properties?.action_link;
      if (!actionLink) {
        console.error("create-user: generateLink returned no action_link");
      } else if (!resendApiKey) {
        console.warn("RESEND_API_KEY not set — skipping confirmation email");
      } else {
        try {
          const resend = new Resend(resendApiKey);
          const displayName = (first_name && String(first_name).trim()) || "there";
          await resend.emails.send({
            from: "AgentFlow <team@fflagent.com>",
            to: [email],
            subject: "Confirm your AgentFlow account",
            html: buildConfirmEmailHtml(displayName, actionLink),
          });
          emailSent = true;
        } catch (emailErr) {
          console.error("create-user: failed to send confirmation email:", emailErr);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, user_id: data.user.id, email_sent: emailSent }),
      { status: 200, headers }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers }
    );
  }
});
