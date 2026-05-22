/**
 * Random leaderboard activity simulator — call-first funnel:
 *   call → ~30% appointment → 3–15% of appointments close as wins ($35–500/mo premium).
 * Does NOT send win notifications to the whole org.
 *
 * Includes every Active profile in the org by default (demo + real users).
 * Optional subset: DEMO_RACE_AGENTS=nick,dana (first names, comma-separated)
 * Demo-only (legacy): DEMO_DEMO_USERS_ONLY=1
 *
 *   ALLOW_PRODUCTION=yes npm run leaderboard-demo:simulate
 *
 * Event timing is random (not synced to the UI scoreboard refresh countdown).
 * Stop with Ctrl+C.
 */

import { createClient } from "@supabase/supabase-js";
import { assertProductionAllowed, loadAdminEnv } from "./lib/supabase-admin-env.mjs";

const EMAIL_DOMAIN = "leaderboard-demo.local";
const DEFAULT_ORG_ID = "a0000000-0000-0000-0000-000000000001";

const RACE_FIRST_NAMES = (process.env.DEMO_RACE_AGENTS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const POLICY_TYPES = ["Term Life", "Whole Life", "IUL", "Final Expense"];
const CALL_DISPOSITIONS = ["No Answer", "Voicemail", "Not Interested", "Callback"];
/** Share of calls that schedule an appointment. */
const APPOINTMENT_FROM_CALL_RATE = 0.3;
const PREMIUM_MIN = 35;
const PREMIUM_MAX = 500;

/** Event cadence multiplier (lower = faster). Tuned for screen recordings. */
const SIM_SPEED_FACTOR = 0.3;
const ACTIVITY_CACHE_MS = 500;
/** Re-read org roster so newly seeded demo users join without restarting. */
const AGENT_RELOAD_MS = 30_000;

/** Nick W. and Dana S. stay near the top; everyone else gets a session tier. */
const STAR_PRODUCTION_BOOST = 1.1;
const STAR_AGENTS = [
  { firstName: "nick", lastInitial: "w" },
  { firstName: "dana", lastInitial: "s" },
];

/** Per-agent sim profile for this session (stable until sim restarts). */
const agentProfiles = new Map();

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const { url: supabaseUrl, serviceRoleKey, projectRef } = loadAdminEnv();
if (!serviceRoleKey) {
  console.error("Missing service role key (Supabase CLI login or SUPABASE_SERVICE_ROLE_KEY).");
  process.exit(1);
}
assertProductionAllowed(supabaseUrl, projectRef);

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loadOrgAgents(orgId) {
  const demoOnly = process.env.DEMO_DEMO_USERS_ONLY === "1";

  let query = admin
    .from("profiles")
    .select("id, first_name, last_name, email, role")
    .eq("organization_id", orgId)
    .eq("status", "Active")
    .order("first_name");

  if (demoOnly) {
    query = query.like("email", `%@${EMAIL_DOMAIN}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) {
    throw new Error(
      demoOnly
        ? "No demo agents found. Run npm run leaderboard-demo:seed-users first."
        : "No active profiles in this org.",
    );
  }

  return data.map((p) => ({
    id: p.id,
    firstName: (p.first_name || "").toLowerCase(),
    lastName: (p.last_name || "").trim(),
    name: `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.email,
    email: p.email,
    role: p.role,
  }));
}

function isStarAgent(agent) {
  const lastInitial = (agent.lastName || agent.name.split(/\s+/)[1] || "")[0]?.toLowerCase() ?? "";
  return STAR_AGENTS.some(
    (star) => star.firstName === agent.firstName && star.lastInitial === lastInitial,
  );
}

