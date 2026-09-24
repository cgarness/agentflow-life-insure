// TEST-ONLY authenticated LOCAL browser scenarios for Team/Open lead details (implementation_plan.md §10).
// The real app (Vite, vite.local.config.ts) runs against the LOCAL Supabase Auth/PostgREST/Postgres with
// genuine Agent sessions. Only the Voice.js boundary is faked (fakeTwilioVoice.ts). Lead reads, claim_lead,
// permissions and saves are the real application paths. A few scenarios add a browser-level network
// DELAY or FAILURE to a real request; each one is labelled in its evidence row.
//
// Usage: node scenarios.mjs <workspace> <evidence-dir> [scenarioId ...]
import { launch, session, evidenceStore, APP, sql } from "./lib.mjs";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [WS, EVDIR, ...ONLY] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
// The raw evidence.json holds unsanitised console text (e.g. the local anon key inside Realtime URLs), so it
// must be written outside the repository; only sanitize-evidence.mjs output and PNGs are copied in.
function isInsideRepo(p, repo) {
  // Resolve symlinks through the nearest existing ancestor, then treat only ".." / "../…" as outside.
  let probe = path.resolve(p); const tail = [];
  while (!existsSync(probe) && path.dirname(probe) !== probe) { tail.unshift(path.basename(probe)); probe = path.dirname(probe); }
  const real = path.join(realpathSync(probe), ...tail);
  const rel = path.relative(realpathSync(repo), real);
  return rel === "" || !(rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel));
}
if (!EVDIR || isInsideRepo(EVDIR, REPO)) throw new Error(`refusing evidence dir inside the repository: ${EVDIR}`);
const env = JSON.parse(readFileSync(path.join(WS, "lv.env.json"), "utf8"));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(env.API_URL)) throw new Error(`refusing non-loopback API_URL ${env.API_URL}`);
const users = JSON.parse(readFileSync(path.join(WS, "lv.users.json"), "utf8"));
const ID = users.ids;
const ev = evidenceStore(EVDIR);
const LEAD = {
  tessa: "a1000000-0000-4000-8000-0000000001a1", oliver: "a1000000-0000-4000-8000-0000000001a2",
  olga: "a1000000-0000-4000-8000-0000000001a3", owen: "a1000000-0000-4000-8000-0000000001a4",
  pat: "a1000000-0000-4000-8000-0000000001a5", bianca: "b1000000-0000-4000-8000-0000000001b1",
};
const NOISE = /realtime|WebSocket|ERR_BLOCKED_BY_CLIENT|VITE_SUPABASE_URL host|unread count/i;

function reset() {
  execFileSync("docker", ["exec", "-i", "supabase_db_agentflow-localverify", "psql", "-U", "postgres", "-q", "-f", "-"],
    { input: readFileSync(path.join(HERE, "reset.sql")) });
  execFileSync("node", [path.join(HERE, "bootstrap.mjs"), path.join(WS, "lv.env.json")], { stdio: "ignore", env: { ...process.env, NO_PROXY: "*" } });
}
const login = (b, who) => session(b, who, users.emails[who], env.PASSWORD, ev);
async function startCampaign(p, name) {
  await p.goto(`${APP}/dialer`);
  await p.locator("tr", { hasText: name }).getByText("START DIALING").click();
  await p.waitForTimeout(3500);
}
const btn = (p, re) => p.getByRole("button", { name: re }).first();
async function call(p) { await btn(p, /^call$/i).click(); await p.waitForTimeout(1500); }
async function fv(p, ev_, idx) {
  await p.evaluate(([e, i]) => (i === undefined ? window.__fakeVoice.emit(e) : window.__fakeVoice.calls[i].emit(e)), [ev_, idx]);
  await p.waitForTimeout(1200);
}
async function hangUp(p) { await btn(p, /hang up/i).click(); await p.waitForTimeout(1200); }
async function details(p) {
  const d = p.locator('[data-testid="team-open-lead-details"]');
  return (await d.count()) ? await d.innerText() : null;
}
async function saveWith(p, disp) { await btn(p, new RegExp(`^${disp}$`, "i")).click(); await btn(p, /^save$/i).click(); await p.waitForTimeout(3500); }
async function toasts(p) { return p.locator("[data-sonner-toast]").allInnerTexts(); }
const LABELS = ["FIRST NAME", "LAST NAME", "PHONE", "POLICY INTEREST", "EMAIL", "STATE", "DEPENDENTS", "BLANK NOTE", "SOURCE", "AGE",
  "NOTES", "ASSIGNED AGENT", "COVERAGE AMOUNT", "EMAIL (CUSTOM)", "SMOKER", "TAGS", "__AGENTFLOW", "ADDITIONAL_POLICIES"];
