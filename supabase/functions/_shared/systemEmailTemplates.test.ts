// Unit tests for the canonical AgentFlow system-email templates.
// Offline after the first module fetch: no network, no Supabase, no fetch().
// Run: deno test --allow-env --allow-read supabase/functions/_shared/

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  RenderedSystemEmailWithSubject,
  renderAgencyGroupInviteEmail,
  renderConfirmationEmail,
  renderTeamInvitationEmail,
  renderWelcomeEmail,
} from "./systemEmailTemplates.ts";

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

const ACTION_LINK = "https://app.example.com/auth/v1/verify/token-abc123";
const INVITE_URL = "https://app.example.com/accept-invite/token-abc123";
const GROUP_INVITE_URL = "https://app.example.com/agency-groups/invite/token-abc123";

/** XSS + HTML-entity payload used across the injection tests. */
const INJECTION = `O'Brien & Sons <script>alert(1)</script>`;
/** Header-injection payload used across the CRLF tests. */
const CRLF_PAYLOAD = "Line1\r\nLine2";

function assertRenderedShape(rendered: RenderedSystemEmailWithSubject, label: string): void {
  assert(rendered.subject.length > 0, `${label}: subject must be non-empty`);
  assert(rendered.html.length > 0, `${label}: html must be non-empty`);
  assert(rendered.text.length > 0, `${label}: text must be non-empty`);
  assert(rendered.html.startsWith("<!DOCTYPE html>"), `${label}: html must be a full document`);
  assertEquals(rendered.html.includes("{{"), false, `${label}: html has an unresolved '{{'`);
  assertEquals(rendered.html.includes("${"), false, `${label}: html has an unresolved '\${'`);
  assertEquals(rendered.subject.includes("\r"), false, `${label}: subject contains CR`);
  assertEquals(rendered.subject.includes("\n"), false, `${label}: subject contains LF`);
}

function assertNoRawScript(html: string, label: string): void {
  assertEquals(html.includes("<script>"), false, `${label}: raw <script> leaked into html`);
  assertEquals(html.includes("</script>"), false, `${label}: raw </script> leaked into html`);
  assertEquals(html.includes("alert(1)</"), false, `${label}: unescaped payload leaked`);
  assertStringIncludes(html, "&lt;script&gt;");
  assertStringIncludes(html, "&lt;/script&gt;");
  assertStringIncludes(html, "O&#39;Brien &amp; Sons");
}

// ---------------------------------------------------------------------------
// renderConfirmationEmail
// ---------------------------------------------------------------------------

Deno.test("renderConfirmationEmail returns the canonical subject and full payload", () => {
  const rendered = renderConfirmationEmail({ firstName: "Chris", actionLink: ACTION_LINK });
  assertRenderedShape(rendered, "confirmation");
  assertEquals(rendered.subject, "You're almost in — confirm your AgentFlow email");
  assertStringIncludes(rendered.html, "You&#39;re almost in");
  assertStringIncludes(rendered.html, "Verify Your Email");
  assertStringIncludes(rendered.html, `<a href="${ACTION_LINK}"`);
  assertStringIncludes(rendered.html, "Hi <strong style=\"color: #0F172A;\">Chris</strong>");
  assertStringIncludes(rendered.text, "You're almost in");
  assertStringIncludes(rendered.text, ACTION_LINK);
});

Deno.test("renderConfirmationEmail falls back to 'there' for a blank first name", () => {
  for (const firstName of ["", "   "]) {
    const rendered = renderConfirmationEmail({ firstName, actionLink: ACTION_LINK });
    assertRenderedShape(rendered, "confirmation-blank");
    assertStringIncludes(rendered.html, ">there</strong>");
    assertStringIncludes(rendered.text, "Hi there —");
  }
});

// ---------------------------------------------------------------------------
// renderTeamInvitationEmail
// ---------------------------------------------------------------------------

