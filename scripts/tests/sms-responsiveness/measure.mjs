// Drives the synthetic SMS fixture with Playwright and reports send-feedback timings.
//
// Rules (2026-10-15 correction):
// - Only a real, actionable click on Send is used: never Enter, a forced click or DOM insertion.
// - A latency counts as user-visible only when the text is VISIBLE (see main.tsx): non-zero size,
//   CSS-visible, at least half inside the viewport and every clipping ancestor, and not covered.
//   RENDERED-only times are reported separately and are never a user-visible pass.
// - A surface/viewport whose layout makes Send unusable, or whose message never becomes visible,
//   is recorded as BLOCKED with its geometry and a screenshot. It is never skipped silently.
//
// Env: SMS_PLAYWRIGHT_MODULE (playwright index.mjs), SMS_FIXTURE_URL, SMS_BUILD_LABEL (base|candidate),
// SMS_SENDS (default 50), SMS_CPU_THROTTLE (default 1), SMS_EXPECT_PENDING (1 = candidate assertions),
// SMS_SURFACES (conversations,contact), SMS_VIEWPORTS (1440x900,390x844), SMS_RESPONSIVENESS_OUT,
// SMS_DEFERRED_HISTORY_MS (default 4000; blank = default; 0 = off, reported as a warning), SMS_DEFERRED_SENDS (default 3),
// SMS_EXPECT_BLOCKED (default "conversations@390x844,contact@390x844": both surfaces' desktop-only
// layouts, the same on base — Conversations covers Send with its 300 px contact pane; the contact
// record leaves its message column, and all but a 29 px sliver of Send, off-screen inside
// overflow-hidden ancestors, so a sent text never becomes visible).
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.SMS_PLAYWRIGHT_MODULE).href);
const url = process.env.SMS_FIXTURE_URL || "http://127.0.0.1:4189";
const out = process.env.SMS_RESPONSIVENESS_OUT || "/tmp/sms-responsiveness-evidence";
const label = process.env.SMS_BUILD_LABEL || "candidate";
const sends = Number(process.env.SMS_SENDS || 50);
const throttle = Number(process.env.SMS_CPU_THROTTLE || 1);
const expectPending = process.env.SMS_EXPECT_PENDING !== "0";
const surfaces = (process.env.SMS_SURFACES || "conversations,contact").split(",");
const viewports = (process.env.SMS_VIEWPORTS || "1440x900,390x844").split(",").map((v) => v.split("x").map(Number));
const expectBlocked = new Set((process.env.SMS_EXPECT_BLOCKED ?? "conversations@390x844,contact@390x844").split(",").filter(Boolean));
// The scroll containers holding each surface's messages (unchanged between base and candidate).
const REGION = { conversations: ".flex-1.overflow-y-auto.p-6", contact: ".flex-col-reverse.overflow-y-auto" };
const INPUT = 'input[placeholder="Type SMS message…"]';
const SEND = 'button[title="Send SMS"]';
const VISIBLE_WAIT_MS = 3_000;
// Deferred-history case: history reads slowed to this many ms, Send clicked while the first load is
// still pending (desktop, real clicks). 0 disables it.
// Unset or blank takes the default, as for the other variables; only a literal "0" turns it off.
const envInt = (name, fallback) => {
  const raw = (process.env[name] ?? "").trim();
  if (raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a whole number, got "${raw}"`);
  return Number(raw);
};
const deferredMs = envInt("SMS_DEFERRED_HISTORY_MS", 4000);
const deferredSends = envInt("SMS_DEFERRED_SENDS", 3);
if (deferredMs > 0 && (deferredMs < 1000 || deferredMs > 600_000)) throw new Error(`SMS_DEFERRED_HISTORY_MS must be 0 (off) or 1000–600000, got ${deferredMs}`);
if (deferredSends < 1) throw new Error(`SMS_DEFERRED_SENDS must be >= 1, got ${deferredSends}`);
// Reconciliation is required to land before history only when history is slow enough to allow it
// (receipt 1,500 ms + targeted read 80 ms + page start-up).
const reconcileBeforeHistory = deferredMs >= 3000;

await mkdir(out, { recursive: true });

function summary(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const rank = (p) => v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
  return { n: v.length, p50: +rank(50).toFixed(1), p95: +rank(95).toFixed(1), max: +v[v.length - 1].toFixed(1) };
}

async function openSurface(page, surface) {
  await page.goto(`${url}/?surface=${surface}`, { waitUntil: "networkidle" });
  if (surface === "conversations") await page.getByText("Jordan Rivera").first().click();
  await page.waitForFunction((sel) => (document.querySelector(sel)?.textContent ?? "").includes("Synthetic text"), REGION[surface]);
  if (surface === "contact") {
    // Load the 90-item window the measurement conditions call for.
    for (let i = 0; i < 2; i += 1) {
      const before = await page.locator(`${REGION.contact} > *`).count();
      await page.getByRole("button", { name: "Load earlier" }).click();
      await page.waitForFunction(([sel, n]) => document.querySelectorAll(`${sel} > *`).length > n, [REGION.contact, before]);
    }
  }
  await page.waitForTimeout(1_500); // let the initial scroll-to-newest finish on both builds
}

/** Layout facts behind a BLOCKED verdict: region and Send geometry, and what covers Send. */
function geometry(page, surface) {
  return page.evaluate(([regionSel, sendSel]) => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const send = document.querySelector(sendSel);
    const r = send?.getBoundingClientRect();
    const hit = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
    const cls = (el) => (el ? `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(".")}` : null);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentScrollWidth: document.documentElement.scrollWidth,
      pageScroll: { x: scrollX, y: scrollY },
      messageRegion: rect(document.querySelector(regionSel)),
      sendButton: rect(send),
      atSendCenter: hit && send && (send === hit || send.contains(hit)) ? "the Send button" : cls(hit),
    };
  }, [REGION[surface], SEND]);
}

const runs = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const surface of surfaces) {
    for (const [width, height] of viewports) {
      const key = `${surface}@${width}x${height}`;
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const run = { surface, viewport: `${width}x${height}`, key, trigger: "click", status: "measured", sends: 0, raw: [] };
      try {
        await openSurface(page, surface);
        if (throttle > 1) {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
        }
        const before = await geometry(page, surface);
        // Preflight: can a person click Send here at all? A trial click runs Playwright's
        // actionability checks (visible, stable, enabled, receives events) without clicking.
        try {
          await page.fill(INPUT, "preflight", { timeout: 3_000 });
          await page.locator(SEND).click({ trial: true, timeout: 3_000 });
          await page.fill(INPUT, "", { timeout: 3_000 });
        } catch (error) {
          const lines = String(error.message).split("\n");
          run.status = "blocked";
          run.reason = `The composer or Send is not usable: ${(lines.find((l) => l.includes("intercepts pointer events")) ?? lines[0]).replace(/\x1b\[[0-9;]*m/g, "").trim()}`;
          run.geometry = await geometry(page, surface);
          await page.screenshot({ path: `${out}/${label}-${surface}-${width}-blocked.png` });
        }
        for (let i = 0; run.status === "measured" && i < sends; i += 1) {
          const text = `Probe ${label} ${surface} ${width} #${i} ${Math.random().toString(36).slice(2, 8)}`;
          // Each send starts with no toast on screen: the base build's previous success toast would
          // otherwise cover its Send spinner. Waiting (never removing a toast) keeps both builds equal.
          await page.waitForFunction(() => !document.querySelector("[data-sonner-toast]"), null, { timeout: 15_000 });
          await page.fill(INPUT, text);
          await page.evaluate(([t, r]) => window.__smsProbe.arm(t, r), [text, REGION[surface]]);
          await page.click(SEND, { timeout: 5_000 });
          if (i === 0) {
            // Rendered or visibly changed, whichever comes first; visibility is judged below.
            await page.waitForFunction(() => {
              const m = window.__smsProbe.marks;
              return m.firstChangeVisiblePaint !== undefined || m.outgoingRenderedPaint !== undefined;
            }, null, { timeout: 10_000 });
            await page.screenshot({ path: `${out}/${label}-${surface}-${width}-in-flight.png` });
            run.afterFirstClick = await geometry(page, surface);
          }
          await page.waitForFunction(() => window.__smsProbe.marks.savedRenderedPaint !== undefined, null, { timeout: 30_000 });
          const visibleInTime = await page
            .waitForFunction(() => window.__smsProbe.marks.savedVisiblePaint !== undefined, null, { timeout: VISIBLE_WAIT_MS })
            .then(() => true, () => false);
          const sample = await page.evaluate(([t, r]) => {
            const p = window.__smsProbe;
            const event = p.events.filter((e) => Math.abs(e.startTime - p.marks.click) < 5).pop() ?? null;
            const shownTimes = (document.querySelector(r)?.textContent ?? "").split(t).length - 1;
            const composer = document.querySelector('input[placeholder="Type SMS message…"]')?.value ?? null;
            return { marks: { ...p.marks }, event, shownTimes, composer, firstChange: p.firstChange, firstRenderVisibility: p.firstRenderVisibility, lastVisibility: p.lastVisibility };
          }, [text, REGION[surface]]);
          const m = sample.marks;
          if (!visibleInTime || m.outgoingVisiblePaint === undefined) {
            run.status = "blocked";
            run.reason = "The sent text rendered but never became visible to a person (size, clipping, viewport or covering element).";
            run.visibility = { firstRender: sample.firstRenderVisibility, last: sample.lastVisibility };
            run.geometry = await geometry(page, surface);
            await page.screenshot({ path: `${out}/${label}-${surface}-${width}-blocked.png` });
            break;
          }
          const problems = [];
          if (sample.shownTimes !== 1) problems.push(`the sent text showed ${sample.shownTimes} times`);
          if (sample.composer !== "") problems.push("the composer did not clear");
          if (expectPending && !(m.outgoingVisiblePaint < m.receipt)) problems.push("the outgoing text was not visible before the receipt");
          if (problems.length) {
            run.status = "failed";
            run.reason = `send #${i}: ${problems.join("; ")}`;
            break;
          }
          run.sends += 1;
          run.raw.push({
            clickToFirstChangeVisible: m.firstChangeVisiblePaint - m.click,
            clickToOutgoingVisible: m.outgoingVisiblePaint - m.click,
            clickToOutgoingRendered: m.outgoingRenderedPaint - m.click,
            clickToRequestStart: m.requestStart - m.click,
            requestRoundTrip: m.receipt - m.requestStart,
            receiptToSavedVisible: m.savedVisiblePaint - m.receipt,
            clickToSavedVisible: m.savedVisiblePaint - m.click,
            eventTimingDuration: sample.event ? sample.event.duration : null,
            firstChange: sample.firstChange,
          });
          await page.waitForFunction((s) => !document.querySelector(`${s} .animate-spin`), SEND);
          await page.waitForTimeout(100);
        }
        if (run.status === "measured" && throttle === 1) await page.screenshot({ path: `${out}/${label}-${surface}-${width}-after.png` });
        run.geometryBeforeSends = before;
        run.overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      } catch (error) {
        run.status = "failed";
        run.reason = String(error.message).split("\n")[0];
      }
      if (errors.length) {
        run.status = "failed";
        run.reason = `page errors: ${errors.join(" | ").slice(0, 300)}`;
      }
      if (run.raw.length) {
        run.metrics = {};
        run.firstChangeKinds = Object.fromEntries(["text", "spinner"].map((kind) => [kind, run.raw.filter((r) => r.firstChange === kind).length]));
        for (const k of Object.keys(run.raw[0]).filter((key) => key !== "firstChange")) {
          run.metrics[k] = k === "eventTimingDuration"
            ? { ...summary(run.raw.map((r) => r[k] ?? NaN)), under16ms: run.raw.filter((r) => r[k] === null).length }
            : summary(run.raw.map((r) => r[k]));
        }
      }
      run.expectedBlocked = expectBlocked.has(key);
      runs.push(run);
      const m = run.metrics?.clickToOutgoingVisible;
      console.log(`${label} x${throttle} ${key}: ${run.status.toUpperCase()}${run.reason ? ` — ${run.reason}` : ""}${m ? ` — click → outgoing VISIBLE p50 ${m.p50} p95 ${m.p95} max ${m.max} ms over ${run.sends} sends` : ""}`);
      await page.close();
    }
  }

  // Deferred-history case (2026-10-15 review): each send opens the surface afresh and clicks Send
  // while its first history load is still pending. The candidate must show the outgoing text before
  // that history arrives; base cannot, and its time to visible is reported as measured.
  for (const surface of deferredMs > 0 ? surfaces : []) {
    const key = `${surface}@1440x900+history${deferredMs}ms`;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const run = { surface, viewport: "1440x900", key, trigger: "click", status: "measured", sends: 0, raw: [], deferredHistoryMs: deferredMs };
    try {
      if (throttle > 1) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
      }
      for (let i = 0; run.status === "measured" && i < deferredSends; i += 1) {
        await page.goto(`${url}/?surface=${surface}&historyMs=${deferredMs}`, { waitUntil: "domcontentloaded" });
        if (surface === "conversations") await page.getByText("Jordan Rivera").first().click();
        await page.waitForSelector(INPUT, { timeout: 10_000 });
        const text = `Probe ${label} ${surface} deferred #${i} ${Math.random().toString(36).slice(2, 8)}`;
        await page.fill(INPUT, text);
        await page.evaluate(([t, r]) => window.__smsProbe.arm(t, r), [text, REGION[surface]]);
        // Shorter than the history delay: a Send that waits for history fails here, not as "clicked late".
        const clicked = await page.click(SEND, { timeout: Math.floor(deferredMs / 2) }).then(() => true, () => false);
        if (!clicked) { run.status = "failed"; run.reason = `send #${i}: Send could not be clicked while history was pending`; break; }
        const visible = await page
          .waitForFunction(() => window.__smsProbe.marks.outgoingVisiblePaint !== undefined, null, { timeout: deferredMs + 8_000 })
          .then(() => true, () => false);
        const sample = await page.evaluate(() => {
          const p = window.__smsProbe;
          return { marks: { ...p.marks }, historyAtClick: p.historyAtClick, historyAtVisible: p.historyAtVisible };
        });
        const m = sample.marks;
        if (!visible) { run.status = "failed"; run.reason = `send #${i}: the sent text never became visible`; break; }
        if (sample.historyAtClick) { run.status = "failed"; run.reason = `send #${i}: history had loaded before the click (scenario not exercised)`; break; }
        if (expectPending && sample.historyAtVisible) {
          run.status = "failed";
          run.reason = `send #${i}: the outgoing text was not visible until history loaded`;
          break;
        }
        await page.waitForFunction(() => window.__smsProbe.marks.receipt !== undefined, null, { timeout: 30_000 });
        const receipt = await page.evaluate(() => window.__smsProbe.marks.receipt);
        // Visible before history is not enough on its own: it must also come before the send's
        // receipt, or the text only appeared as the saved row.
        if (expectPending && !(m.outgoingVisiblePaint < receipt)) {
          run.status = "failed";
          run.reason = `send #${i}: the outgoing text was not visible before the send's receipt`;
          break;
        }
        // Stay until the send is the saved row AND history has landed, so reconciliation and the
        // history merge (same message_id) are checked in the browser and their page errors count.
        const settled = await page
          .waitForFunction(() => {
            const k = window.__smsProbe.marks;
            return k.savedVisiblePaint !== undefined && k.historyShown !== undefined;
          }, null, { timeout: deferredMs + 8_000 })
          .then(() => true, () => false);
        const after = await page.evaluate(([t, r]) => {
          const p = window.__smsProbe;
          return {
            marks: { ...p.marks },
            shownTimes: (document.querySelector(r)?.textContent ?? "").split(t).length - 1,
            composer: document.querySelector('input[placeholder="Type SMS message…"]')?.value ?? null,
            pendingLeft: !!document.querySelector('[data-testid="pending-sms"], [data-testid="pending-sms-status"]'),
          };
        }, [text, REGION[surface]]);
        const k = after.marks;
        const problems = [];
        if (!settled) problems.push("the saved row or history never became visible");
        if (after.shownTimes !== 1) problems.push(`after history landed the sent text showed ${after.shownTimes} times`);
        if (after.composer !== "") problems.push("the composer did not clear");
        if (after.pendingLeft) problems.push("a pending item was left after reconciliation");
        if (expectPending && reconcileBeforeHistory && !(k.savedVisiblePaint < k.historyShown)) {
          problems.push("the saved row was not reconciled before history landed");
        }
        if (problems.length) {
          run.status = "failed";
          run.reason = `send #${i}: ${problems.join("; ")}`;
          break;
        }
        run.sends += 1;
        run.raw.push({
          clickToOutgoingVisible: m.outgoingVisiblePaint - m.click,
          historyAtVisible: sample.historyAtVisible,
          visibleBeforeReceipt: m.outgoingVisiblePaint < receipt,
          savedBeforeHistory: k.savedVisiblePaint < k.historyShown,
        });
      }
      if (run.status === "measured" && run.sends !== deferredSends) {
        run.status = "failed";
        run.reason = `${run.sends} of ${deferredSends} sends measured`;
      }
    } catch (error) {
      run.status = "failed";
      run.reason = String(error.message).split("\n")[0];
    }
    if (errors.length) {
      run.status = "failed";
      run.reason = `page errors: ${errors.join(" | ").slice(0, 300)}`;
    }
    if (run.raw.length) {
      run.metrics = { clickToOutgoingVisible: summary(run.raw.map((r) => r.clickToOutgoingVisible)) };
      run.visibleBeforeHistory = run.raw.filter((r) => r.historyAtVisible === false).length;
      run.visibleBeforeReceipt = run.raw.filter((r) => r.visibleBeforeReceipt).length;
      run.savedBeforeHistory = run.raw.filter((r) => r.savedBeforeHistory).length;
    }
    run.expectedBlocked = expectBlocked.has(key);
    runs.push(run);
    const dm = run.metrics?.clickToOutgoingVisible;
    console.log(`${label} x${throttle} ${key}: ${run.status.toUpperCase()}${run.reason ? ` — ${run.reason}` : ""}${dm ? ` — click → outgoing VISIBLE p50 ${dm.p50} p95 ${dm.p95} max ${dm.max} ms over ${run.sends} sends; visible before history in ${run.visibleBeforeHistory}, before the receipt in ${run.visibleBeforeReceipt}; saved row before history in ${run.savedBeforeHistory}` : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
}

const conditions = {
  build: "vite production build of the fixture", browser: "Playwright headless Chromium", cpuThrottle: throttle, trigger: "real click on Send only", startState: "no toast on screen before each send (waited for, never removed)",
  thread: "100 SMS, 50 calls, 50 emails", contact: "90 history items loaded", deferredHistoryMs: deferredMs, deferredSends, receiptMs: 1500, rowReadMs: 80, listReadMs: 250,
  visible: "non-zero size, CSS-visible, >=50% inside viewport and clipping ancestors, not covered (elementFromPoint, where falling through a pointer-events:none target to its ancestor is not covering, plus toast rectangles)",
};
await writeFile(`${out}/${label}-x${throttle}.json`, JSON.stringify({ label, throttle, conditions, runs }, null, 2));

// Report every outcome; nothing is skipped silently. Expected blocks warn; anything else fails.
const unexpectedBlocked = runs.filter((r) => r.status === "blocked" && !r.expectedBlocked);
const failed = runs.filter((r) => r.status === "failed");
const nowMeasurable = runs.filter((r) => r.status === "measured" && r.expectedBlocked);
const lines = [`### SMS responsiveness fixture — ${label}, CPU x${throttle}`, "", "| Surface | Status | Click → outgoing visible p50 / p95 / max (ms) | Reason |", "|---|---|---|---|"];
for (const r of runs) {
  const m = r.metrics?.clickToOutgoingVisible;
  lines.push(`| ${r.key} | ${r.status}${r.expectedBlocked && r.status === "blocked" ? " (expected: pre-existing layout)" : ""} | ${m ? `${m.p50} / ${m.p95} / ${m.max} (n=${r.sends})` : "—"} | ${(r.reason ?? "").replace(/\|/g, "/")} |`);
}
if (deferredMs === 0) lines.push("| deferred-history case | **OFF** (SMS_DEFERRED_HISTORY_MS=0) | — | not run |");
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n\n`);
if (deferredMs === 0) console.log(`::warning title=SMS fixture deferred-history case OFF::${label}: SMS_DEFERRED_HISTORY_MS=0, so sending while history is pending was not checked.`);
for (const r of runs.filter((x) => x.status === "blocked" && x.expectedBlocked)) {
  console.log(`::warning title=SMS fixture blocked (expected)::${r.key} ${label}: ${r.reason}`);
}
for (const r of nowMeasurable) console.log(`::warning title=SMS fixture now measurable::${r.key} was expected to be blocked; update SMS_EXPECT_BLOCKED and the record.`);
for (const r of [...unexpectedBlocked, ...failed]) console.log(`::error title=SMS fixture ${r.status}::${r.key} ${label}: ${r.reason}`);
if (unexpectedBlocked.length || failed.length) process.exitCode = 1;
