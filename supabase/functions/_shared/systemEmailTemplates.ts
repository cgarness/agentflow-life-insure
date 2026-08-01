// Canonical AgentFlow system email templates. Every AgentFlow-owned
// transactional email — signup confirmation, team invitation (initial AND
// resent), welcome, Agency Group invitation, and previews — renders through
// these functions so subjects, sender, and visuals cannot diverge.

import {
  escapeHtml,
  featureRow,
  paragraph,
  RenderedSystemEmail,
  renderSystemEmail,
  resolveSiteUrl,
  sanitizeHeaderText,
  strongText,
} from "./systemEmail.ts";

export interface RenderedSystemEmailWithSubject extends RenderedSystemEmail {
  subject: string;
}

/** Signup confirmation (create-user). */
export function renderConfirmationEmail(params: {
  firstName: string;
  actionLink: string;
}): RenderedSystemEmailWithSubject {
  const name = (params.firstName ?? "").trim() || "there";
  const { html, text } = renderSystemEmail({
    title: "Confirm your AgentFlow account",
    preheader: "Confirm your email to activate your AgentFlow workspace.",
    badge: "Verify Your Email",
    heading: "You're almost in",
    bodyHtml: paragraph(
      `Hi ${strongText(escapeHtml(name))} &mdash; confirm your email to activate your workspace. After that you can sign in and finish a quick setup for your agency.`,
    ),
    bodyText: [
      `Hi ${name} — confirm your email to activate your workspace. After that you can sign in and finish a quick setup for your agency.`,
    ],
    cta: { label: "Confirm email →", url: params.actionLink },
    ctaNote:
      "This link expires for security. If it does, sign up again or use Forgot password on the login page.",
    fallbackUrl: params.actionLink,
  });
  return {
    subject: "You're almost in — confirm your AgentFlow email",
    html,
    text,
  };
}

/**
 * Team invitation — used by BOTH invite-user (initial send) and
 * send-invite-email (resend) so the two paths cannot diverge.
 */
export function renderTeamInvitationEmail(params: {
  firstName: string;
  role: string;
  organizationName: string | null;
  inviteUrl: string;
}): RenderedSystemEmailWithSubject {
  const name = (params.firstName ?? "").trim() || "there";
  const role = (params.role ?? "").trim() || "Agent";
  const orgName = (params.organizationName ?? "").trim();
  const orgDisplay = orgName || "our agency";
  const subject = orgName
    ? sanitizeHeaderText(`You've been invited to join ${orgName} on AgentFlow`)
    : "You've been invited to join AgentFlow";
  const { html, text } = renderSystemEmail({
    title: "You're invited to AgentFlow",
    preheader: orgName
      ? sanitizeHeaderText(`${orgName} invited you to join their team on AgentFlow.`)
      : "You've been invited to join a team on AgentFlow.",
    badge: "New Team Invitation",
    heading: orgName ? `Join ${orgName}` : "Join Our Agency",
    bodyHtml: paragraph(
      `Hi ${strongText(escapeHtml(name))}, you've been invited to join ${strongText(escapeHtml(orgDisplay))} on AgentFlow as a ${strongText(escapeHtml(role))}. Click the button below to accept the invitation and complete your registration.`,
    ),
    bodyText: [
      `Hi ${name}, you've been invited to join ${orgDisplay} on AgentFlow as a ${role}. Use the link below to accept the invitation and complete your registration.`,
    ],
    cta: { label: "Accept Invitation →", url: params.inviteUrl },
    ctaNote: "This invitation expires in 7 days.",
    fallbackUrl: params.inviteUrl,
  });
  return { subject, html, text };
}

/** Welcome email (send-welcome-email, post-confirmation). */
export function renderWelcomeEmail(params: {
  firstName: string;
}): RenderedSystemEmailWithSubject {
  const name = (params.firstName ?? "").trim() || "there";
  const siteUrl = resolveSiteUrl();
  const bodyHtml = [
    paragraph(
      "Your workspace is ready. You're now set up to manage leads, run your dialer, and track your team &mdash; all in one place.",
    ),
    featureRow(
      "01",
      "Power Dialer",
      "300+ dials per day with single-click calling and automatic disposition logging.",
    ),
    featureRow(
      "02",
      "Lead Management",
      "Organize leads, clients, and recruits with full pipeline tracking.",
    ),
    featureRow(
      "03",
      "Team Insights",
      "Leaderboards, reports, and activity logs keep your team accountable.",
    ),
  ].join("\n");
  const { html, text } = renderSystemEmail({
    title: "Welcome to AgentFlow",
    preheader: "Your AgentFlow workspace is ready — dialer, leads, and team tools.",
    heading: `Welcome to AgentFlow, ${name}!`,
    bodyHtml,
    bodyText: [
      "Your workspace is ready. You're now set up to manage leads, run your dialer, and track your team — all in one place.",
      "",
      "1. Power Dialer — 300+ dials per day with single-click calling and automatic disposition logging.",
      "2. Lead Management — Organize leads, clients, and recruits with full pipeline tracking.",
      "3. Team Insights — Leaderboards, reports, and activity logs keep your team accountable.",
    ],
    cta: { label: "Go to Dashboard →", url: `${siteUrl}/dashboard` },
    // No footer links: /support, /privacy, and /terms are not routes in the
    // app (verified against src/App.tsx), so linking them would send every
    // new user to the NotFound page. Add them here once the routes exist.
  });
  return { subject: "Welcome to AgentFlow — You're all set", html, text };
}

/** Agency Group invitation (invite-to-agency-group). */
export function renderAgencyGroupInviteEmail(params: {
  masterOrgName: string | null;
  groupName: string;
  inviteUrl: string;
}): RenderedSystemEmailWithSubject {
  const masterOrg = (params.masterOrgName ?? "").trim() || "An AgentFlow agency";
  const groupName = (params.groupName ?? "").trim() || "their Agency Group";
  const { html, text } = renderSystemEmail({
    title: "Agency Group invitation",
    preheader: sanitizeHeaderText(
      `${masterOrg} invited your agency to a leaderboard group on AgentFlow.`,
    ),
    badge: "Agency Group Invitation",
    heading: "You're invited to an Agency Group",
    bodyHtml: [
      paragraph(
        `${strongText(escapeHtml(masterOrg))} has invited your agency to join ${strongText(escapeHtml(groupName))} on AgentFlow.`,
      ),
      paragraph(
        "Agency Groups share leaderboard metrics for friendly competition between agencies. Your contacts, phone numbers, billing, and settings stay fully independent.",
      ),
    ].join("\n"),
    bodyText: [
      `${masterOrg} has invited your agency to join ${groupName} on AgentFlow.`,
      "",
      "Agency Groups share leaderboard metrics for friendly competition between agencies. Your contacts, phone numbers, billing, and settings stay fully independent.",
    ],
    cta: { label: "View Invitation →", url: params.inviteUrl },
    ctaNote: "This invitation expires in 7 days.",
    fallbackUrl: params.inviteUrl,
  });
  return {
    subject: sanitizeHeaderText(
      `You've been invited to join ${masterOrg}'s Agency Group on AgentFlow`,
    ),
    html,
    text,
  };
}
