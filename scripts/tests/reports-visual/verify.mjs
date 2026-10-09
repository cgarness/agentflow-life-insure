// Real browser + real Reports components/hooks/export code; synthetic SQL transport only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.REPORTS_VISUAL_URL || 'http://127.0.0.1:4180';
const target = new URL(url);
assert.equal(target.origin, 'http://127.0.0.1:4180', 'Only the isolated Reports fixture is allowed');
const output = process.env.REPORTS_VISUAL_OUTPUT || 'reports-visual-evidence';
await mkdir(`${output}/csv`, { recursive: true });
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
const header = () => page.locator('[data-reports-workspace] > header');
const asOf = () => page.getByTestId('report-as-of');
const customizeButton = () => page.getByRole('button', { name: 'Customize layout', exact: true });
const periodSelect = () => page.getByRole('combobox', { name: 'Report period', exact: true });
const dataBasis = () => page.getByRole('dialog', { name: 'Data basis', exact: true });
const band = () => page.getByRole('region', { name: 'Production overview', exact: true });
const premiumArticle = () => page.getByRole('article', { name: 'Known annual premium', exact: true });
const PERIOD_OPTIONS = ['Today', 'Yesterday', 'Last 7 days', 'Last 30 days', 'This month', 'Last month', 'Custom range'];
// Columns that must be visible without scrolling from 1024px, and reachable beside the pinned label below it.
const IMPORTANT_COLUMNS = {
  agent_performance_cards: ['Policies (current assignment)', 'Known annual premium'],
  campaign_performance: ['Policies (campaign-attributed)', 'Known annual premium'],
};
const SQL_WINDOW = '2026-10-01-to-2026-10-01';
// Every export control on the SQL window; file names come from the unchanged report names.
const EXPORT_FILES = ['report-summary', 'policies-sold', 'call-volume', 'agent-performance', 'agent-efficiency', 'campaign-performance',
  'lead-source-performance', 'disposition-breakdown', 'call-summary', 'calling-heatmap', 'call-flow-by-hour',
  'call-duration-by-disposition', 'disposition-deep-dive-by-agent'].map(name => `${name}-${SQL_WINDOW}.csv`).sort();
