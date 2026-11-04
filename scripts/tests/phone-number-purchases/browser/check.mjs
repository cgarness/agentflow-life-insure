import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../../../..');
const screenshots = process.env.PHONE_PURCHASE_SCREENSHOTS || '/tmp/phone-number-purchase-browser';
await fs.mkdir(screenshots, { recursive: true });
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--config', path.join(here, 'vite.config.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
process.on('exit', () => server.kill());
let stdout = '', stderr = '', serverFailure;
server.stdout.on('data', (chunk) => { stdout = (stdout + String(chunk)).slice(-8192); });
server.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-8192); });
server.on('error', (error) => { serverFailure = error.message; });
server.on('exit', (code, signal) => { serverFailure = `Fixture server exited ${code ?? signal}.`; });
const readinessDeadline = Date.now() + 20000;
let ready = false, readinessFailure = 'Fixture server did not respond.';
while (Date.now() < readinessDeadline && !serverFailure) {
  try {
    const response = await fetch('http://127.0.0.1:4177', {
      signal: AbortSignal.timeout(Math.max(1, Math.min(1000, readinessDeadline - Date.now()))),
      redirect: 'error',
    });
    const html = await response.text();
    if (response.ok && html.includes('<title>Phone numbers · synthetic verification</title>')) {
      ready = !serverFailure;
      break;
    }
    readinessFailure = `Fixture readiness returned HTTP ${response.status} without the expected title.`;
  } catch (error) { readinessFailure = error.message; }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(100, readinessDeadline - Date.now()))));
}
if (!ready) {
  server.kill();
  throw new Error(`Fixture server did not start: ${serverFailure || readinessFailure}\nstdout (tail):\n${stdout}\nstderr (tail):\n${stderr}`);
}
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    if (route.request().url().startsWith('http://127.0.0.1:4177')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const actions = () => page.evaluate(() => window.phoneFixtureEvents.map((event) => event.body.action));
  await page.goto('http://127.0.0.1:4177');
  assert.equal(await page.getByRole('button', { name: 'Local', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByLabel('Area code', { exact: true }).fill('213');
  await page.getByRole('button', { name: 'Search available numbers' }).click();
  await page.getByRole('button', { name: 'Add to cart +12135550100', exact: true }).click();
  await page.getByRole('button', { name: 'Toll-Free', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Prefer 800', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Search available numbers' }).click();
  await page.getByRole('button', { name: 'Add to cart +18005550100', exact: true }).click();
  const offered = await page.getByRole('list', { name: 'Available numbers' }).getByRole('listitem').allTextContents();
  assert.ok(offered[0].includes('+1800') && offered[1].includes('+1888'), '800 precedes 888');
  await page.getByRole('button', { name: 'Add to cart +18885550100', exact: true }).click();
  await page.getByRole('button', { name: 'Review purchase', exact: true }).click();
  const confirm = page.getByRole('button', { name: 'Confirm purchase of 3 numbers', exact: true });
  await confirm.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Confirm purchase of 3 numbers' && !b.disabled));
  const review = page.getByRole('region', { name: 'Purchase review' });
  assert.equal(await review.getByRole('listitem').count(), 3);
  assert.ok((await review.textContent()).replace(/\s+/g, ' ').includes('USD 5.45'), 'Every selected rental is included in the monthly total');
  assert.equal((await actions()).filter((action) => action === 'purchase').length, 0, 'Review is not billable');
  await page.screenshot({ path: path.join(screenshots, 'desktop-review.png'), fullPage: true });
  await confirm.focus(); await page.keyboard.press('Space');
  await page.getByText('Your numbers are ready in Phone Numbers.', { exact: false }).waitFor();
  assert.equal((await actions()).filter((action) => action === 'purchase').length, 3);
  assert.equal(await page.evaluate(() => window.phoneFixtureEvents.some((event) => event.name === 'twilio-buy-number' && 'phone_number' in event.body)), false);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('dialog').count(), 0, 'Keyboard closes a completed purchase');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4177/?scenario=timeout');
  await page.getByRole('button', { name: 'Toll-Free', exact: true }).click();
  await page.getByRole('button', { name: '888 only', exact: true }).click();
  await page.getByRole('button', { name: 'Search available numbers' }).click();
  await page.getByRole('button', { name: 'Add to cart +18885550100', exact: true }).click();
  await page.getByRole('button', { name: 'Review purchase', exact: true }).click();
  const mobileConfirm = page.getByRole('button', { name: 'Confirm purchase of 1 number', exact: true });
  await mobileConfirm.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Confirm purchase of 1 number' && !b.disabled));
  assert.equal(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth), true, 'No narrow-screen dialog overflow');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No document overflow');
  await page.screenshot({ path: path.join(screenshots, 'mobile-review.png'), fullPage: true });
  await mobileConfirm.click();
  await page.getByText('Purchase status is not confirmed. Check status before continuing.', { exact: true }).waitFor();
  assert.deepEqual((await actions()).filter((a) => ['purchase', 'status'].includes(a)), ['purchase', 'status'], 'A lost response triggers status only');
  assert.equal(await page.getByRole('button', { name: 'Confirm purchase', exact: true }).isDisabled(), true);
  await page.screenshot({ path: path.join(screenshots, 'mobile-needs-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Check purchase status', exact: true }).click();
  await page.getByText('Your numbers are ready in Phone Numbers.', { exact: false }).waitFor();
  assert.deepEqual((await actions()).filter((a) => ['purchase', 'status'].includes(a)), ['purchase', 'status', 'status']);

  for (const query of ['agent=true', 'viewAs=true']) {
    await page.goto(`http://127.0.0.1:4177/?${query}`);
    await page.getByRole('alert').waitFor();
    assert.deepEqual(await actions(), [], 'Read-only identities do not reach the service');
    assert.equal(await page.getByRole('button', { name: 'Search available numbers' }).count(), 0);
  }
  await page.goto('http://127.0.0.1:4177/?scenario=old');
  await page.getByRole('button', { name: 'Toll-Free', exact: true }).click();
  await page.getByRole('button', { name: 'Search available numbers' }).click();
  await page.getByText('Phone-number purchasing has changed. Refresh the page before continuing.', { exact: true }).waitFor();
  assert.deepEqual(await actions(), ['search'], 'An old backend never enables purchase');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: actual Local/Toll-Free dialog, 800 order, mixed cart, exact prices, keyboard confirmation, mobile layout, timeout status-only recovery, Admin/View As and version skew. Zero external requests.');
} finally { await browser.close(); server.kill(); }
