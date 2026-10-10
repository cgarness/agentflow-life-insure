// Run: deno test --allow-read --allow-env supabase/functions/_shared/onboardingEmail/
import assert from "node:assert/strict";
import { type DeliveryContext, evaluateEligibility, isDeliverableAddress } from "./eligibility.ts";

const NOW = new Date("2026-10-12T15:00:00Z");
const ORG = "00000000-0000-0000-0000-0000000000a1";

function ctx(overrides: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    delivery_id: "d1",
    delivery_status: "sending",
    step_key: "agent_day01_dialer_ready",
    template_version: 1,
    sequence_key: "agent",
    expires_at: "2026-10-14T15:00:00Z",
    enrollment_status: "active",
    enrollment_organization_id: ORG,
    profile_exists: true,
    profile_status: "Active",
    profile_role: "Agent",
    profile_is_super_admin: false,
    profile_organization_id: ORG,
    first_name: "Jordan",
    auth_exists: true,
    email: "jordan@example.test",
    email_confirmed: true,
    auth_deleted: false,
    auth_banned: false,
    organization_status: "active",
    opted_out: false,
    ...overrides,
  };
}

const CASES: Array<[string, DeliveryContext | null, string]> = [
  ["eligible agent", ctx(), "send"],
  ["eligible team leader on the agent series", ctx({ profile_role: "Team Leader" }), "send"],
  ["eligible admin on the admin series", ctx({ profile_role: "Admin", sequence_key: "agency_admin" }), "send"],
  ["NULL agency status is the active default", ctx({ organization_status: null }), "send"],
  ["delivery no longer exists", null, "cancel:user_deleted"],
  ["profile missing", ctx({ profile_exists: false }), "cancel:user_deleted"],
  ["auth user missing", ctx({ auth_exists: false }), "cancel:user_deleted"],
  ["auth user soft-deleted", ctx({ auth_deleted: true }), "cancel:user_deleted"],
  ["profile soft-deleted", ctx({ profile_status: "Deleted" }), "cancel:user_deleted"],
  ["opted out", ctx({ opted_out: true }), "cancel:opted_out"],
  ["opted out wins over a closed enrollment", ctx({ opted_out: true, enrollment_status: "cancelled" }), "cancel:opted_out"],
  ["enrollment already closed", ctx({ enrollment_status: "cancelled" }), "skip:enrollment_closed"],
  ["became a super admin", ctx({ profile_is_super_admin: true }), "cancel:role_ineligible"],
  ["role Super Admin", ctx({ profile_role: "Super Admin" }), "cancel:role_ineligible"],
  ["unknown role", ctx({ profile_role: "Team Lead" }), "cancel:role_ineligible"],
  ["agent promoted to admin", ctx({ profile_role: "Admin" }), "cancel:role_changed"],
  ["admin demoted to agent", ctx({ profile_role: "Agent", sequence_key: "agency_admin" }), "cancel:role_changed"],
  ["moved to another agency", ctx({ profile_organization_id: "00000000-0000-0000-0000-0000000000a2" }), "cancel:organization_changed"],
  ["left every agency", ctx({ profile_organization_id: null }), "cancel:organization_changed"],
  ["deactivated", ctx({ profile_status: "Inactive" }), "skip:user_inactive"],
  ["pending", ctx({ profile_status: "Pending" }), "skip:user_inactive"],
  ["banned", ctx({ auth_banned: true }), "skip:user_inactive"],
  ["agency suspended", ctx({ organization_status: "suspended" }), "skip:organization_inactive"],
  ["agency archived", ctx({ organization_status: "archived" }), "skip:organization_inactive"],
  ["email not confirmed", ctx({ email_confirmed: false }), "skip:email_unconfirmed"],
  ["no email", ctx({ email: null }), "skip:email_unconfirmed"],
  ["two addresses", ctx({ email: "a@example.test, b@example.test" }), "skip:email_unconfirmed"],
  ["expired step", ctx({ expires_at: "2026-10-12T15:00:00Z" }), "skip:stale"],
  ["unparseable expiry", ctx({ expires_at: "not a date" }), "skip:stale"],
];

for (const [name, input, expected] of CASES) {
  Deno.test(`eligibility: ${name} -> ${expected}`, () => {
    const decision = evaluateEligibility(input, NOW);
    const actual = decision.action === "send" ? "send" : `${decision.action}:${decision.reason}`;
    assert.equal(actual, expected);
  });
}

Deno.test("eligibility: sends to the current confirmed auth email, trimmed", () => {
  const decision = evaluateEligibility(ctx({ email: "  jordan@example.test " }), NOW);
  assert.deepEqual(decision, { action: "send", email: "jordan@example.test", firstName: "Jordan" });
});

Deno.test("eligibility: address check accepts exactly one plausible address", () => {
  assert.ok(isDeliverableAddress("a@b.co"));
  for (const bad of ["", "a", "a@b", "a b@c.d", "a@b.c;d@e.f", "<a@b.c>", "x".repeat(250) + "@b.co"]) {
    assert.ok(!isDeliverableAddress(bad), bad);
  }
});