const labels = (t) => (t ?? "").split("\n").filter((l) => LABELS.includes(l));
const appErrors = (s) => s.consoleErrors.filter((e) => !NOISE.test(e));

async function scenario(id, title, fn) {
  if (ONLY.length && !ONLY.includes(id)) return;
  reset();
  const b = await launch();
  const row = { id, title, result: "FAILED", simulated: [], ui: [], db: [], shots: [], consoleErrors: [] };
  const sessions = [];
  const open = async (who) => { const s = await login(b, who); sessions.push(s); return s; };
  try {
    await fn({ row, open, check: (cond, msg) => { if (!cond) throw new Error(`check failed: ${msg}`); } });
    row.result = row.result === "FAILED" ? "PASSED" : row.result;
  } catch (e) {
    row.error = String(e).slice(0, 400);
    row.result = row.result === "BLOCKED" ? "BLOCKED" : "FAILED";
    for (const s of sessions) row.shots.push(await ev.shot(s.page, `${id}-failure-${s.net.label}`).catch(() => null));
  }
  for (const s of sessions) row.consoleErrors.push(...appErrors(s).map((e) => `${s.net.label}: ${e}`));
  ev.record(row);
  await b.close();
}

// ── S01 / S02 / S03: Team lead, pre-claim → legitimate claim → field rendering → inline edit ─────────────
await scenario("S01", "Agent before claim: campaign copy + accurate notice; staged reveal; no fabricated master data", async ({ row, open, check }) => {
  row.simulated.push("Voice.js: outbound ringing (early media) and accept via the fake boundary");
  const { page: p } = await open("agent1");
  await startCampaign(p, "LV Team Campaign");
  row.ui.push(`idle details: ${await details(p)}`);
  await call(p);
  const dialing = await details(p);
  await fv(p, "ringing");
  const ringing = await details(p);
  row.shots.push(await ev.shot(p, "S01-ringing"));
  await fv(p, "accept");
  const connected = await details(p);
  row.shots.push(await ev.shot(p, "S01-connected-preclaim"));
  row.ui.push(`dialing: ${dialing}`, `ringing: ${ringing}`, `connected: ${JSON.stringify(connected)}`);
  check(dialing === null && ringing === null, "no details before answer");
  check(connected?.includes("isn't available to you yet"), "unavailable-record notice");
  check(connected.includes("Tessa") && connected.includes("tessa.team@example.test"), "campaign copy shown");
  check(!/Term 20|Team lead master note|custom-email-value|250000|POLICY INTEREST/.test(connected), "no master-only data");
  const editTitle = await p.locator('button[title^="Editing is available"]').count();
  row.ui.push(`edit disabled with explanation: ${editTitle === 1}`);
  check(editTitle === 1, "edit disabled pre-claim");
  row.db.push(`leads(Tessa) owner: ${sql(`select coalesce(assigned_agent_id::text,'NULL') from leads where id='${LEAD.tessa}'`)}`);
  row.db.push(`lock: ${sql(`select locked_by='${ID.agent1}', campaign_lead_id from dialer_lead_locks`)}`);
  row.db.push(`calls: ${sql("select direction, status, campaign_lead_id from calls")}`);
  check(sql(`select assigned_agent_id is null from leads where id='${LEAD.tessa}'`) === "t", "not claimed yet");
});

