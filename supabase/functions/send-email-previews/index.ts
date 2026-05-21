import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@3.2.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Hardcoded allowlist — preview sends only; not for production user flows. */
const ALLOWED_TO = new Set(["cgarness.ffl@gmail.com"]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildConfirmEmailHtml(firstName: string, actionLink: string, logoUrl: string): string {
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
        .tagline { font-size: 11px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; color: #64748B; margin: 0 0 28px; }
        .hero { padding: 0 40px 28px; text-align: center; }
        .badge { display: inline-block; padding: 8px 18px; background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.35); border-radius: 999px; color: #93C5FD; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 20px; }
        h1 { font-size: 30px; font-weight: 800; margin: 0 0 14px; line-height: 1.15; background: linear-gradient(90deg, #F8FAFC 0%, #CBD5E1 45%, #94A3B8 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        p.subtitle { font-size: 16px; color: #94A3B8; line-height: 1.65; margin: 0; max-width: 440px; margin-left: auto; margin-right: auto; }
        p.subtitle strong { color: #E2E8F0; font-weight: 600; }
        .cta-container { padding: 8px 40px 32px; text-align: center; }
        .btn { display: inline-block; padding: 16px 36px; background: linear-gradient(135deg, #1D4ED8 0%, #2563EB 40%, #3B82F6 100%); color: #FFFFFF !important; text-decoration: none; font-weight: 700; border-radius: 12px; font-size: 15px; letter-spacing: 0.04em; box-shadow: 0 12px 32px rgba(37, 99, 235, 0.45), 0 0 0 1px rgba(255,255,255,0.08) inset; }
        .hint { text-align: center; padding: 0 40px 8px; font-size: 12px; color: #64748B; }
        .footer { padding: 28px 40px 36px; text-align: center; }
        .footer p { font-size: 12px; color: #475569; margin: 0 0 10px; line-height: 1.5; }
    </style>
</head>
<body>
    <div class="wrap">
    <div class="container">
        <div class="accent"></div>
        <div class="header">
            <img src="${logoUrl}" alt="AgentFlow" style="height: 40px; width: auto; display: inline-block;" />
            <p class="tagline">Life Insurance CRM &amp; Power Dialer</p>
        </div>
        <div class="hero">
            <div class="badge">Verify your email</div>
            <h1>You're almost in</h1>
            <p class="subtitle">Hi <strong>${safeName}</strong> — confirm your email to activate your workspace.</p>
        </div>
        <div class="cta-container"><a href="${actionLink}" class="btn">Confirm email &rarr;</a></div>
        <p class="hint">Preview only — link is not valid.</p>
        <div class="footer"><p class="brand">&copy; 2026 AgentFlow Inc.</p></div>
    </div>
    </div>
</body>
</html>`;
}

function buildAgencyGroupHtml(masterOrgName: string, groupName: string, inviteURL: string, logoUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Agency Group Invitation</title>
<style>
body { margin: 0; padding: 0; background-color: #020408; font-family: -apple-system, sans-serif; color: #F1F5F9; }
.container { max-width: 600px; margin: 40px auto; background: rgba(13, 25, 48, 0.4); border: 1px solid rgba(99, 155, 255, 0.2); border-radius: 24px; overflow: hidden; }
.hero { padding: 0 40px 40px; text-align: center; }
h1 { font-size: 28px; font-weight: 700; margin: 0 0 16px; }
p.subtitle { font-size: 16px; color: #94A3B8; line-height: 1.6; }
.btn { display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #1D4ED8, #3B82F6); color: #FFF !important; text-decoration: none; font-weight: 700; border-radius: 12px; }
</style></head>
<body>
<div class="container">
<div style="padding:40px;text-align:center"><img src="${logoUrl}" alt="AgentFlow" style="height:40px" /></div>
<div class="hero">
<span style="display:inline-block;padding:8px 16px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:30px;color:#3B82F6;font-size:14px;font-weight:600">Agency Group Invitation</span>
<h1>Join ${escapeHtml(masterOrgName)}'s Agency Group</h1>
<p class="subtitle">${escapeHtml(masterOrgName)} has invited your agency to join "<strong>${escapeHtml(groupName)}</strong>" on AgentFlow.</p>
</div>
<div style="padding:40px;text-align:center"><a href="${inviteURL}" class="btn">Accept Invitation</a></div>
</div>
</body></html>`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), { status: 500, headers });
  }

  try {
    const { to, firstName } = await req.json();
    const email = String(to || "").trim().toLowerCase();
    if (!ALLOWED_TO.has(email)) {
      return new Response(JSON.stringify({ error: "Recipient not allowed for previews" }), { status: 403, headers });
    }

    const siteUrl = Deno.env.get("PUBLIC_SITE_URL") || "https://agentflow-life-insure.vercel.app";
    const logoUrl = `${siteUrl}/agentflow-logo-full.png`;
    const name = String(firstName || "Chris").trim() || "Chris";
    const resend = new Resend(resendKey);

    const workflowBody = `<p>Hi ${escapeHtml(name)},</p><p>This is a sample workflow email body with merge fields — same format agents configure in Email &amp; SMS Templates (no shared wrapper today).</p><p>Thanks,<br/>Your Agency</p>`;

    const sends = [
      {
        subject: "[Preview] Signup — confirm email",
        html: buildConfirmEmailHtml(name, `${siteUrl}/dashboard`, logoUrl),
      },
      {
        subject: "[Preview] Agency group invite",
        html: buildAgencyGroupHtml("Family First Life", "Preview Agency Group", `${siteUrl}/accept-group-invite?token=PREVIEW`, logoUrl),
      },
      {
        subject: "[Preview] Workflow — Send Email",
        html: workflowBody,
      },
    ];

    const results: { subject: string; id?: string; error?: string }[] = [];
    for (const mail of sends) {
      const { data, error } = await resend.emails.send({
        from: "AgentFlow <team@fflagent.com>",
        to: [email],
        subject: mail.subject,
        html: mail.html,
      });
      results.push({ subject: mail.subject, id: data?.id, error: error?.message });
      await new Promise((r) => setTimeout(r, 400));
    }

    return new Response(JSON.stringify({ success: true, results }), { status: 200, headers });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }
});
