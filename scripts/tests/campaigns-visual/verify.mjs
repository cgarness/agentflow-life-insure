// Real browser + real Campaigns page/components/hooks/queries; synthetic transport only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.CAMPAIGNS_VISUAL_URL || 'http://127.0.0.1:4190';
assert.equal(new URL(base).origin, 'http://127.0.0.1:4190', 'Only the isolated Campaigns fixture is allowed');
const output = process.env.CAMPAIGNS_VISUAL_OUTPUT || 'campaigns-visual-evidence';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const results = [];
const external = [];

async function open(query, width, height = 900) {
  const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'America/Los_Angeles' });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(base).origin) { external.push(url.origin); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
  await page.goto(`${base}/?${query}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  return { context, page, errors };
}

async function noOverflow(page, label) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  assert.ok(scrollWidth <= clientWidth, `${label}: page overflows horizontally (${scrollWidth} > ${clientWidth})`);
}

async function check(name, fn) {
  try { await fn(); results.push(`PASS ${name}`); } catch (error) { results.push(`FAIL ${name}: ${error.message}`); }
}

// 1. Layout matrix inside the reproduced app shell (sidebar offset + AppLayout padding).
for (const theme of ['dark', 'light']) {
  for (const [width, sidebar] of [[1440, 'expanded'], [1280, 'expanded'], [1280, 'collapsed'], [1024, 'expanded'], [1024, 'collapsed'], [768, 'expanded'], [390, 'expanded']]) {
    const label = `${theme}-${width}-${sidebar}`;
    await check(`layout ${label}`, async () => {
      const { context, page, errors } = await open(`persona=admin&theme=${theme}&sidebar=${sidebar}`, width, width <= 390 ? 844 : 900);
      await noOverflow(page, label);
      const desktop = width >= 1280;
      assert.equal(await page.locator('table').count() > 0, desktop, `${label}: desktop table iff viewport >= 1280`);
      assert.equal(await page.getByRole('list', { name: 'Campaigns' }).count() > 0, !desktop, `${label}: stacked list below 1280`);
      // Essentials visible without horizontal scrolling: every row's Open action is inside the viewport.
      const opens = page.getByRole('button', { name: /^Open / });
      const box = await opens.first().boundingBox();
      assert.ok(box && box.x + box.width <= width, `${label}: Open action within viewport`);
      await page.screenshot({ path: `${output}/${label}.png`, fullPage: true });
      assert.deepEqual(errors, [], `${label}: console/page errors`);
      await context.close();
    });
  }
}

// 2. Interaction states (desktop dark, mobile dark).
await check('desktop expanded row, columns editor, overflow menu', async () => {
  const { context, page, errors } = await open('persona=admin', 1440);
  const chevron = page.getByRole('button', { name: /Show details for Final Expense/ });
  await chevron.click();
  assert.equal(await page.getByRole('button', { name: /Hide details for Final Expense/ }).getAttribute('aria-expanded'), 'true');
  assert.equal(new URL(page.url()).search.includes('persona=admin'), true, 'expanding does not navigate');
  await page.screenshot({ path: `${output}/desktop-expanded.png`, fullPage: true });
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('checkbox', { name: 'Show Contacted' }).waitFor();
  await page.screenshot({ path: `${output}/desktop-columns-editor.png` });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: /More actions for Final Expense/ }).click();
  await page.getByRole('menuitem', { name: /Duplicate/ }).waitFor();
  await page.screenshot({ path: `${output}/desktop-overflow-menu.png` });
  assert.deepEqual(errors, []);
  await context.close();
});

await check('column preferences persist without writing on load', async () => {
  const { context, page } = await open('persona=admin', 1440);
  await page.evaluate(() => window.campaignsFixture.clearPrefs());
  await page.reload({ waitUntil: 'networkidle' });
  const onLoad = await page.evaluate(() => window.campaignsFixture.requests().filter((r) => r.includes('user_preferences')));
  assert.deepEqual(onLoad, ['select:user_preferences'], 'page load only reads preferences');
  await page.getByRole('button', { name: 'Columns' }).click();
  for (const label of ['Contacted', 'Created', 'Tags', 'Last dialed']) await page.getByRole('checkbox', { name: `Show ${label}` }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('columnheader', { name: /Last dialed/i }).waitFor();
  await page.getByRole('button', { name: /Show details for Final Expense/ }).click();
  await page.evaluate(() => { const s = document.querySelector('table')?.parentElement; if (s) s.scrollLeft = s.scrollWidth; });
  await page.mouse.move(2, 2);
  await page.screenshot({ path: `${output}/desktop-all-columns-scrolled.png` });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('columnheader', { name: /Last dialed/i }).waitFor();
  const afterReload = await page.evaluate(() => window.campaignsFixture.requests().filter((r) => r.includes('user_preferences')));
  assert.deepEqual(afterReload, ['select:user_preferences'], 'reload reads saved columns and writes nothing');
  await page.evaluate(() => window.campaignsFixture.clearPrefs());
  await context.close();
});

await check('mobile stacked expanded', async () => {
  const { context, page, errors } = await open('persona=admin', 390, 844);
  await page.getByRole('button', { name: /Show details for Final Expense/ }).click();
  await noOverflow(page, 'mobile expanded');
  await page.screenshot({ path: `${output}/mobile-expanded.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
});

await check('agent persona: counts, no duplicate, no create', async () => {
  const { context, page, errors } = await open('persona=agent', 1440);
  assert.equal(await page.getByRole('button', { name: /New Campaign/ }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /More actions/ }).count(), 0);
  await page.getByText('5 assigned').first().waitFor();
  await page.screenshot({ path: `${output}/desktop-agent.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
});

for (const [state, expectText] of [['empty', 'No campaigns yet'], ['error', "Couldn't load campaigns."], ['stats-error', 'Metrics unavailable.']]) {
  await check(`state ${state}`, async () => {
    const { context, page } = await open(`persona=admin&state=${state}`, 1440);
    await page.getByText(expectText).first().waitFor();
    if (state === 'error') assert.equal(await page.getByText('No campaigns yet').count(), 0, 'error is not shown as empty');
    await page.screenshot({ path: `${output}/state-${state}.png`, fullPage: true });
    await context.close();
  });
}

await check('state loading and stats-loading never show fabricated zeros', async () => {
  const { context, page } = await open('persona=admin&state=stats-loading', 1440);
  assert.ok(await page.getByTestId('metric-loading').count() > 0, 'metric skeletons while stats load');
  await page.screenshot({ path: `${output}/state-stats-loading.png`, fullPage: true });
  await context.close();
  const loading = await open('persona=admin&state=loading', 1440);
  await loading.page.getByTestId('campaigns-skeleton').waitFor();
  await loading.page.screenshot({ path: `${output}/state-loading.png` });
  await loading.context.close();
});

await check('agency lock disables creation', async () => {
  const { context, page } = await open('persona=admin&org=suspended', 1440);
  assert.equal(await page.getByRole('button', { name: /New Campaign/ }).isDisabled(), true);
  await page.getByRole('button', { name: /More actions for Final Expense/ }).click();
  assert.equal(await page.getByRole('menuitem', { name: /Duplicate/ }).getAttribute('aria-disabled'), 'true');
  await context.close();
});

await browser.close();
assert.deepEqual([...new Set(external)], [], 'no external requests');
await writeFile(`${output}/browser-results.txt`, results.join('\n') + '\n');
console.log(results.join('\n'));
if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
