// =============================================================================
// create-user — public signup endpoint (anonymously callable).
//
// TRUST MODEL — the request body is UNTRUSTED INPUT, never authority.
//
//   The caller is anonymous, so anything in the body is attacker-controlled.
//   `organization_id`, `role`, `upline_id`, `licensed_states` and
//   `commission_level` are therefore NEVER read from the body: they decide
//   tenancy and privilege, and profiles.role / profiles.organization_id are
//   projected into auth.users.raw_app_meta_data (set_claim) and into JWT claims
//   (custom_access_token_hook), where get_user_role() and get_org_id() gate
//   hundreds of RLS policies. Accepting a body-supplied role/org was a
//   cross-tenant account-takeover primitive.
//
//   Two modes, both server-derived:
//
//   1. INVITE  (signup_source === 'invite' or an invite_token is present)
//      Authority comes exclusively from the `invitations` row looked up by
//      token with the service-role client. The invitation must be Pending,
//      unexpired, and its email must equal the signup email after
//      lower(trim()) normalization — exact equality, never `ilike` (an `ilike`
//      match treats `%` / `_` in the address as wildcards). The invitation is
//      claimed ATOMICALLY (UPDATE ... WHERE status='Pending' RETURNING id)
//      BEFORE the account exists, so it is single-use even under a race; the
//      claim is released back to Pending if account creation then fails.
//      Only first_name/last_name may prefer the body value — names carry no
//      authority.
//
//   2. SELF-SERVE (no invite token)
//      Body org/role fields are ignored outright. The user is created FIRST
//      with no organization_id and no role (handle_new_user defaults to
//      role 'Agent', organization_id NULL), then the organization is minted
//      server-side, then the profile is patched to that org as 'Admin'.
//      This ordering is deliberate: the compensating action on failure is
//      deleting a brand-new auth user, which has no external side effects.
//      The reverse order (org first, as the old frontend did) left a fully
//      provisioned orphan organization — Twilio subaccount included — behind
//      every failed signup, and every retry minted another.
//
//   Failures after the account exists are compensated (invitation released, or
//   auth user deleted) so a partial signup never leaves an orphan. Confirmation
//   email failure remains non-fatal: the account stands and email_sent is false.
// =============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@3.2.0";
import { buildOrganizationSlug } from "../_shared/organizationProvisioning.ts";

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

/** Structural type — only the admin call the compensating cleanup needs. */
type AdminClient = {
  auth: { admin: { deleteUser: (id: string) => Promise<{ error: { message: string } | null }> } };
};

/** Generic refusal — never tells an anonymous caller WHY an invitation failed. */
const INVALID_INVITATION = "This invitation link is not valid. Ask your admin to send a new one.";
/** Generic signup failure — the real cause is logged, never returned. */
const SIGNUP_FAILED = "Could not complete signup. Please try again.";

/** Exact-equality comparison key for emails. Never used with `ilike`. */
function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}


/**
 * Compensating cleanup for a failed self-serve signup (plan §9): the auth user
 * was created first precisely so this delete has no external side effects.
 */