await scenario("S02", "Legitimate claim (Not Interested → Save): master details, layout order, missing-layout fields, 0/false, hidden blanks + internal keys", async ({ row, open, check }) => {
  row.simulated.push("Voice.js: accept + hang-up via the fake boundary");
  const { page: p } = await open("agent1");
  await startCampaign(p, "LV Team Campaign");
  await call(p); await fv(p, "accept"); await hangUp(p);
  row.ui.push(`wrap-up before save: ${JSON.stringify(await details(p))}`);
  await saveWith(p, "not interested");
  const t = await details(p);
  row.shots.push(await ev.shot(p, "S02-postclaim-details"));
  row.ui.push(`post-claim: ${JSON.stringify(t)}`);
  const L = labels(t);
  row.ui.push(`label order: ${L.join(" > ")}`);
  const expectPrefix = ["FIRST NAME", "LAST NAME", "PHONE", "POLICY INTEREST", "EMAIL", "STATE", "DEPENDENTS"];
  check(expectPrefix.every((l, i) => L[i] === l), "layout order honoured");
  check(!L.includes("BLANK NOTE"), "empty custom value hidden");
  check(L.includes("COVERAGE AMOUNT") && L.includes("SMOKER") && L.includes("EMAIL (CUSTOM)"), "populated fields missing from layout appended");
  check(/DEPENDENTS\n0\b/.test(t), "0 shown");
  check(/SMOKER\nNo\b/.test(t), "false shown as No");
  check(!/__agentflow|additional_policies|TAGS|LV Carrier/i.test(t), "internal metadata hidden");
  row.db.push(`claim: ${sql(`select assigned_agent_id='${ID.agent1}', user_id='${ID.agent1}' from leads where id='${LEAD.tessa}'`)}`);
  check(sql(`select assigned_agent_id='${ID.agent1}' from leads where id='${LEAD.tessa}'`) === "t", "claimed through claim_lead");
});

await scenario("S03", "Inline edit (standard + custom) preserves unrelated values; campaign snapshot follows", async ({ row, open, check }) => {
  row.simulated.push("Voice.js: accept + hang-up");
  const { page: p } = await open("agent1");
  await startCampaign(p, "LV Team Campaign");
  await call(p); await fv(p, "accept"); await hangUp(p); await saveWith(p, "not interested");
  const before = sql(`select custom_fields from leads where id='${LEAD.tessa}'`);
  await p.locator('button[title="Edit Contact"]').click();
  await p.locator("#team-open-field-custom_Policy_Interest").fill("Term 30");
  await p.locator("#team-open-field-std_age").fill("42");
  await p.locator("#team-open-field-std_state").selectOption("OK");
  row.shots.push(await ev.shot(p, "S03-editing"));
  await p.locator('button[title="Save Edits"]').click();
  await p.waitForTimeout(3000);
  row.shots.push(await ev.shot(p, "S03-saved"));
  const t = await details(p);
  row.ui.push(`after save: ${JSON.stringify(t)}`, `toasts: ${JSON.stringify(await toasts(p))}`);
  const after = sql(`select custom_fields from leads where id='${LEAD.tessa}'`);
  row.db.push(`custom_fields before: ${before}`, `custom_fields after: ${after}`);
  row.db.push(`age lead/snapshot (age is not snapshot-synced by design): ${sql(`select l.age, cl.age from leads l join campaign_leads cl on cl.lead_id=l.id where l.id='${LEAD.tessa}'`)}`);
  row.db.push(`state lead/snapshot: ${sql(`select l.state, cl.state from leads l join campaign_leads cl on cl.lead_id=l.id where l.id='${LEAD.tessa}'`)}`);
  check(sql(`select l.state='OK' and cl.state='OK' from leads l join campaign_leads cl on cl.lead_id=l.id where l.id='${LEAD.tessa}'`) === "t", "state saved to master and snapshot");
  const a = JSON.parse(after); const bf = JSON.parse(before);
  check(a["Policy Interest"] === "Term 30", "custom edit saved");
  for (const k of Object.keys(bf)) if (k !== "Policy Interest") check(JSON.stringify(a[k]) === JSON.stringify(bf[k]), `unrelated key preserved: ${k}`);
  check(sql(`select age from leads where id='${LEAD.tessa}'`) === "42", "standard edit saved");
  check(/POLICY INTEREST\nTerm 30/.test(t) && /AGE\n42/.test(t), "UI shows saved values");
});

