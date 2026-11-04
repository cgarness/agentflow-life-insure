// Reports v3 isolated browser gate (D6 §4.10). Runs against the isolated Vite harness (stubs.ts) on SQL-generated v3
// payloads and the labelled synthetic scenarios. Blocks every external request; records screenshots, RPC requests,
// CSV downloads, axe results and a summary. Synthetic data only.
//   PLAYWRIGHT_MODULE=<…/node_modules/playwright> AXE_CORE_PATH=<…/axe.min.js> REPORTS_VISUAL_OUTPUT=<dir> node verify.mjs
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const axePath = process.env.AXE_CORE_PATH;
if (!axePath) throw new Error("axe precondition: set AXE_CORE_PATH to axe.min.js");
const AXE = readFileSync(axePath, "utf8");
const BASE = process.env.REPORTS_VISUAL_URL || "http://127.0.0.1:4180/";
const OUT = process.env.REPORTS_VISUAL_OUTPUT || "reports-visual-evidence";
mkdirSync(join(OUT, "screens"), { recursive: true }); mkdirSync(join(OUT, "csv"), { recursive: true });
const V3 = new Set(["scopeV3", "summaryV3", "journeyV3", "salesAppointmentsV3", "statesV3", "volumeV3", "dispositionsV3", "campaignsV3", "leadSourcesV3"]);
const VIEWPORTS = [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 640]];
const failures = [];
const summary = { checks: [], scenarios: {}, axe: {}, csv: [] };
const check = (name, ok, detail = "") => { summary.checks.push({ name, ok, detail }); if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`); };

const browser = await chromium.launch();
async function open({ scenario = "complete", width = 1440, height = 900, dark = true, dsf = 1, reducedMotion = "reduce", scope }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf, reducedMotion, acceptDownloads: true });
  await context.route("**/*", route => (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(route.request().url()) ? route.continue() : route.abort()));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${BASE}?scenario=${scenario}`);
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForTimeout(scenario === "loading" ? 1200 : 2200);
  if (scope) { await page.getByRole("tab", { name: scope }).dispatchEvent("mousedown", { button: 0 }); await page.waitForTimeout(2200); }
  return { context, page, errors };
}
const requests = page => page.evaluate(() => window.reportsFixture.requests());

// Font precondition: the budgets are measured in Inter.
{
  const { context, page } = await open({});
  const ok = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.family.includes("Inter") && f.status === "loaded").length >= 1; });
  check("font precondition (Inter loaded)", ok);
  await context.close();
}

