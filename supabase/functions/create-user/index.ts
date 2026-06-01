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

function buildConfirmEmailHtml(firstName: string, actionLink: string, logoUrl: string): string {
  const safeName = escapeHtml(firstName);
  const safeLink = escapeHtml(actionLink);
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Confirm your AgentFlow account</title>
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
                <div style="color: #94A3B8; font-size: 11px; letter-spacing: 0.15em; font-weight: 600; text-transform: uppercase; margin-top: 12px;">Life Insurance CRM &amp; Power Dialer</div>
            </div>
            <div style="padding: 28px 40px 24px; text-align: center;">
                <div style="display: inline-block; background-color: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 6px 14px; margin-bottom: 16px;">Verify Your Email</div>
                <h1 style="font-size: 26px; font-weight: 800; color: #0F172A; line-height: 1.2; margin: 0 0 12px;">You're almost in</h1>
                <p style="font-size: 15px; color: #475569; line-height: 1.7; margin: 0;">Hi <strong style="color: #0F172A;">${safeName}</strong> — confirm your email to activate your workspace. After that you can sign in and finish a quick setup for your agency.</p>
            </div>
            <div style="padding: 0 40px 12px; text-align: center;">
                <a href="${actionLink}" style="display: inline-block; background-color: #2563EB; color: #FFFFFF; padding: 14px 32px; border-radius: 8px; font-weight: 700; font-size: 15px; text-decoration: none; box-shadow: 0 2px 6px rgba(37,99,235,0.4);">Confirm email &rarr;</a>
            </div>
            <p style="text-align: center; padding: 0 40px; font-size: 12px; color: #94A3B8; line-height: 1.6; margin: 0 0 20px;">This link expires for security. If it does, sign up again or use Forgot password on the login page.</p>
            <div style="margin: 0 40px 28px; padding: 14px 16px; background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;">
                <p style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #94A3B8; margin: 0 0 8px;">Button not working?</p>
                <p style="font-size: 11px; line-height: 1.5; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #2563EB; margin: 0;"><a href="${actionLink}" style="color: #2563EB; text-decoration: none;">${safeLink}</a></p>
            </div>
            <div style="border-top: 1px solid #E2E8F0; padding: 24px 40px; background-color: #F8FAFC; text-align: center;">
                <p style="font-size: 11px; font-weight: 600; letter-spacing: 0.15em; color: #94A3B8; margin: 0 0 8px;">LIFE INSURANCE CRM &amp; POWER DIALER</p>
                <p style="font-size: 12px; color: #94A3B8; margin: 0;">&copy; 2026 AgentFlow Inc. All Rights Reserved.</p>
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
    const {
      email,
      password,
      first_name,
      last_name,
      organization_id,
      upline_id,
      role,
      licensed_states,
      commission_level,
      signup_source,
      invite_token,
    } = body;

    if (!email || !password) {
      return new Response(
        JSON.stringify({ success: false, error: "Email and password are required" }),
        { status: 200, headers }
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
        { status: 200, headers }
      );
    }

    const isInviteSignup = signup_source === "invite";
    if (isInviteSignup) {
      const acceptedAt = new Date().toISOString();
      const acceptPayload = { status: "Accepted", accepted_at: acceptedAt };

      if (invite_token) {
        const { error: inviteError } = await supabaseAdmin
          .from("invitations")
          .update(acceptPayload)
          .eq("token", invite_token)
          .eq("status", "Pending");

        if (inviteError) {
          console.error("create-user: failed to accept invitation by token:", inviteError.message);
        }
      } else if (organization_id) {
        const { error: inviteError } = await supabaseAdmin
          .from("invitations")
          .update(acceptPayload)
          .ilike("email", email)
          .eq("organization_id", organization_id)
          .eq("status", "Pending");

        if (inviteError) {
          console.error("create-user: failed to accept invitation by email:", inviteError.message);
        }
      }
    }

    let emailSent = false;
    const siteUrl = Deno.env.get("PUBLIC_SITE_URL") || "https://agentflow-life-insure.vercel.app";
    const logoUrl = `${siteUrl}/agentflow-logo-full.png`;
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
            html: buildConfirmEmailHtml(displayName, actionLink, logoUrl),
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
      { status: 200, headers }
    );
  }
});