Deno.test("renderTeamInvitationEmail subject includes the organization when present", () => {
  const rendered = renderTeamInvitationEmail({
    firstName: "Dana",
    role: "Team Leader",
    organizationName: "Summit Financial",
    inviteUrl: INVITE_URL,
  });
  assertRenderedShape(rendered, "team-invite-with-org");
  assertEquals(
    rendered.subject,
    "You've been invited to join Summit Financial on AgentFlow",
  );
  assertStringIncludes(rendered.html, "Join Summit Financial");
  assertStringIncludes(rendered.html, "New Team Invitation");
  assertStringIncludes(rendered.html, `<a href="${INVITE_URL}"`);
  assertStringIncludes(rendered.html, "Team Leader");
  assertStringIncludes(rendered.text, INVITE_URL);
});

Deno.test("renderTeamInvitationEmail subject omits the organization when null or empty", () => {
  for (const organizationName of [null, "", "   "]) {
    const rendered = renderTeamInvitationEmail({
      firstName: "Dana",
      role: "Agent",
      organizationName,
      inviteUrl: INVITE_URL,
    });
    assertRenderedShape(rendered, `team-invite-no-org(${JSON.stringify(organizationName)})`);
    assertEquals(rendered.subject, "You've been invited to join AgentFlow");
    assertStringIncludes(rendered.html, "Join Our Agency");
    assertStringIncludes(rendered.html, "our agency");
  }
});

Deno.test("renderTeamInvitationEmail defaults a blank name and role", () => {
  const rendered = renderTeamInvitationEmail({
    firstName: "",
    role: "",
    organizationName: "Summit Financial",
    inviteUrl: INVITE_URL,
  });
  assertRenderedShape(rendered, "team-invite-defaults");
  assertStringIncludes(rendered.html, ">there</strong>");
  assertStringIncludes(rendered.html, ">Agent</strong>");
});

// ---------------------------------------------------------------------------
// renderWelcomeEmail
// ---------------------------------------------------------------------------

Deno.test("renderWelcomeEmail returns the canonical subject and feature rows", () => {
  withSiteUrlEnv("https://app.example.com", () => {
    const rendered = renderWelcomeEmail({ firstName: "Chris" });
    assertRenderedShape(rendered, "welcome");
    assertEquals(rendered.subject, "Welcome to AgentFlow — You're all set");
    assertStringIncludes(rendered.html, "Welcome to AgentFlow, Chris!");
    assertStringIncludes(rendered.html, "Power Dialer");
    assertStringIncludes(rendered.html, "Lead Management");
    assertStringIncludes(rendered.html, "Team Insights");
    assertStringIncludes(rendered.html, `<a href="https://app.example.com/dashboard"`);
    assertStringIncludes(rendered.text, "Go to Dashboard: https://app.example.com/dashboard");
    // /support, /privacy and /terms are NOT routes in the app — linking them
    // would send every new user to the NotFound page. Keep them out until the
    // routes exist.
    assertEquals(rendered.html.includes("/support"), false);
    assertEquals(rendered.html.includes("/privacy"), false);
    assertEquals(rendered.html.includes("/terms"), false);
  });
});

Deno.test("renderWelcomeEmail falls back to 'there' and the production site URL", () => {
  withSiteUrlEnv(undefined, () => {
    const rendered = renderWelcomeEmail({ firstName: "   " });
    assertRenderedShape(rendered, "welcome-defaults");
    assertStringIncludes(rendered.html, "Welcome to AgentFlow, there!");
    assertStringIncludes(rendered.html, `<a href="https://www.fflagent.com/dashboard"`);
  });
});

// ---------------------------------------------------------------------------
// renderAgencyGroupInviteEmail
// ---------------------------------------------------------------------------

