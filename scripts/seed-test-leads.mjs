/**
 * Seed fake unassigned leads for dialer / campaign / contacts testing.
 *
 * Production (Chris FFL org default):
 *   ALLOW_PRODUCTION=yes COUNT=200 npm run test-leads:seed
 *
 * Cleanup:
 *   ALLOW_PRODUCTION=yes npm run test-leads:cleanup
 */

import { createClient } from "@supabase/supabase-js";
import { assertProductionAllowed, loadAdminEnv } from "./lib/supabase-admin-env.mjs";

const DEFAULT_ORG_ID = "a0000000-0000-0000-0000-000000000001";
const LEAD_SOURCE = "AgentFlow Test Seed";
const PHONE_PREFIX = "+1555900";

const FIRST_NAMES = [
  "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda",
  "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
];
const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas",
];
const STATES = ["TX", "FL", "CA", "NY", "OH", "GA", "NC", "PA", "MI", "AZ", "TN", "IN", "MO", "WI", "CO", "VA"];

function buildRows(count, orgId) {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      first_name: FIRST_NAMES[i % FIRST_NAMES.length],
      last_name: LAST_NAMES[i % LAST_NAMES.length],
      phone: `${PHONE_PREFIX}${String(n).padStart(4, "0")}`,
      email: `test-seed-${String(n).padStart(3, "0")}@agentflow-test.local`,
      state: STATES[i % STATES.length],
      status: "New",
      lead_source: LEAD_SOURCE,
      lead_score: 5 + (i % 5),
      assigned_agent_id: null,
      user_id: null,
      organization_id: orgId,
      notes: "Fake test lead (unassigned) — safe to bulk-delete by lead_source.",
    };
  });
}

async function main() {
  const count = Math.min(Math.max(parseInt(process.env.COUNT || "200", 10) || 200, 1), 500);
  const orgId = process.env.ORG_ID?.trim() || DEFAULT_ORG_ID;
  const mode = process.argv.includes("cleanup") ? "cleanup" : "seed";

  const { url, serviceRoleKey } = loadAdminEnv();
  assertProductionAllowed(url, loadAdminEnv().projectRef);

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (or supabase CLI api-keys).");
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (mode === "cleanup") {
    const { count: deleted, error } = await admin
      .from("leads")
      .delete({ count: "exact" })
      .eq("organization_id", orgId)
      .eq("lead_source", LEAD_SOURCE);
    if (error) throw error;
    console.log(`Deleted ${deleted ?? 0} test leads (lead_source = "${LEAD_SOURCE}").`);
    return;
  }

  const rows = buildRows(count, orgId);
  const BATCH = 50;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await admin.from("leads").insert(batch);
    if (error) throw new Error(error.message);
    inserted += batch.length;
  }

  console.log(`Inserted ${inserted} unassigned test leads into org ${orgId}.`);
  console.log(`  lead_source: "${LEAD_SOURCE}"`);
  console.log(`  phones: ${PHONE_PREFIX}0001 … ${PHONE_PREFIX}${String(count).padStart(4, "0")}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
