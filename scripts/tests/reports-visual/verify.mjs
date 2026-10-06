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
const section = id => page.locator(`[data-report-section="${id}"]`);
const editor = () => page.getByRole('region', { name: 'Customize your report', exact: true });
async function exportWithheld() {
  const button = page.getByRole('button', { name: 'Export', exact: true });
  assert.ok(await button.count() === 0 || !await button.isEnabled(), 'stale export is withheld');
}
async function sectionOrder(group) {
  return page.locator(`[data-report-group="${group}"] [data-report-section]`).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-report-section')));
}
async function selectSqlWindow() {
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
}
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
async function customize() {
  const original = await sectionOrder('performance');
  await page.getByRole('button', { name: 'Customize layout', exact: true }).click();
  await editor().waitFor();
  await editor().evaluate(node => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${output}/customize-desktop-top.png` });
  assert.equal(await editor().getByRole('checkbox', { name: /Policies Sold|Known Annual Premium/ }).count(), 0, 'production anchors cannot be hidden');
  const campaign = editor().getByRole('checkbox', { name: 'Show Campaign performance', exact: true });
  await campaign.uncheck();
  await section('campaign_performance').waitFor({ state: 'hidden' });
  await editor().getByRole('button', { name: 'Cancel', exact: true }).click();
  await editor().waitFor({ state: 'hidden' });
  assert.deepEqual(await sectionOrder('performance'), original, 'Cancel restores saved layout');
  assert.equal(await page.evaluate(() => window.reportsFixture.savedLayout()), null, 'Cancel does not persist a draft');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Customize layout', exact: true }).click();
  await editor().getByRole('button', { name: 'Move Lead sources up', exact: true }).click();
  await campaign.uncheck();
  const customized = await sectionOrder('performance');
  assert.ok(!customized.includes('campaign_performance'));
  // Named keyboard controls remain usable at the mobile width.
  const moveUp = editor().getByRole('button', { name: 'Move Lead sources up', exact: true });
  await moveUp.focus();
  await page.keyboard.press('Enter');
  const reordered = await sectionOrder('performance');
  assert.ok(reordered.indexOf('lead_source_roi') < reordered.indexOf('agent_efficiency'), 'keyboard action reorders within performance');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile customizer has no page overflow');
  await editor().screenshot({ path: `${output}/customize-mobile.png` });
  await editor().evaluate(node => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${output}/customize-mobile-top.png` });
  await editor().getByRole('button', { name: 'Save layout', exact: true }).click();
  await editor().waitFor({ state: 'hidden' });
  const saved = await page.evaluate(() => window.reportsFixture.savedLayout());
  assert.equal(saved.version, 4);
  assert.equal(saved.sections.find(section => section.id === 'campaign_performance').visible, false);

  // A full remount exercises preference loading, not merely current React state.
  await page.reload();
  await selectSqlWindow();
  assert.deepEqual(await sectionOrder('performance'), reordered, 'saved visibility/order survive page remount');
  await page.getByRole('button', { name: 'Customize layout', exact: true }).click();
  await campaign.check();
  await page.evaluate(() => window.reportsFixture.failLayoutSave(true));
  await editor().getByRole('button', { name: 'Save layout', exact: true }).click();
  await editor().getByRole('alert').waitFor();
  assert.equal(await editor().isVisible(), true, 'failed save keeps editable draft open');
  assert.deepEqual(await page.evaluate(() => window.reportsFixture.savedLayout()), saved, 'failed save leaves persisted layout unchanged');
  await editor().screenshot({ path: `${output}/customize-save-failure.png` });
  await editor().getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(await sectionOrder('performance'), reordered, 'Cancel after failure restores persisted layout');
  await page.evaluate(() => window.reportsFixture.failLayoutSave(false));
  await page.getByRole('button', { name: 'Customize layout', exact: true }).click();
  await editor().getByRole('button', { name: 'Reset to default', exact: true }).click();
  await editor().waitFor({ state: 'hidden' });
  assert.deepEqual(await sectionOrder('performance'), original, 'Reset restores inherited default');
  assert.equal(await page.evaluate(() => window.reportsFixture.savedLayout()), null, 'Reset removes only the saved personal override');
  assert.deepEqual(await sectionOrder('trends'), ['policies_sold', 'call_volume'], 'customization never moves fixed trends');
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log('PASS mobile/keyboard customization, save/remount, cancel, reset and failed-save recovery');
}
async function scopes() {
  assert.equal(await page.getByRole('tab', { name: 'Agency', exact: true }).getAttribute('aria-selected'), 'true', 'server maximum scope is initial default');
  // The fixture deliberately has no filtered-agent response. The real UI must discard
  // that filter when switching scopes, otherwise the next genuine SQL bundle cannot load.
  await page.getByRole('button', { name: 'Filter reports to Synthetic agent', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('[data-report-state="error"]') && !document.querySelector('[data-report-state="loading"]'));
  await exportWithheld();
  await page.evaluate(() => window.reportsFixture.hold('summary'));
  await page.getByRole('tab', { name: 'Personal', exact: true }).click();
  await page.waitForFunction(() => window.reportsFixture.requests().some(request => request.panel === 'summary' && request.args.p_requested_scope === 'personal'));
  await exportWithheld();
  assert.ok(!(await page.locator('body').innerText()).includes('$14,406.00'), 'scope transition withholds previous agency amount');
  await page.evaluate(() => window.reportsFixture.release());
  await ready();
  assert.equal(await page.getByRole('tab', { name: 'Personal', exact: true }).getAttribute('aria-selected'), 'true');
  assert.match(await page.getByRole('article', { name: 'Known annual premium', exact: true }).innerText(), /Unavailable[\s\S]*0 of 1 policies/);
  assert.equal(await section('agent_performance_cards').count(), 0, 'personal view has no team performance panel');
  for (const name of ['Team', 'Agency']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await ready();
    assert.equal(await page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected'), 'true');
  }
  assert.ok((await page.getByRole('article', { name: 'Known annual premium', exact: true }).innerText()).includes('$14,406.00'));
  const requests = await page.evaluate(() => window.reportsFixture.requests());
  for (const requestedScope of ['personal', 'team', 'agency']) {
    for (const panel of ['scope', 'summary', 'volume', 'dispositions', 'campaigns', 'leadSources']) {
      assert.ok(requests.some(request => request.panel === panel && request.accepted &&
        (request.args.p_requested_scope === requestedScope || requestedScope === 'agency' && request.args.p_requested_scope === null)), `${requestedScope}/${panel} used a genuine matching SQL payload`);
    }
    assert.ok(requests.some(request => request.panel === 'summary' && request.accepted && request.args.p_requested_scope === requestedScope && request.args.p_agent_id === null), `${requestedScope} clears narrowed agent filter`);
  }
  console.log('PASS Personal / Team / Agency SQL-payload transitions, agent reset and stale-export withholding');
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
    headings: [...document.querySelectorAll('h1,h2,h3')].map(node => node.textContent),
    hierarchy: ['[aria-label="Production overview"]', '[data-report-group="stats"]', '[data-report-group="trends"]', '[data-report-group="performance"]', '[data-report-group="diagnostics"]'].map(selector => ({ selector, top: document.querySelector(selector)?.getBoundingClientRect().top })),
  }));
  assert.ok(measurements.pageWidth <= measurements.viewport + 1, `${label}: horizontal page overflow ${JSON.stringify(measurements)}`);
  assert.equal(measurements.overlay, false);
  assert.ok(measurements.charts > 0, `${label}: chart components rendered`);
  assert.ok(measurements.pieSectors >= 2, `${label}: nonblank disposition sectors`);
  assert.ok(measurements.positiveBars >= 1, `${label}: nonblank call-volume bars`);
  assert.deepEqual(measurements.monetaryClipping, [], `${label}: monetary values must show their cents`);
  for (let i = 1; i < measurements.hierarchy.length; i++) {
    assert.ok(measurements.hierarchy[i].top > measurements.hierarchy[i - 1].top, `${label}: executive-first hierarchy`);
  }
  await page.screenshot({ path: `${output}/${label}.png`, fullPage: true });
  await page.getByRole('region', { name: 'Production overview', exact: true }).screenshot({ path: `${output}/${label}-production-overview.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${output}/${label}-top.png` });
  // Tailwind's class-based theme is applied only to the isolated synthetic page.
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: dark theme has no horizontal overflow`);
  await page.screenshot({ path: `${output}/${label}-dark-top.png` });
  await page.getByRole('region', { name: 'Production overview', exact: true }).screenshot({ path: `${output}/${label}-dark-production-overview.png` });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await writeFile(`${output}/${label}.json`, JSON.stringify(measurements, null, 2));
  console.log('PASS', label, JSON.stringify(measurements));
}
try {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Reports', exact: true }).waitFor();
  await selectSqlWindow();
  assert.equal(await page.getByTestId('report-period').innerText(), 'Oct 1, 2026 – Oct 1, 2026');
  const payloads = await page.evaluate(() => window.reportsFixture.payloads);
  assert.equal(payloads.summary.totals.policies_sold, 8);
  assert.equal(payloads.summary.totals.premium.annual_premium, 14406);
  assert.equal(payloads.summary.totals.premium.known_count, 3);
  assert.equal(payloads.summary.totals.session_seconds, 7200);
  assert.equal(payloads.summary.totals.talk_time_seconds, 201);
  assert.equal(payloads.summary.by_agent.find(a => a.name === 'Synthetic admin').premium.annual_premium, null);
  await page.getByText('Report basis and data quality', { exact: true }).click();
  const efficiencyToggle = section('agent_efficiency').getByRole('button', { name: 'Agent Efficiency', exact: true });
  if (await efficiencyToggle.getAttribute('aria-expanded') === 'false') await efficiencyToggle.click();
  const content = await page.locator('body').innerText();
  for (const text of [
    'Bookings created (all types)', 'Callback dispositions', '$14,406.00', '3 of 8 policies have a known premium.',
    '5 unknown', '1800 duplicate seconds removed', '3 calls matched same-agent/campaign session intervals',
    '2 unmatched calls stay in Calls Made', '2h 0m 0s', '3m 21s',
    'Each panel is calculated independently', 'unavailable campaign attribution',
    '5 outbound calls are not linked to a current lead',
  ]) assert.ok(content.includes(text), `Rendered report contains ${text}`);
  const unknownRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Filter reports to Synthetic admin', exact: true }) });
  assert.match(await unknownRow.innerText(), /—[\s\S]*0\/1 known/);
  assert.ok(!(await unknownRow.innerText()).includes('$0.00'), 'all-unknown premium never presented as zero');
  assert.match(await section('agent_efficiency').innerText(), /1\.5/, '3 interval-matched calls / 2 hours');
  assert.equal((await sectionOrder('stats')).length, 6, 'six grouped default metrics');
  assert.deepEqual(await sectionOrder('trends'), ['policies_sold', 'call_volume'], 'fixed production and calling trends');
  for (const [width, height] of [[1440, 1050], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await measure(`reports-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const summaryCsv = await exportFile(page.getByRole('button', { name: 'Export', exact: true }), 'report-summary-2026-10-01-to-2026-10-01.csv');
  for (const text of ['"Talk time (seconds)",201', '"Dialer session time (seconds)",7200', '"Known annual premium",14406', '"Policies with unknown premium",5', 'reports_integrity_v2', payloads.summary.as_of]) {
    assert.ok(summaryCsv.includes(text), `Summary CSV preserves ${text}`);
  }
  const campaignCsv = await exportFile(section('campaign_performance').getByRole('button', { name: 'Export Campaign Performance CSV', exact: true }), 'campaign-performance-2026-10-01-to-2026-10-01.csv');
  assert.ok(campaignCsv.includes('"Attribution unavailable","",1,"","","","","",8,14406,"3/8"'));
  const agentsCsv = await exportFile(section('agent_performance_cards').getByRole('button', { name: 'Export Agent Performance CSV', exact: true }), 'agent-performance-2026-10-01-to-2026-10-01.csv');
  assert.ok(agentsCsv.includes('"Synthetic admin","Active",0,0,"",0,1,0,0,0,"",0,1'), 'unknown numeric fields export blank');
  const formulaDownload = page.waitForEvent('download');
  await page.evaluate(() => window.reportsFixture.downloadFormulaExample());
  const formula = await formulaDownload;
  await formula.saveAs(`${output}/fixture-formula-safety.csv`);
  assert.ok((await readFile(`${output}/fixture-formula-safety.csv`, 'utf8')).includes('"\'=1+1","",10.01'));
  console.log('PASS real Reports CSV downloads, exact values, blank unknowns and formula protection');

  await customize();
  await scopes();

  await page.evaluate(() => window.reportsFixture.fail('campaigns'));
  await page.getByRole('button', { name: 'Refresh reports' }).click();
  await ready();
  const failure = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: 'Campaign Performance', exact: true }) });
  await failure.waitFor();
  assert.match(await failure.innerText(), /This is not a zero/);
  assert.equal(await failure.getByRole('button', { name: /Export.*CSV/ }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Export', exact: true }).isEnabled(), true, 'independent summary remains exportable');
  await page.screenshot({ path: `${output}/panel-failure.png`, fullPage: true });
  await page.evaluate(() => window.reportsFixture.fail(null));
  await failure.getByRole('button', { name: 'Try again' }).click();
  await section('campaign_performance').getByRole('button', { name: 'Export Campaign Performance CSV', exact: true }).waitFor();
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