await scenario("S04", "Failed saves retain the draft (validation; lead hidden by RLS after reassignment); partial save reported accurately", async ({ row, open, check }) => {
  row.simulated.push("Voice.js accept/hang-up",
    "(b) a privileged local UPDATE reassigning the lead just before Save; RLS then hides the row from the save's pre-write read, so no UPDATE is sent",
    "(b→c) a second privileged local UPDATE restoring ownership to Agent One before (c)",
    "(c) a browser-level network failure of the campaign_leads snapshot PATCH only (the leads PATCH is real)");
  const { page: p } = await open("agent1");
  await startCampaign(p, "LV Team Campaign");
  await call(p); await fv(p, "accept"); await hangUp(p); await saveWith(p, "not interested");
  // (a) validation
  await p.locator('button[title="Edit Contact"]').click();
  await p.locator("#team-open-field-std_phone").fill("abc");
  await p.locator('button[title="Save Edits"]').click(); await p.waitForTimeout(1500);
  const va = await p.locator("#team-open-field-std_phone").inputValue();
  row.ui.push(`(a) phone draft after invalid save: ${va}; details: ${JSON.stringify(await details(p))}`);
  row.shots.push(await ev.shot(p, "S04a-validation"));
  check(va === "abc", "(a) invalid draft retained");
  check(sql(`select phone from leads where id='${LEAD.tessa}'`) === "+15555550111", "(a) nothing written");
  await p.locator("#team-open-field-std_phone").fill("+15555550111");
  // (b) RLS refusal
  await p.locator("#team-open-field-custom_Policy_Interest").fill("Should Not Save");
  sql(`update leads set assigned_agent_id='${ID.agent2}' where id='${LEAD.tessa}'`);
  await p.locator('button[title="Save Edits"]').click(); await p.waitForTimeout(2500);
  const vb = await p.locator("#team-open-field-custom_Policy_Interest").count()
    ? await p.locator("#team-open-field-custom_Policy_Interest").inputValue() : "<editor closed>";
  row.ui.push(`(b) draft after refused save: ${vb}; toasts: ${JSON.stringify(await toasts(p))}`);
  row.shots.push(await ev.shot(p, "S04b-refused"));
  row.db.push(`(b) Policy Interest: ${sql(`select custom_fields->>'Policy Interest' from leads where id='${LEAD.tessa}'`)}`);
  check(vb === "Should Not Save", "(b) draft retained after refusal");
  check(sql(`select custom_fields->>'Policy Interest' from leads where id='${LEAD.tessa}'`) === "Term 20", "(b) nothing written");
  sql(`update leads set assigned_agent_id='${ID.agent1}' where id='${LEAD.tessa}'`);
  // (c) partial: master saves, snapshot write fails in transit
  await p.locator("#team-open-field-custom_Policy_Interest").fill("Term 20");
  await p.locator("#team-open-field-std_state").selectOption("NM");
  await p.route("**/rest/v1/campaign_leads**", (r) => (r.request().method() === "PATCH" ? r.abort("failed") : r.fallback()));
  await p.locator('button[title="Save Edits"]').click(); await p.waitForTimeout(2500);
  await p.unroute("**/rest/v1/campaign_leads**");
  row.ui.push(`(c) toasts: ${JSON.stringify(await toasts(p))}; details: ${JSON.stringify(await details(p))}`);
  row.shots.push(await ev.shot(p, "S04c-partial"));
  const tc = await toasts(p);
  row.db.push(`(c) lead state / snapshot state: ${sql(`select l.state, cl.state from leads l join campaign_leads cl on cl.lead_id=l.id where l.id='${LEAD.tessa}'`)}`);
  check(sql(`select state from leads where id='${LEAD.tessa}'`) === "NM", "(c) master saved");
  check(sql(`select state from campaign_leads where lead_id='${LEAD.tessa}'`) === "TX", "(c) snapshot not written");
  check(tc.some((t) => /campaign|partial|queue/i.test(t)), "(c) partial outcome reported");
});

