/**
 * Zero out leaderboard demo stats for Today (all active agents in org).
 * Removes sim/seed activity plus any calls, wins, and appointments from start of today.
 *
 *   ALLOW_PRODUCTION=yes npm run leaderboard-demo:reset-stats
 */

import { createClient } from "@supabase/supabase-js";
import { assertProductionAllowed, loadAdminEnv } from "./lib/supabase-admin-env.mjs";

const DEFAULT_ORG_ID = "a0000000-0000-0000-0000-000000000001";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

const { url: supabaseUrl, serviceRoleKey, projectRef } = loadAdminEnv();
if (!serviceRoleKey) fail("Missing service role key.");
assertProductionAllowed(supabaseUrl, projectRef);

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const orgId = process.env.ORG_ID?.trim() || DEFAULT_ORG_ID;
  const todayStart = startOfToday().toISOString();

  console.log("\n↺ Reset leaderboard stats (Today + demo/sim rows)\n");
  console.log(`  org: ${orgId}`);
  console.log(`  from: ${todayStart}\n`);

  const { data: agents, error: agentsError } = await admin
    .from("profiles")
    .select("id, first_name, last_name")
    .eq("organization_id", orgId)
    .eq("status", "Active");
  if (agentsError) fail(agentsError.message);

  const agentIds = (agents || []).map((a) => a.id);
  console.log(`  agents (${agentIds.length}): ${(agents || []).map((a) => `${a.first_name} ${a.last_name?.[0] || ""}.`.trim()).join(", ")}\n`);

  const deletes = [
    {
      label: "calls (today)",
      run: () =>
        admin
          .from("calls")
          .delete({ count: "exact" })
          .eq("organization_id", orgId)
          .gte("started_at", todayStart),
    },
    {
      label: "calls (demo/sim)",
      run: async () => {
        let total = 0;
        for (const pattern of ["Demo Call %", "Sim Contact %"]) {
          const { error, count } = await admin
            .from("calls")
            .delete({ count: "exact" })
            .eq("organization_id", orgId)
            .like("contact_name", pattern);
          if (error) throw error;
          total += count ?? 0;
        }
        return { error: null, count: total };
      },
    },
    {
      label: "wins (today)",
      run: () =>
        admin
          .from("wins")
          .delete({ count: "exact" })
          .eq("organization_id", orgId)
          .gte("created_at", todayStart),
    },
    {
      label: "wins (demo/sim)",
      run: async () => {
        let total = 0;
        const filters = [
          () => admin.from("wins").delete({ count: "exact" }).eq("organization_id", orgId).like("contact_name", "Demo Win %"),
          () => admin.from("wins").delete({ count: "exact" }).eq("organization_id", orgId).like("contact_name", "Sim Win %"),
          () => admin.from("wins").delete({ count: "exact" }).eq("organization_id", orgId).eq("campaign_name", "Leaderboard Demo"),
        ];
        for (const run of filters) {
          const { error, count } = await run();
          if (error) throw error;
          total += count ?? 0;
        }
        return { error: null, count: total };
      },
    },
    {
      label: "appointments (today)",
      run: () =>
        admin
          .from("appointments")
          .delete({ count: "exact" })
          .eq("organization_id", orgId)
          .gte("created_at", todayStart),
    },
    {
      label: "appointments (sim)",
      run: () =>
        admin
          .from("appointments")
          .delete({ count: "exact" })
          .eq("organization_id", orgId)
          .like("title", "Sim Appt %"),
    },
  ];

  for (const step of deletes) {
    const { error, count } = await step.run();
    if (error) fail(`${step.label}: ${error.message || JSON.stringify(error)}`);
    console.log(`  ✓ ${step.label}: removed ${count ?? 0}`);
  }

  console.log("\n✅ Leaderboard reset — all agents should show 0 on Today.\n");
  console.log("  Start sim: ALLOW_PRODUCTION=yes npm run leaderboard-demo:simulate\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
