// Runs against the loopback-only signed-in CRM fixture. The draft exists only in browser memory.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP, launch, session } from "../team-open-local/lib.mjs";

const settings = JSON.parse(readFileSync(process.env.AUTOMATIONS_LOCAL_SETTINGS,"utf8"));
assert.equal(new URL(settings.API_URL).hostname,"127.0.0.1");
const dir = process.env.AUTOMATION_UI_EVIDENCE || "/tmp/automation-ui-evidence";
mkdirSync(dir,{recursive:true});
const evidence = {sessions:[]};
const browser = await launch();
try {
  const login = session(browser,"keyboard and themes","af-ui-one@example.invalid",settings.PASSWORD,evidence);
  const loginWatch = setInterval(() => {
    for (const context of browser.contexts()) context.setDefaultTimeout(30000);
  }, 100);
  const {page,net} = await login.finally(() => clearInterval(loginWatch));
  page.setDefaultTimeout(30000);
  await page.goto(APP + "/settings?section=automation");
  await page.getByRole("button",{name:"Create automation",exact:true}).waitFor();
  await page.goto(APP + "/automations");
  await page.getByRole("button",{name:"Create automation",exact:true}).click();
  await page.getByLabel("Automation name").fill("Keyboard test");
  const trigger = page.getByRole("button",{name:"Choose trigger",exact:true});
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button",{name:"New lead created",exact:true}).press("Enter");
  // The canvas is the desktop default. The ordered list is reached from the keyboard through the view toggle.
  const listToggle = page.getByRole("radio",{name:"List",exact:true});
  await listToggle.focus();
  await page.keyboard.press("Enter");
  const steps = page.getByRole("list",{name:"Ordered steps"}).getByRole("listitem");
  async function addAt(index, name) {
    const add = steps.nth(index).getByRole("button",{name:"Add step",exact:true});
    await add.press("Enter");
    const picker = page.getByRole("dialog",{name:"Add step",exact:true});
    await picker.getByRole("button",{name,exact:true}).press("Enter");
    await picker.waitFor({state:"hidden"});
  }
  await addAt(0,"Wait");
  await addAt(1,"Send SMS");
  await page.getByLabel("Message",{exact:true}).fill("Hello {{first_name}}");
  await steps.nth(2).getByRole("button",{name:"Move up",exact:true}).press("Enter");
  assert.match(await steps.nth(1).innerText(),/Send SMS/);
  assert.match(await steps.nth(2).innerText(),/Wait/);
  // A selected step opens its settings: beside the list on a wide screen, in a sheet over it on a phone.
  // Close them so the same page can be checked at both widths.
  await page.getByRole("button",{name:"Close step settings",exact:true}).press("Enter");

  const screenshots = [];
  async function check(theme,width,height) {
    await page.setViewportSize({width,height});
    const dark = await page.locator("html").evaluate(el => el.classList.contains("dark"));
    if ((theme === "dark") !== dark) {
      const menu = page.getByRole("button",{name:/Account menu/});
      await menu.click();
      await page.getByRole("button",{name:theme === "dark" ? "Dark mode" : "Light mode",exact:true}).click();
      await menu.click();
    }
    await page.waitForFunction(expected => document.documentElement.classList.contains(expected),theme);
    // One layout at a time: the canvas exists only on a wide screen in Canvas view, the timeline is the phone's only view.
    assert.equal(await page.getByLabel("Automation canvas").count(),0);
    assert.equal(await page.getByRole("radio",{name:"List",exact:true}).count(),width >= 768 ? 1 : 0);
    assert.equal(await steps.nth(1).getByRole("button",{name:"Move down",exact:true}).isVisible(),true);
    const layout = await page.getByLabel("Ordered steps").boundingBox();
    assert.ok(layout && layout.x >= 0 && layout.x + layout.width <= width + 1);
    const file = "automations-" + width + "-" + theme + ".png";
    await page.screenshot({path:join(dir,file)});
    screenshots.push(file);
  }
  for (const [width,height] of [[1440,1000],[375,812]]) {
    for (const theme of ["light","dark"]) await check(theme,width,height);
  }
  await steps.nth(1).getByRole("button",{name:"Move down",exact:true}).press("Enter");
  assert.match(await steps.nth(1).innerText(),/Wait/);
  await page.getByRole("button",{name:"Back to automations",exact:true}).click();
  // Unsaved work is never dropped silently.
  await page.getByRole("alertdialog").getByRole("button",{name:"Leave without saving",exact:true}).click();
  await page.getByRole("button",{name:"Create automation",exact:true}).waitFor();
  assert.equal(net.requests.filter(req => /rpc\/(save_automation_draft|publish_automation|automation_lifecycle)/.test(req)).length,0);
  const result = {result:"pass",viewports:[375,1440],themes:["light","dark"],screenshots,
    keyboard:["choose trigger","insert on path","move up","move down"],workflowWrites:0,network:"loopback browser guard"};
  writeFileSync(join(dir,"mobile-keyboard.json"),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} catch (error) {
  const page = browser.contexts().flatMap(context => context.pages()).at(-1);
  if (page && !page.isClosed()) {
    const observed = evidence.sessions.at(-1);
    console.error("Fixture HTTP errors", [...new Set((observed?.net.httpErrors ?? []).map(s => s.split("?")[0]))].slice(-18));
    console.error("Observed path:",new URL(page.url()).pathname,
      "headings:",await page.getByRole("heading").allTextContents(),
      "status:",await page.getByRole("status").allTextContents());
    await page.screenshot({path:join(dir,"mobile-keyboard-failure.png")}).catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