function rollAgentProfile(agent) {
  if (isStarAgent(agent)) {
    return {
      tier: "star",
      activityWeight: 1.38 * STAR_PRODUCTION_BOOST,
      closeRate: randBetween(0.11, 0.15),
    };
  }

  const roll = Math.random();
  if (roll < 0.24) {
    const hot = randBetween(1.15, 1.52);
    return {
      tier: "hot",
      activityWeight: hot,
      closeRate: randBetween(0.08, 0.14),
    };
  }
  if (roll < 0.52) {
    const mid = randBetween(0.82, 1.12);
    return {
      tier: "mid",
      activityWeight: mid,
      closeRate: randBetween(0.05, 0.11),
    };
  }
  const cold = randBetween(0.72, 1.05);
  return {
    tier: "cold",
    activityWeight: cold,
    closeRate: randBetween(0.03, 0.08),
  };
}

function getAgentProfile(agent) {
  let profile = agentProfiles.get(agent.id);
  if (!profile) {
    profile = rollAgentProfile(agent);
    agentProfiles.set(agent.id, profile);
  }
  return profile;
}

function ensureAgentProfiles(agents) {
  for (const agent of agents) {
    getAgentProfile(agent);
  }
}

function eventJitter() {
  return randBetween(0.86, 1.18);
}

function agentSelectionWeight(agent) {
  return getAgentProfile(agent).activityWeight;
}

