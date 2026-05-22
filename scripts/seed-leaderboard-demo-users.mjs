/**
 * Seed 15 demo agents for leaderboard screen recordings (avatars via Unsplash).
 *
 * Production (Chris FFL org default):
 *   ALLOW_PRODUCTION=yes ORG_ID=a0000000-0000-0000-0000-000000000001 npm run leaderboard-demo:seed-users
 *
 * Local:
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... npm run leaderboard-demo:seed-users
 */

import { createClient } from "@supabase/supabase-js";
import { assertProductionAllowed, loadAdminEnv } from "./lib/supabase-admin-env.mjs";

const DEMO_PASSWORD = "DemoLeaderboard123!";
const EMAIL_DOMAIN = "leaderboard-demo.local";
const DEFAULT_ORG_ID = "a0000000-0000-0000-0000-000000000001";

/** Stable Unsplash portraits (256×256 face crop) — safe for demo recordings */
const DEMO_AGENTS = [
  {
    firstName: "Alex",
    lastName: "Rivera",
    slot: 1,
    avatarUrl:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=256&h=256&fit=crop&crop=faces",
  },
  {
    firstName: "Nick",
    lastName: "Walsh",
    slot: 2,
    avatarUrl:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=256&h=256&fit=crop&crop=faces",
  },
  {
    firstName: "Casey",
    lastName: "Brooks",
    slot: 3,
    avatarUrl:
      "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=256&h=256&fit=crop&crop=faces",
  },
  {
    firstName: "Dana",
    lastName: "Scott",
    slot: 4,
    avatarUrl:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=256&h=256&fit=crop&crop=faces",
  },
  {
    firstName: "Evan",
    lastName: "Pierce",
    slot: 5,
    avatarUrl:
      "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=256&h=256&fit=crop&crop=faces",
  },
  {
    firstName: "Nick",
    lastName: "Thompson",
    slot: 6,
    avatarUrl:
      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=256&h=256&fit=crop&crop=faces",
  },
  {
    firstName: "Jordan",
    lastName: "Lee",
    slot: 7,
    avatarUrl:
      "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=256&h=256&fit=crop&crop=faces",
  },
  {
    firstName: "Maya",
    lastName: "Chen",
    slot: 8,
    avatarUrl:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=256&h=256&fit=crop&crop=faces",
  },
  {
    firstName: "Tyler",
    lastName: "James",
    slot: 9,
    avatarUrl:
      "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=256&h=256&fit=crop&crop=faces",
  },
  {
    firstName: "Riley",
    lastName: "Morgan",
    slot: 10,
    avatarUrl:
      "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=256&h=256&fit=crop&crop=faces",
  },
  {
    firstName: "Sam",
    lastName: "Torres",
    slot: 11,
    avatarUrl:
      "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=256&h=256&fit=crop&crop=faces",
  },
  {
    firstName: "Quinn",
    lastName: "Adams",
    slot: 12,
    avatarUrl:
      "https://images.unsplash.com/photo-1552058544-f2b08422138a?w=256&h=256&fit=crop&crop=faces",
  },
  {
    firstName: "Morgan",
    lastName: "Reed",
    slot: 13,
    avatarUrl:
      "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=256&h=256&fit=crop&crop=faces",
  },
  {
    firstName: "Jamie",
    lastName: "Foster",
    slot: 14,
    avatarUrl:
      "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=256&h=256&fit=crop&crop=faces",
  },
  {
    firstName: "Avery",
    lastName: "Blake",
    slot: 15,
    avatarUrl:
      "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=256&h=256&fit=crop&crop=faces",
  },
];

