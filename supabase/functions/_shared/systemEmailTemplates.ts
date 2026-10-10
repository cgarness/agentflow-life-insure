// Canonical AgentFlow system email templates. Every AgentFlow-owned
// transactional email — signup confirmation, team invitation (initial AND
// resent), welcome, Agency Group invitation, previews, and the internal
// platform-admin registration notifications — renders through these functions
// so subjects, sender, and visuals cannot diverge.

import {
  DetailRow,
  detailTable,
  DetailTone,
  escapeHtml,
  featureRow,
  noticeBox,
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

// ── Internal platform-admin notifications (platform-admin-notify) ─────────────
// Sent ONLY to the AgentFlow platform administrator, never to a customer.
// Values are display strings derived server-side; every one is escaped by
// detailTable(). Never pass passwords, tokens, invitation tokens, auth links,
// JWT/app_metadata or phone numbers into these templates.

export const ADMIN_USER_REGISTERED_SUBJECT = "[AGENTFLOW ADMIN] New User Registered";
export const ADMIN_AGENCY_CREATED_SUBJECT = "[AGENTFLOW ADMIN] New Agency Created";
const ADMIN_BADGE = "Admin Only · Internal Notification";
const ADMIN_NOTICE =
  "ADMIN ONLY — internal AgentFlow platform notification, sent only to the platform administrator. Do not forward to customers.";

export interface AgencyStatusDisplay {
  label: "Active" | "Pending" | "Suspended" | "Archived";
  tone: DetailTone;
  detail: string;
}

/**
 * Agency lifecycle for admin notifications. `organizations.status` is the
 * platform status (active | suspended | archived, NULL treated as the column
 * default 'active'); an active agency whose phone system is not provisioned
 * yet (`twilio_subaccount_status` other than 'active') is Pending.
 */
export function deriveAgencyStatus(
  status: string | null | undefined,
  twilioSubaccountStatus: string | null | undefined,
): AgencyStatusDisplay {
  const platform = (status ?? "active").trim().toLowerCase() || "active";
  const phone = (twilioSubaccountStatus ?? "").trim().toLowerCase();
  if (platform === "suspended") {
    return { label: "Suspended", tone: "danger", detail: "Agency is suspended by the platform." };
  }
  if (platform === "archived") {
    return { label: "Archived", tone: "neutral", detail: "Agency is archived." };
  }
  if (platform !== "active") {
    return { label: "Pending", tone: "warning", detail: `Unrecognized platform status "${platform}".` };
  }
  if (phone === "active") {
    return { label: "Active", tone: "success", detail: "Agency is active and its phone system is provisioned." };
  }
  const phoneDetail: Record<string, string> = {
    pending: "Phone system provisioning is pending.",
    pending_manual: "Phone system is awaiting manual provisioning.",
    suspended: "Phone system account is suspended.",
    closed: "Phone system account is closed.",
  };
  return {
    label: "Pending",
    tone: "warning",
    detail: phoneDetail[phone] ?? "Phone system status is unknown.",
  };
}

function adminCtaUrl(organizationId: string | null): string {
  const base = resolveSiteUrl();
  return organizationId
    ? `${base}/super-admin/organizations/${encodeURIComponent(organizationId)}`
    : `${base}/super-admin`;
}

function rowsToText(rows: DetailRow[]): string[] {
  return rows.map((row) => `${row.label}: ${row.value}`);
}

export interface AdminUserRegisteredEmailParams {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  accountStatus: string;
  emailConfirmed: boolean;
  signupSource: string;
  invitedBy: string | null;
  organizationId: string | null;
  organizationName: string | null;
  agencyStatus: AgencyStatusDisplay | null;
  registeredAtUtc: string;
  registeredAtPacific: string;
}

/** Internal: "[AGENTFLOW ADMIN] New User Registered". */
export function renderAdminUserRegisteredEmail(
  p: AdminUserRegisteredEmailParams,
): RenderedSystemEmailWithSubject {
  const name = p.fullName.trim() || "Unnamed user";
  const orgLabel = p.organizationName?.trim() || (p.organizationId ? "Unnamed agency" : "No agency yet");
  const rows: DetailRow[] = [
    { label: "Name", value: name },
    { label: "Email", value: p.email || "—" },
    { label: "Role", value: p.role || "—" },
    { label: "Account status", value: p.accountStatus || "—", tone: p.accountStatus === "Active" ? "success" : "warning" },
    { label: "Email confirmed", value: p.emailConfirmed ? "Yes" : "Pending", tone: p.emailConfirmed ? "success" : "warning" },
    { label: "Signup source", value: p.signupSource },
    ...(p.invitedBy ? [{ label: "Invited by", value: p.invitedBy }] : []),
    { label: "Agency", value: orgLabel },
    ...(p.agencyStatus
      ? [
        { label: "Agency status", value: p.agencyStatus.label, tone: p.agencyStatus.tone },
        { label: "Agency status detail", value: p.agencyStatus.detail },
      ]
      : []),
    ...(p.organizationId ? [{ label: "Organization ID", value: p.organizationId }] : []),
    { label: "Registered (UTC)", value: p.registeredAtUtc },
    { label: "Registered (Pacific)", value: p.registeredAtPacific },
    { label: "User ID", value: p.userId },
  ];
  const summary = p.organizationName?.trim()
    ? `${name} registered an AgentFlow account in ${p.organizationName.trim()}.`
    : `${name} registered an AgentFlow account.`;
  const { html, text } = renderSystemEmail({
    title: ADMIN_USER_REGISTERED_SUBJECT,
    preheader: sanitizeHeaderText(`ADMIN ONLY — ${summary}`),
    badge: ADMIN_BADGE,
    heading: "New user registered",
    bodyHtml: [noticeBox(ADMIN_NOTICE), paragraph(escapeHtml(summary)), detailTable(rows)].join("\n"),
    bodyText: [ADMIN_NOTICE, "", summary, "", ...rowsToText(rows)],
    cta: { label: "Open in Super Admin →", url: adminCtaUrl(p.organizationId) },
  });
  return { subject: ADMIN_USER_REGISTERED_SUBJECT, html, text };
}

export interface AdminAgencyCreatedEmailParams {
  organizationId: string;
  name: string;
  slug: string | null;
  status: AgencyStatusDisplay;
  founder: string | null;
  memberCount: number;
  createdAtUtc: string;
  createdAtPacific: string;
}

/** Internal: "[AGENTFLOW ADMIN] New Agency Created". */
export function renderAdminAgencyCreatedEmail(
  p: AdminAgencyCreatedEmailParams,
): RenderedSystemEmailWithSubject {
  const name = p.name.trim() || "Unnamed agency";
  const rows: DetailRow[] = [
    { label: "Agency", value: name },
    { label: "Status", value: p.status.label, tone: p.status.tone },
    { label: "Status detail", value: p.status.detail },
    { label: "Founder", value: p.founder ?? "No member attached yet" },
    { label: "Members", value: String(p.memberCount) },
    ...(p.slug ? [{ label: "Slug", value: p.slug }] : []),
    { label: "Created (UTC)", value: p.createdAtUtc },
    { label: "Created (Pacific)", value: p.createdAtPacific },
    { label: "Organization ID", value: p.organizationId },
  ];
  const summary = `${name} was created on AgentFlow (status: ${p.status.label}).`;
  const { html, text } = renderSystemEmail({
    title: ADMIN_AGENCY_CREATED_SUBJECT,
    preheader: sanitizeHeaderText(`ADMIN ONLY — ${summary}`),
    badge: ADMIN_BADGE,
    heading: "New agency created",
    bodyHtml: [noticeBox(ADMIN_NOTICE), paragraph(escapeHtml(summary)), detailTable(rows)].join("\n"),
    bodyText: [ADMIN_NOTICE, "", summary, "", ...rowsToText(rows)],
    cta: { label: "Open in Super Admin →", url: adminCtaUrl(p.organizationId) },
  });
  return { subject: ADMIN_AGENCY_CREATED_SUBJECT, html, text };
}
