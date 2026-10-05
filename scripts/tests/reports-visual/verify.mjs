// Real browser + real Reports components/hooks/export code; synthetic SQL transport only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.REPORTS_VISUAL_URL || 'http://127.0.0.1:4180';
const target = new URL(url);
assert.equal(target.origin, 'http://127.0.0.1:4180', 'Only the isolated Reports fixture is allowed');
const output = process.env.REPORTS_VISUAL_OUTPUT || 'reports-visual-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const context = await browser.newContext({ acceptDownloads: true, timezoneId: 'America/Los_Angeles', viewport: { width: 1440, height: 1000 } });
const external = [], errors = [], consoleErrors = [];
await context.route('**/*', route => {
  const resource = new URL(route.request().url());
  if (['http:', 'https:'].includes(resource.protocol) && resource.origin !== target.origin) {
    external.push(resource.origin); return route.abort();
  }
  return route.continue();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('ISOLATED_FIXTURE_UNAVAILABLE')) consoleErrors.push(message.text());
});
const section = title => page.getByRole('heading', { name: title, exact: true }).locator('..').locator('..').locator('..');
async function exportFile(button, expectedName) {
  const pending = page.waitForEvent('download');
  await button.click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), expectedName);
  await download.saveAs(`${output}/${expectedName}`);
  assert.equal(await download.failure(), null);
  return readFile(`${output}/${expectedName}`, 'utf8');
}
async function ready() {
  await page.getByText('Report basis and data quality', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Export', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Export', exact: true }).isEnabled(), true);
  await page.waitForFunction(() => !document.querySelector('[data-report-state="loading"]'));
}
async function measure(label) {
  // Recharts animates on initial mount and resize. Capture settled, nonblank chart geometry.
  await page.evaluate(async () => {
    const started = performance.now();
    let previous = '', stableSince = started;
    while (performance.now() - started < 6000) {
      await new Promise(requestAnimationFrame);
      const next = JSON.stringify([...document.querySelectorAll('.recharts-wrapper path,.recharts-wrapper rect,.recharts-wrapper circle')]
        .map(node => ['d', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r'].map(attr => node.getAttribute(attr))));
      if (next !== previous) { previous = next; stableSince = performance.now(); }
      if (performance.now() - started > 1700 && performance.now() - stableSince > 350) return;
    }
    throw new Error('Report chart geometry did not settle');
  });
  const measurements = await page.evaluate(() => ({
    viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
    overlay: !!document.querySelector('vite-error-overlay'),
    charts: [...document.querySelectorAll('.recharts-wrapper')].length,
    pieSectors: [...document.querySelectorAll('.recharts-pie-sector path')].filter(node => { const box = node.getBBox(); return box.width > 1 && box.height > 1; }).length,
    positiveBars: [...document.querySelectorAll('.recharts-bar-rectangle path')].filter(node => { const box = node.getBBox(); return box.width > 1 && box.height > 1; }).length,
    monetaryClipping: [...document.querySelectorAll('p')].filter(node => node.children.length === 0 && /^\$[\d,]+\.\d{2}$/.test(node.textContent.trim()))
      .filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent),
    headings: [...document.querySelectorAll('h1,h3')].map(node => node.textContent),
  }));
  assert.ok(measurements.pageWidth <= measurements.viewport + 1, `${label}: horizontal page overflow ${JSON.stringify(measurements)}`);
  assert.equal(measurements.overlay, false);
  assert.ok(measurements.charts > 0, `${label}: chart components rendered`);
  assert.ok(measurements.pieSectors >= 2, `${label}: nonblank disposition sectors`);
  assert.ok(measurements.positiveBars >= 1, `${label}: nonblank call-volume bars`);
  assert.deepEqual(measurements.monetaryClipping, [], `${label}: monetary values must show their cents`);
  await page.screenshot({ path: `${output}/${label}.png`, fullPage: true });
  await section('Call Summary').screenshot({ path: `${output}/${label}-call-summary.png` });
  await writeFile(`${output}/${label}.json`, JSON.stringify(measurements, null, 2));
  console.log('PASS', label, JSON.stringify(measurements));
}
try {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Performance Analytics' }).waitFor();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  for (const label of ['Start Date', 'End Date']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    const caption = page.locator('[id^="react-day-picker-"][aria-live="polite"]');
    const month = new Date(`${await caption.innerText()} 1`);
    assert.ok(Number.isFinite(month.getTime()), 'calendar month is readable');
    const steps = (2026 - month.getFullYear()) * 12 + 9 - month.getMonth();
    assert.ok(Math.abs(steps) < 120, 'fixture calendar remains within ten years of its SQL date');
    for (let step = 0; step < Math.abs(steps); step++) {
      await page.getByRole('button', { name: steps < 0 ? 'Go to previous month' : 'Go to next month', exact: true }).click();
    }
    await page.getByText('October 2026', { exact: true }).waitFor();
    await page.getByRole('grid').getByRole('gridcell', { name: '1', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('grid').waitFor({ state: 'hidden' });
  }
  await ready();
  assert.equal(await page.getByTestId('report-period').innerText(), 'Oct 1, 2026 – Oct 1, 2026');
  const payloads = await page.evaluate(() => window.reportsFixture.payloads);
  assert.equal(payloads.summary.totals.policies_sold, 8);
  assert.equal(payloads.summary.totals.premium.annual_premium, 14406);
  assert.equal(payloads.summary.totals.premium.known_count, 3);
  assert.equal(payloads.summary.totals.session_seconds, 7200);
  assert.equal(payloads.summary.totals.talk_time_seconds, 201);
  assert.equal(payloads.summary.by_agent.find(a => a.name === 'Synthetic admin').premium.annual_premium, null);
  await page.getByText('Report basis and data quality', { exact: true }).click();
  await page.getByRole('heading', { name: 'Agent Efficiency', exact: true }).click();
  const content = await page.locator('body').innerText();
  for (const text of [
    'Bookings created (all types)', 'Callback dispositions', '$14,406.00', '3/8 policies known',
    '5 unknown', '1800 duplicate seconds removed', '3 calls matched same-agent/campaign session intervals',
    '2 unmatched calls stay in Calls Made', '2h 0m 0s', '3m 21s',
    'Each panel is calculated independently', 'unavailable campaign attribution',
    '5 outbound calls are not linked to a current lead',
  ]) assert.ok(content.includes(text), `Rendered report contains ${text}`);
  const unknownCard = page.getByRole('button', { name: /Synthetic admin.*Known annual premium/s });
  assert.match(await unknownCard.innerText(), /Known annual premium \(0\/1\)[\s\S]*—/i);
  assert.ok(!await unknownCard.innerText().then(text => text.includes('$0.00')), 'all-unknown premium never presented as zero');
  assert.match(await section('Agent Efficiency').innerText(), /1\.5/, '3 interval-matched calls / 2 hours');
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await measure(`reports-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const summaryCsv = await exportFile(page.getByRole('button', { name: 'Export', exact: true }), 'report-summary-2026-10-01-to-2026-10-01.csv');
  for (const text of ['"Talk time (seconds)",201', '"Dialer session time (seconds)",7200', '"Known annual premium",14406', '"Policies with unknown premium",5', 'reports_integrity_v2', payloads.summary.as_of]) {
    assert.ok(summaryCsv.includes(text), `Summary CSV preserves ${text}`);
  }
  const campaignCsv = await exportFile(section('Campaign Performance').getByRole('button', { name: 'CSV', exact: true }), 'campaign-performance-2026-10-01-to-2026-10-01.csv');
  assert.ok(campaignCsv.includes('"Attribution unavailable","",1,"","","","","",8,14406,"3/8"'));
  const agentsCsv = await exportFile(section('Agent Performance').getByRole('button', { name: 'CSV', exact: true }), 'agent-performance-2026-10-01-to-2026-10-01.csv');
  assert.ok(agentsCsv.includes('"Synthetic admin","Active",0,0,"",0,1,0,0,0,"",0,1'), 'unknown numeric fields export blank');
  const formulaDownload = page.waitForEvent('download');
  await page.evaluate(() => window.reportsFixture.downloadFormulaExample());
  const formula = await formulaDownload;
  await formula.saveAs(`${output}/fixture-formula-safety.csv`);
  assert.ok((await readFile(`${output}/fixture-formula-safety.csv`, 'utf8')).includes('"\'=1+1","",10.01'));
  console.log('PASS real Reports CSV downloads, exact values, blank unknowns and formula protection');

  await page.evaluate(() => window.reportsFixture.fail('campaigns'));
  await page.getByRole('button', { name: 'Refresh reports' }).click();
  await ready();
  const failure = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: 'Campaign Performance', exact: true }) });
  await failure.waitFor();
  assert.match(await failure.innerText(), /This is not a zero/);
  assert.equal(await failure.getByRole('button', { name: 'CSV', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Export', exact: true }).isEnabled(), true, 'independent summary remains exportable');
  await page.screenshot({ path: `${output}/panel-failure.png`, fullPage: true });
  await page.evaluate(() => window.reportsFixture.fail(null));
  await failure.getByRole('button', { name: 'Try again' }).click();
  await section('Campaign Performance').getByRole('button', { name: 'CSV', exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0, 'panel retry recovers');

  await page.getByRole('button', { name: 'Last 7 Days', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('[data-report-state="error"]') && !document.querySelector('[data-report-state="loading"]'));
  assert.equal(await page.getByRole('button', { name: 'Export', exact: true }).isEnabled(), false, 'unsupported window never exports stale data');
  assert.equal(await page.getByText('Report basis and data quality', { exact: true }).count(), 0);
  assert.ok(!(await page.locator('body').innerText()).includes('$14,406.00'), 'prior window values are withheld');
  const requests = await page.evaluate(() => window.reportsFixture.requests());
  for (const key of ['scope', 'summary', 'volume', 'dispositions', 'campaigns', 'leadSources']) {
    assert.ok(requests.some(r => r.panel === key && r.accepted), `real hook requested ${key}`);
  }
  assert.ok(requests.some(r => !r.accepted), 'unsupported windows fail explicitly');
  await writeFile(`${output}/rpc-requests.json`, JSON.stringify(requests, null, 2));
  assert.deepEqual(external, [], 'fixture must never contact external data services');
  assert.deepEqual(errors, [], 'uncaught browser errors');
  assert.deepEqual(consoleErrors, [], 'unexpected browser console errors');
  console.log('PASS all six SQL payloads through real hooks, partial failure/retry and stale-window protection');
} catch (error) {
  console.error('Browser errors:', JSON.stringify({ errors, consoleErrors, external }));
  console.error('Visible state:', (await page.locator('body').innerText()).slice(0, 6000));
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  throw error;
} finally { await browser.close(); }