function baselineStats(slotIndex) {
  const i = slotIndex - 1;
  return {
    calls: Math.max(1, 14 - i),
    wins: Math.max(0, 5 - Math.floor(i / 3)),
  };
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function isLocalSupabaseUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

const { url: supabaseUrl, serviceRoleKey, projectRef } = loadAdminEnv();
const orgName = process.env.ORG_NAME?.trim();
const orgSlug = process.env.ORG_SLUG?.trim();

if (!supabaseUrl || !serviceRoleKey) {
  fail(
    "Missing Supabase admin credentials.\n" +
      "Set SUPABASE_SERVICE_ROLE_KEY or run while logged into Supabase CLI (`npx supabase login`).",
  );
}

const isLocal = isLocalSupabaseUrl(supabaseUrl);
if (!isLocal) {
  assertProductionAllowed(supabaseUrl, projectRef);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function resolveOrganizationId() {
  const explicitOrgId = process.env.ORG_ID?.trim() || (!orgName && !orgSlug ? DEFAULT_ORG_ID : "");
  if (explicitOrgId) {
    const { data, error } = await admin
      .from("organizations")
      .select("id, name, slug")
      .eq("id", explicitOrgId)
      .maybeSingle();
    if (error) fail(`Organization lookup failed: ${error.message}`);
    if (!data) fail(`ORG_ID not found: ${explicitOrgId}`);
    return data;
  }

  if (orgSlug) {
    const { data, error } = await admin
      .from("organizations")
      .select("id, name, slug")
      .eq("slug", orgSlug)
      .maybeSingle();
    if (error) fail(`Organization lookup failed: ${error.message}`);
    if (data) return data;
  }

  const name = orgName || "AgentFlow";
  const { data: byName, error: nameError } = await admin
    .from("organizations")
    .select("id, name, slug")
    .ilike("name", name)
    .limit(5);

  if (nameError) fail(`Organization lookup failed: ${nameError.message}`);
  if (!byName?.length) fail(`No organization found matching name "${name}". Set ORG_ID=...`);
  if (byName.length > 1) {
    console.warn("Multiple organizations matched; using the first:");
    byName.forEach((o) => console.warn(`  - ${o.name} (${o.id})`));
  }
  return byName[0];
}

async function findUserByEmail(email) {
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function ensureDemoUser(orgId, agent) {
  const email = `leaderboard-demo-${agent.slot}@${EMAIL_DOMAIN}`;

  let user = await findUserByEmail(email);

  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: {
        first_name: agent.firstName,
        last_name: agent.lastName,
        organization_id: orgId,
        role: "Agent",
      },
    });
    if (error) fail(`createUser ${email}: ${error.message}`);
    user = data.user;
    console.log(`  created auth user ${email}`);
  } else {
    console.log(`  auth user exists ${email}`);
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        first_name: agent.firstName,
        last_name: agent.lastName,
        organization_id: orgId,
        role: "Agent",
      },
    });
  }

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: user.id,
      email,
      first_name: agent.firstName,
      last_name: agent.lastName,
      avatar_url: agent.avatarUrl,
      organization_id: orgId,
      role: "Agent",
      status: "Active",
      onboarding_complete: true,
    },
    { onConflict: "id" },
  );

  if (profileError) fail(`profiles upsert ${email}: ${profileError.message}`);

  return { id: user.id, email, name: `${agent.firstName} ${agent.lastName}` };
}

async function seedBaselineActivity(orgId, agents) {
  const agentsNeedingBaseline = [];

  for (const agent of agents) {
    const { count } = await admin
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("agent_id", agent.id)
      .like("contact_name", "Demo Call %");

    if ((count ?? 0) === 0) agentsNeedingBaseline.push(agent);
  }

  if (!agentsNeedingBaseline.length) {
    console.log("  baseline: skipped (all demo agents already have baseline calls)");
    return;
  }

  const now = new Date();
  const calls = [];
  const wins = [];

  agentsNeedingBaseline.forEach((agent) => {
    const slot = Number(agent.email.match(/leaderboard-demo-(\d+)@/)?.[1] ?? 0);
    const { calls: callCount, wins: winCount } = baselineStats(slot || 1);

    for (let c = 0; c < callCount; c++) {
      const started = new Date(now.getTime() - (c + 1) * 4 * 60 * 1000);
      calls.push({
        agent_id: agent.id,
        organization_id: orgId,
        contact_name: `Demo Call ${agent.name} #${c + 1}`,
        contact_phone: `555010${String(slot).padStart(2, "0")}${String(c).padStart(2, "0")}`,
        direction: "outbound",
        disposition_name: c % 3 === 0 ? "No Answer" : "Contact Made",
        duration: 90 + c * 15,
        started_at: started.toISOString(),
        ended_at: new Date(started.getTime() + 120000).toISOString(),
      });
    }
    for (let w = 0; w < winCount; w++) {
      wins.push({
        agent_id: agent.id,
        agent_name: agent.name,
        organization_id: orgId,
        contact_name: `Demo Win ${agent.name} #${w + 1}`,
        policy_type: w % 2 === 0 ? "Term Life" : "Whole Life",
        campaign_name: "Leaderboard Demo",
        celebrated: false,
        created_at: new Date(now.getTime() - (w + 1) * 15 * 60 * 1000).toISOString(),
      });
    }
  });

  if (calls.length) {
    const { error } = await admin.from("calls").insert(calls);
    if (error) fail(`baseline calls: ${error.message}`);
  }
  if (wins.length) {
    const { error } = await admin.from("wins").insert(wins);
    if (error) fail(`baseline wins: ${error.message}`);
  }
  console.log(`  baseline: ${calls.length} calls, ${wins.length} wins for ${agentsNeedingBaseline.length} agent(s)`);
}

async function main() {
  console.log("\n🏆 Leaderboard demo users\n");
  console.log(`  Supabase: ${supabaseUrl}`);
  if (!isLocal) console.log("  ⚠️  PRODUCTION — cleanup with npm run leaderboard-demo:cleanup-users\n");

  const org = await resolveOrganizationId();
  console.log(`  Organization: ${org.name} (${org.id})\n`);

  const created = [];
  for (const agent of DEMO_AGENTS) {
    console.log(`→ ${agent.firstName} ${agent.lastName}`);
    created.push(await ensureDemoUser(org.id, agent));
  }

  console.log("\n→ Seeding baseline stats for Today...");
  await seedBaselineActivity(org.id, created);

  console.log("\n✅ Done.\n");
  console.log("  Demo logins (optional):");
  for (const row of created) {
    console.log(`    ${row.email}  /  ${DEMO_PASSWORD}`);
  }
  console.log(`\n  organization_id: ${org.id}`);
  console.log("\n  Live animation: ALLOW_PRODUCTION=yes npm run leaderboard-demo:simulate");
  console.log("  Cleanup:        ALLOW_PRODUCTION=yes npm run leaderboard-demo:cleanup-users\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
