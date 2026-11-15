// Real-screen negative controls for the synthetic number-preview contract.
// No send button is forced/enabled, no application hook is replaced, no provider traffic.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.SMS_PLAYWRIGHT_MODULE).href);
const base = process.env.SMS_FIXTURE_URL || "http://127.0.0.1:4189";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error("Loopback fixture required");
const out = process.env.SMS_RESPONSIVENESS_OUT || "/tmp/sms-responsiveness-evidence";
await mkdir(out, { recursive: true });
const checks = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const surface of ["conversations", "contact"]) {
    for (const scenario of ["error", "blocked", "ready"]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => route.request().url().startsWith(base + "/") ? route.continue() : route.abort());
      await page.goto(`${base}/?surface=${surface}&affinity=${scenario}`, { waitUntil: "networkidle" });
      if (surface === "conversations") await page.getByText("Jordan Rivera").first().click();
      await page.locator('textarea[placeholder="Type SMS message…"]').fill("Synthetic readiness control");
      const send = page.locator('button[title="Send SMS"]');
      if (scenario === "ready") {
        await page.getByText("Ready · checked again when sending", { exact: true }).first().waitFor();
        await send.click({ trial: true, timeout: 3000 });
        assert.equal(await send.isEnabled(), true, `${surface}: valid preview enables ordinary send`);
      } else {
        if (scenario === "error") await page.getByRole("alert").filter({ hasText: "Numbers unavailable" }).first().waitFor();
        else await page.getByText("Texting setup required", { exact: true }).first().waitFor();
        assert.equal(await send.isDisabled(), true, `${surface}: ${scenario} must block Send`);
      }
      assert.equal(await page.evaluate(() => window.__smsFixtureTransport.requestCount()), 0, "Preview/trial never dispatches");
      assert.deepEqual(errors, [], "No unhandled application errors");
      checks.push({ surface, scenario, passed: true });
      await page.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(`${out}/number-preview-checks.json`, JSON.stringify(checks, null, 2) + "\n");
}
console.log(`Number preview controls: ${checks.length}/6 passed; inaccessible/unready sends remain blocked.`);
