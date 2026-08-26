// Shared renderer for every AgentFlow-owned transactional/system email.
// One light, email-client-safe shell: table-based structure, inline CSS,
// solid hex colors, hidden preheader, plain-text alternative, dynamic year.
// Agency-authored workflow emails (workflow-executor send_email) and
// user-authored Gmail/contact emails must NEVER be wrapped in this shell.

export const SYSTEM_EMAIL_FROM = "AgentFlow <team@fflagent.com>";

const FALLBACK_SITE_URL = "https://www.fflagent.com";

export function resolveSiteUrl(): string {
  const configured = (Deno.env.get("PUBLIC_SITE_URL") ?? "").trim();
  const url = configured || FALLBACK_SITE_URL;
  return url.replace(/\/+$/, "");
}

// Email-only asset, deliberately NOT the platform/UI `/agentflow-logo-full.png`.
// That stable path was overwritten in place when the wordmark was corrected, so email
// image proxies (Gmail, Apple MPP, Outlook) can keep serving the pre-correction bitmap
// they cached against it. Email therefore renders from its own immutable filename.
// NEVER overwrite this file in place — a future artwork change needs a NEW filename,
// or every proxy that already cached this URL keeps showing the old logo forever.
// Keep it byte-identical to the approved wordmark (guarded by the sha256 parity test in
// src/lib/__tests__/systemEmailLogoAsset.test.ts).
export function resolveLogoUrl(siteUrl?: string): string {
  return `${siteUrl ?? resolveSiteUrl()}/agentflow-logo-email-v2.png`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Subjects and preheaders are header-adjacent text: strip control characters
// and collapse whitespace so interpolated names cannot smuggle CRLF sequences.
export function sanitizeHeaderText(value: unknown): string {
  return String(value ?? "")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Guard for CTA/fallback/logo URLs. These are always server-constructed
// (siteUrl + path, or a Supabase-generated action link); anything that is not
// an absolute https URL is a programming error, so fail loudly — every caller
// sends best-effort inside try/catch.
export function assertHttpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`systemEmail: invalid URL for email link: ${value}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`systemEmail: refusing non-https email link: ${value}`);
  }
  return value;
}

/** Standard body paragraph. `innerHtml` must already be escaped by the caller. */
export function paragraph(innerHtml: string): string {
  return `<p style="font-size: 15px; color: #475569; line-height: 1.7; margin: 0 0 14px; text-align: center;">${innerHtml}</p>`;
}

/** Bold inline emphasis for an escaped dynamic value. */
export function strongText(escapedValue: string): string {
  return `<strong style="color: #0F172A;">${escapedValue}</strong>`;
}

/**
 * Welcome-style feature row. Text-only marker glyph (no emoji as primary
 * icon): a solid tinted square with a bold two-character label.
 */
export function featureRow(marker: string, title: string, description: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate; border: 1px solid #E2E8F0; border-radius: 8px; background-color: #FAFAFA; margin-bottom: 12px;">
  <tr>
    <td valign="top" width="74" style="padding: 16px 0 16px 16px; width: 74px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" width="44" height="44" style="width: 44px; height: 44px; background-color: #EFF6FF; border-radius: 8px; color: #1D4ED8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 800; letter-spacing: 0.04em;">${escapeHtml(marker)}</td>
      </tr></table>
    </td>
    <td valign="top" style="padding: 16px 16px 16px 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <div style="font-size: 15px; font-weight: 700; color: #0F172A; margin-bottom: 4px;">${escapeHtml(title)}</div>
      <div style="font-size: 13px; color: #475569; line-height: 1.6;">${escapeHtml(description)}</div>
    </td>
  </tr>
</table>`;
}

export interface SystemEmailCta {
  label: string;
  url: string;
}

export interface SystemEmailFooterLink {
  label: string;
  url: string;
}

export interface SystemEmailContent {
  /** <title> + accessible document title. Plain text. */
  title: string;
  /** Hidden preview text. Plain text. */
  preheader: string;
  /** Optional uppercase pill badge. Plain text. */
  badge?: string;
  /** H1. Plain text (escaped here). */
  heading: string;
  /** Pre-built body HTML — every dynamic value must be escaped by the caller. */
  bodyHtml: string;
  /** Plain-text body lines for the text/plain alternative. */
  bodyText: string[];
  cta?: SystemEmailCta;
  /** Small gray note under the CTA (e.g. expiry copy). Plain text. */
  ctaNote?: string;
  /** Visible raw-link fallback box for security/invitation actions. */
  fallbackUrl?: string;
  footerLinks?: SystemEmailFooterLink[];
}

export interface RenderedSystemEmail {
  html: string;
  text: string;
}

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function renderSystemEmail(content: SystemEmailContent): RenderedSystemEmail {
  const siteUrl = resolveSiteUrl();
  const logoUrl = assertHttpsUrl(resolveLogoUrl(siteUrl));
  const year = new Date().getFullYear();
  const ctaUrl = content.cta ? assertHttpsUrl(content.cta.url) : null;
  const fallbackUrl = content.fallbackUrl ? assertHttpsUrl(content.fallbackUrl) : null;

  const badgeHtml = content.badge
    ? `<div style="display: inline-block; background-color: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 6px 14px; margin-bottom: 16px;">${escapeHtml(content.badge)}</div>`
    : "";

  const ctaHtml = content.cta && ctaUrl
    ? `<tr><td align="center" class="af-pad" style="padding: 8px 40px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" style="background-color: #2563EB; border-radius: 8px;">
            <a href="${escapeHtml(ctaUrl)}" style="display: inline-block; padding: 14px 32px; color: #FFFFFF; font-family: ${FONT_STACK}; font-weight: 700; font-size: 15px; text-decoration: none;">${escapeHtml(content.cta.label)}</a>
          </td>
        </tr></table>
      </td></tr>`
    : "";

  const ctaNoteHtml = content.ctaNote
    ? `<tr><td align="center" class="af-pad" style="padding: 0 40px;">
        <p style="font-size: 12px; color: #94A3B8; line-height: 1.6; margin: 0 0 8px; font-family: ${FONT_STACK};">${escapeHtml(content.ctaNote)}</p>
      </td></tr>`
    : "";

  const fallbackHtml = fallbackUrl
    ? `<tr><td class="af-pad" style="padding: 12px 40px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate; background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;">
          <tr><td style="padding: 14px 16px; font-family: ${FONT_STACK};">
            <p style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #94A3B8; margin: 0 0 8px;">Button not working?</p>
            <p style="font-size: 11px; line-height: 1.5; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #2563EB; margin: 0;"><a href="${escapeHtml(fallbackUrl)}" style="color: #2563EB; text-decoration: none;">${escapeHtml(fallbackUrl)}</a></p>
          </td></tr>
        </table>
      </td></tr>`
    : "";

  const footerLinks = content.footerLinks ?? [];
  const footerLinksHtml = footerLinks.length
    ? `<p style="font-size: 12px; color: #94A3B8; margin: 10px 0 0;">${footerLinks
        .map((l) => `<a href="${escapeHtml(assertHttpsUrl(l.url))}" style="color: #94A3B8; text-decoration: none;">${escapeHtml(l.label)}</a>`)
        .join("&nbsp;&nbsp;|&nbsp;&nbsp;")}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(content.title)}</title>
<style>
body { margin: 0; padding: 0; background-color: #F1F5F9; }
a { text-decoration: none; }
img { border: 0; line-height: 100%; outline: none; }
@media only screen and (max-width: 600px) {
  .af-pad { padding-left: 20px !important; padding-right: 20px !important; }
}
</style>
</head>
<body style="margin: 0; padding: 0; background-color: #F1F5F9; font-family: ${FONT_STACK};">
<div style="display: none; font-size: 1px; line-height: 1px; max-height: 0; max-width: 0; opacity: 0; overflow: hidden; mso-hide: all;">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; background-color: #F1F5F9;">
  <tr>
    <td align="center" style="padding: 32px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate; width: 100%; max-width: 560px; background-color: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px;">
        <tr><td height="4" style="height: 4px; line-height: 4px; font-size: 0; background-color: #2563EB; border-radius: 8px 8px 0 0;">&nbsp;</td></tr>
        <tr><td align="center" class="af-pad" style="padding: 32px 40px 0;">
          <img src="${escapeHtml(logoUrl)}" alt="AgentFlow" height="24" style="height: 24px; max-width: 100%; display: inline-block;">
          <div style="color: #94A3B8; font-size: 11px; letter-spacing: 0.15em; font-weight: 600; text-transform: uppercase; margin-top: 12px; font-family: ${FONT_STACK};">Life Insurance CRM &amp; Power Dialer</div>
        </td></tr>
        <tr><td align="center" class="af-pad" style="padding: 28px 40px 4px;">
          ${badgeHtml}
          <h1 style="font-size: 26px; font-weight: 800; color: #0F172A; line-height: 1.2; margin: 0 0 12px; font-family: ${FONT_STACK};">${escapeHtml(content.heading)}</h1>
        </td></tr>
        <tr><td class="af-pad" style="padding: 0 40px 8px; font-family: ${FONT_STACK};">${content.bodyHtml}</td></tr>
        ${ctaHtml}
        ${ctaNoteHtml}
        ${fallbackHtml}
        <tr><td height="20" style="height: 20px; line-height: 20px; font-size: 0;">&nbsp;</td></tr>
        <tr><td align="center" class="af-pad" style="border-top: 1px solid #E2E8F0; padding: 24px 40px; background-color: #F8FAFC; border-radius: 0 0 8px 8px;">
          <p style="font-size: 11px; font-weight: 600; letter-spacing: 0.15em; color: #94A3B8; margin: 0 0 8px; font-family: ${FONT_STACK};">LIFE INSURANCE CRM &amp; POWER DIALER</p>
          <p style="font-size: 12px; color: #94A3B8; margin: 0; font-family: ${FONT_STACK};">&copy; ${year} AgentFlow Inc. All Rights Reserved.</p>
          ${footerLinksHtml}
        </td></tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  // The text/plain part gets the same treatment the subject does: dynamic
  // values reach it un-escaped (there is no markup to escape into), so a
  // caller-supplied newline could otherwise forge extra lines of "AgentFlow"
  // copy inside a DKIM-signed message. Sanitizing per line strips CR/LF and
  // control characters while preserving the intended line structure.
  const textParts: string[] = [
    "AGENTFLOW — LIFE INSURANCE CRM & POWER DIALER",
    "",
    sanitizeHeaderText(content.heading),
    "",
    ...content.bodyText.map((line) => sanitizeHeaderText(line)),
  ];
  if (content.cta && ctaUrl) {
    textParts.push("", `${content.cta.label.replace(/\s*(→|&rarr;)\s*$/u, "")}: ${ctaUrl}`);
  }
  if (content.ctaNote) {
    textParts.push("", content.ctaNote);
  }
  if (fallbackUrl && fallbackUrl !== ctaUrl) {
    textParts.push("", `If the button doesn't work, copy this link into your browser: ${fallbackUrl}`);
  }
  textParts.push("", `© ${year} AgentFlow Inc. All Rights Reserved.`);
  if (footerLinks.length) {
    textParts.push(...footerLinks.map((l) => `${l.label}: ${l.url}`));
  }

  return { html, text: textParts.join("\n") };
}
