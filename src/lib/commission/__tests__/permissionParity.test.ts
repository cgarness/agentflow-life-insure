import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_COMMISSION } from "@/config/permissionDefaults";
import { OTHERS_COMMISSION_PERMISSION, OWN_COMMISSION_PERMISSION } from "../policyPreview";

/**
 * The server's Own/Others commission rule (policy_commission_authz.access) mirrors usePermissions. Both sides are
 * pinned to the same defaults file; the SQL security suite checks the SQL against it, this checks the TypeScript.
 */
const root = resolve(__dirname, "../../../..");
const pinned = JSON.parse(readFileSync(resolve(root, "supabase/tests/fixtures/policy_commission/permission_defaults.json"), "utf8")) as
  Record<string, { agent: boolean; teamLeader: boolean }>;
const migration = readFileSync(resolve(root, "supabase/migrations/20261019170000_policy_commission_tracking.sql"), "utf8");

describe("commission permission parity", () => {
  it("pins exactly the two permissions the preview and the server use", () => {
    expect(Object.keys(pinned).sort()).toEqual([OTHERS_COMMISSION_PERMISSION, OWN_COMMISSION_PERMISSION].sort());
  });

  it("the TypeScript defaults equal the pinned defaults", () => {
    for (const [name, value] of Object.entries(pinned)) {
      const item = DEFAULT_COMMISSION.find((candidate) => candidate.name === name);
      expect(item, name).toBeDefined();
      expect({ agent: item!.agent, teamLeader: item!.teamLeader }).toEqual(value);
    }
  });

  it("the server names the same permissions and role keys", () => {
    expect(migration).toContain("'View Own Commission Percentage'");
    expect(migration).toContain("'View Others'' Commission Percentage'");
    expect(migration).toMatch(/WHEN 'Agent' THEN 'agent' WHEN 'Team Leader' THEN 'teamLeader'/);
    // Defaults when no row or a non-array `c`: only the Own permission is granted.
    expect(migration).toContain("RETURN p_name = 'View Own Commission Percentage';");
  });
});
