// Reproducible Reports CSV capture for an exact-base byte comparison (local synthetic fixture, real Chromium).
//
// It drives the isolated Reports fixture (scripts/tests/reports-visual) with a pinned clock and timezone, downloads
// every export control in every view-toggle and grouping combination present in each scope (Agency, Team,
// Personal), and writes a manifest of raw SHA-256 digests. Run it against a base and a candidate server on separate
// ports, then compare the two manifests with compare-csv-captures.mjs. Nothing is normalized: with the clock pinned,
// the "Generated" row is identical too, so the comparison is byte-for-byte.
//
//   PLAYWRIGHT_MODULE=/path/node_modules/playwright REPORTS_CAPTURE_URL=http://127.0.0.1:4181 \
//   REPORTS_CAPTURE_OUTPUT=/tmp/capture-base node csv-capture.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const url = process.env.REPORTS_CAPTURE_URL;
assert.ok(url, 'REPORTS_CAPTURE_URL is required (the fixture server to capture)');
const target = new URL(url);
assert.equal(target.hostname, '127.0.0.1', 'Only a loopback fixture server is allowed');
const output = process.env.REPORTS_CAPTURE_OUTPUT;
assert.ok(output, 'REPORTS_CAPTURE_OUTPUT is required');
const FIXED_CLOCK = new Date(process.env.REPORTS_CAPTURE_CLOCK || '2026-10-09T04:00:00Z');
const PACE_MS = Number(process.env.REPORTS_CAPTURE_PACE_MS || 1100);
await mkdir(`${output}/csv`, { recursive: true });

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const context = await browser.newContext({ acceptDownloads: true, timezoneId: 'America/Los_Angeles', viewport: { width: 1440, height: 1000 } });
const external = [];
await context.route('**/*', route => {
  const resource = new URL(route.request().url());
  if (['http:', 'https:'].includes(resource.protocol) && resource.origin !== target.origin) { external.push(resource.origin); return route.abort(); }
  return route.continue();
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.clock.setFixedTime(FIXED_CLOCK);

const ready = async () => {
  await page.getByTestId('report-as-of').waitFor();
  await page.getByRole('button', { name: 'Export', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-report-state="loading"]'));
};

async function selectSqlWindow() {
  await page.waitForFunction(() => document.querySelector('button[aria-label="Customize layout"]')?.disabled === false);
  await page.getByRole('combobox', { name: 'Report period', exact: true }).click();
  await page.getByRole('option', { name: 'Custom range', exact: true }).click();
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  for (const label of ['Start Date', 'End Date']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    const caption = page.locator('[id^="react-day-picker-"][aria-live="polite"]');
    const month = new Date(`${await caption.innerText()} 1`);
    const steps = (2026 - month.getFullYear()) * 12 + 9 - month.getMonth();
    for (let step = 0; step < Math.abs(steps); step++) {
      await page.getByRole('button', { name: steps < 0 ? 'Go to previous month' : 'Go to next month', exact: true }).click();
    }
    await page.getByText('October 2026', { exact: true }).waitFor();
    await page.getByRole('grid').getByRole('gridcell', { name: '1', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('grid').waitFor({ state: 'hidden' });
  }
  await ready();
}

/** The option labels of a segmented control (role=group of aria-pressed buttons). */
const optionsOf = group => group.locator('button[aria-pressed]').allInnerTexts().then(texts => texts.map(t => t.trim()));
async function choose(group, option) {
  const button = group.locator('button[aria-pressed]').filter({ hasText: option }).first();
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await page.waitForFunction(() => !document.querySelector('[data-report-state="loading"]'));
}
function* product(lists) {
  if (!lists.length) { yield []; return; }
  const [first, ...rest] = lists;
  for (const value of first) for (const tail of product(rest)) yield [value, ...tail];
}

const manifest = [];
async function download(button, key) {
  await page.waitForTimeout(PACE_MS); // back-to-back downloads stall in Chromium; pace like the historical capture
  const pending = page.waitForEvent('download');
  await button.click();
  const file = await pending;
  assert.equal(await file.failure(), null);
  const name = `${key.replace(/[^A-Za-z0-9_.=-]+/g, '_')}__${file.suggestedFilename()}`;
  const path = `${output}/csv/${name}`;
  await file.saveAs(path);
  const bytes = await readFile(path);
  manifest.push({ key, suggestedFilename: file.suggestedFilename(), saved: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}

try {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Reports', exact: true }).waitFor();
  await selectSqlWindow();
  const scopes = await page.getByRole('tab').filter({ hasText: /^(Personal|Team|Agency)$/ }).allInnerTexts();
  for (const scope of ['Agency', 'Team', 'Personal']) {
    if (!scopes.map(s => s.trim()).includes(scope)) { manifest.push({ key: `${scope}`, unavailable: 'scope tab not offered' }); continue; }
    await page.getByRole('tab', { name: scope, exact: true }).click();
    await ready();
    // Expand collapsed panels so every export control is present (their export buttons stay in the header anyway).
    const collapsed = await page.locator('[data-reports-workspace] section h3 > button[aria-expanded="false"]').evaluateAll(n => n.map(e => e.id));
    for (const id of collapsed) await page.locator(`[id="${id}"]`).click();
    await download(page.getByRole('button', { name: 'Export', exact: true }), `${scope}|summary`);
    const trendsGroup = page.getByRole('group', { name: 'Group trends by', exact: true });
    const sectionIds = await page.locator('[data-report-section]').evaluateAll(n => n.map(e => e.getAttribute('data-report-section')));
    for (const id of sectionIds) {
      const section = page.locator(`[data-report-section="${id}"]`);
      const exportButtons = await section.getByRole('button', { name: /^Export .+ CSV$/ }).all();
      if (!exportButtons.length) continue;
      const groups = [];
      if (id === 'policies_sold' || id === 'call_volume') groups.push({ name: 'Group trends by', locator: trendsGroup });
      for (const label of await section.getByRole('group').evaluateAll(n => n.map(e => e.getAttribute('aria-label')).filter(Boolean))) {
        groups.push({ name: label, locator: section.getByRole('group', { name: label, exact: true }) });
      }
      const optionLists = [];
      for (const g of groups) optionLists.push(await optionsOf(g.locator));
      for (const combo of product(optionLists)) {
        for (let i = 0; i < groups.length; i++) await choose(groups[i].locator, combo[i]);
        for (const button of await section.getByRole('button', { name: /^Export .+ CSV$/ }).all()) {
          const label = await button.getAttribute('aria-label');
          const comboKey = groups.map((g, i) => `${g.name}=${combo[i]}`).join(',');
          if (!await button.isEnabled()) { manifest.push({ key: `${scope}|${id}|${label}|${comboKey}`, unavailable: 'export disabled' }); continue; }
          await download(button, `${scope}|${id}|${label}|${comboKey}`);
        }
      }
      // Restore each control to its first option so later sections start from the same state.
      for (let i = 0; i < groups.length; i++) await choose(groups[i].locator, optionLists[i][0]);
    }
  }
  assert.deepEqual(external, [], 'no external requests');
  await writeFile(`${output}/manifest.json`, JSON.stringify({ url, fixedClock: FIXED_CLOCK.toISOString(), paceMs: PACE_MS, timezone: 'America/Los_Angeles', errors, entries: manifest }, null, 1));
  const downloaded = manifest.filter(e => e.sha256);
  console.log(`PASS captured ${downloaded.length} CSV downloads (${manifest.length - downloaded.length} unavailable entries) from ${url}`);
} finally {
  await browser.close();
}