Deno.test("renderAgencyGroupInviteEmail returns the canonical subject and payload", () => {
  const rendered = renderAgencyGroupInviteEmail({
    masterOrgName: "Summit Financial",
    groupName: "Q4 Leaderboard",
    inviteUrl: GROUP_INVITE_URL,
  });
  assertRenderedShape(rendered, "agency-group-invite");
  assertEquals(
    rendered.subject,
    "You've been invited to join Summit Financial's Agency Group on AgentFlow",
  );
  assertStringIncludes(rendered.html, "Agency Group Invitation");
  assertStringIncludes(rendered.html, "You&#39;re invited to an Agency Group");
  assertStringIncludes(rendered.html, "Q4 Leaderboard");
  assertStringIncludes(rendered.html, `<a href="${GROUP_INVITE_URL}"`);
  assertStringIncludes(rendered.text, GROUP_INVITE_URL);
});

Deno.test("renderAgencyGroupInviteEmail defaults a blank master org and group name", () => {
  const rendered = renderAgencyGroupInviteEmail({
    masterOrgName: null,
    groupName: "",
    inviteUrl: GROUP_INVITE_URL,
  });
  assertRenderedShape(rendered, "agency-group-invite-defaults");
  assertEquals(
    rendered.subject,
    "You've been invited to join An AgentFlow agency's Agency Group on AgentFlow",
  );
  assertStringIncludes(rendered.html, "their Agency Group");
});

// ---------------------------------------------------------------------------
// Injection: HTML/XSS
// ---------------------------------------------------------------------------

Deno.test("renderConfirmationEmail escapes an XSS payload in firstName", () => {
  const rendered = renderConfirmationEmail({
    firstName: INJECTION,
    actionLink: ACTION_LINK,
  });
  assertRenderedShape(rendered, "confirmation-injection");
  assertNoRawScript(rendered.html, "confirmation-injection");
});

Deno.test("renderTeamInvitationEmail escapes XSS payloads in name, role, and org", () => {
  const rendered = renderTeamInvitationEmail({
    firstName: INJECTION,
    role: INJECTION,
    organizationName: INJECTION,
    inviteUrl: INVITE_URL,
  });
  assertRenderedShape(rendered, "team-invite-injection");
  assertNoRawScript(rendered.html, "team-invite-injection");
  // Subject is header-sanitized but intentionally NOT html-escaped.
  assertStringIncludes(rendered.subject, "O'Brien & Sons");
});

Deno.test("renderWelcomeEmail escapes an XSS payload in firstName", () => {
  withSiteUrlEnv(undefined, () => {
    const rendered = renderWelcomeEmail({ firstName: INJECTION });
    assertRenderedShape(rendered, "welcome-injection");
    assertNoRawScript(rendered.html, "welcome-injection");
  });
});

Deno.test("renderAgencyGroupInviteEmail escapes XSS payloads in org and group name", () => {
  const rendered = renderAgencyGroupInviteEmail({
    masterOrgName: INJECTION,
    groupName: INJECTION,
    inviteUrl: GROUP_INVITE_URL,
  });
  assertRenderedShape(rendered, "agency-group-injection");
  assertNoRawScript(rendered.html, "agency-group-injection");
});

// ---------------------------------------------------------------------------
// Injection: CRLF header smuggling
// ---------------------------------------------------------------------------

Deno.test("renderTeamInvitationEmail strips CRLF from the subject", () => {
  const rendered = renderTeamInvitationEmail({
    firstName: CRLF_PAYLOAD,
    role: CRLF_PAYLOAD,
    organizationName: CRLF_PAYLOAD,
    inviteUrl: INVITE_URL,
  });
  assertRenderedShape(rendered, "team-invite-crlf");
  assertEquals(rendered.subject, "You've been invited to join Line1 Line2 on AgentFlow");
});

Deno.test("renderAgencyGroupInviteEmail strips CRLF from the subject and preheader", () => {
  const rendered = renderAgencyGroupInviteEmail({
    masterOrgName: CRLF_PAYLOAD,
    groupName: CRLF_PAYLOAD,
    inviteUrl: GROUP_INVITE_URL,
  });
  assertRenderedShape(rendered, "agency-group-crlf");
  assertEquals(
    rendered.subject,
    "You've been invited to join Line1 Line2's Agency Group on AgentFlow",
  );
});

