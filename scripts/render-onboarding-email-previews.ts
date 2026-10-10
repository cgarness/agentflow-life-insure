// Renders every onboarding email to local HTML and plain-text files for review. LOCAL ONLY: no
// network, no database, no secrets, no email is sent. Uses the same templates and shared renderer
// as the worker, with a fixed first name and a visibly fake unsubscribe token.
//
// Usage (from the repository root):
//   deno run --allow-read --allow-write --allow-env scripts/render-onboarding-email-previews.ts [outDir]
// Default outDir: tmp/onboarding-email-previews (gitignored). Output: <step>.html, <step>.txt and an
// index.html that lists every email with its series, day, subject and CTA. The only varying content
// between runs is the footer year (the renderer's dynamic year, invariant #21).
import { resolveSiteUrl } from "../supabase/functions/_shared/systemEmail.ts";
import { ONBOARDING_STEPS, UNSUBSCRIBE_PAGE_PATH } from "../supabase/functions/_shared/onboardingEmail/catalog.ts";
import { ONBOARDING_EMAIL_COPY, renderOnboardingEmail } from "../supabase/functions/_shared/onboardingEmail/templates.ts";

const outDir = (Deno.args[0] ?? "tmp/onboarding-email-previews").replace(/\/+$/, "");
const siteUrl = resolveSiteUrl();
const unsubscribeUrl = `${siteUrl}${UNSUBSCRIBE_PAGE_PATH}?token=PREVIEW-TOKEN`;

await Deno.mkdir(outDir, { recursive: true });

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const rows: string[] = [];
for (const step of ONBOARDING_STEPS) {
  const rendered = renderOnboardingEmail({ stepKey: step.stepKey, firstName: "Jordan", unsubscribeUrl });
  await Deno.writeTextFile(`${outDir}/${step.stepKey}.html`, rendered.html);
  await Deno.writeTextFile(`${outDir}/${step.stepKey}.txt`, rendered.text);
  rows.push(
    `<tr><td>${step.sequenceKey === "agent" ? "Agent" : "Agency admin"}</td><td>Day ${step.dayOffset}</td>` +
      `<td><a href="${step.stepKey}.html">${escape(ONBOARDING_EMAIL_COPY[step.stepKey].subject)}</a> ` +
      `(<a href="${step.stepKey}.txt">text</a>)</td><td>${escape(siteUrl + step.ctaPath)}</td></tr>`,
  );
}

await Deno.writeTextFile(
  `${outDir}/index.html`,
  `<!doctype html><meta charset="utf-8"><title>Onboarding email previews</title>
<style>body{font:14px system-ui,sans-serif;margin:24px}td,th{padding:6px 10px;border-bottom:1px solid #ddd;text-align:left}</style>
<h1>Onboarding email previews (local only — nothing is sent)</h1>
<p>Day 0 is the existing welcome email and is not part of this series.</p>
<table><tr><th>Series</th><th>Day</th><th>Subject</th><th>CTA</th></tr>${rows.join("")}</table>`,
);

console.log(`Rendered ${ONBOARDING_STEPS.length} onboarding emails to ${outDir}/`);
