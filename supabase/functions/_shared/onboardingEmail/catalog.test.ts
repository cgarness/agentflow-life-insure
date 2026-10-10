// Run: deno test --allow-read --allow-env supabase/functions/_shared/onboardingEmail/
import assert from "node:assert/strict";
import {
  findStep,
  ONBOARDING_STEPS,
  SEQUENCE_LENGTH,
  sequenceForRole,
  UNSUBSCRIBE_PAGE_PATH,
  VERIFIED_CTA_PATHS,
} from "./catalog.ts";

const ROOT = new URL("../../../../", import.meta.url);
const MIGRATION = new URL("supabase/migrations/pending/20261011120000_onboarding_email_foundation.sql", ROOT);

Deno.test("catalog: nine steps, agent Day 1/3/5/8/14 and admin Day 2/4/7/12, no Day 0", () => {
  assert.equal(ONBOARDING_STEPS.length, 9);
  const days = (seq: string) => ONBOARDING_STEPS.filter((s) => s.sequenceKey === seq).map((s) => s.dayOffset);
  assert.deepEqual(days("agent"), [1, 3, 5, 8, 14]);
  assert.deepEqual(days("agency_admin"), [2, 4, 7, 12]);
  assert.equal(SEQUENCE_LENGTH.agent, 5);
  assert.equal(SEQUENCE_LENGTH.agency_admin, 4);
  assert.ok(ONBOARDING_STEPS.every((s) => s.dayOffset > 0), "Day 0 is the existing welcome email, never a step");
  assert.equal(new Set(ONBOARDING_STEPS.map((s) => s.stepKey)).size, 9);
  assert.equal(findStep("agent_day08_numbers")?.ctaPath, "/settings?section=my-profile");
  assert.equal(findStep("nope"), null);
});

Deno.test("catalog: step timing equals the SQL seed (parity)", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  const seeded = [...sql.matchAll(/\('([a-z0-9_]+)',\s*'(agent|agency_admin)',\s*(\d+),\s*(\d+)\)/g)]
    .map((m) => `${m[1]}|${m[2]}|${m[3]}|${m[4]}`).sort();
  const catalog = ONBOARDING_STEPS.map((s) => `${s.stepKey}|${s.sequenceKey}|${s.dayOffset}|${s.position}`).sort();
  assert.deepEqual(seeded, catalog);
});

Deno.test("catalog: role mapping mirrors onboarding_email_enroll_due", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  assert.ok(sql.includes("CASE WHEN p.role = 'Admin' THEN 'agency_admin' ELSE 'agent' END"));
  assert.ok(sql.includes("AND p.role IN ('Agent', 'Team Leader', 'Admin')"));
  assert.ok(sql.includes("AND coalesce(p.is_super_admin, false) = false"));
  assert.equal(sequenceForRole("Admin", false), "agency_admin");
  assert.equal(sequenceForRole("Agent", false), "agent");
  assert.equal(sequenceForRole("Team Leader", false), "agent");
  assert.equal(sequenceForRole("Super Admin", false), null);
  assert.equal(sequenceForRole("Admin", true), null);
  assert.equal(sequenceForRole("Agent", true), null);
  assert.equal(sequenceForRole(null, false), null);
  assert.equal(sequenceForRole("Team Lead", false), null);
});

Deno.test("catalog: every CTA path is verified and exists in the app's routes and settings", async () => {
  const app = await Deno.readTextFile(new URL("src/App.tsx", ROOT));
  const settings = await Deno.readTextFile(new URL("src/config/settingsConfig.ts", ROOT));
  for (const step of ONBOARDING_STEPS) {
    assert.ok(VERIFIED_CTA_PATHS.has(step.ctaPath), `${step.stepKey} CTA ${step.ctaPath} is not verified`);
  }
  for (const path of VERIFIED_CTA_PATHS) {
    const [route, query] = path.split("?");
    assert.ok(app.includes(`path="${route}"`), `route ${route} missing from src/App.tsx`);
    if (query) {
      const slug = new URLSearchParams(query).get("section");
      assert.ok(slug && settings.includes(`slug: "${slug}"`), `settings section ${slug} missing`);
    }
  }
  assert.ok(app.includes(`path="${UNSUBSCRIBE_PAGE_PATH}"`), "unsubscribe page route missing from src/App.tsx");
  assert.ok(app.includes('path="/privacy"'), "privacy route missing");
});
