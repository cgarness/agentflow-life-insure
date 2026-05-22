/**
 * Remove demo users and all demo calls/wins/appointments.
 *
 *   ALLOW_PRODUCTION=yes npm run leaderboard-demo:cleanup-users
 */

import { createClient } from "@supabase/supabase-js";
import { assertProductionAllowed, loadAdminEnv } from "./lib/supabase-admin-env.mjs";

const EMAIL_DOMAIN = "leaderboard-demo.local";

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

const { url: supabaseUrl, serviceRoleKey, projectRef } = loadAdminEnv();
if (!supabaseUrl || !serviceRoleKey) {
  fail("Missing Supabase admin credentials.");
}

const isLocal = (() => {
  try {
    const h = new URL(supabaseUrl).hostname;
    return h === "127.0.0.1" || h === "localhost";
  } catch {
    return false;
  }
})();

if (!isLocal) assertProductionAllowed(supabaseUrl, projectRef);

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const agentIds = [];
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(error.message);

    for (const user of data.users) {
      if (user.email?.endsWith(`@${EMAIL_DOMAIN}`)) {
        agentIds.push(user.id);
      }
    }

    if (data.users.length < 200) break;
    page += 1;
  }

  const orgId = process.env.ORG_ID?.trim();

  await admin.from("calls").delete().like("contact_name", "Demo %");
  await admin.from("calls").delete().like("contact_name", "Live Demo %");
  await admin.from("wins").delete().like("contact_name", "Demo %");
  await admin.from("wins").delete().like("contact_name", "Live Win %");
  await admin.from("wins").delete().eq("campaign_name", "Leaderboard Demo");

  if (orgId) {
    await admin.from("calls").delete().eq("organization_id", orgId).in("agent_id", agentIds);
    await admin.from("wins").delete().eq("organization_id", orgId).in("agent_id", agentIds);
  } else if (agentIds.length) {
    await admin.from("calls").delete().in("agent_id", agentIds);
    await admin.from("wins").delete().in("agent_id", agentIds);
  }

  for (const id of agentIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.warn(`  delete user ${id}: ${error.message}`);
    else console.log(`  deleted demo user ${id}`);
  }

  console.log(`\n✅ Cleanup done (${agentIds.length} demo user(s)).\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
