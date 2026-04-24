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
    <meta name="color-scheme" content="dark">
    <title>Confirm your AgentFlow account</title>
    <style>
        body { margin: 0; padding: 24px 16px; background: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59, 130, 246, 0.18), transparent 55%), #020408; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #F1F5F9; -webkit-font-smoothing: antialiased; }
        .wrap { max-width: 560px; margin: 0 auto; }
        .container { background: linear-gradient(180deg, rgba(30, 58, 138, 0.35) 0%, rgba(13, 25, 48, 0.92) 28%); border: 1px solid rgba(99, 155, 255, 0.28); border-radius: 24px; overflow: hidden; box-shadow: 0 0 0 1px rgba(255,255,255,0.04) inset, 0 24px 64px rgba(0, 0, 0, 0.55), 0 0 80px rgba(59, 130, 246, 0.12); }
        .accent { height: 4px; background: linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.9), rgba(168, 85, 247, 0.75), rgba(59, 130, 246, 0.9), transparent); }
        .header { padding: 36px 40px 8px; text-align: center; }
        .logo { font-size: 34px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 6px; }
        .logo-agent { color: #F8FAFC; text-shadow: 0 0 40px rgba(59, 130, 246, 0.35); }
        .logo-flow { color: #3B82F6; text-shadow: 0 0 28px rgba(59, 130, 246, 0.55); }
        .tagline { font-size: 11px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; color: #64748B; margin: 0 0 28px; }
        .hero { padding: 0 40px 28px; text-align: center; }
        .badge { display: inline-block; padding: 8px 18px; background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.35); border-radius: 999px; color: #93C5FD; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 20px; }
        h1 { font-size: 30px; font-weight: 800; margin: 0 0 14px; line-height: 1.15; background: linear-gradient(90deg, #F8FAFC 0%, #CBD5E1 45%, #94A3B8 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        p.subtitle { font-size: 16px; color: #94A3B8; line-height: 1.65; margin: 0; max-width: 440px; margin-left: auto; margin-right: auto; }
        p.subtitle strong { color: #E2E8F0; font-weight: 600; }
        .cta-container { padding: 8px 40px 32px; text-align: center; }
        .btn { display: inline-block; padding: 16px 36px; background: linear-gradient(135deg, #1D4ED8 0%, #2563EB 40%, #3B82F6 100%); color: #FFFFFF !important; text-decoration: none; font-weight: 700; border-radius: 12px; font-size: 15px; letter-spacing: 0.04em; box-shadow: 0 12px 32px rgba(37, 99, 235, 0.45), 0 0 0 1px rgba(255,255,255,0.08) inset; }
        .btn:hover { box-shadow: 0 14px 36px rgba(59, 130, 246, 0.5); }
        .hint { text-align: center; padding: 0 40px 8px; font-size: 12px; color: #64748B; }
        .fallback { margin: 0 32px 28px; padding: 16px 18px; background: rgba(8, 18, 36, 0.85); border: 1px solid rgba(51, 65, 85, 0.6); border-radius: 14px; }
        .fallback-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #64748B; margin: 0 0 10px; }
        .fallback-url { font-size: 11px; line-height: 1.5; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #93C5FD; }
        .fallback-url a { color: #93C5FD; text-decoration: none; }
        .divider { height: 1px; margin: 0 40px; background: linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.25), transparent); }
        .footer { padding: 28px 40px 36px; text-align: center; }
        .footer p { font-size: 12px; color: #475569; margin: 0 0 10px; line-height: 1.5; }
        .footer .brand { color: #64748B; font-weight: 600; }
    </style>
</head>
<body>
    <div class="wrap">
    <div class="container">
        <div class="accent"></div>
        <div class="header">
            <div class="logo"><span class="logo-agent">Agent</span><span class="logo-flow">Flow</span></div>
            <p class="tagline">Life Insurance CRM &amp; Power Dialer</p>
        </div>
        <div class="hero">
            <div class="badge">Verify your email</div>
            <h1>You're almost in</h1>
            <p class="subtitle">Hi <strong>${safeName}</strong> — confirm your email to activate your workspace. After that you can sign in and finish a quick setup for your agency.</p>
        </div>
        <div class="cta-container"><a href="${actionLink}" class="btn">Confirm email &rarr;</a></div>
        <p class="hint">This link expires for security. If it does, sign up again or use Forgot password on the login page.</p>
        <div class="fallback">
            <p class="fallback-label">Button not working?</p>
            <p class="fallback-url"><a href="${actionLink}">${escapeHtml(actionLink)}</a></p>
        </div>
        <div class="divider"></div>
        <div class="footer">
            <p>Built for life insurance agencies — leads, dialer, and team workflows in one place.</p>
            <p class="brand">&copy; 2026 AgentFlow Inc. All rights reserved.</p>
        </div>
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
    const { email, password, first_name, last_name, organization_id, upline_id, role, licensed_states, commission_level, signup_source } = body;

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
        needs_app_wizard: true,
        signup_source: signup_source === "invite" ? "invite" : "self_serve",
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
            subject: "You're almost in — confirm your AgentFlow email",
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