for (const scenario of ["complete", "missing-premiums", "in-progress", "empty", "loading", "error", "unavailable"]) {
  const result = {};
  for (const [width, height] of VIEWPORTS) for (const dark of [true, false]) {
    const { context, page, errors } = await open({ scenario, width, height, dark });
    const tag = `${scenario}-${width}-${dark ? "dark" : "light"}`;
    const reqs = await requests(page);
    check(`${tag}: only v3 readers requested`, reqs.every(r => V3.has(r.panel)), JSON.stringify(reqs.map(r => r.panel)));
    check(`${tag}: no page error`, errors.length === 0, errors.join("; "));
    check(`${tag}: no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (scenario === "unavailable") check(`${tag}: v3 off requests no panel`, reqs.every(r => r.panel === "scopeV3"));
    if (["complete", "missing-premiums", "in-progress", "empty"].includes(scenario)) {
      const tiles = await page.evaluate(() => [...document.querySelectorAll("[data-kpi-id]")].map(t => ({ id: t.getAttribute("data-kpi-id"), chips: t.querySelectorAll("button[aria-expanded]").length })));
      check(`${tag}: exactly 23 metrics`, tiles.length === 23 && new Set(tiles.map(t => t.id)).size === 23);
      check(`${tag}: at most two chips per tile`, tiles.every(t => t.chips <= 2));
      const helpers = await page.evaluate(() => [...document.querySelectorAll("[data-report-helper]")].map(e => e.getAttribute("data-report-helper")));
      check(`${tag}: only the permitted helper lines`, helpers.every(h => h === "period-averages" || h === "regional-unmapped") && helpers.filter(h => h === "period-averages").length === 1);
      check(`${tag}: no % in Production`, !(await page.locator("[data-report-group='production']").innerText()).includes("%"));
      const order = await page.evaluate(() => [...new Set([...document.querySelectorAll("[data-report-group]")].map(e => e.getAttribute("data-report-group")))]);
      check(`${tag}: brief order`, JSON.stringify(order) === JSON.stringify(["production", "effort", "trends", "agent_performance_cards", "regional_performance", "calling_heatmap", "breakdowns"]), order.join(","));
    }
    if (width === 1440 || width === 390) await page.screenshot({ path: join(OUT, "screens", `${tag}.png`), fullPage: true, timeout: 180000 });
    if (scenario === "complete" && dark && width === 390) {
      const ap = await page.locator("[data-kpi-id='1']").boundingBox(), pol = await page.locator("[data-kpi-id='2']").boundingBox();
      check("390x844: AP and Policies sold end by y600 (first screen)", ap.y + ap.height <= 600 && pol.y + pol.height <= 600, `${ap.y + ap.height}/${pol.y + pol.height}`);
    }
    if (scenario === "complete" && dark && width === 1440) {
      const header = await page.locator("[data-kpi-id='1']").boundingBox();
      check("1440x900: production starts within the first screen", header.y < 900, String(header.y));
    }
    if ((width === 1440 || width === 390) && scenario === "complete") {
      await page.addScriptTag({ content: AXE });
      const axe = await page.evaluate(async () => (await window.axe.run(document.querySelector("[data-reports-workspace]"), { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })).violations.map(v => `${v.id}(${v.nodes.length})`));
      summary.axe[tag] = axe;
      check(`${tag}: axe has no violations`, axe.length === 0, axe.join(", "));
    }
    result[tag] = { requests: reqs.length };
    await context.close();
  }
  summary.scenarios[scenario] = result;
}

// Scopes, keyboard, reduced motion, zoom and CSV on the complete scenario.
{
  for (const scope of ["Team", "Personal"]) {
    const { context, page } = await open({ scope });
    const reqs = await requests(page);
    check(`${scope}: requests carry the scope`, reqs.filter(r => r.panel !== "scopeV3").some(r => r.args.p_requested_scope === scope.toLowerCase()));
    if (scope === "Personal") check("Personal: no agent table", (await page.locator("[data-report-group='agent_performance_cards']").count()) === 0);
    await page.screenshot({ path: join(OUT, "screens", `complete-${scope.toLowerCase()}-1440-dark.png`), fullPage: true, timeout: 180000 });
    await context.close();
  }
  const { context, page } = await open({ scenario: "missing-premiums" });
  const chip = page.locator("[data-kpi-id='1'] button[aria-expanded]").first();
  await chip.focus(); await page.keyboard.press("Enter");
  check("chip disclosure opens by keyboard", (await chip.getAttribute("aria-expanded")) === "true");
  await page.keyboard.press("Escape");
  check("chip disclosure closes with Escape", (await chip.getAttribute("aria-expanded")) === "false");
  const state = page.locator("svg[aria-label='Map of states'] path[tabindex='0']");
  await state.focus(); const first = await state.getAttribute("aria-label"); await page.keyboard.press("ArrowRight");
  const next = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  check("map arrows move focus by name", !!first && !!next && first !== next);
  const cell = page.locator("[role='grid'] [role='gridcell'][tabindex='0']");
  check("heatmap is one grid with one tab stop", (await cell.count()) === 1);
  await cell.focus(); await page.keyboard.press("ArrowRight"); await page.keyboard.press("Enter");
  check("heatmap arrows move and Enter pins a cell", (await page.locator("[role='gridcell'][aria-selected='true']").count()) === 1
    && (await page.locator("[data-heatmap-status]").innerText()).includes("calls made"));
  const animating = await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length);
  check("reduced motion: nothing animates", animating === 0, String(animating));
  const downloads = [];
  page.on("download", d => downloads.push(d));
  const buttons = page.getByRole("button", { name: /^Export .* CSV$|^Export$/ });
  const count = await buttons.count();
  for (let i = 0; i < count; i++) { await buttons.nth(i).click(); await page.waitForTimeout(450); }
  for (const d of downloads) {
    const path = join(OUT, "csv", d.suggestedFilename()); await d.saveAs(path);
    const text = readFileSync(path, "utf8");
    summary.csv.push({ file: d.suggestedFilename(), bytes: text.length });
    check(`csv ${d.suggestedFilename()}: v3 meta rows`, text.includes('"Basis version","reports_v3"') && text.includes('"Contract version"'));
  }
  check("at least one CSV downloaded", downloads.length > 0, String(downloads.length));
  await context.close();
  const zoom = await open({ width: 720, height: 450, dsf: 2 });
  check("720x450 DSF 2 (zoom): no page overflow", await zoom.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await zoom.page.screenshot({ path: join(OUT, "screens", "complete-720x450-zoom.png") });
  await zoom.context.close();
}

await browser.close();
summary.failures = failures;
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`${summary.checks.length - failures.length} of ${summary.checks.length} checks passed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
