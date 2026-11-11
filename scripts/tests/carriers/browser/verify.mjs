import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// CI prerequisites (install outside the checkout; no package/lockfile changes):
// npm install --prefix /tmp/carrier-playwright --no-save --package-lock=false playwright@1.56.1
// node /tmp/carrier-playwright/node_modules/playwright/cli.js install --with-deps chromium
// PLAYWRIGHT_MODULE=/tmp/carrier-playwright/node_modules/playwright/index.mjs \
//   CARRIER_SCREENSHOTS=/tmp/carrier-browser-checks node scripts/tests/carriers/browser/verify.mjs
// PLAYWRIGHT_CHROMIUM_EXECUTABLE optionally selects an already installed Chromium.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const origin = 'http://127.0.0.1:4188';
const screenshots = path.resolve(process.env.CARRIER_SCREENSHOTS || path.join(os.tmpdir(), 'carrier-browser-checks'));
assert.ok(screenshots !== root && !screenshots.startsWith(`${root}${path.sep}`), 'Keep browser artifacts outside the git checkout');
await fs.mkdir(screenshots, { recursive: true });
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--config', path.join(here, 'vite.config.mjs')], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '', serverFailure, browser, page;
server.stdout.on('data', (chunk) => { output = (output + String(chunk)).slice(-8192); });
server.stderr.on('data', (chunk) => { output = (output + String(chunk)).slice(-8192); });
server.on('error', (error) => { serverFailure = error.message; });
server.on('exit', (code, signal) => { serverFailure = `Fixture server exited ${code ?? signal}`; });
process.on('exit', () => server.kill());
const checks = [], errors = [], blocked = [], captures = [];