await scenario("S05", "Visit identity: a delayed claim re-read for lead A cannot paint onto lead B", async ({ row, open, check }) => {
  row.simulated.push("Voice.js accept/hang-up", "browser-level DELAY (6 s) of the real master GET for lead A");
  const { page: p } = await open("agent1");
  await startCampaign(p, "LV Open Pool");
  const first = sql(`select cl.first_name from dialer_lead_locks d join campaign_leads cl on cl.id=d.campaign_lead_id where d.locked_by='${ID.agent1}'`);
  const aId = sql(`select cl.lead_id from dialer_lead_locks d join campaign_leads cl on cl.id=d.campaign_lead_id where d.locked_by='${ID.agent1}'`);
  row.ui.push(`lead A = ${first}`);
  await call(p); await fv(p, "accept"); await hangUp(p);
  await p.route(`**/rest/v1/leads?*id=eq.${aId}*`, async (r) => {
    if (r.request().method() === "GET") await new Promise((res) => setTimeout(res, 6000));
    return r.fallback();
  });
  await btn(p, /^not interested$/i).click(); await btn(p, /^save$/i).click();
  await p.waitForTimeout(800);
  await btn(p, /^skip$/i).click();
  await p.waitForTimeout(8000);
  await p.unroute(`**/rest/v1/leads?*id=eq.${aId}*`);
  const bName = sql(`select cl.first_name from dialer_lead_locks d join campaign_leads cl on cl.id=d.campaign_lead_id where d.locked_by='${ID.agent1}'`);
  const card = await p.locator("main").innerText();
  row.shots.push(await ev.shot(p, "S05-lead-B-after-stale-read"));
  row.ui.push(`lead B = ${bName}; details(B) = ${JSON.stringify(await details(p))}`);
  row.db.push(`A claimed: ${sql(`select assigned_agent_id='${ID.agent1}' from leads where id='${aId}'`)}`);
  check(bName && bName !== first, "moved to a different lead");
  check(!card.includes(first === "Oliver" ? "Whole Life" : "Final Expense") && !card.includes(`${first} Open`), "no lead-A data on lead B");
  row.ui.push("A→B→A return: not reachable through the ordinary queue (A is suppressed after Skip/claimed); covered by the hook suite (16/16)");
});

await scenario("S06", "Call events: unanswered, repeated attempts (stale accept), wrap-up, inbound interruption", async ({ row, open, check }) => {
  row.simulated.push("Voice.js: ringing/disconnect/accept on specific Call objects; an inbound Call via the fake Device");
  const { page: p } = await open("agent1");
  await startCampaign(p, "LV Team Campaign");
  await call(p); await fv(p, "ringing"); const r1 = await details(p); await fv(p, "disconnect"); const u1 = await details(p);
  row.ui.push(`unanswered: ringing=${r1} afterDisconnect=${u1}`);
  row.shots.push(await ev.shot(p, "S06-unanswered"));
  check(r1 === null && u1 === null, "unanswered never reveals");
  await call(p);
  await fv(p, "accept", 0);
  const stale = await details(p);
  row.ui.push(`attempt 2, previous attempt's late accept: ${stale}`);
  check(stale === null, "stale accept from attempt 1 does not reveal attempt 2");
  await fv(p, "accept", 1);
  const live = await details(p);
  check(live !== null, "attempt 2 accept reveals");
  await hangUp(p);
  const wrap = await details(p);
  row.ui.push(`wrap-up keeps reveal: ${wrap !== null}`);
  check(wrap !== null, "wrap-up keeps reveal");
  await p.evaluate(() => window.__fakeVoice.incoming("+15555550999"));
  await p.waitForTimeout(1500);
  const inbound = await details(p);
  row.shots.push(await ev.shot(p, "S06-inbound"));
  row.ui.push(`during inbound ring: ${inbound === null ? "masked" : "VISIBLE"}`);
  check(inbound === null, "inbound activity masks");
  await p.evaluate(() => window.__fakeVoice.current().reject());
  await p.waitForTimeout(2000);
  row.ui.push(`after the inbound ends (lead still in wrap-up of an answered attempt): ${JSON.stringify(await details(p))}`);
  row.shots.push(await ev.shot(p, "S06-after-inbound"));
});

await scenario("S06b", "Lock loss while revealed masks the lead", async ({ row, open, check }) => {
  row.simulated.push("Voice.js accept", "lock loss: the Agent's lock row deleted by a privileged local actor (models expiry/admin release); detected by the real renew_lead_lock heartbeat");
  const { page: p } = await open("agent1");
  await startCampaign(p, "LV Team Campaign");
  await call(p); await fv(p, "accept");
  check((await details(p)) !== null, "revealed before lock loss");
  sql(`delete from dialer_lead_locks where locked_by='${ID.agent1}'`);
  let masked = false;
  for (let i = 0; i < 45 && !masked; i++) { await p.waitForTimeout(1000); masked = (await details(p)) === null; }
  row.shots.push(await ev.shot(p, "S06b-lock-loss"));
  row.ui.push(`after lock loss: ${masked ? "masked" : JSON.stringify(await details(p))}; toasts ${JSON.stringify(await toasts(p))}`);
  row.db.push(`locks now: ${sql("select count(*) from dialer_lead_locks")}`);
  check(masked, "lock loss masks within the heartbeat window");
});

