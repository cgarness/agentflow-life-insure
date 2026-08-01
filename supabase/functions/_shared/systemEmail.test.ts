// Unit tests for the shared system-email renderer.
// Offline after the first module fetch: no network, no Supabase, no fetch().
// Run: deno test --allow-env --allow-read supabase/functions/_shared/

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  assertHttpsUrl,
  escapeHtml,
  featureRow,
  paragraph,
  RenderedSystemEmail,
  renderSystemEmail,
  resolveLogoUrl,
  resolveSiteUrl,
  sanitizeHeaderText,
  strongText,
  SYSTEM_EMAIL_FROM,
  SystemEmailContent,
} from "./systemEmail.ts";

const ENV_KEY = "PUBLIC_SITE_URL";

/** Save/restore PUBLIC_SITE_URL so env-dependent tests are order-independent. */
function withSiteUrlEnv(value: string | undefined, fn: () => void): void {
  const previous = Deno.env.get(ENV_KEY);
  try {
    if (value === undefined) {
      Deno.env.delete(ENV_KEY);
    } else {
      Deno.env.set(ENV_KEY, value);
    }
    fn();
  } finally {
    if (previous === undefined) {
      Deno.env.delete(ENV_KEY);
    } else {
      Deno.env.set(ENV_KEY, previous);
    }
  }
}

// ---------------------------------------------------------------------------
// SYSTEM_EMAIL_FROM
// ---------------------------------------------------------------------------