try {
  const deadline = Date.now() + 20_000;
  let ready = false;
  while (Date.now() < deadline && !serverFailure) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000), redirect: 'error' });
      ready = response.ok && (await response.text()).includes('<title>Carriers · synthetic verification</title>');
      if (ready) break;
    } catch { /* Wait for the loopback-only fixture server. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready && !serverFailure, `Fixture server failed: ${serverFailure || output}`);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.protocol === 'http:') return route.continue();
    blocked.push(url.href);
    return route.abort('blockedbyclient');
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (error) => errors.push(error.message));
  const goto = (pathname) => {
    assert.ok(pathname.startsWith('/') && !pathname.startsWith('//'));
    return page.goto(`${origin}${pathname}`);
  };
  const atlas = () => page.getByRole('button', { name: 'Atlas Example Life', exact: true });
  const beacon = () => page.getByRole('button', { name: 'Beacon Example Life', exact: true });
  const settleCard = async (trigger) => {
    const contentId = await trigger.getAttribute('aria-controls');
    assert.ok(contentId, 'Carrier button controls its content panel');
    await page.locator(`[id="${contentId}"]`).evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
    });
  };
  const openCard = async (trigger) => { await trigger.click(); await settleCard(trigger); };
  const carrierReads = () => page.evaluate(() => window.carrierFixture.events.filter((event) => event.table === 'carriers' && event.operation === 'select').length);
  const noOverflow = async (label) => {
    const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(sizes.document <= sizes.viewport + 1, `${label}: document overflow ${JSON.stringify(sizes)}`);
    for (const dialog of await page.getByRole('dialog').all()) {
      assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), `${label}: dialog overflow`);
    }
  };
  const capture = async (name) => {
    if (await page.getByRole('dialog').count() === 0) await page.evaluate(() => window.scrollTo(0, 0));
    await noOverflow(name);
    await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true });
    captures.push(name);
  };
  const record = (name) => { checks.push(name); console.log(`PASS: ${name}`); };

  await goto('/carriers');
  await atlas().waitFor();
  assert.equal(await page.locator('button[aria-expanded="true"]').count(), 0, 'All cards begin closed');
  await atlas().focus();
  await page.keyboard.press('Enter');
  await settleCard(atlas());
  assert.equal(await atlas().getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('ArrowDown');
  assert.equal(await beacon().evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('Space');
  await settleCard(beacon());
  assert.equal(await beacon().getAttribute('aria-expanded'), 'true');
  assert.equal(await atlas().getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('button[aria-expanded="true"]').count(), 1);
  await page.keyboard.press('Space');
  assert.equal(await beacon().getAttribute('aria-expanded'), 'false');
  await openCard(atlas());
  record('Native Enter/Space and Radix arrow navigation; exactly one card open');

  const quick = page.getByRole('region', { name: 'Quick links', exact: true });
  const guides = page.getByRole('region', { name: 'Guides & training', exact: true });
  assert.deepEqual(await quick.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href'))), [
    'https://atlas.example/agent', 'https://atlas.example/apply', 'https://atlas.example/cases',
  ]);
  assert.deepEqual(await guides.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href'))), [
    'https://atlas.example/guide.pdf', 'https://atlas.example/training',
  ]);
  for (const link of await page.locator('main a[target="_blank"]').all()) {
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    assert.ok((await link.getAttribute('aria-label') || await link.textContent()).includes('opens in a new tab'));
  }
  assert.equal(await page.getByText('Duplicate portal', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: '+1 (800) 555-0100 ext. 12', exact: true }).getAttribute('href'), 'tel:+18005550100;ext=12');
  await page.getByRole('button', { name: 'Copy Agent support phone number', exact: true }).click();
  await page.getByText('Phone number copied.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '+1 (800) 555-0100 ext. 12');
  record('Exact resource groups, canonical portal, safe new-tab attributes, native contacts and actual clipboard');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const contentId = await atlas().getAttribute('aria-controls');
  assert.equal(await page.locator(`[id="${contentId}"]`).evaluate((element) => getComputedStyle(element).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await settleCard(atlas());
  for (const [size, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }], ['compact', { width: 320, height: 740 }]]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
      await capture(`${size}-${theme}-directory`);
    }
  }
  record('1440px, 390px and 320px layouts in light/dark, long names/contacts, no horizontal overflow, reduced motion');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.getByRole('searchbox', { name: 'Search carriers' }).fill('  ATLAS  ');
  assert.equal(await atlas().getAttribute('aria-expanded'), 'false');
  assert.equal(await beacon().count(), 0);
  await page.getByRole('searchbox', { name: 'Search carriers' }).fill('underwriting');
  await page.getByText('No carriers found', { exact: true }).waitFor();
  await page.getByRole('searchbox', { name: 'Search carriers' }).fill('');
  await openCard(beacon());
  await page.getByText('No resources added yet.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: 'Quick links', exact: true }).count(), 0);
  record('Name-only case-insensitive search, collapsed filtering and carrier empty state');

  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Atlas Example Life', exact: true }).click();
  const editor = page.getByRole('group', { name: 'Carrier resource links', exact: true });
  const labels = () => editor.getByRole('textbox', { name: 'Label', exact: true });
  await editor.getByRole('button', { name: 'Add link', exact: true }).click();
  await labels().last().fill('Underwriting FAQ');
  await editor.getByRole('textbox', { name: 'URL', exact: true }).last().fill('https://atlas.example/faq');
  await editor.getByRole('combobox', { name: 'Group', exact: true }).last().selectOption('guides_training');
  for (const row of [6, 5, 4]) await editor.getByRole('button', { name: `Move link ${row} up`, exact: true }).click();
  assert.equal(await labels().nth(2).inputValue(), 'Underwriting FAQ');
  const stableId = await labels().nth(2).getAttribute('id');
  await capture('desktop-light-editor');
  await page.setViewportSize({ width: 390, height: 844 });
  await labels().nth(2).scrollIntoViewIfNeeded();
  await capture('mobile-light-editor');
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await labels().nth(2).scrollIntoViewIfNeeded();
  await capture('compact-dark-editor');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const saved = await page.evaluate(() => window.carrierFixture.snapshot().find((row) => row.name === 'Atlas Example Life'));
  assert.equal(saved.resource_links[2].label, 'Underwriting FAQ');
  assert.equal(`carrier-resource-${saved.resource_links[2].id}-label`, stableId);
  assert.deepEqual(await page.evaluate(() => Object.keys(window.carrierFixture.events.filter((event) => event.table === 'carriers' && event.operation === 'update').at(-1).payload)), ['resource_links']);
  await page.getByRole('link', { name: 'Directory', exact: true }).click();
  await openCard(atlas());
  assert.equal(await guides.getByRole('link').first().getAttribute('href'), 'https://atlas.example/faq');
  await page.reload();
  await openCard(atlas());
  assert.equal(await guides.getByRole('link').first().getAttribute('href'), 'https://atlas.example/faq');
  record('Admin add/reorder/save, stable link IDs, resource-only patch and persisted directory reload');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Atlas Example Life', exact: true }).click();
  assert.equal(await labels().nth(2).inputValue(), 'Underwriting FAQ');
  await labels().nth(2).fill('Retained failed-save draft');
  await page.evaluate(() => window.carrierFixture.failNextSave());
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await page.getByText('Failed to save carrier', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 1);
  assert.equal(await labels().nth(2).inputValue(), 'Retained failed-save draft');
  assert.equal(await page.evaluate(() => window.carrierFixture.snapshot().find((row) => row.name === 'Atlas Example Life').resource_links[2].label), 'Underwriting FAQ');
  await labels().nth(2).scrollIntoViewIfNeeded();
  await capture('mobile-save-failure-keeps-draft');
  await labels().nth(2).fill('😀'.repeat(120));
  assert.equal(Array.from(await labels().nth(2).inputValue()).length, 120, 'The browser must not truncate 120 Unicode code points to 60 emoji');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => Array.from(window.carrierFixture.snapshot().find((row) => row.name === 'Atlas Example Life').resource_links[2].label).length), 120);
  record('Failed save preserves the draft; retry saves 120 Unicode code points without native input truncation');

  await goto('/carriers?agent=true');
  await atlas().waitFor();
  assert.equal(await page.getByRole('link', { name: 'Manage carriers', exact: true }).count(), 0);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Atlas Example Life', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Add Carrier|Edit Atlas|Remove Atlas/ }).count(), 0);
  for (const control of await page.getByRole('switch').all()) assert.equal(await control.isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.carrierFixture.events.filter((event) => event.table === 'carriers' && event.operation !== 'select')), []);
  record('Agent directory is read-only and Settings exposes no enabled carrier mutations');

  await goto('/carriers');
  await atlas().waitFor();
  await page.getByRole('searchbox', { name: 'Search carriers' }).fill('Atlas');
  await openCard(atlas());
  await page.evaluate(() => window.carrierFixture.setIdentity({ userId: window.carrierFixture.identities.userB, profileId: window.carrierFixture.identities.userB }));
  await page.waitForFunction(() => document.querySelector('input[aria-label="Search carriers"]')?.value === '');
  assert.equal(await atlas().getAttribute('aria-expanded'), 'false');
  await page.evaluate(() => window.carrierFixture.setIdentity({ organizationId: window.carrierFixture.identities.organizationB }));
  await page.getByRole('button', { name: 'Harbor Example Life', exact: true }).waitFor();
  assert.equal(await atlas().count(), 0);
  for (const patch of [{ isImpersonating: true }, { profileId: null }, { claimOrganizationId: 'a1000000-0000-4000-8000-000000000001' }]) {
    const before = await carrierReads();
    await page.evaluate((change) => window.carrierFixture.setIdentity(change), patch);
    await page.getByText('Carrier resources are not available for this account.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('searchbox').count(), 0);
    assert.equal(await carrierReads(), before, 'Unresolved or View As identity must not start a carrier read');
    await page.evaluate(() => window.carrierFixture.setIdentity({
      profileId: window.carrierFixture.identities.userB, isImpersonating: false, claimOrganizationId: null,
    }));
    await page.getByRole('button', { name: 'Harbor Example Life', exact: true }).waitFor();
  }
  await page.evaluate(() => {
    window.carrierFixture.delayNextRead(400);
    window.carrierFixture.setIdentity({ organizationId: window.carrierFixture.identities.organizationA });
  });
  await page.getByText('Loading carriers…', { exact: true }).waitFor();
  await page.evaluate(() => window.carrierFixture.setIdentity({ organizationId: window.carrierFixture.identities.organizationB }));
  await page.getByRole('button', { name: 'Harbor Example Life', exact: true }).waitFor();
  await page.waitForTimeout(450);
  assert.equal(await atlas().count(), 0, 'Late previous-organization response must remain invisible');
  record('Same-organization identity reset, organization change, View As/unresolved claim suppression and late-response isolation');

  await page.evaluate(() => {
    window.carrierFixture.failNextRead();
    window.carrierFixture.setIdentity({
      userId: window.carrierFixture.identities.userA, profileId: window.carrierFixture.identities.userA,
      organizationId: window.carrierFixture.identities.organizationA,
    });
  });
  await page.getByText('Could not load carriers.', { exact: true }).waitFor();
  assert.equal(await atlas().count(), 0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await atlas().waitFor();
  record('Read failure clears the directory and explicit retry recovers');

  assert.deepEqual(errors, [], 'No uncaught browser errors');
  assert.deepEqual(blocked, [], 'No external HTTP request was attempted; every non-loopback origin is blocked');
  await fs.writeFile(path.join(screenshots, 'results.json'), JSON.stringify({ checks, captures, browserErrors: errors, blockedExternalRequests: blocked }, null, 2));
  console.log(`PASS: ${checks.length} browser scenarios; ${captures.length} screenshots in ${screenshots}; zero external requests.`);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(screenshots, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill();
}
