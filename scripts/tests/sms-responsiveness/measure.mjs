// Drives the synthetic SMS fixture with Playwright and reports rendered-feedback timings.
// Env: SMS_PLAYWRIGHT_MODULE (playwright index.mjs), SMS_FIXTURE_URL, SMS_BUILD_LABEL (base|candidate),
// SMS_SENDS (default 50), SMS_CPU_THROTTLE (default 1), SMS_EXPECT_PENDING (1 = candidate assertions),
// SMS_SURFACES (conversations,contact), SMS_RESPONSIVENESS_OUT (evidence directory).
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const { chromium } = await import(pathToFileURL(process.env.SMS_PLAYWRIGHT_MODULE).href);
const url = process.env.SMS_FIXTURE_URL || "http://127.0.0.1:4189";
const out = process.env.SMS_RESPONSIVENESS_OUT || "/tmp/sms-responsiveness-evidence";
const label = process.env.SMS_BUILD_LABEL || "candidate";
const sends = Number(process.env.SMS_SENDS || 50);
const throttle = Number(process.env.SMS_CPU_THROTTLE || 1);
const expectPending = process.env.SMS_EXPECT_PENDING !== "0";
const surfaces = (process.env.SMS_SURFACES || "conversations,contact").split(",");
const viewports = [[1440, 900], [390, 844]];
// The scroll containers holding each surface's messages (unchanged between base and candidate).
const REGION = { conversations: ".flex-1.overflow-y-auto.p-6", contact: ".flex-col-reverse.overflow-y-auto" };
const INPUT = 'input[placeholder="Type SMS message…"]';
const SEND = 'button[title="Send SMS"]';

await mkdir(out, { recursive: true });

function summary(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const rank = (p) => v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
  return { n: v.length, p50: +rank(50).toFixed(1), p95: +rank(95).toFixed(1), max: +v[v.length - 1].toFixed(1) };
}

async function openSurface(page, surface) {
  await page.goto(`${url}/?surface=${surface}`, { waitUntil: "networkidle" });
  if (surface === "conversations") {
    await page.getByText("Jordan Rivera").first().click();
  }
  await page.waitForFunction((sel) => (document.querySelector(sel)?.textContent ?? "").includes("Synthetic text"), REGION[surface]);
  if (surface === "contact") {
    // Load the 90-item window the measurement conditions call for.
    for (let i = 0; i < 2; i += 1) {
      const before = await page.locator(`${REGION.contact} > *`).count();
      await page.getByRole("button", { name: "Load earlier" }).click();
      await page.waitForFunction(([sel, n]) => document.querySelectorAll(`${sel} > *`).length > n, [REGION.contact, before]);
    }
  }
}

const runs = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const surface of surfaces) {
    for (const [width, height] of viewports) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await openSurface(page, surface);
      await page.waitForTimeout(1_500); // let the initial scroll-to-newest finish on both builds
      if (throttle > 1) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
      }
      const raw = [];
      for (let i = 0; i < sends; i += 1) {
        const text = `Probe ${label} ${surface} ${width} #${i} ${Math.random().toString(36).slice(2, 8)}`;
        await page.fill(INPUT, text);
        await page.evaluate(([t, r]) => window.__smsProbe.arm(t, r), [text, REGION[surface]]);
        // Below 600 px both surfaces' existing desktop layouts cover Send, so Enter sends there.
        if (width < 600) await page.press(INPUT, "Enter");
        else await page.click(SEND);
        if (i === 0) {
          await page.waitForFunction(() => window.__smsProbe.marks.firstChangePaint !== undefined);
          await page.screenshot({ path: `${out}/${label}-${surface}-${width}-in-flight.png` });
        }
        await page.waitForFunction(() => window.__smsProbe.marks.savedPaint !== undefined, null, { timeout: 30_000 });
        await page.waitForFunction((s) => !document.querySelector(`${s} .animate-spin`), SEND);
        await page.waitForTimeout(100);
        const sample = await page.evaluate(([t, r]) => {
          const p = window.__smsProbe;
          const event = p.events.filter((e) => Math.abs(e.startTime - p.marks.click) < 5).pop() ?? null;
          const shownTimes = (document.querySelector(r)?.textContent ?? "").split(t).length - 1;
          return { marks: { ...p.marks }, event, shownTimes, composer: document.querySelector('input[placeholder="Type SMS message…"]')?.value ?? null };
        }, [text, REGION[surface]]);
        const m = sample.marks;
        assert.equal(sample.shownTimes, 1, `${surface} ${width}: the sent text must show exactly once`);
        assert.equal(sample.composer, "", `${surface} ${width}: the composer clears after a send`);
        if (expectPending) {
          assert.ok(m.outgoingPaint < m.receipt, `${surface} ${width}: the outgoing text must paint before the receipt`);
        }
        raw.push({
          clickToFirstChangePainted: m.firstChangePaint - m.click,
          clickToOutgoingPainted: m.outgoingPaint - m.click,
          clickToRequestStart: m.requestStart - m.click,
          requestRoundTrip: m.receipt - m.requestStart,
          receiptToSavedPainted: m.savedPaint - m.receipt,
          clickToSavedPainted: m.savedPaint - m.click,
          eventTimingDuration: sample.event ? sample.event.duration : null,
        });
      }
      if (throttle === 1) await page.screenshot({ path: `${out}/${label}-${surface}-${width}-after.png` });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      const metrics = {};
      for (const key of Object.keys(raw[0])) {
        metrics[key] = key === "eventTimingDuration"
          ? { ...summary(raw.map((r) => r[key] ?? NaN)), under16ms: raw.filter((r) => r[key] === null).length }
          : summary(raw.map((r) => r[key]));
      }
      assert.deepEqual(errors, [], `${surface} ${width}: page errors`);
      runs.push({ surface, viewport: `${width}x${height}`, trigger: width < 600 ? "Enter" : "click", sends, overflow, metrics, raw });
      console.log(`${label} x${throttle} ${surface} ${width}x${height}: outgoing painted p50 ${metrics.clickToOutgoingPainted.p50} p95 ${metrics.clickToOutgoingPainted.p95} max ${metrics.clickToOutgoingPainted.max} ms; first change p95 ${metrics.clickToFirstChangePainted.p95} ms; saved p95 ${metrics.clickToSavedPainted.p95} ms`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}

const conditions = {
  build: "vite production build of the fixture", browser: "Playwright 1.56.1 headless Chromium", cpuThrottle: throttle,
  thread: "100 SMS, 50 calls, 50 emails", contact: "90 history items loaded", receiptMs: 1500, rowReadMs: 80, listReadMs: 250,
};
await writeFile(`${out}/${label}-x${throttle}.json`, JSON.stringify({ label, throttle, conditions, runs }, null, 2));