Deno.test("SYSTEM_EMAIL_FROM is the single AgentFlow sender identity", () => {
  assertEquals(SYSTEM_EMAIL_FROM, "AgentFlow <team@fflagent.com>");
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

Deno.test("escapeHtml escapes all five HTML-significant characters", () => {
  assertEquals(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

Deno.test("escapeHtml escapes ampersand first (no double-encoding artifacts)", () => {
  assertEquals(escapeHtml("&amp;"), "&amp;amp;");
  assertEquals(escapeHtml("Tom & Jerry <b>"), "Tom &amp; Jerry &lt;b&gt;");
});

Deno.test("escapeHtml neutralizes a script tag payload", () => {
  const out = escapeHtml(`<script>alert(1)</script>`);
  assertEquals(out.includes("<script>"), false);
  assertEquals(out.includes("</script>"), false);
  assertStringIncludes(out, "&lt;script&gt;");
  assertStringIncludes(out, "&lt;/script&gt;");
});

Deno.test("escapeHtml maps null and undefined to the empty string", () => {
  assertEquals(escapeHtml(null), "");
  assertEquals(escapeHtml(undefined), "");
});

Deno.test("escapeHtml stringifies non-string values", () => {
  assertEquals(escapeHtml(0), "0");
  assertEquals(escapeHtml(false), "false");
  assertEquals(escapeHtml(42), "42");
});

// ---------------------------------------------------------------------------
// sanitizeHeaderText
// ---------------------------------------------------------------------------

Deno.test("sanitizeHeaderText strips CR/LF header-injection sequences", () => {
  assertEquals(sanitizeHeaderText("Line1\r\nLine2"), "Line1 Line2");
  assertEquals(
    sanitizeHeaderText("Subject\r\nBcc: attacker@example.com"),
    "Subject Bcc: attacker@example.com",
  );
  const out = sanitizeHeaderText("a\r\nb\r\nc");
  assertEquals(out.includes("\r"), false);
  assertEquals(out.includes("\n"), false);
  assertEquals(out, "a b c");
});

Deno.test("sanitizeHeaderText strips other control characters", () => {
  assertEquals(sanitizeHeaderText("\u0000bad\u007Fchars"), "bad chars");
  assertEquals(sanitizeHeaderText("tab\there"), "tab here");
  assertEquals(sanitizeHeaderText("bell\u0007end"), "bell end");
  assertEquals(sanitizeHeaderText("\u001B[31mred\u001B[0m"), "[31mred [0m");
});

Deno.test("sanitizeHeaderText collapses whitespace runs and trims", () => {
  assertEquals(sanitizeHeaderText("   a    b \t\t c   "), "a b c");
  assertEquals(sanitizeHeaderText("\n\n  padded  \n\n"), "padded");
});

Deno.test("sanitizeHeaderText maps null and undefined to the empty string", () => {
  assertEquals(sanitizeHeaderText(null), "");
  assertEquals(sanitizeHeaderText(undefined), "");
  assertEquals(sanitizeHeaderText("   "), "");
});

Deno.test("sanitizeHeaderText preserves ordinary punctuation", () => {
  assertEquals(
    sanitizeHeaderText("O'Brien & Sons — Agency #1"),
    "O'Brien & Sons — Agency #1",
  );
});

// ---------------------------------------------------------------------------
// assertHttpsUrl
// ---------------------------------------------------------------------------

Deno.test("assertHttpsUrl returns https URLs unchanged", () => {
  const url = "https://www.fflagent.com/accept-invite?token=abc123";
  assertEquals(assertHttpsUrl(url), url);
  assertEquals(assertHttpsUrl("https://example.com"), "https://example.com");
});

Deno.test("assertHttpsUrl rejects plain http", () => {
  assertThrows(
    () => assertHttpsUrl("http://example.com/x"),
    Error,
    "refusing non-https email link",
  );
});

Deno.test("assertHttpsUrl rejects the javascript: scheme", () => {
  assertThrows(
    () => assertHttpsUrl("javascript:alert(1)"),
    Error,
    "refusing non-https email link",
  );
});

Deno.test("assertHttpsUrl rejects the data: scheme", () => {
  assertThrows(
    () => assertHttpsUrl("data:text/html;base64,PHNjcmlwdD4="),
    Error,
    "refusing non-https email link",
  );
});

Deno.test("assertHttpsUrl rejects malformed input", () => {
  assertThrows(() => assertHttpsUrl("not a url"), Error, "invalid URL for email link");
  assertThrows(() => assertHttpsUrl(""), Error, "invalid URL for email link");
  assertThrows(() => assertHttpsUrl("//example.com/x"), Error, "invalid URL for email link");
  assertThrows(
    () => assertHttpsUrl("www.fflagent.com/dashboard"),
    Error,
    "invalid URL for email link",
  );
});

// ---------------------------------------------------------------------------
// resolveSiteUrl / resolveLogoUrl
// ---------------------------------------------------------------------------

Deno.test("resolveSiteUrl honors PUBLIC_SITE_URL", () => {
  withSiteUrlEnv("https://app.example.com", () => {
    assertEquals(resolveSiteUrl(), "https://app.example.com");
  });
});

Deno.test("resolveSiteUrl strips trailing slashes", () => {
  withSiteUrlEnv("https://app.example.com/", () => {
    assertEquals(resolveSiteUrl(), "https://app.example.com");
  });
  withSiteUrlEnv("https://app.example.com///", () => {
    assertEquals(resolveSiteUrl(), "https://app.example.com");
  });
});

Deno.test("resolveSiteUrl trims surrounding whitespace", () => {
  withSiteUrlEnv("  https://app.example.com/  ", () => {
    assertEquals(resolveSiteUrl(), "https://app.example.com");
  });
});

Deno.test("resolveSiteUrl falls back to the production site when unset or blank", () => {
  withSiteUrlEnv(undefined, () => {
    assertEquals(resolveSiteUrl(), "https://www.fflagent.com");
  });
  withSiteUrlEnv("", () => {
    assertEquals(resolveSiteUrl(), "https://www.fflagent.com");
  });
  withSiteUrlEnv("   ", () => {
    assertEquals(resolveSiteUrl(), "https://www.fflagent.com");
  });
});

Deno.test("resolveLogoUrl builds an https logo URL from the resolved site", () => {
  assertEquals(
    resolveLogoUrl("https://app.example.com"),
    "https://app.example.com/agentflow-logo-full.png",
  );
  withSiteUrlEnv(undefined, () => {
    assertEquals(resolveLogoUrl(), "https://www.fflagent.com/agentflow-logo-full.png");
    assertEquals(assertHttpsUrl(resolveLogoUrl()), resolveLogoUrl());
  });
});

// ---------------------------------------------------------------------------
// paragraph / strongText / featureRow
// ---------------------------------------------------------------------------

Deno.test("paragraph wraps pre-escaped inner HTML in a styled <p>", () => {
  const out = paragraph("Hello &amp; welcome");
  assertStringIncludes(out, "<p style=");
  assertStringIncludes(out, "Hello &amp; welcome");
  assertStringIncludes(out, "</p>");
});

Deno.test("strongText wraps a pre-escaped value in <strong>", () => {
  const out = strongText("Acme &amp; Co");
  assertStringIncludes(out, "<strong");
  assertStringIncludes(out, "Acme &amp; Co");
  assertStringIncludes(out, "</strong>");
});

Deno.test("featureRow escapes its marker, title, and description", () => {
  const out = featureRow("01", "<b>Dialer</b>", "Tom & Jerry's <script>alert(1)</script>");
  assertEquals(out.includes("<script>"), false);
  assertEquals(out.includes("<b>Dialer</b>"), false);
  assertStringIncludes(out, "&lt;b&gt;Dialer&lt;/b&gt;");
  assertStringIncludes(out, "&lt;script&gt;");
  assertStringIncludes(out, "Tom &amp; Jerry&#39;s");
  assertStringIncludes(out, ">01</td>");
});

// ---------------------------------------------------------------------------
// renderSystemEmail
// ---------------------------------------------------------------------------

const CTA_URL = "https://app.example.com/accept-invite/token-abc123";
const FALLBACK_URL = "https://app.example.com/fallback/token-abc123";

function renderFixture(overrides: Partial<SystemEmailContent> = {}): RenderedSystemEmail {
  return renderSystemEmail({
    title: "Fixture title",
    preheader: "Fixture preheader text",
    badge: "New Team Invitation",
    heading: "Join Our Agency",
    bodyHtml: paragraph("Body copy goes here."),
    bodyText: ["Body copy goes here."],
    cta: { label: "Accept Invitation →", url: CTA_URL },
    ctaNote: "This invitation expires in 7 days.",
    fallbackUrl: FALLBACK_URL,
    ...overrides,
  });
}

Deno.test("renderSystemEmail emits a hidden preheader div", () => {
  const { html } = renderFixture({ preheader: "Peek at this preview text" });
  assertStringIncludes(html, "display: none");
  assertStringIncludes(html, "mso-hide: all");
  assertStringIncludes(html, ">Peek at this preview text</div>");
});

Deno.test("renderSystemEmail escapes the heading, badge, title, and preheader", () => {
  const payload = `O'Brien & Sons <script>alert(1)</script>`;
  const { html } = renderFixture({
    title: payload,
    preheader: payload,
    badge: payload,
    heading: payload,
  });
  assertEquals(html.includes("<script>"), false);
  assertEquals(html.includes("</script>"), false);
  assertStringIncludes(html, "&lt;script&gt;alert(1)&lt;/script&gt;");
  assertStringIncludes(html, "O&#39;Brien &amp; Sons");
});

Deno.test("renderSystemEmail renders a CTA anchor whose href matches exactly", () => {
  const { html } = renderFixture();
  assertStringIncludes(html, `<a href="${CTA_URL}"`);
  assertStringIncludes(html, ">Accept Invitation →</a>");
});

Deno.test("renderSystemEmail omits CTA markup when no cta is supplied", () => {
  const { html, text } = renderFixture({ cta: undefined, fallbackUrl: undefined });
  assertEquals(html.includes(CTA_URL), false);
  assertEquals(text.includes(CTA_URL), false);
});

Deno.test("renderSystemEmail renders the raw-link fallback box", () => {
  const { html } = renderFixture();
  assertStringIncludes(html, "Button not working?");
  assertStringIncludes(html, `<a href="${FALLBACK_URL}"`);
  // The URL is also displayed as visible copy-paste text.
  assertStringIncludes(html, `>${FALLBACK_URL}</a>`);
});

Deno.test("renderSystemEmail renders the CTA note", () => {
  const { html, text } = renderFixture();
  assertStringIncludes(html, "This invitation expires in 7 days.");
  assertStringIncludes(text, "This invitation expires in 7 days.");
});

Deno.test("renderSystemEmail footer contains the current year", () => {
  const year = String(new Date().getFullYear());
  const { html, text } = renderFixture();
  assertStringIncludes(html, `&copy; ${year} AgentFlow Inc. All Rights Reserved.`);
  assertStringIncludes(html, year);
  assertStringIncludes(text, `© ${year} AgentFlow Inc. All Rights Reserved.`);
});

Deno.test("renderSystemEmail leaves no unresolved template placeholders", () => {
  const { html, text } = renderFixture();
  assertEquals(html.includes("{{"), false, "html must not contain '{{'");
  assertEquals(html.includes("}}"), false, "html must not contain '}}'");
  assertEquals(html.includes("${"), false, "html must not contain an unresolved '${'");
  assertEquals(text.includes("{{"), false, "text must not contain '{{'");
  assertEquals(text.includes("${"), false, "text must not contain an unresolved '${'");
  assertEquals(html.includes("undefined"), false, "html must not leak 'undefined'");
  assertEquals(html.includes("[object Object]"), false);
});

Deno.test("renderSystemEmail produces a non-empty text alternative with heading and CTA URL", () => {
  const { text } = renderFixture();
  assert(text.length > 0, "text part must be non-empty");
  assertStringIncludes(text, "AGENTFLOW — LIFE INSURANCE CRM & POWER DIALER");
  assertStringIncludes(text, "Join Our Agency");
  assertStringIncludes(text, "Body copy goes here.");
  assertStringIncludes(text, `Accept Invitation: ${CTA_URL}`);
  assertStringIncludes(text, FALLBACK_URL);
  // No HTML tags leak into the plain-text alternative.
  assertEquals(text.includes("<td"), false);
  assertEquals(text.includes("<p "), false);
});

Deno.test("renderSystemEmail emits a well-formed HTML document shell", () => {
  const { html } = renderFixture();
  assert(html.startsWith("<!DOCTYPE html>"));
  assertStringIncludes(html, '<html lang="en">');
  assertStringIncludes(html, '<meta charset="utf-8">');
  assertStringIncludes(html, "</html>");
  assertStringIncludes(html, "<title>Fixture title</title>");
});

Deno.test("renderSystemEmail renders escaped footer links", () => {
  const { html, text } = renderFixture({
    footerLinks: [
      { label: "Support & Help", url: "https://app.example.com/support" },
      { label: "Privacy", url: "https://app.example.com/privacy" },
    ],
  });
  assertStringIncludes(html, `<a href="https://app.example.com/support"`);
  assertStringIncludes(html, "Support &amp; Help");
  assertStringIncludes(text, "Support & Help: https://app.example.com/support");
  assertStringIncludes(text, "Privacy: https://app.example.com/privacy");
});

Deno.test("renderSystemEmail refuses non-https CTA, fallback, and footer links", () => {
  assertThrows(
    () => renderFixture({ cta: { label: "Go", url: "http://evil.example.com" } }),
    Error,
    "refusing non-https email link",
  );
  assertThrows(
    () => renderFixture({ fallbackUrl: "javascript:alert(1)" }),
    Error,
    "refusing non-https email link",
  );
  assertThrows(
    () =>
      renderFixture({
        footerLinks: [{ label: "Bad", url: "http://evil.example.com" }],
      }),
    Error,
    "refusing non-https email link",
  );
});

Deno.test("renderSystemEmail uses PUBLIC_SITE_URL for the logo", () => {
  withSiteUrlEnv("https://staging.example.com/", () => {
    const { html } = renderFixture();
    assertStringIncludes(html, `src="https://staging.example.com/agentflow-logo-full.png"`);
  });
  withSiteUrlEnv(undefined, () => {
    const { html } = renderFixture();
    assertStringIncludes(html, `src="https://www.fflagent.com/agentflow-logo-full.png"`);
  });
});

Deno.test("renderSystemEmail is deterministic for identical input", () => {
  const a = renderFixture();
  const b = renderFixture();
  assertEquals(a.html, b.html);
  assertEquals(a.text, b.text);
});