await scenario("S07", "Two Agents in the same Open Pool follow the existing queue-lock behaviour", async ({ row, open, check }) => {
  const a = await open("agent1"); const b2 = await open("agent2");
  await startCampaign(a.page, "LV Open Pool");
  await startCampaign(b2.page, "LV Open Pool");
  row.shots.push(await ev.shot(a.page, "S07-agent1"), await ev.shot(b2.page, "S07-agent2"));
  const locks = sql("select p.first_name, cl.first_name from dialer_lead_locks d join profiles p on p.id=d.locked_by join campaign_leads cl on cl.id=d.campaign_lead_id order by 1");
  row.db.push(`locks: ${locks.replace(/\n/g, "; ")}`);
  const rows = locks.split("\n").map((l) => l.split("|"));
  check(rows.length === 2 && rows[0][1] !== rows[1][1], "each Agent holds a different lead");
  check(!rows.some(([ag, lead]) => ag === "Avery" && lead === "Owen"), "Agent One is never served Agent Two's owned lead");
});

await scenario("S08", "Sold with an unavailable master stays blocked; disposition + notes kept; Retry only reads", async ({ row, open, check }) => {
  row.simulated.push("Voice.js accept/hang-up", "(b) browser-level network FAILURE of the real post-claim master GET, then removed before Retry");
  const { page: p, net } = await open("agent1");
  await startCampaign(p, "LV Team Campaign");
  await call(p); await fv(p, "accept"); await hangUp(p);
  const notes = p.getByPlaceholder(/note/i).first();
  await notes.fill("keep these notes");
  await btn(p, /^sold$/i).click(); await btn(p, /^save$/i).click(); await p.waitForTimeout(2500);
  const ta = await toasts(p);
  row.ui.push(`(a) pre-claim Sold toasts: ${JSON.stringify(ta)}; notes: ${await notes.inputValue()}`);
  row.shots.push(await ev.shot(p, "S08a-blocked"));
  check(ta.some((t) => t.includes("can't be completed in this dialer flow yet")), "(a) unavailable-before-claim message");
  check((await notes.inputValue()) === "keep these notes", "(a) notes kept");
  check(sql("select count(*) from clients") === "0", "(a) no conversion");
  check(sql(`select assigned_agent_id is null from leads where id='${LEAD.tessa}'`) === "t", "(a) nothing claimed");
  // (b) claim with a failing re-read → error → Sold offers Retry → Retry reads only
  await p.route(`**/rest/v1/leads?*id=eq.${LEAD.tessa}*`, (r) => (r.request().method() === "GET" ? r.abort("failed") : r.fallback()));
  await saveWith(p, "not interested");
  row.ui.push(`(b) details after failed re-read: ${JSON.stringify(await details(p))}`);
  await notes.fill("still here");
  await btn(p, /^sold$/i).click(); await btn(p, /^save$/i).click(); await p.waitForTimeout(2000);
  const tb = await toasts(p);
  row.ui.push(`(b) Sold toasts: ${JSON.stringify(tb)}`);
  row.shots.push(await ev.shot(p, "S08b-error-retry"));
  check(tb.some((t) => t.includes("could not be loaded")), "(b) error message");
  await p.unroute(`**/rest/v1/leads?*id=eq.${LEAD.tessa}*`);
  const before = net.requests.length;
  await p.getByRole("button", { name: /retry loading record/i }).click();
  await p.waitForTimeout(2500);
  const sent = net.requests.slice(before).filter((r) => r.includes(":54321"));
  row.ui.push(`(b) requests sent by Retry: ${JSON.stringify(sent)}; details: ${JSON.stringify(await details(p))}`);
  check(sent.every((r) => r.startsWith("GET ") || r.startsWith("HEAD ")), "(b) Retry only reads");
  check(!sent.some((r) => /convert_lead_to_client_atomic/.test(r)), "(b) Retry never converts");
  check(sql("select count(*) from clients") === "0", "(b) no conversion");
  check((await notes.inputValue()) === "still here", "(b) notes kept");
});