async function deleteAuthUserBestEffort(supabaseAdmin: AdminClient, userId: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(
      `create-user: compensating deleteUser failed for ${userId} — orphaned auth user requires manual cleanup:`,
      error.message
    );
  }
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
    // NOTE: organization_id, role, upline_id, licensed_states and
    // commission_level are deliberately NOT destructured — they are authority
    // fields and are never read from an anonymous request body.
    const {
      email,
      password,
      first_name,
      last_name,
      organization_name,
      signup_source,
      invite_token,
    } = body;

    if (!email || !password) {
      return new Response(
        JSON.stringify({ success: false, error: "Email and password are required" }),
        { status: 200, headers }
      );
    }

    const inviteToken = trimmedString(invite_token);
    const isInviteSignup = signup_source === "invite" || inviteToken.length > 0;
    const bodyFirstName = trimmedString(first_name);
    const bodyLastName = trimmedString(last_name);

    let createdUserId: string;

    if (isInviteSignup) {
      // ---------------------------------------------------------------------
      // INVITE MODE — every authority field comes from the invitations row.
      // ---------------------------------------------------------------------
      if (!inviteToken) {
        // The legacy "invite without a token" path is removed: it derived org
        // and role from the request body, which an anonymous caller controls.
        return new Response(
          JSON.stringify({ success: false, error: INVALID_INVITATION }),
          { status: 400, headers }
        );
      }

      const { data: invitation, error: invitationError } = await supabaseAdmin
        .from("invitations")
        .select(
          "id, email, first_name, last_name, role, organization_id, upline_id, licensed_states, commission_level, status, expires_at"
        )
        .eq("token", inviteToken)
        .maybeSingle();

      if (invitationError) {
        console.error("create-user: invitation lookup failed:", invitationError.message);
        return new Response(
          JSON.stringify({ success: false, error: INVALID_INVITATION }),
          { status: 400, headers }
        );
      }

      if (!invitation) {
        console.warn("create-user: signup refused — no invitation matches the supplied token");
        return new Response(
          JSON.stringify({ success: false, error: INVALID_INVITATION }),
          { status: 400, headers }
        );
      }

      const expiresAtMs = Date.parse(String(invitation.expires_at ?? ""));
      const invitedEmail = normalizeEmail(invitation.email);
      const signupEmail = normalizeEmail(email);

      // Exact normalized equality — NEVER `ilike`, which would treat `%` and
      // `_` in an attacker-supplied address as wildcards.
      const emailMatches = invitedEmail.length > 0 && invitedEmail === signupEmail;
      const isPending = invitation.status === "Pending";
      const isUnexpired = Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();

      if (!isPending || !isUnexpired || !emailMatches) {
        console.warn(
          `create-user: invitation ${invitation.id} refused (pending=${isPending} unexpired=${isUnexpired} email_match=${emailMatches})`
        );
        return new Response(
          JSON.stringify({ success: false, error: INVALID_INVITATION }),
          { status: 400, headers }
        );
      }

      // One-time use: claim the invitation BEFORE the account exists. The
      // status predicate makes this atomic — a concurrent signup that already
      // flipped the row to Accepted leaves us with zero updated rows.
      const { data: claimedRows, error: claimError } = await supabaseAdmin
        .from("invitations")
        .update({ status: "Accepted", accepted_at: new Date().toISOString() })
        .eq("id", invitation.id)
        .eq("status", "Pending")
        .select("id");

      if (claimError) {
        console.error("create-user: invitation claim failed:", claimError.message);
        return new Response(
          JSON.stringify({ success: false, error: INVALID_INVITATION }),
          { status: 400, headers }
        );
      }

      if (!claimedRows || claimedRows.length === 0) {
        console.warn(`create-user: invitation ${invitation.id} was already consumed by another signup`);
        return new Response(
          JSON.stringify({ success: false, error: "This invitation has already been used." }),
          { status: 409, headers }
        );
      }

      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
        user_metadata: {
          // Names are not authority — prefer what the invitee typed.
          first_name: bodyFirstName || trimmedString(invitation.first_name),
          last_name: bodyLastName || trimmedString(invitation.last_name),
          // Everything below is server-derived from the invitation row.
          organization_id: invitation.organization_id,
          role: invitation.role,
          upline_id: invitation.upline_id ?? null,
          licensed_states: invitation.licensed_states ?? [],
          commission_level: invitation.commission_level ?? "0%",
          needs_app_wizard: true,
          signup_source: "invite",
        },
      });

      if (createError || !created?.user) {
        // Compensation (plan §9): release the claim so the invitation stays
        // usable — no account was created.
        const { error: releaseError } = await supabaseAdmin
          .from("invitations")
          .update({ status: "Pending", accepted_at: null })
          .eq("id", invitation.id)
          .eq("status", "Accepted");

        if (releaseError) {
          console.error(
            `create-user: FAILED to release invitation ${invitation.id} after createUser error — it is stuck in Accepted and needs manual reset:`,
            releaseError.message
          );
        }

        return new Response(
          JSON.stringify({ success: false, error: SIGNUP_FAILED }),
          { status: 200, headers }
        );
      }

      createdUserId = created.user.id;
    } else {
      // ---------------------------------------------------------------------
      // SELF-SERVE MODE — user first, then a server-minted organization.
      // Body-supplied organization_id / role / upline_id / licensed_states /
      // commission_level are ignored entirely.
      // ---------------------------------------------------------------------
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
        user_metadata: {
          first_name: bodyFirstName,
          last_name: bodyLastName,
          needs_app_wizard: true,
          signup_source: "self_serve",
          // No organization_id and no role: handle_new_user creates the profile
          // with organization_id NULL and role 'Agent'; both are set below.
        },
      });

      if (createError || !created?.user) {
        return new Response(
          JSON.stringify({ success: false, error: SIGNUP_FAILED }),
          { status: 200, headers }
        );
      }

      const newUserId = created.user.id;
      const requestedOrgName = trimmedString(organization_name);
      const orgName = requestedOrgName || (bodyFirstName ? `${bodyFirstName}'s Agency` : "New Agency");

      // Atomic: org insert + disposition seed + founder attach happen inside a
      // single SECURITY DEFINER transaction, so a failure rolls the whole thing
      // back (including the pg_net row queued by the Twilio provisioning
      // trigger). An Edge Function could NOT compensate this itself — 41 tables
      // hold ON DELETE NO ACTION FKs to organizations, so a delete would fail.
      const { data: newOrgId, error: provisionError } = await supabaseAdmin.rpc(
        "provision_organization",
        {
          p_name: orgName,
          p_slug: buildOrganizationSlug(orgName, crypto.randomUUID().slice(0, 8)),
          p_owner_user_id: newUserId,
        },
      );

      if (provisionError || !newOrgId) {
        console.error(
          "create-user: founder organization provisioning failed (transaction rolled back):",
          provisionError?.message ?? "no organization id returned",
        );
        // Nothing was persisted on the DB side; only the auth user needs undoing.
        await deleteAuthUserBestEffort(supabaseAdmin, newUserId);
        return new Response(
          JSON.stringify({ success: false, error: SIGNUP_FAILED }),
          { status: 200, headers }
        );
      }

      createdUserId = newUserId;
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
      JSON.stringify({ success: true, user_id: createdUserId, email_sent: emailSent }),
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
