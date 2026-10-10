// Run: deno test --allow-read --allow-env supabase/functions/_shared/onboardingEmail/
import assert from "node:assert/strict";
import { ONBOARDING_STEPS, SEQUENCE_LENGTH } from "./catalog.ts";
import { displayFirstName, ONBOARDING_EMAIL_COPY, renderOnboardingEmail } from "./templates.ts";

const SITE = "https://www.fflagent.com";
const UNSUB = `${SITE}/email/unsubscribe?token=v1.payload.signature`;
const COPY_DOC = new URL("../../../../docs/plans/2026-10-10-onboarding-emails/email-copy.md", import.meta.url);
const YEAR = new Date().getFullYear();

function render(stepKey: string, firstName: string | null = "Jordan", unsubscribeUrl = UNSUB) {
  return renderOnboardingEmail({ stepKey, firstName, unsubscribeUrl });
}

Deno.test("templates: every step has complete copy and three steps", () => {
  assert.deepEqual(Object.keys(ONBOARDING_EMAIL_COPY).sort(), ONBOARDING_STEPS.map((s) => s.stepKey).sort());
  for (const [key, copy] of Object.entries(ONBOARDING_EMAIL_COPY)) {
    for (const field of ["subject", "preheader", "heading", "intro", "why", "ctaLabel", "ctaNote"] as const) {
      assert.ok(copy[field].trim().length > 0, `${key}.${field} is empty`);
    }
    assert.equal(copy.steps.length, 3, `${key} must have three steps`);
    assert.ok(copy.subject.length <= 70, `${key} subject is too long for most inboxes`);
  }
});

Deno.test("templates: badge, one https CTA to the verified page, unsubscribe and privacy links", () => {
  for (const step of ONBOARDING_STEPS) {
    const r = render(step.stepKey);
    const label = step.sequenceKey === "agent" ? "New Agent Tips" : "Agency Setup";
    assert.ok(r.html.includes(`${label} · ${step.position} of ${SEQUENCE_LENGTH[step.sequenceKey]}`), `${step.stepKey} badge`);
    const ctaUrl = `${SITE}${step.ctaPath}`;
    assert.ok(r.html.includes(`href="${ctaUrl}"`), `${step.stepKey} CTA href`);
    assert.ok(r.text.includes(`: ${ctaUrl}`), `${step.stepKey} CTA in text`);
    assert.ok(r.html.includes(`href="${UNSUB}"`) && r.text.includes(`Unsubscribe from onboarding tips: ${UNSUB}`), `${step.stepKey} unsubscribe`);
    assert.ok(r.html.includes(`href="${SITE}/privacy"`), `${step.stepKey} privacy link`);
    const hrefs = [...r.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length >= 3 && hrefs.every((h) => h.startsWith("https://www.fflagent.com/")), `${step.stepKey} links: ${hrefs}`);
  }
});

Deno.test("templates: shared shell rules (invariant #21) and no forbidden patterns", () => {
  for (const step of ONBOARDING_STEPS) {
    const r = render(step.stepKey);
    assert.ok(r.html.includes("/agentflow-logo-email-v2.png"), "email-only logo");
    assert.ok(r.html.includes(`&copy; ${YEAR} AgentFlow Inc.`), "dynamic year");
    assert.ok(r.text.startsWith("AGENTFLOW — LIFE INSURANCE CRM & POWER DIALER"), "plain-text part");
    for (const forbidden of ["backdrop-filter", "background-clip", "lovable", "vercel.app", "agentflow.app", "<script"]) {
      assert.ok(!r.html.toLowerCase().includes(forbidden), `${step.stepKey} contains ${forbidden}`);
    }
  }
});

Deno.test("templates: the first name is escaped, single-line, bounded, with a fallback", () => {
  const hostile = '<img src=x onerror=alert(1)>"\r\nBcc: victim@example.test';
  const r = render("agent_day01_dialer_ready", hostile);
  assert.ok(!r.html.includes("<img src=x"), "raw markup must not reach the HTML");
  assert.ok(r.html.includes("&lt;img src=x onerror=alert(1)&gt;&quot;"), "markup is escaped");
  assert.ok(!r.text.includes("\r") && !/\nBcc:/.test(r.text), "no header-like line injected into text");
  assert.ok(!r.subject.includes(hostile), "subject never carries the name");
  assert.equal(displayFirstName(null), "there");
  assert.equal(displayFirstName("   "), "there");
  assert.equal(displayFirstName("x".repeat(500)).length, 60);
  assert.ok(render("agent_day01_dialer_ready", null).text.includes("Hi there, "));
});

Deno.test("templates: rejects an unknown step and a non-https unsubscribe URL", () => {
  assert.throws(() => render("agent_day99_nope"));
  assert.throws(() => render("agent_day01_dialer_ready", "Jordan", "http://www.fflagent.com/email/unsubscribe"));
});

Deno.test("templates: rendered copy equals the reviewed email-copy.md", async () => {
  const doc = await Deno.readTextFile(COPY_DOC);
  const normalizeYear = (s: string) => s.replace(/© \d{4} AgentFlow/g, "© YEAR AgentFlow");
  for (const step of ONBOARDING_STEPS) {
    const copy = ONBOARDING_EMAIL_COPY[step.stepKey];
    assert.ok(doc.includes(`**Subject:** ${copy.subject}`), `${step.stepKey} subject differs from the reviewed copy`);
    assert.ok(doc.includes(`**Preheader:** ${copy.preheader}`), `${step.stepKey} preheader differs`);
    assert.ok(doc.includes(`→” → \`${SITE}${step.ctaPath}\``), `${step.stepKey} CTA differs`);
    const text = render(step.stepKey, "Jordan", `${SITE}/email/unsubscribe?token=<signed>`).text;
    assert.ok(normalizeYear(doc).includes(normalizeYear(text)), `${step.stepKey} plain text differs from email-copy.md`);
  }
});