await scenario("S09", "Loaded-record conversion preserves stored custom fields (current implementation)", async ({ row, open, check }) => {
  row.simulated.push("Voice.js accept/hang-up");
  const { page: p } = await open("agent1");
  await startCampaign(p, "LV Team Campaign");
  await call(p); await fv(p, "accept"); await hangUp(p); await saveWith(p, "not interested");
  check((await details(p))?.includes("POLICY INTEREST"), "master loaded");
  await btn(p, /^sold$/i).click(); await btn(p, /^save$/i).click(); await p.waitForTimeout(2000);
  const dlg = p.getByRole("dialog");
  row.shots.push(await ev.shot(p, "S09-convert-modal"));
  const stored = JSON.parse(sql(`select custom_fields from leads where id='${LEAD.tessa}'`));
  await dlg.locator("select").filter({ hasText: "Select carrier" }).selectOption("LV Synthetic Carrier");
  await dlg.getByRole("button", { name: /convert lead/i }).click();
  await p.waitForTimeout(5000);
  row.shots.push(await ev.shot(p, "S09-after-convert"));
  row.ui.push(`toasts: ${JSON.stringify(await toasts(p))}`);
  const client = sql(`select custom_fields, assigned_agent_id is null from clients where lead_id='${LEAD.tessa}'`);
  row.db.push(`stored lead custom_fields before: ${JSON.stringify(stored)}`, `client row (custom_fields | unassigned?): ${client}`);
  row.db.push(`lead deleted: ${sql(`select count(*)=0 from leads where id='${LEAD.tessa}'`)}; wins: ${sql("select count(*), coalesce(max(agent_id::text),'-') from wins")}`);
  check(client.length > 0, "client created");
  const cf = JSON.parse(client.split("|")[0]);
  for (const k of ["Policy Interest", "Dependents", "Coverage Amount", "Smoker", "Email"]) {
    check(JSON.stringify(cf[k]) === JSON.stringify(stored[k]), `stored custom field preserved: ${k}`);
  }
  row.db.push(`internal keys on client: __agentflow=${JSON.stringify(cf.__agentflow)} tags=${JSON.stringify(cf.tags)} additional_policies=${JSON.stringify(cf.additional_policies)} "Blank Note"=${JSON.stringify(cf["Blank Note"])}`);
});

await scenario("S10", "Personal campaign behaviour unchanged (no Team/Open details, no lock)", async ({ row, open, check }) => {
  row.simulated.push("Voice.js accept");
  const { page: p } = await open("agent1");
  await startCampaign(p, "LV Personal (Agent One)");
  await call(p); await fv(p, "accept");
  const main = await p.locator("main").innerText();
  row.shots.push(await ev.shot(p, "S10-personal-connected"));
  row.ui.push(`team-open details component: ${await details(p)}`, `card excerpt: ${JSON.stringify(main.slice(0, 700))}`);
  check((await details(p)) === null, "no Team/Open component");
  check(main.includes("Pat") , "personal lead shown");
  row.db.push(`locks: ${sql("select count(*) from dialer_lead_locks")}`);
  check(sql("select count(*) from dialer_lead_locks") === "0", "no lock for Personal");
});

await scenario("S11", "Cross-organization master-lead access remains denied", async ({ row, open, check }) => {
  const a = await open("agent1"); const o = await open("agentb");
  const read = async (p, id) => p.evaluate(async ([url, anon, lid]) => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("sb-") && x.endsWith("-auth-token"));
    const tok = JSON.parse(localStorage.getItem(k)).access_token;
    const r = await fetch(`${url}/rest/v1/leads?id=eq.${lid}&select=id,first_name,custom_fields`, { headers: { apikey: anon, Authorization: `Bearer ${tok}` } });
    return `${r.status} ${await r.text()}`;
  }, ["http://127.0.0.1:54321", env.ANON_KEY, id]);
  const r1 = await read(o.page, LEAD.tessa); const r2 = await read(o.page, LEAD.pat); const r3 = await read(a.page, LEAD.bianca);
  row.ui.push(`org B Agent → org A Tessa: ${r1}`, `org B Agent → org A Pat: ${r2}`, `org A Agent → org B Bianca: ${r3}`);
  await o.page.goto(`${APP}/dialer`); await o.page.waitForTimeout(3000);
  const list = await o.page.locator("main").innerText();
  row.shots.push(await ev.shot(o.page, "S11-orgB-dialer"));
  row.ui.push(`org B dialer lists org A campaigns: ${/LV Team Campaign|LV Open Pool\b/.test(list)}`);
  check([r1, r2, r3].every((r) => r === "200 []"), "zero rows across orgs");
  check(!/LV Team Campaign|LV Open Pool\b/.test(list), "org B sees no org A campaign");
});

ev.save();
console.log(JSON.stringify(ev.scenarios.map((s) => [s.id, s.result, s.error ?? ""]), null, 1));