function pickWeightedAgent(candidates) {
  if (!candidates.length) return undefined;
  const weights = candidates.map(agentSelectionWeight);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < candidates.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function appointmentCloseRate(agent) {
  return getAgentProfile(agent).closeRate;
}

function rollPremiumMonthly() {
  return Math.round(randBetween(PREMIUM_MIN, PREMIUM_MAX));
}

function summarizeAgentTiers(agents) {
  const grouped = { star: [], hot: [], mid: [], cold: [] };
  for (const agent of agents) {
    const { tier } = getAgentProfile(agent);
    grouped[tier]?.push(agent.name);
  }
  return grouped;
}

function resolveSimAgents(agents) {
  if (RACE_FIRST_NAMES.length === 0) {
    return [...agents].sort((a, b) => a.name.localeCompare(b.name));
  }

  const subset = agents.filter((a) => RACE_FIRST_NAMES.includes(a.firstName));
  if (subset.length === 0) {
    throw new Error(
      `No agents matched DEMO_RACE_AGENTS [${RACE_FIRST_NAMES.join(", ")}] in org.`,
    );
  }
  return subset.sort((a, b) => a.name.localeCompare(b.name));
}

function formatAgentList(agents) {
  if (agents.length <= 8) return agents.map((a) => a.name).join(", ");
  return `${agents
    .slice(0, 6)
    .map((a) => a.name)
    .join(", ")}, … +${agents.length - 6} more`;
}

async function todayActivityCounts(orgId, agentIds) {
  const start = startOfToday().toISOString();

  const [winsRes, callsRes] = await Promise.all([
    admin
      .from("wins")
      .select("agent_id")
      .eq("organization_id", orgId)
      .gte("created_at", start)
      .in("agent_id", agentIds),
    admin
      .from("calls")
      .select("agent_id")
      .eq("organization_id", orgId)
      .gte("started_at", start)
      .in("agent_id", agentIds),
  ]);

  if (winsRes.error) throw winsRes.error;
  if (callsRes.error) throw callsRes.error;

  const wins = Object.fromEntries(agentIds.map((id) => [id, 0]));
  const calls = Object.fromEntries(agentIds.map((id) => [id, 0]));

  for (const row of winsRes.data || []) {
    wins[row.agent_id] = (wins[row.agent_id] || 0) + 1;
  }
  for (const row of callsRes.data || []) {
    calls[row.agent_id] = (calls[row.agent_id] || 0) + 1;
  }

  return { wins, calls };
}

let cachedActivity = null;
let cachedActivityAt = 0;
let simAgents = [];
let lastAgentReloadAt = 0;

async function refreshSimAgents(orgId, options = {}) {
  const orgAgents = await loadOrgAgents(orgId);
  const nextAgents = resolveSimAgents(orgAgents);
  const prevCount = simAgents.length;
  simAgents = nextAgents;
  ensureAgentProfiles(nextAgents);
  lastAgentReloadAt = Date.now();
  cachedActivity = null;

  if (options.log !== false && (options.force || prevCount !== nextAgents.length)) {
    simLog(`roster: ${nextAgents.length} active agent(s) — ${formatAgentList(nextAgents)}`);
  }

  return simAgents;
}

async function getActivityCounts(orgId, agentIds) {
  const now = Date.now();
  if (cachedActivity && now - cachedActivityAt < ACTIVITY_CACHE_MS) {
    return cachedActivity;
  }
  cachedActivity = await todayActivityCounts(orgId, agentIds);
  cachedActivityAt = now;
  return cachedActivity;
}

function bumpActivity(agentId, field) {
  if (!cachedActivity) return;
  cachedActivity[field][agentId] = (cachedActivity[field][agentId] || 0) + 1;
}

function pickCatchUpAgent(agents, winCounts, _tieBreaker) {
  let min = Infinity;
  for (const a of agents) {
    const c = winCounts[a.id] ?? 0;
    if (c < min) min = c;
  }
  const tied = agents.filter((a) => (winCounts[a.id] ?? 0) === min);
  return pickWeightedAgent(tied);
}

function pickMidPackAgent(agents, winCounts) {
  const sorted = [...agents].sort(
    (a, b) => (winCounts[a.id] ?? 0) - (winCounts[b.id] ?? 0),
  );
  const third = Math.max(1, Math.floor(sorted.length / 3));
  const mid = sorted.slice(third, third * 2);
  return pickWeightedAgent(mid.length ? mid : sorted);
}

function pickLowerCallAgent(agents, callCounts) {
  const sorted = [...agents].sort(
    (a, b) => (callCounts[a.id] ?? 0) - (callCounts[b.id] ?? 0),
  );
  const half = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
  return pickWeightedAgent(half);
}

function pickAgent(agents, winCounts, callCounts, tieBreaker) {
  const roll = Math.random();
  // Spread activity — favor agents with fewer calls/wins, not just top producers.
  if (roll < 0.12) return pick(agents);
  if (roll < 0.52) return pickLowerCallAgent(agents, callCounts);
  if (roll < 0.7) return pickCatchUpAgent(agents, winCounts, tieBreaker);
  if (roll < 0.84) return pickMidPackAgent(agents, winCounts);
  return pickWeightedAgent(agents);
}

function funnelPauseMs() {
  return Math.round(randBetween(120, 320) * SIM_SPEED_FACTOR);
}

function nextDelayMs() {
  if (Math.random() < 0.015) {
    return Math.round(randBetween(900, 1600) * SIM_SPEED_FACTOR);
  }
  return Math.round(randBetween(180, 650) * SIM_SPEED_FACTOR);
}

function chainDelayMs() {
  return Math.round(randBetween(180, 450) * SIM_SPEED_FACTOR);
}

const startedAt = Date.now();
let eventSeq = 0;
let tieBreaker = 0;
let nextTimer = null;
let stopping = false;

function simLog(message) {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[sim ${elapsed}s] ${message}`);
}

function stopAll() {
  stopping = true;
  if (nextTimer) clearTimeout(nextTimer);
  nextTimer = null;
}

async function insertCall(orgId, agent, seq, { disposition } = {}) {
  const now = new Date();
  const profile = getAgentProfile(agent);
  const durationSec = Math.round(randBetween(35, 285) * profile.activityWeight * eventJitter());
  const dispositionName = disposition ?? pick(CALL_DISPOSITIONS);

  const { error } = await admin.from("calls").insert({
    agent_id: agent.id,
    organization_id: orgId,
    contact_name: `Sim Contact ${seq}`,
    contact_phone: `55502${String(seq % 10000).padStart(4, "0")}`,
    direction: "outbound",
    disposition_name: dispositionName,
    duration: durationSec,
    started_at: now.toISOString(),
    ended_at: new Date(now.getTime() + durationSec * 1000).toISOString(),
  });
  if (error) throw error;

  bumpActivity(agent.id, "calls");
  simLog(`call: ${agent.name} +1 call, ${durationSec}s talk (${dispositionName})`);
}

async function insertWin(orgId, agent, seq) {
  const now = new Date();
  const policyType = pick(POLICY_TYPES);
  const premiumMonthly = rollPremiumMonthly();

  const { error } = await admin.from("wins").insert({
    agent_id: agent.id,
    agent_name: agent.name,
    organization_id: orgId,
    contact_name: `Sim Win ${seq}`,
    policy_type: policyType,
    campaign_name: "Leaderboard Demo",
    premium_amount: premiumMonthly,
    celebrated: false,
    created_at: now.toISOString(),
  });
  if (error) throw error;

  bumpActivity(agent.id, "wins");
  simLog(`win: ${agent.name} closed ${policyType} ($${premiumMonthly}/mo)`);
}

async function insertAppointment(orgId, agent, seq) {
  const now = new Date();
  const hoursOut = Math.round(randBetween(1, 48));
  const apptStart = new Date(now.getTime() + hoursOut * 3600000);

  const { error } = await admin.from("appointments").insert({
    user_id: agent.id,
    created_by: agent.id,
    organization_id: orgId,
    title: `Sim Appt ${seq}`,
    contact_name: `Sim Contact ${seq}`,
    type: "Sales Call",
    status: "Scheduled",
    start_time: apptStart.toISOString(),
    end_time: new Date(apptStart.getTime() + 3600000).toISOString(),
    created_at: now.toISOString(),
  });
  if (error) throw error;

  simLog(`appointment: ${agent.name} scheduled (+1 appt)`);
  return true;
}

/** One dial attempt: call always, ~30% book appt, 3–15% of appts close. */
async function runCallCycle(orgId, agent, seq) {
  const booksAppt = Math.random() < APPOINTMENT_FROM_CALL_RATE;
  await insertCall(orgId, agent, seq, {
    disposition: booksAppt ? "Callback" : undefined,
  });

  if (!booksAppt) return { call: true, appointment: false, win: false };

  await new Promise((r) => setTimeout(r, funnelPauseMs()));
  eventSeq += 1;
  const apptSeq = eventSeq;
  await insertAppointment(orgId, agent, apptSeq);

  const closes = Math.random() < appointmentCloseRate(agent);
  if (!closes) return { call: true, appointment: true, win: false };

  await new Promise((r) => setTimeout(r, funnelPauseMs()));
  eventSeq += 1;
  await insertWin(orgId, agent, eventSeq);
  simLog(`funnel: ${agent.name} call → appt → sold`);
  return { call: true, appointment: true, win: true };
}

async function runDialStreak(orgId) {
  const agents = simAgents;
  if (!agents.length) return;

  tieBreaker += 1;
  const { wins, calls } = await getActivityCounts(
    orgId,
    agents.map((a) => a.id),
  );
  const agent = pickAgent(agents, wins, calls, tieBreaker);
  const streakSize = Math.round(randBetween(2, 4));

  for (let i = 0; i < streakSize; i += 1) {
    eventSeq += 1;
    await runCallCycle(orgId, agent, eventSeq);
    if (i < streakSize - 1) {
      await new Promise((r) =>
        setTimeout(r, Math.round(randBetween(250, 600) * SIM_SPEED_FACTOR)),
      );
    }
  }

  simLog(`dial streak: ${agent.name} × ${streakSize} calls`);
}

async function runMultiAgentTick(orgId, agentCount) {
  const agents = simAgents;
  if (!agents.length) return;

  const { wins, calls } = await getActivityCounts(
    orgId,
    agents.map((a) => a.id),
  );
  const used = new Set();

  for (let i = 0; i < agentCount; i += 1) {
    tieBreaker += 1;
    let agent = pickAgent(agents, wins, calls, tieBreaker);
    let attempts = 0;
    while (used.has(agent.id) && attempts < 10) {
      tieBreaker += 1;
      agent = pickAgent(agents, wins, calls, tieBreaker);
      attempts += 1;
    }
    used.add(agent.id);

    eventSeq += 1;
    await runCallCycle(orgId, agent, eventSeq);
    calls[agent.id] = (calls[agent.id] || 0) + 1;

    if (i < agentCount - 1) {
      await new Promise((r) =>
        setTimeout(r, Math.round(randBetween(80, 220) * SIM_SPEED_FACTOR)),
      );
    }
  }

  simLog(`multi-agent tick: ${[...used].map((id) => agents.find((a) => a.id === id)?.name).filter(Boolean).join(", ")}`);
}

async function runOneEvent(orgId) {
  if (Date.now() - lastAgentReloadAt >= AGENT_RELOAD_MS) {
    await refreshSimAgents(orgId, { log: true });
  }

  const agents = simAgents;
  if (!agents.length) {
    throw new Error("No active agents in simulation roster.");
  }

  const roll = Math.random();
  if (roll < 0.22) {
    await runMultiAgentTick(orgId, Math.random() < 0.35 ? 3 : 2);
    return;
  }
  if (roll < 0.4) {
    await runDialStreak(orgId);
    return;
  }

  eventSeq += 1;
  tieBreaker += 1;
  const { wins, calls } = await getActivityCounts(
    orgId,
    agents.map((a) => a.id),
  );
  const agent = pickAgent(agents, wins, calls, tieBreaker);
  await runCallCycle(orgId, agent, eventSeq);
}

function scheduleNext(orgId) {
  if (stopping) return;

  const delayMs = nextDelayMs();
  if (delayMs >= 2000) {
    simLog(`quiet — next event in ${(delayMs / 1000).toFixed(1)}s`);
  }

  nextTimer = setTimeout(() => {
    runOneEvent(orgId)
      .catch((err) => {
        console.error(err);
        stopAll();
        process.exit(1);
      })
      .finally(() => {
        if (stopping) return;
        if (Math.random() < 0.22) {
          nextTimer = setTimeout(() => {
            runOneEvent(orgId)
              .catch((err) => {
                console.error(err);
                stopAll();
                process.exit(1);
              })
              .finally(() => {
                if (!stopping) scheduleNext(orgId);
              });
          }, chainDelayMs());
          return;
        }
        scheduleNext(orgId);
      });
  }, delayMs);
}

async function main() {
  const orgId = process.env.ORG_ID?.trim() || DEFAULT_ORG_ID;
  await refreshSimAgents(orgId, { force: true, log: false });

  console.log("\n▶ Leaderboard random activity simulator");
  console.log(`  org: ${orgId}`);
  console.log(`  agents (${simAgents.length}): ${simAgents.map((a) => a.name).join(", ")}`);
  console.log("  pool: all Active org profiles (demo + real users)");
  console.log("  tiers: ~24% hot · ~28% mid · ~48% cold/star mix — weights stick for this session");
  const tiers = summarizeAgentTiers(simAgents);
  if (tiers.star.length) console.log(`  stars: ${tiers.star.join(", ")}`);
  if (tiers.hot.length) console.log(`  hot:   ${tiers.hot.join(", ")}`);
  if (tiers.cold.length) console.log(`  cold:  ${tiers.cold.join(", ")}`);
  console.log(`  funnel: call (always) → ~${Math.round(APPOINTMENT_FROM_CALL_RATE * 100)}% appt → 3–15% appt close`);
  console.log(`  premium: $${PREMIUM_MIN}–$${PREMIUM_MAX}/mo on closed deals`);
  console.log("  timing: fast cadence · ~22% multi-agent ticks · ~18% dial streaks");
  console.log("  selection: favors agents with fewer calls so the whole roster moves");
  console.log("  warmup: 5 quick cycles across the roster");
  console.log("  Open /leaderboard (Today) and watch Recent Wins vs podium/table.");
  console.log("  Ctrl+C to stop.\n");

  for (let i = 0; i < 5; i += 1) {
    await runOneEvent(orgId);
    if (i < 4) {
      await new Promise((r) => setTimeout(r, Math.round(randBetween(120, 280) * SIM_SPEED_FACTOR)));
    }
  }
  scheduleNext(orgId);

  process.on("SIGINT", () => {
    stopAll();
    console.log("\nStopped.\n");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