let payloads = null;
async function exportWithheld() {
  const button = page.getByRole('button', { name: 'Export', exact: true });
  assert.ok(await button.count() === 0 || !await button.isEnabled(), 'stale export is withheld');
}
async function sectionOrder(group) {
  return page.locator(`[data-report-group="${group}"] [data-report-section]`).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-report-section')));
}
async function choosePeriod(label) {
  await periodSelect().click();
  await page.getByRole('listbox').waitFor();
  assert.deepEqual((await page.getByRole('option').allInnerTexts()).map(text => text.trim()), PERIOD_OPTIONS, 'period options, sentence case, fixed order');
  await page.getByRole('option', { name: label, exact: true }).click();
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  assert.ok((await periodSelect().innerText()).includes(label), `period select shows ${label}`);
}
async function selectSqlWindow() {
  // On the default preset the fixture's unavailable panels still build sections, so Customize starts enabled.
  await page.waitForFunction(() => document.querySelector('button[aria-label="Customize layout"]')?.disabled === false);
  await choosePeriod('Custom range');
  await page.getByText('Pick a start and end date to run the report.', { exact: true }).waitFor();
  assert.equal(await customizeButton().isDisabled(), true, 'U-6: no customization while the range is incomplete');
  assert.equal(await page.getByRole('tab', { name: 'Agency', exact: true }).getAttribute('aria-controls'), null, 'U-8: no aria-controls before the panel exists');
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
  assert.equal(await page.getByRole('tab', { name: 'Agency', exact: true }).getAttribute('aria-controls'), 'reports-scope-panel', 'U-8: tabs reference the rendered panel');
  assert.equal(await page.locator('#reports-scope-panel').count(), 1);
}
async function exportFile(button, expectedName, dir = output) {
  await page.waitForTimeout(400); // Back-to-back downloads stall in Chromium; pace every export click.
  const pending = page.waitForEvent('download');
  await button.click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), expectedName);
  await download.saveAs(`${dir}/${expectedName}`);
  assert.equal(await download.failure(), null);
  return readFile(`${dir}/${expectedName}`, 'utf8');
}
async function ready() {
  // "Summary as of" renders only for a ready, current, non-withheld summary.
  await asOf().waitFor();
  await page.getByRole('button', { name: 'Export', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Export', exact: true }).isEnabled(), true);
  await page.waitForFunction(() => !document.querySelector('[data-report-state="loading"]'));
}
async function rowByHeader(id, rowLabel) {
  return section(id).evaluate((root, rowLabel) => {
    const table = root.querySelector('table');
    const heads = [...table.querySelectorAll('thead th')].map(th => th.innerText.replace(/\s+/g, ' ').trim());
    const row = [...table.querySelectorAll('tbody tr, tfoot tr')].find(tr => tr.firstElementChild?.innerText.includes(rowLabel));
    return row ? Object.fromEntries([...row.children].map((cell, i) => [heads[i] ?? `#${i}`, cell.innerText.trim()])) : null;
  }, rowLabel);
}
async function dataBasisFlow(label, check) {
  // Each trigger owns its Sheet: open by keyboard, focus moves in, geometry fits, focus returns on close.
  const triggers = [
    ['context', header().getByRole('button', { name: 'Data basis', exact: true }), 'Enter'],
    ['band', band().getByRole('button', { name: 'Data basis', exact: true }), 'Space'],
  ];
  let opened = 0;
  for (const [where, trigger, key] of triggers) {
    if (!await trigger.isVisible().catch(() => false)) continue;
    opened++;
    await trigger.focus();
    await page.keyboard.press(key);
    await dataBasis().waitFor();
    assert.ok(await dataBasis().evaluate(node => node.contains(document.activeElement)), `${label}/${where}: focus moves into Data basis`);
    await dataBasis().evaluate(node => Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished)));
    const box = await dataBasis().boundingBox(), viewport = page.viewportSize();
    if (viewport.width < 768) {
      assert.ok(box.y + box.height <= viewport.height + 1 && box.height <= viewport.height * 0.85 + 1, `${label}/${where}: bottom sheet at most 85dvh ${JSON.stringify(box)}`);
    } else {
      assert.ok(Math.abs(box.x + box.width - viewport.width) <= 1 && box.width <= 449, `${label}/${where}: right sheet at most 28rem ${JSON.stringify(box)}`);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}/${where}: sheet causes no page overflow`);
    if (check) await check(dataBasis(), where);
    if (where === 'context') await page.keyboard.press('Escape');
    else { await dataBasis().getByRole('button', { name: 'Close', exact: true }).focus(); await page.keyboard.press('Enter'); }
    await dataBasis().waitFor({ state: 'hidden' });
    assert.ok(await trigger.evaluate(node => node === document.activeElement), `${label}/${where}: focus returns to the trigger that opened it`);
    await trigger.evaluate(node => node.blur()); // keep later screenshots free of the focus ring
  }
  assert.ok(opened >= 1, `${label}: a Data basis trigger is reachable`);
  return opened;
}
async function customize() {
  const original = await sectionOrder('performance');
  await customizeButton().click();
  await editor().waitFor();
  await editor().evaluate(node => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${output}/customize-desktop-top.png` });
  // Production anchors: an anchored, case-insensitive name check, a label-independent id check, and a
  // positive control so neither can pass against an empty editor.
  assert.equal(await editor().getByRole('checkbox', { name: 'Show Calls made', exact: true }).count(), 1, 'editor lists registered metrics');
  assert.equal(await editor().getByRole('checkbox', { name: /^Show (Policies sold|Known annual premium)$/i }).count(), 0, 'production anchors cannot be hidden');
  assert.equal(await editor().locator('[data-customizer-section="stat_policies_sold"],[data-customizer-section="stat_annual_premium"]').count(), 0, 'production anchors are not registered');
  assert.equal(await editor().getByRole('checkbox', { name: 'Show Contacted calls', exact: true }).count(), 1, 'contacted calls label');
  assert.equal(await editor().getByRole('checkbox', { name: 'Show Dials per booking', exact: true }).count(), 1, 'R-1 approved label');
  assert.equal(await editor().getByRole('checkbox', { name: /Dials per appointment/i }).count(), 0, 'R-1 old label gone');
  const campaign = editor().getByRole('checkbox', { name: 'Show Campaign performance', exact: true });
  await campaign.uncheck();
  await section('campaign_performance').waitFor({ state: 'hidden' });
  await editor().getByRole('button', { name: 'Cancel', exact: true }).click();
  await editor().waitFor({ state: 'hidden' });
  assert.deepEqual(await sectionOrder('performance'), original, 'Cancel restores saved layout');
  assert.equal(await page.evaluate(() => window.reportsFixture.savedLayout()), null, 'Cancel does not persist a draft');

  await page.setViewportSize({ width: 390, height: 844 });
  await customizeButton().click();
  await editor().getByRole('button', { name: 'Move Lead sources up', exact: true }).click();
  await campaign.uncheck();
  const customized = await sectionOrder('performance');
  assert.ok(!customized.includes('campaign_performance'));
  // Named keyboard controls remain usable at the mobile width.
  const moveUp = editor().getByRole('button', { name: 'Move Lead sources up', exact: true });
  await moveUp.focus();
  await page.keyboard.press('Enter');
  let reordered = await sectionOrder('performance');
  assert.ok(reordered.indexOf('lead_source_roi') < reordered.indexOf('agent_efficiency'), 'keyboard action reorders within performance');
  // U-9: at the group edge the pressed button disables, so focus moves to the same item's other button.
  await page.keyboard.press('Enter');
  assert.equal(await moveUp.isDisabled(), true, 'first item cannot move up');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Move Lead sources down', 'U-9: focus stays on the moved item at the group edge');
  reordered = await sectionOrder('performance');
  assert.equal(reordered[0], 'lead_source_roi');
  const move = await editor().getByRole('button', { name: 'Move Lead sources down', exact: true }).boundingBox();
  assert.ok(move.width >= 40 && move.height >= 40, `mobile move targets are at least 40px ${JSON.stringify(move)}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile customizer has no page overflow');
  await editor().screenshot({ path: `${output}/customize-mobile.png` });
  await editor().evaluate(node => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${output}/customize-mobile-top.png` });
  const save = await editor().getByRole('button', { name: 'Save layout', exact: true }).boundingBox();
  assert.ok(save.y >= 0 && save.y + save.height <= 845, `sticky Save/Cancel bar is reachable on mobile ${JSON.stringify(save)}`);
  await editor().getByRole('button', { name: 'Save layout', exact: true }).click();
  await editor().waitFor({ state: 'hidden' });
  const saved = await page.evaluate(() => window.reportsFixture.savedLayout());
  assert.equal(saved.version, 4);
  assert.equal(saved.sections.find(section => section.id === 'campaign_performance').visible, false);

  // A full remount exercises preference loading, not merely current React state.
  await page.reload();
  await selectSqlWindow();
  assert.deepEqual(await sectionOrder('performance'), reordered, 'saved visibility/order survive page remount');
  await customizeButton().click();
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
  await customizeButton().click();
  await editor().getByRole('button', { name: 'Reset to default', exact: true }).click();
  await editor().waitFor({ state: 'hidden' });
  assert.deepEqual(await sectionOrder('performance'), original, 'Reset restores inherited default');
  assert.equal(await page.evaluate(() => window.reportsFixture.savedLayout()), null, 'Reset removes only the saved personal override');
  assert.deepEqual(await sectionOrder('trends'), ['policies_sold', 'call_volume'], 'customization never moves fixed trends');
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log('PASS mobile/keyboard customization, U-6/U-8/U-9, save/remount, cancel, reset and failed-save recovery');
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
  assert.equal(await asOf().count(), 0, 'freshness withheld while the new scope loads');
  await page.evaluate(() => window.reportsFixture.release());
  await ready();
  assert.equal(await page.getByRole('tab', { name: 'Personal', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await asOf().locator('time').getAttribute('datetime'), payloads.scopes.personal.summary.as_of, 'freshness belongs to the current scope summary');
  const personalPremium = await premiumArticle().innerText();
  assert.match(personalPremium, /Unavailable[\s\S]*0 of 1 premium known · 1 unknown excluded/);
  assert.ok(!personalPremium.includes('$0.00'), 'all-unknown premium never $0.00');
  assert.match(personalPremium, /Avg (per|\/) known policy\s*—/, 'zero known premiums: the average has no denominator');
  assert.equal(await premiumArticle().getByText('Partial', { exact: true }).count(), 0, 'no Partial chip when nothing is known');
  assert.equal(await section('agent_performance_cards').count(), 0, 'personal view has no team performance panel');
  assert.equal(await band().getByText('Most policies — current assignments', { exact: true }).count(), 0, 'no leader row in Personal');
  for (const name of ['Team', 'Agency']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await ready();
    assert.equal(await page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected'), 'true');
    assert.match(await band().innerText(), name === 'Team'
      ? /Most policies — current assignments[\s\S]*Synthetic admin · 1 policy\b/
      : /Most policies — current assignments[\s\S]*Synthetic agent · 7 policies/, `${name} leader row from the same summary`);
  }
  assert.ok((await premiumArticle().innerText()).includes('$14,406.00'));
  const requests = await page.evaluate(() => window.reportsFixture.requests());
  for (const requestedScope of ['personal', 'team', 'agency']) {
    for (const panel of ['scope', 'summary', 'volume', 'dispositions', 'campaigns', 'leadSources']) {
      assert.ok(requests.some(request => request.panel === panel && request.accepted &&
        (request.args.p_requested_scope === requestedScope || requestedScope === 'agency' && request.args.p_requested_scope === null)), `${requestedScope}/${panel} used a genuine matching SQL payload`);
    }
    assert.ok(requests.some(request => request.panel === 'summary' && request.accepted && request.args.p_requested_scope === requestedScope && request.args.p_agent_id === null), `${requestedScope} clears narrowed agent filter`);
  }
  console.log('PASS Personal / Team / Agency SQL-payload transitions, leader row, agent reset and stale-export withholding');
}
async function refreshNeverRepaintsStale() {
  // R-4: after Refresh, the previous summary must never be committed to the screen again.
  const sent = (await page.evaluate(() => window.reportsFixture.requests())).filter(request => request.panel === 'summary').length;
  await page.evaluate(() => {
    const read = () => !!document.querySelector('[aria-label="Known annual premium"]')?.textContent.includes('$14,406.00');
    window.__reportFrames = [read()];
    window.__reportObserver = new MutationObserver(() => window.__reportFrames.push(read()));
    window.__reportObserver.observe(document.getElementById('root'), { childList: true, subtree: true, characterData: true });
    window.reportsFixture.hold('summary');
  });
  await page.getByRole('button', { name: 'Refresh reports' }).click();
  await page.waitForFunction(count => window.reportsFixture.requests().filter(request => request.panel === 'summary').length > count, sent);
  await page.waitForFunction(() => !!document.querySelector('[data-report-state="loading"]'));
  await page.waitForTimeout(300);
  const frames = await page.evaluate(() => { window.__reportObserver.disconnect(); return window.__reportFrames; });
  const cleared = frames.indexOf(false);
  assert.ok(cleared > 0, `Refresh clears the previous summary ${JSON.stringify(frames)}`);
  assert.ok(!frames.slice(cleared).includes(true), `R-4: the previous summary is never re-committed ${JSON.stringify(frames)}`);
  assert.equal(await asOf().count(), 0, 'no freshness while the refreshed summary loads');
  await exportWithheld();
  await page.evaluate(() => window.reportsFixture.release());
  await ready();
  assert.ok((await premiumArticle().innerText()).includes('$14,406.00'), 'refreshed summary renders');
  console.log('PASS R-4 Refresh frame probe', JSON.stringify(frames));
}
async function firstScreen(label) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const m = await page.evaluate(() => {
    const box = el => el?.getBoundingClientRect();
    // A control's target includes an absolutely positioned ::after hit area (the 20px Data basis link has a 40px one).
    const target = el => {
      const r = box(el), after = getComputedStyle(el, '::after'), px = v => parseFloat(v) || 0;
      const extended = after.content !== 'none' && after.position === 'absolute';
      const h = extended ? Math.max(r.height, r.height - px(after.top) - px(after.bottom)) : r.height;
      const w = extended ? Math.max(r.width, r.width - px(after.left) - px(after.right)) : r.width;
      const cx = r.left + r.width / 2, extra = (h - r.height) / 2;
      const hits = (y) => { const hit = document.elementFromPoint(cx, y); return !!hit && (hit === el || el.contains(hit)); };
      return { h, w, hit: extra < 1 || (hits(r.top - extra + 1) && hits(r.bottom + extra - 1)) };
    };
    const head = document.querySelector('[data-reports-workspace] > header');
    const period = head.querySelector('[role="combobox"][aria-label="Report period"]');
    const start = head.querySelector('button[aria-label="Start Date"]');
    // The fixture runs on a Custom range; its date row is measured so preset budgets can be checked too.
    const customBlock = start && box(start).top >= box(period).bottom - 1 ? box(start).bottom - box(period).bottom : 0;
    const hero = ['Policies sold', 'Known annual premium'].map(name => box(document.querySelector(`[aria-label="${name}"] [data-report-value="hero"]`)));
    const tablist = head.querySelector('[role="tablist"]');
    return {
      width: innerWidth, height: innerHeight, headerTop: box(head).top, header: box(head).height, customBlock,
      hero: hero.map(h => h && { top: h.top, bottom: h.bottom }),
      tiles: [...document.querySelectorAll('[data-report-group="stats"] [data-report-section]')].map(tile => box(tile).bottom),
      trendsTitle: box(document.getElementById('report-trends-title'))?.bottom ?? null,
      tablist: tablist ? box(tablist).height : null,
      // Tabs sit inside an h-10 p-1 list (32px triggers in a 40px bar); every other header control is at least 40x40.
      smallControls: [...head.querySelectorAll('button, [role="combobox"], [role="tab"]')].filter(el => el.offsetParent)
        .map(el => ({ name: el.getAttribute('aria-label') || el.textContent.trim(), tab: el.getAttribute('role') === 'tab', ...target(el) }))
        .filter(c => c.tab ? c.h < 32 || !tablist || box(tablist).height < 40 : c.h < 40 || c.w < 40 || !c.hit),
    };
  });
  await writeFile(`${output}/${label}-first-screen.json`, JSON.stringify(m, null, 2));
  assert.ok(m.hero.every(Boolean), `${label}: both production values render`);
  assert.ok(m.hero.every(h => h.top >= 64 && h.bottom <= m.height), `${label}: both production values on the first screen below the TopBar ${JSON.stringify(m.hero)}`);
  if (m.width < 640) {
    assert.ok(m.customBlock <= 56, `${label}: custom date row stays one 40px row (${m.customBlock}px)`);
    assert.deepEqual(m.smallControls, [], `${label}: header targets are at least 40px`);
    if (m.height >= 800) {
      const filters = m.header - m.customBlock, heroBottom = Math.max(...m.hero.map(h => h.bottom)) - m.customBlock;
      assert.ok(filters <= 216, `${label}: filter block ${filters}px (before 427; budget 216)`);
      assert.ok(heroBottom <= 380, `${label}: production values end at y${heroBottom} (before 710/982; budget 380)`);
      assert.equal(m.tiles.length, 6);
      const tilesBottom = Math.max(...m.tiles) - m.customBlock;
      assert.ok(tilesBottom <= 844, `${label}: six metrics end at y${tilesBottom} (before 1723; budget 844)`);
    }
  }
  if (m.width >= 1280) {
    assert.ok(m.header <= 150, `${label}: desktop header ${m.header}px (before 223/275; budget 150)`);
    assert.ok(Math.max(...m.tiles) <= m.height && m.trendsTitle !== null && m.trendsTitle <= m.height, `${label}: strip and Trends heading on the first screen`);
  }
  console.log('PASS', `${label} first screen`, JSON.stringify({ header: m.header, customBlock: m.customBlock, hero: m.hero, tiles: Math.max(...m.tiles), trendsTitle: m.trendsTitle }));
}
async function tableCues(label) {
  const width = page.viewportSize().width;
  const tables = await page.evaluate(important => [...document.querySelectorAll('[data-reports-workspace] table')].map(table => {
    let scroller = table.parentElement;
    while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
    const id = table.closest('[data-report-section]')?.getAttribute('data-report-section') ?? 'unknown';
    const box = (scroller ?? table).getBoundingClientRect();
    const alpha = el => { const n = getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []; return n.length === 3 ? 1 : n.length === 4 ? Number(n[3]) : 0; };
    const firstCells = [...table.querySelectorAll('tr > :first-child')];
    const labelledBy = scroller?.getAttribute('aria-labelledby');
    return {
      id, overflow: !!scroller && scroller.scrollWidth > scroller.clientWidth + 1,
      scrollWidth: scroller?.scrollWidth ?? null, clientWidth: scroller?.clientWidth ?? null,
      role: scroller?.getAttribute('role') ?? null,
      name: scroller?.getAttribute('aria-label') || (labelledBy && document.getElementById(labelledBy)?.textContent.trim()) || null,
      tabIndex: scroller?.tabIndex ?? null,
      direct: scroller === table.parentElement,
      sticky: firstCells.length > 0 && firstCells.every(cell => getComputedStyle(cell).position === 'sticky'),
      opaque: firstCells.every(cell => alpha(cell) >= 0.99),
      fade: [...(scroller?.parentElement?.querySelectorAll(':scope > [data-scroll-fade]') ?? [])].some(cue => getComputedStyle(cue).display !== 'none'),
      hiddenImportant: (important[id] ?? []).filter(name => {
        const th = [...table.querySelectorAll('thead th')].find(head => head.innerText.replace(/\s+/g, ' ').trim() === name);
        if (!th) return true;
        const r = th.getBoundingClientRect();
        return r.left < box.left - 1 || r.right > box.right + 1;
      }),
    };
  }), IMPORTANT_COLUMNS);
  await writeFile(`${output}/${label}-tables.json`, JSON.stringify(tables, null, 2));
  for (const id of Object.keys(IMPORTANT_COLUMNS)) assert.ok(tables.some(t => t.id === id), `${label}: ${id} table rendered`);
  for (const t of tables) {
    if (t.overflow) {
      assert.equal(t.role, 'region', `${label}/${t.id}: scrolling table is a labelled region`);
      assert.ok(t.name, `${label}/${t.id}: region name`);
      assert.equal(t.tabIndex, 0, `${label}/${t.id}: region is keyboard-focusable`);
      assert.ok(t.direct, `${label}/${t.id}: the table is the region's direct child`);
      assert.ok(t.sticky && t.opaque, `${label}/${t.id}: opaque sticky first column`);
      if (width < 640) assert.ok(t.fade, `${label}/${t.id}: mobile right-edge cue`);
    }
    if (width >= 1024) assert.deepEqual(t.hiddenImportant, [], `${label}/${t.id}: important columns visible without scrolling`);
  }
  if (width < 1024) for (const id of Object.keys(IMPORTANT_COLUMNS)) {
    const region = section(id).locator('[role="region"][tabindex="0"]:has(> table)');
    if (!await region.count() || !await region.evaluate(el => el.scrollWidth > el.clientWidth + 1)) continue;
    await region.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    // Keyboard scrolling is animated (smooth), so wait for it to land rather than reading it at once.
    const scrolled = await region.evaluate(el => new Promise(resolve => {
      const started = performance.now();
      const poll = () => el.scrollLeft > 0 || performance.now() - started > 2000 ? resolve(el.scrollLeft) : requestAnimationFrame(poll);
      poll();
    }));
    assert.ok(scrolled > 0, `${label}/${id}: arrow keys scroll the focused table`);
    const reach = await region.evaluate((el, names) => names.map(name => {
      const th = [...el.querySelectorAll('thead th')].find(head => head.innerText.replace(/\s+/g, ' ').trim() === name);
      el.scrollLeft = 0; // from the start, so 'nearest' never tucks a column under the sticky label
      th.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      const box = el.getBoundingClientRect(), r = th.getBoundingClientRect();
      const pinned = el.querySelector('thead tr > :first-child').getBoundingClientRect();
      return { name, visible: r.right <= box.right + 1 && r.left >= pinned.right - 1, pinned: Math.abs(pinned.left - box.left) <= 2 };
    }), IMPORTANT_COLUMNS[id]);
    assert.ok(reach.every(x => x.visible && x.pinned), `${label}/${id}: important columns reachable beside the pinned row label ${JSON.stringify(reach)}`);
    await region.evaluate(el => { el.scrollLeft = 0; });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  console.log('PASS', `${label} table cues`, JSON.stringify(tables.map(t => [t.id, t.overflow, t.hiddenImportant.length])));
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
  const measurements = await page.evaluate(() => {
    const nonblank = node => { const box = node.getBBox(); return box.width > 1 && box.height > 1; };
    // Every leaf money node, measured on its nearest non-inline box (an inline span never reports overflow).
    const money = [...document.querySelectorAll('[data-reports-workspace] *')].filter(node => node.children.length === 0 && /^\$[\d,]+\.\d{2}$/.test(node.textContent.trim()));
    const clipped = money.filter(node => {
      let block = node;
      while (block && getComputedStyle(block).display === 'inline') block = block.parentElement;
      return block.scrollWidth > block.clientWidth + 1;
    });
    return {
      viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
      overlay: !!document.querySelector('vite-error-overlay'),
      charts: [...document.querySelectorAll('.recharts-wrapper')].length,
      dispositionRows: [...document.querySelectorAll('[data-report-section="conversion_funnel"] li')]
        .filter(li => li.innerText.trim() && [...li.querySelectorAll('[aria-hidden="true"] > div')].some(bar => bar.getBoundingClientRect().width > 1)).length,
      trendBars: ['policies_sold', 'call_volume'].map(id => [...document.querySelectorAll(`[data-report-section="${id}"] .recharts-bar-rectangle path`)].filter(nonblank).length),
      moneyChecked: money.length,
      monetaryClipping: clipped.map(node => node.textContent.trim()),
      heroLines: ['Policies sold', 'Known annual premium'].map(name => {
        const value = document.querySelector(`[aria-label="${name}"] [data-report-value="hero"]`);
        if (!value) return 0;
        const range = document.createRange();
        range.selectNodeContents(value);
        return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size;
      }),
      headings: [...document.querySelectorAll('h1,h2,h3')].map(node => node.textContent),
      hierarchy: ['[aria-label="Production overview"]', '[data-report-group="stats"]', '[data-report-group="trends"]', 'section[aria-labelledby="report-totals-title"]', '[data-report-group="performance"]', '[data-report-group="diagnostics"]']
        .map(selector => ({ selector, top: document.querySelector(selector)?.getBoundingClientRect().top })),
    };
  });
  assert.ok(measurements.pageWidth <= measurements.viewport + 1, `${label}: horizontal page overflow ${JSON.stringify(measurements)}`);
  assert.equal(measurements.overlay, false);
  assert.ok(measurements.charts >= 4, `${label}: two single-axis panels per trend card`);
  assert.ok(measurements.dispositionRows >= 2, `${label}: ranked disposition rows with text and a share bar`);
  assert.ok(measurements.trendBars.every(count => count >= 1), `${label}: nonblank production and calling bars ${JSON.stringify(measurements.trendBars)}`);
  assert.ok(measurements.moneyChecked >= 3, `${label}: money nodes were checked (${measurements.moneyChecked})`);
  assert.deepEqual(measurements.monetaryClipping, [], `${label}: monetary values must show their cents`);
  assert.deepEqual(measurements.heroLines, [1, 1], `${label}: hero values never wrap`);
  for (let i = 1; i < measurements.hierarchy.length; i++) {
    assert.ok(measurements.hierarchy[i].top > measurements.hierarchy[i - 1].top, `${label}: executive-first hierarchy ${JSON.stringify(measurements.hierarchy)}`);
  }
  await page.screenshot({ path: `${output}/${label}.png`, fullPage: true });
  await band().screenshot({ path: `${output}/${label}-production-overview.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${output}/${label}-top.png` });
  // Tailwind's class-based theme is applied only to the isolated synthetic page.
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: dark theme has no horizontal overflow`);
  await page.screenshot({ path: `${output}/${label}-dark-top.png` });
  await band().screenshot({ path: `${output}/${label}-dark-production-overview.png` });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await writeFile(`${output}/${label}.json`, JSON.stringify(measurements, null, 2));
  console.log('PASS', label, JSON.stringify({ ...measurements, headings: undefined, hierarchy: undefined }));
}
async function exportAll() {
  // Every export control (collapsed panels keep theirs), downloaded once, paced, with filenames pinned.
  const buttons = [page.getByRole('button', { name: 'Export', exact: true }), ...await page.getByRole('button', { name: /^Export .+ CSV$/ }).all()];
  const manifest = [];
  for (const button of buttons) {
    const name = await button.getAttribute('aria-label') ?? 'Export';
    await page.waitForTimeout(400);
    const pending = page.waitForEvent('download');
    await button.click();
    const download = await pending;
    assert.equal(await download.failure(), null);
    const file = `${output}/csv/${download.suggestedFilename()}`;
    await download.saveAs(file);
    const bytes = await readFile(file);
    // "Generated" is the client clock; drop it so the same payload always hashes the same.
    const normalized = bytes.toString('utf8').split('\n').filter(line => !line.startsWith('"Generated",')).join('\n');
    manifest.push({ button: name, file: download.suggestedFilename(), bytes: bytes.length, normalizedSha256: createHash('sha256').update(normalized).digest('hex') });
  }
  assert.deepEqual(manifest.map(entry => entry.file).sort(), EXPORT_FILES, 'every export control downloads its unchanged file name');
  await writeFile(`${output}/csv/manifest.json`, JSON.stringify(manifest, null, 1));
  console.log('PASS', `${manifest.length} paced CSV downloads`, JSON.stringify(manifest.map(entry => [entry.button, entry.file])));
}
try {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Reports', exact: true }).waitFor();
  // The real default preset, before the fixture moves to its SQL window.
  await page.getByRole('tab', { name: 'Agency', exact: true }).waitFor();
  assert.ok((await periodSelect().innerText()).includes('Last 30 days'), 'default period preserved');
  await page.setViewportSize({ width: 390, height: 844 });
  const presetHeader = await header().evaluate(el => el.getBoundingClientRect().height);
  assert.ok(presetHeader <= 216, `phone filter block on a preset is ${presetHeader}px (before 427; budget 216)`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await selectSqlWindow();
  assert.equal(await page.getByTestId('report-period').innerText(), 'Oct 1, 2026 – Oct 1, 2026');
  payloads = await page.evaluate(() => window.reportsFixture.payloads);
  assert.equal(payloads.summary.totals.policies_sold, 8);
  assert.equal(payloads.summary.totals.premium.annual_premium, 14406);
  assert.equal(payloads.summary.totals.premium.known_count, 3);
  assert.equal(payloads.summary.totals.session_seconds, 7200);
  assert.equal(payloads.summary.totals.talk_time_seconds, 201);
  assert.equal(payloads.summary.by_agent.find(a => a.name === 'Synthetic admin').premium.annual_premium, null);
  assert.equal(await asOf().locator('time').getAttribute('datetime'), payloads.summary.as_of, 'as-of from the current summary');
  const efficiencyToggle = section('agent_efficiency').getByRole('button', { name: 'Agent efficiency', exact: true });
  if (await efficiencyToggle.getAttribute('aria-expanded') === 'false') await efficiencyToggle.click();
  const content = await page.locator('body').innerText();
  for (const text of ['Bookings created (all types)', '$14,406.00', '2h 0m 0s', '3m 21s']) {
    assert.ok(content.includes(text), `Rendered report contains ${text}`);
  }
  // Production band: exact cents, coverage in words, Partial only for 0 < known < count, never a percentage.
  const premium = await premiumArticle().innerText();
  assert.ok(premium.includes('3 of 8 premiums known · 5 unknown excluded'), 'premium coverage in words');
  assert.match(premium, /Known monthly\s*\$1,200\.50/);
  assert.match(premium, /Avg (per|\/) known policy\s*\$4,802\.00/);
  assert.equal(await premiumArticle().getByText('Partial', { exact: true }).count(), 1, 'Partial chip for a partly known premium');
  assert.ok(!/\d%/.test(await band().innerText()), 'no percentage in the production band');
  assert.match(await page.getByRole('article', { name: 'Policies sold', exact: true }).innerText(), /8[\s\S]*Primary \+ additional policies/);
  assert.match(await band().innerText(), /Most policies — current assignments[\s\S]*Synthetic agent · 7 policies/, 'agency leader row');
  // Six-metric strip: exact labels and values, one duration format, data-quality cautions in place.
  for (const [id, label, value] of [['stat_total_dials', 'Calls made', '5'], ['stat_total_contacted', 'Contacted calls', '1'], ['stat_contact_rate', 'Call contact rate', '20.0%'],
    ['stat_appointments_set', 'Bookings created (all types)', '2'], ['stat_total_talk_time', 'Talk time', '3m 21s'], ['stat_session_time', 'Dialer session time', '2h 0m 0s']]) {
    const [shownLabel, shownValue] = (await section(id).innerText()).split('\n').map(line => line.trim()).filter(Boolean);
    assert.deepEqual([shownLabel, shownValue], [label, value], `${id} tile`);
  }
  assert.ok((await section('stat_total_talk_time').innerText()).includes('5 unknown'), 'duration caution shown in place');
  assert.ok((await section('stat_session_time').innerText()).includes('1 stale, capped'), 'session caution shown in place');
  assert.ok(!/0h 3m 21s|(^|[^\d:])3:21(?!\d)/.test(await page.locator('body').innerText()), 'one exact duration format');
  // Period totals: independent dt/dd tiles, value first; no arrows and no percentages.
  const totals = page.locator('section[aria-labelledby="report-totals-title"]');
  assert.deepEqual(await totals.locator('dt').allInnerTexts(), ['Calls made', 'Contacted calls', 'Bookings created (all types)', 'Converted leads/clients', 'Policies sold']);
  assert.deepEqual(await totals.locator('dt + dd').allInnerTexts(), ['5', '1', '2', '0', '8']);
  assert.equal(await totals.locator('svg.lucide-arrow-right').count(), 0);
  assert.ok(!/%/.test(await totals.innerText()), 'no percentage in Period totals');
  // tfoot rows keep the attribution disclosures in their own columns.
  const unavailable = await rowByHeader('campaign_performance', 'Attribution unavailable');
  assert.ok(unavailable, 'campaign Attribution unavailable row');
  assert.equal(unavailable['Calls made'], '1');
  assert.equal(unavailable['Policies (campaign-attributed)'], '8');
  assert.ok(unavailable['Known annual premium'].includes('$14,406.00'));
  assert.equal(unavailable['Known / total policies'], '3/8');
  assert.ok((await section('campaign_performance').innerText()).includes('Campaign-attributed policies use conversion lineage only'), 'campaign lineage note');
  assert.equal(await section('campaign_performance').locator('tr[role="link"]').count(), 0, 'U-3: real links, no tr[role=link]');
  const unlinked = await rowByHeader('lead_source_roi', 'Not linked to a current lead');
  assert.ok(unlinked && unlinked['Calls made'] === '5', `unlinked source calls still disclosed with zero sources ${JSON.stringify(unlinked)}`);
  const unknownRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Filter reports to Synthetic admin', exact: true }) });
  assert.match(await unknownRow.innerText(), /—[\s\S]*0\/1 known/);
  assert.ok(!(await unknownRow.innerText()).includes('$0.00'), 'all-unknown premium never presented as zero');
  assert.match(await section('agent_efficiency').innerText(), /1\.5/, '3 interval-matched calls / 2 hours');
  assert.equal((await sectionOrder('stats')).length, 6, 'six grouped default metrics');
  assert.deepEqual(await sectionOrder('trends'), ['policies_sold', 'call_volume'], 'fixed production and calling trends');
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await firstScreen(`reports-${width}`);
    await measure(`reports-${width}`);
    await tableCues(`reports-${width}`);
    if (width === 768 || width === 390) await dataBasisFlow(`data-basis-${width}`);
  }
  await page.setViewportSize({ width: 390, height: 664 });
  await firstScreen('reports-390x664');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const summaryCsv = await exportFile(page.getByRole('button', { name: 'Export', exact: true }), `report-summary-${SQL_WINDOW}.csv`);
  for (const text of ['"Talk time (seconds)",201', '"Dialer session time (seconds)",7200', '"Known annual premium",14406', '"Policies with unknown premium",5', 'reports_integrity_v2', payloads.summary.as_of,
    '2 overlapping rows; 1800 duplicate seconds removed']) {
    assert.ok(summaryCsv.includes(text), `Summary CSV preserves ${text}`);
  }
  // Data basis shows the summary CSV's own Note sentences (the response stamp is shown as the localized as-of).
  const csvNotes = summaryCsv.split('\n').map(line => line.match(/^"Note","(.*)"\r?$/)?.[1]?.replace(/""/g, '"')).filter(Boolean)
    .filter(note => !note.startsWith('Response as of'));
  assert.ok(csvNotes.length >= 6, 'summary CSV carries its Note rows');
  await dataBasisFlow('data-basis-1440', async (sheet, where) => {
    const text = await sheet.innerText();
    // Live data quality is the CSV's own sentences (wording L6 replaced the old screen-only matched-calls line).
    for (const expected of ['2 overlapping rows; 1800 duplicate seconds removed', 'Session rate cohort: 3 matched calls, 2 unmatched calls retained in Calls Made',
      'Each panel is calculated independently', 'Callback dispositions count calls', ...csvNotes]) assert.ok(text.includes(expected), `Data basis shows ${expected}`);
    assert.equal(await sheet.locator(`time[datetime="${payloads.summary.as_of}"]`).count(), 1, 'as-of from the current summary');
    await sheet.screenshot({ path: `${output}/data-basis-1440-${where}.png` });
  });
  const campaignCsv = await exportFile(section('campaign_performance').getByRole('button', { name: 'Export Campaign performance CSV', exact: true }), `campaign-performance-${SQL_WINDOW}.csv`);
  assert.ok(campaignCsv.includes('"Attribution unavailable","",1,"","","","","",8,14406,"3/8"'));
  const agentsCsv = await exportFile(section('agent_performance_cards').getByRole('button', { name: 'Export Agent performance CSV', exact: true }), `agent-performance-${SQL_WINDOW}.csv`);
  assert.ok(agentsCsv.includes('"Synthetic admin","Active",0,0,"",0,1,0,0,0,"",0,1'), 'unknown numeric fields export blank');
  await page.waitForTimeout(400);
  const formulaDownload = page.waitForEvent('download');
  await page.evaluate(() => window.reportsFixture.downloadFormulaExample());
  const formula = await formulaDownload;
  await formula.saveAs(`${output}/fixture-formula-safety.csv`);
  assert.ok((await readFile(`${output}/fixture-formula-safety.csv`, 'utf8')).includes('"\'=1+1","",10.01'));
  await exportAll();
  console.log('PASS real Reports CSV downloads, exact values, blank unknowns, formula protection and Data basis parity');

  await customize();
  await scopes();
  await refreshNeverRepaintsStale();

  await page.evaluate(() => window.reportsFixture.fail('campaigns'));
  await page.getByRole('button', { name: 'Refresh reports' }).click();
  await ready();
  const failure = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: 'Campaign performance', exact: true }) });
  await failure.waitFor();
  assert.match(await failure.innerText(), /This is not a zero/);
  assert.equal(await failure.getByRole('button', { name: /Export.*CSV/ }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Export', exact: true }).isEnabled(), true, 'independent summary remains exportable');
  await page.screenshot({ path: `${output}/panel-failure.png`, fullPage: true });
  await page.evaluate(() => window.reportsFixture.fail(null));
  await failure.getByRole('button', { name: 'Try again' }).click();
  await section('campaign_performance').getByRole('button', { name: 'Export Campaign performance CSV', exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0, 'panel retry recovers');

  // Keyboard period selection: open, Home, two steps down, Enter; focus returns and the date pickers leave.
  // Radix moves focus on a timer, so each key waits until the focused option is the expected one.
  const focusedOption = expected => page.waitForFunction(text => {
    const active = document.activeElement;
    return active?.getAttribute('role') === 'option' && active.textContent.trim() === text;
  }, expected);
  await periodSelect().focus();
  await page.keyboard.press('Enter');
  await page.getByRole('listbox').waitFor();
  await focusedOption('Custom range'); // opens on the current selection
  assert.deepEqual((await page.getByRole('option').allInnerTexts()).map(text => text.trim()), PERIOD_OPTIONS, 'period options by keyboard');
  for (const [key, expected] of [['Home', 'Today'], ['ArrowDown', 'Yesterday'], ['ArrowDown', 'Last 7 days']]) {
    await page.keyboard.press(key);
    await focusedOption(expected);
  }
  await page.keyboard.press('Enter');
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  assert.ok((await periodSelect().innerText()).includes('Last 7 days'), 'keyboard selects Last 7 days');
  assert.ok(await periodSelect().evaluate(el => el === document.activeElement), 'focus returns to the period select');
  assert.equal(await page.getByRole('button', { name: 'Start Date', exact: true }).count(), 0, 'date pickers leave with Custom range');
  await page.waitForFunction(() => !!document.querySelector('[data-report-state="error"]') && !document.querySelector('[data-report-state="loading"]'));
  assert.equal(await page.getByRole('button', { name: 'Export', exact: true }).isEnabled(), false, 'unsupported window never exports stale data');
  assert.equal(await asOf().count(), 0, 'no freshness for a failed summary');
  assert.ok(!(await page.locator('body').innerText()).includes('$14,406.00'), 'prior window values are withheld');
  await dataBasisFlow('data-basis-unavailable', async sheet => {
    const text = await sheet.innerText();
    assert.ok(text.includes("Live data-quality counts are unavailable because the summary didn't load."), 'unavailable live data quality said in words');
    for (const stale of ['1800', '$14,406.00', '3 matched calls', 'Session rate cohort']) assert.ok(!text.includes(stale), `sheet withholds ${stale}`);
    assert.equal(await sheet.locator('time[datetime]').count(), 0, 'no as-of for a failed summary');
  });
  const requests = await page.evaluate(() => window.reportsFixture.requests());
  for (const key of ['scope', 'summary', 'volume', 'dispositions', 'campaigns', 'leadSources']) {
    assert.ok(requests.some(r => r.panel === key && r.accepted), `real hook requested ${key}`);
  }
  assert.ok(requests.some(r => !r.accepted), 'unsupported windows fail explicitly');
  await writeFile(`${output}/rpc-requests.json`, JSON.stringify(requests, null, 2));
  assert.deepEqual(external, [], 'fixture must never contact external data services');
  assert.deepEqual(errors, [], 'uncaught browser errors');
  assert.deepEqual(consoleErrors, [], 'unexpected browser console errors');
  console.log('PASS all six SQL payloads through real hooks, partial failure/retry, keyboard period select and stale-window protection');
} catch (error) {
  console.error('Browser errors:', JSON.stringify({ errors, consoleErrors, external }));
  console.error('Visible state:', (await page.locator('body').innerText()).slice(0, 6000));
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  throw error;
} finally { await browser.close(); }
