// Isolated real-browser gate. Only the dedicated synthetic Vite adapter is allowed; all external browser requests fail.
// PLAYWRIGHT_MODULE=/.../playwright AXE_CORE_PATH=/.../axe.min.js COMMISSION_BROWSER_OUTPUT=/... node this-file.mjs
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.COMMISSION_BROWSER_URL || "http://127.0.0.1:4186/";
const output = process.env.COMMISSION_BROWSER_OUTPUT || "commission-browser-evidence";
const cpuRate = Number(process.env.COMMISSION_BROWSER_CPU_RATE || 1);
const axe = readFileSync(process.env.AXE_CORE_PATH || require.resolve("axe-core/axe.min.js"), "utf8");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/$/.test(base)) throw new Error("Browser gate requires a loopback synthetic server.");
if (!Number.isFinite(cpuRate) || cpuRate < 1 || cpuRate > 20) throw new Error("CPU throttle must be between 1 and 20.");
mkdirSync(output, { recursive: true });
const started = Date.now();
const results = { fixture: "Team Commissions isolated synthetic browser", started_at: new Date(started).toISOString(),
  browser: "", cpu_rate: cpuRate, duration_ms: 0, checks: [], screenshots: [], requests: [] };
let activePage = null;
const check = (name, pass, detail = null) => { results.checks.push({ name, pass, detail }); if (!pass) console.error(`FAIL ${name}: ${JSON.stringify(detail)}`); };
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
results.browser = browser.version();
const calls = (page) => page.evaluate(() => window.commissionFixture.requests());
const financial = (requests) => requests.filter((r) => r.name.startsWith("get_scoped_"));
const location = (page) => page.getByTestId("location").textContent();
const changed = (page, route) => page.evaluate((value) => window.commissionFixture.navigate(value), route);
const noMoney = (page) => page.evaluate(() => {
  const pattern = /\$\s?\d/;
  return !pattern.test(document.body.innerText) && [...document.querySelectorAll("[aria-label],[aria-valuetext],[title]")]
    .every((node) => ["aria-label", "aria-valuetext", "title"].every((attribute) => !pattern.test(node.getAttribute(attribute) || "")));
});
async function open({ route = "/commissions", scenario = "team", width = 1440 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion: "reduce" });
  const blocked = [], errors = [];
  await context.route("**/*", (request) => {
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(request.request().url())) return request.continue();
    blocked.push(request.request().url()); return request.abort();
  });
  const page = await context.newPage();
  activePage = page;
  if (cpuRate > 1) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}?scenario=${scenario}&route=${encodeURIComponent(route)}`);
  await page.waitForFunction(() => !!window.commissionFixture);
  return { context, page, blocked, errors };
}
const ready = (page) => page.getByRole("link", { name: "Expected", exact: true }).waitFor();
async function openAgentsByKeyboard(page, trigger) {
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Choose agents", exact: true }).waitFor();
  // Visibility precedes Radix's passive-effect autofocus and dismissable-layer registration.
  // Observe its normal focus transfer before sending the next key; do not force focus or retry Escape.
  await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label="Choose agents"]')?.contains(document.activeElement));
}
const choose = async (page, name) => {
  await page.getByRole("button", { name: /^Agents:/ }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
};
const capture = async (page, filename) => { await page.screenshot({ path: join(output, filename), fullPage: true }); results.screenshots.push(filename); };

try {
  for (const width of [1440, 390]) {
    const { context, page, errors, blocked } = await open({ route: "/commissions?agents=all", width });
    await ready(page);
    check(`U15 ${width}: no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check(`U09 ${width}: Overview team writes absent`, await page.getByRole("button", { name: "Record payment", exact: true }).count() === 0);
    check(`U12 ${width}: no goal requests`, !(await calls(page)).some((r) => r.name.includes("goal")));
    await capture(page, width === 1440 ? "desktop.png" : "mobile.png");
    await page.addScriptTag({ content: axe });
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), {
      runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    })).violations.map((v) => ({ id: v.id, count: v.nodes.length })));
    check(`U15 ${width}: accessibility`, violations.length === 0, violations);
    await page.getByRole("link", { name: "Payments", exact: true }).click();
    await page.getByRole("table", { name: "Scheduled payments" }).waitFor();
    check(`U09 ${width}: Scheduled writes absent`, await page.getByRole("button", { name: "Record payment", exact: true }).count() === 0);
    check(`U15 ${width}: Scheduled no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole("button", { name: "History", exact: true }).click();
    await page.getByRole("table", { name: "Payment history" }).waitFor();
    check(`U03 ${width}: History retains All`, (await location(page)).includes("agents=all"));
    await page.getByRole("link", { name: "Policies", exact: true }).click();
    await page.getByRole("table", { name: "Policies" }).waitFor();
    check(`U09 ${width}: Policies writes absent`, await page.getByRole("button", { name: "Record estimate", exact: true }).count() === 0);
    await page.getByRole("button", { name: "Hide amounts", exact: true }).click();
    check(`U14 ${width}: team list masked`, await noMoney(page));
    await page.getByRole("button", { name: /Client 1/ }).click();
    await page.getByText(/^Estimated commission/).waitFor();
    check(`U14 ${width}: team drawer masked`, await noMoney(page));
    check(`U09 ${width}: drawer mutations absent`, await page.getByRole("button", { name: /Record payment|Record estimate|Edit dates|Place on hold|Void|Confirm|Dismiss/ }).count() === 0);
    check(`U15 ${width}: no runtime errors`, errors.length === 0, errors);
    check(`isolation ${width}: no external browser requests`, blocked.length === 0, blocked);
    results.requests.push({ scenario: `all-${width}`, requests: await calls(page) });
    await context.close();
  }

  {
    const { context, page } = await open();
    await ready(page);
    const original = await location(page), reads = financial(await calls(page)).length;
    const trigger = page.getByRole("button", { name: "Agents: Me", exact: true });
    await openAgentsByKeyboard(page, trigger);
    await page.getByRole("checkbox", { name: /Jordan Agent/ }).check();
    await page.getByLabel("Search agents", { exact: true }).fill("Jordan");
    await page.getByRole("checkbox", { name: /Jordan Agent/ }).waitFor();
    check("U01: draft/search makes no financial request", financial(await calls(page)).length === reads);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    check("U01: Cancel preserves selection", await location(page) === original);
    await trigger.click(); await page.getByRole("button", { name: "All agents", exact: true }).click();
    await page.keyboard.press("Escape");
    check("U01: Escape preserves selection", await location(page) === original);
    await trigger.click(); await page.getByRole("button", { name: "All agents", exact: true }).click();
    await page.getByRole("heading", { name: "Commissions", exact: true }).click();
    check("U01: dismissal preserves selection", await location(page) === original);
    await trigger.click();
    await page.getByRole("checkbox", { name: /Jordan Agent/ }).check();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.getByRole("button", { name: "Agents: 2 agents", exact: true }).waitFor();
    check("U02: default Me plus checked downline commits both", (await location(page)).includes("agents=selected"));
    const selected = financial(await calls(page)).at(-1)?.args.p_agent_ids;
    check("U02: default self selection retained", selected?.length === 2 && selected.includes("00000000-0000-4000-8000-000000000901"), selected);
    await page.getByRole("button", { name: /^Agents:/ }).click();
    await page.getByLabel("Search agents", { exact: true }).fill("nobody matches");
    await page.getByText("No matching agents", { exact: true }).waitFor();
    await page.getByRole("button", { name: "All agents", exact: true }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await ready(page);
    check("U17: All independent of empty picker search", (await location(page)).includes("agents=all") && financial(await calls(page)).at(-1)?.args.p_agent_ids === null);
    check("U02: no per-agent report fan-out", financial(await calls(page)).filter((r) => r.args.p_agent_scope === "all").length === 2);
    await context.close();
  }

  for (const scenario of ["view-as", "team-only", "empty", "only-self"]) {
    const { context, page } = await open({ scenario, route: scenario === "only-self" ? "/commissions?agents=all" : "/commissions" });
    if (scenario === "view-as") {
      await page.getByText("Commissions aren't available while viewing as another user.", { exact: true }).waitFor();
      check("A14: View As zero protected requests", (await calls(page)).length === 0);
    } else if (scenario === "empty") {
      await page.getByText("No agents available", { exact: true }).waitFor();
      check("A13: empty scope zero financial reads", financial(await calls(page)).length === 0);
    } else {
      await ready(page);
      if (scenario === "team-only") {
        check("A08: team-only default All", await page.getByRole("button", { name: "Agents: All agents", exact: true }).count() === 1);
        check("A08: no Calculator/goal", await page.getByRole("link", { name: "Calculator", exact: true }).count() === 0 && !(await calls(page)).some((r) => r.name.includes("goal")));
        await changed(page, "/commissions/calculator?agents=all");
        await page.getByText("Your role doesn't include the personal Calculator.", { exact: true }).waitFor();
      } else {
        check("U18: All self-only retains selector", await page.getByRole("button", { name: "Agents: All agents", exact: true }).count() === 1);
        await choose(page, "Me");
        await page.getByRole("button", { name: "Record payment", exact: true }).first().waitFor();
        check("U10/U18: return to Me restores controls", (await location(page)).includes("agents=me"));
      }
    }
    await context.close();
  }

  {
    const { context, page } = await open(); await ready(page);
    const trigger = page.getByRole("button", { name: "Agents: Me", exact: true });
    await openAgentsByKeyboard(page, trigger);
    await page.getByLabel("Search agents", { exact: true }).waitFor();
    await page.addScriptTag({ content: axe });
    const violations = await page.evaluate(async () => (await window.axe.run(document.body, {
      runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    })).violations.map((v) => ({ id: v.id, count: v.nodes.length })));
    check("U15: open selector accessibility", violations.length === 0, violations);
    const downline = page.getByRole("checkbox", { name: /Jordan Agent/ });
    for (let i = 0; i < 14 && !await downline.evaluate((node) => node === document.activeElement); i++) await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    const checked = await downline.isChecked();
    const apply = page.getByRole("button", { name: "Apply", exact: true });
    for (let i = 0; i < 14 && !await apply.evaluate((node) => node === document.activeElement); i++) await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Agents: 2 agents", exact: true }).waitFor();
    check("U15: keyboard Tab/Space/Enter commits two exact agents", checked && (await location(page)).includes("agents=selected"));
    const applied = await location(page);
    await page.goto(`${base}?scenario=team&route=${encodeURIComponent(applied)}`); await ready(page);
    check("U03: reload rehydrates committed selected URL", await location(page) === applied && await page.getByRole("button", { name: "Agents: 2 agents", exact: true }).count() === 1);
    const restoredTrigger = page.getByRole("button", { name: "Agents: 2 agents", exact: true });
    await openAgentsByKeyboard(page, restoredTrigger);
    await page.getByLabel("Search agents", { exact: true }).waitFor();
    check("U15: keyboard opening transfers focus into selector after reload", await page.getByRole("dialog", { name: "Choose agents", exact: true })
      .evaluate((node) => node.contains(document.activeElement)));
    await page.keyboard.press("Escape");
    await page.getByLabel("Search agents", { exact: true }).waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Agents: 2 agents");
    check("U15: Escape returns focus to selector trigger", await restoredTrigger.evaluate((node) => node === document.activeElement));
    await context.close();
  }

  {
    const { context, page } = await open(); await ready(page);
    const agents = await page.evaluate(() => ({ a: window.commissionFixture.TEAM_AGENT, b: window.commissionFixture.OTHER_AGENT }));
    await page.evaluate((id) => window.commissionFixture.hold(id), agents.a);
    await changed(page, `/commissions?agents=selected&agent_ids=${agents.a}`);
    await page.waitForFunction((id) => window.commissionFixture.requests().some((r) => r.name === "get_scoped_commission_overview" && r.args.p_agent_ids?.includes(id)), agents.a);
    await changed(page, `/commissions?agents=selected&agent_ids=${agents.b}`); await ready(page);
    await changed(page, "/commissions?agents=all"); await ready(page);
    await page.evaluate((id) => window.commissionFixture.release(id), agents.a);
    await page.getByRole("button", { name: "Agents: All agents", exact: true }).waitFor();
    check("U05: late A after B and All cannot replace current selection", (await location(page)).includes("agents=all")
      && await page.getByText("Agent: Jordan Agent", { exact: true }).count() === 0);
    check("U05: superseded A reads cancelled", (await calls(page)).filter((r) => r.args.p_agent_ids?.includes(agents.a) && r.name.startsWith("get_scoped_")).every((r) => r.aborted));
    await changed(page, `/commissions/policies?agents=selected&agent_ids=${agents.a}`);
    await page.getByRole("table", { name: "Policies" }).waitFor();
    await page.getByRole("button", { name: /Client 1/ }).click();
    await page.getByText(/^Estimated commission/).waitFor();
    await page.evaluate(() => window.commissionFixture.setRevoked());
    await page.getByText("Agent selection unavailable", { exact: true }).waitFor();
    check("U08: detected loss clears drawer, agent names, figures and carrier options", await page.getByRole("dialog").count() === 0
      && !(await page.locator("body").innerText()).match(/Jordan Agent|Client 1|Synthetic Life|\$\s?\d/));
    await context.close();
  }

  {
    const { context, page } = await open({ route: "/commissions?agents=selected&agent_ids=invalid" });
    await page.getByRole("alert").waitFor();
    check("U16: invalid explicit URL has no financial reads", financial(await calls(page)).length === 0);
    await context.close();
  }
} catch (error) {
  check("browser gate completed", false, String(error?.stack || error));
  if (activePage && !activePage.isClosed()) {
    await capture(activePage, "failure.png").catch(() => {});
    results.failure_state = await activePage.evaluate(() => ({
      url: window.location.href,
      route: document.querySelector('[data-testid="location"]')?.textContent,
      focused_element: document.activeElement?.outerHTML,
      selector_expanded: document.querySelector('[aria-label^="Agents:"]')?.getAttribute("aria-expanded"),
      popover_state: document.querySelector('[role="dialog"][aria-label="Choose agents"]')?.getAttribute("data-state"),
      requests: window.commissionFixture?.requests(),
    })).catch(() => ({ unavailable: true }));
  }
} finally {
  await browser.close();
  results.duration_ms = Date.now() - started;
  writeFileSync(join(output, "summary.json"), JSON.stringify(results, null, 2));
}
const failed = results.checks.filter((r) => !r.pass);
console.log(JSON.stringify({ checks: results.checks.length, passed: results.checks.length - failed.length, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;