Deno.test("fixed-subject templates never emit CRLF even with hostile input", () => {
  const confirmation = renderConfirmationEmail({
    firstName: CRLF_PAYLOAD,
    actionLink: ACTION_LINK,
  });
  assertRenderedShape(confirmation, "confirmation-crlf");
  assertEquals(confirmation.subject, "You're almost in — confirm your AgentFlow email");

  withSiteUrlEnv(undefined, () => {
    const welcome = renderWelcomeEmail({ firstName: CRLF_PAYLOAD });
    assertRenderedShape(welcome, "welcome-crlf");
    assertEquals(welcome.subject, "Welcome to AgentFlow — You're all set");
  });
});

// ---------------------------------------------------------------------------
// Invitation parity: initial send and resend share ONE renderer
// ---------------------------------------------------------------------------

Deno.test("renderTeamInvitationEmail is byte-identical for identical arguments", () => {
  const args = {
    firstName: "Dana",
    role: "Agent",
    organizationName: "Summit Financial",
    inviteUrl: INVITE_URL,
  };
  const first = renderTeamInvitationEmail({ ...args });
  const resend = renderTeamInvitationEmail({ ...args });
  assertEquals(first.subject, resend.subject);
  assertEquals(first.html, resend.html);
  assertEquals(first.text, resend.text);
});

Deno.test(
  "invite-user and send-invite-email both call the shared team-invitation renderer",
  async () => {
    const inviteUserSource = await Deno.readTextFile(
      new URL("../invite-user/index.ts", import.meta.url),
    );
    const sendInviteEmailSource = await Deno.readTextFile(
      new URL("../send-invite-email/index.ts", import.meta.url),
    );

    for (
      const [label, source] of [
        ["invite-user", inviteUserSource],
        ["send-invite-email", sendInviteEmailSource],
      ] as const
    ) {
      assert(source.length > 0, `${label}: source must be readable`);
      assertStringIncludes(source, "renderTeamInvitationEmail");
      assertStringIncludes(source, "_shared/systemEmailTemplates.ts");
      assertEquals(
        source.includes("buildEmailHtml"),
        false,
        `${label}: still contains a local buildEmailHtml renderer`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Regression: text/plain injection (adversarial review, 2026-07-30)
// ---------------------------------------------------------------------------

Deno.test(
  "the text/plain part cannot be forged with caller-supplied newlines",
  () => {
    const forged =
      "there,\n\nACTION REQUIRED: re-verify your account at https://evil.example\n";

    const invite = renderTeamInvitationEmail({
      firstName: forged,
      role: forged,
      organizationName: forged,
      inviteUrl: "https://www.fflagent.com/accept-invite?token=T",
    });
    const confirmation = renderConfirmationEmail({
      firstName: forged,
      actionLink: "https://www.fflagent.com/verify?token=T",
    });
    const welcome = renderWelcomeEmail({ firstName: forged });
    const group = renderAgencyGroupInviteEmail({
      masterOrgName: forged,
      groupName: forged,
      inviteUrl: "https://www.fflagent.com/accept-group-invite?token=T",
    });

    for (
      const [label, rendered] of [
        ["invitation", invite],
        ["confirmation", confirmation],
        ["welcome", welcome],
        ["agency-group", group],
      ] as const
    ) {
      // The attacker's line must never appear as its own line of "AgentFlow"
      // copy in the plain-text body.
      assertEquals(
        rendered.text.split("\n").some((line) =>
          line.trim().startsWith("ACTION REQUIRED")
        ),
        false,
        `${label}: forged line survived into the text part`,
      );
      assertEquals(
        /[\r\n]/.test(rendered.subject),
        false,
        `${label}: subject contains a raw newline`,
      );
    }
  },
);
