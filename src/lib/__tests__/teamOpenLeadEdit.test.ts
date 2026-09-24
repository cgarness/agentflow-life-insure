import { describe, it, expect } from "vitest";
import { resolveTeamOpenLeadFields } from "@/lib/dialerLeadFields";
import {
  buildTeamOpenSavePlan,
  mergeCustomFieldsBag,
  seedTeamOpenDraft,
  leadToMasterRow,
} from "@/lib/teamOpenLeadEdit";
import {
  canConvertTeamOpenLead,
  canEditTeamOpenLead,
  teamOpenConvertBlock,
  teamOpenConvertBlockReason,
  TEAM_OPEN_CONVERT_MESSAGES,
  TEAM_OPEN_CONVERT_BLOCKED_MESSAGE,
  TEAM_OPEN_CONVERT_NOT_DIALLED_MESSAGE,
  withTeamOpenMasterLead,
  type TeamOpenEditGateInput,
} from "@/lib/teamOpenLeadAccess";
import type { CustomField, Lead } from "@/lib/types";

const def = (name: string, type: CustomField["type"], extra: Partial<CustomField> = {}): CustomField => ({
  id: `id-${name}`, name, type, appliesTo: ["Leads"], required: false, active: true, usageCount: 0, createdBy: null, ...extra,
});

const master = {
  id: "lead-1", first_name: "Ada", last_name: "L", phone: "5551234567", email: "a@b.co", state: "TX",
  lead_source: "Facebook", age: 44, date_of_birth: "1980-12-10", best_time_to_call: "AM", spouse_info: null,
  notes: "n", assigned_agent_id: null, user_id: "u1",
  custom_fields: { Goal: "Term", Budget: 50, Untouched: "keep", additional_policies: [{ carrier: "X" }], __agentflow: { d: true }, tags: ["Duplicate"] },
};
const fields = resolveTeamOpenLeadFields({
  layoutIds: ["firstName", "phone", "custom:Goal"],
  sources: { snapshot: { id: "cl-1", lead_id: "lead-1", first_name: "Ada", phone: "5551234567", state: "TX", source: "" }, master },
  definitions: [def("Goal", "Dropdown", { dropdownOptions: ["Term", "Whole"] }), def("Budget", "Number"), def("Beneficiary", "Text"), def("Email2", "Email")],
});
const initial = seedTeamOpenDraft(fields);

describe("buildTeamOpenSavePlan", () => {
  it("routes standard edits through the approved Lead mapping, changed keys only", () => {
    const r = buildTeamOpenSavePlan(fields, initial, { ...initial, "std:firstName": "Augusta", "std:notes": "", "std:age": "0" });
    expect(r.ok).toBe(true);
    if (!("plan" in r)) return;
    expect(r.plan.standard).toEqual({ firstName: "Augusta", notes: null, age: 0 });
    expect(r.plan.snapshotColumns).toEqual(["first_name"]);
    expect(r.plan.standard).not.toHaveProperty("leadSource"); // never erased
    expect(r.plan.standard).not.toHaveProperty("assignedAgentId");
    expect(r.plan.customSet).toEqual({});
  });

  it("routes custom edits to the nested key by canonical name (numbers stay numbers)", () => {
    const r = buildTeamOpenSavePlan(fields, initial, { ...initial, "custom:Goal": "Whole", "custom:Budget": "0", "custom:Beneficiary": "Kid" });
    if (!("plan" in r)) throw new Error("expected a plan");
    expect(r.plan.customSet).toEqual({ Goal: "Whole", Budget: 0, Beneficiary: "Kid" });
    expect(r.plan.standard).toEqual({});
    const cleared = buildTeamOpenSavePlan(fields, initial, { ...initial, "custom:Goal": "" });
    if (!("plan" in cleared)) throw new Error("expected a plan");
    expect(cleared.plan.customUnset).toEqual(["Goal"]);
  });

  it("validates with Zod and reports per-field errors without building a plan", () => {
    const r = buildTeamOpenSavePlan(fields, initial, {
      ...initial, "std:email": "not-an-email", "std:age": "abc", "std:dateOfBirth": "2023-02-30", "custom:Goal": "Nope", "custom:Budget": "x", "std:phone": "123",
    });
    expect(r.ok).toBe(false);
    if (!("errors" in r)) return;
    expect(Object.keys(r.errors).sort()).toEqual(["custom:Budget", "custom:Goal", "std:age", "std:dateOfBirth", "std:email", "std:phone"].sort());
  });

  it("an untouched legacy value that would fail validation never blocks saving another field", () => {
    const legacy = resolveTeamOpenLeadFields({
      layoutIds: ["firstName", "email"],
      sources: { snapshot: { id: "cl-1", lead_id: "lead-1", first_name: "Ada", email: "n/a" }, master: { ...master, email: "n/a" } },
      definitions: [],
    });
    const s0 = seedTeamOpenDraft(legacy);
    expect(s0["std:email"]).toBe("n/a");
    const r = buildTeamOpenSavePlan(legacy, s0, { ...s0, "std:firstName": "Augusta" });
    expect("plan" in r && r.plan.standard).toEqual({ firstName: "Augusta" });
  });

  it("a whitespace-only change or no change produces an empty plan", () => {
    const r = buildTeamOpenSavePlan(fields, initial, { ...initial, "std:firstName": "  Ada " });
    if (!("plan" in r)) throw new Error("expected a plan");
    expect(r.plan.changedIds).toEqual([]);
  });

  it("read-only fields (Source, Assigned Agent, structured values) are never seeded or planned", () => {
    expect(Object.keys(initial)).not.toContain("std:leadSource");
    expect(Object.keys(initial)).not.toContain("std:assignedAgentId");
    const r = buildTeamOpenSavePlan(fields, initial, { ...initial, "std:leadSource": "Hacked", "std:assignedAgentId": "someone" });
    if (!("plan" in r)) throw new Error("expected a plan");
    expect(r.plan.changedIds).toEqual([]);
  });
});

describe("phone, collisions, typed custom validation and legacy values", () => {
  const withCollisions = resolveTeamOpenLeadFields({
    layoutIds: ["phone", "custom:Phone"],
    sources: {
      snapshot: { id: "cl-1", lead_id: "lead-1", phone: "5551234567" },
      master: { ...master, custom_fields: { Phone: "555-000-1111", Pick: "Legacy", Mail: "x@y.co", Alt: "5550001111" } },
    },
    definitions: [def("Phone", "Phone"), def("Pick", "Dropdown", { dropdownOptions: ["A", "B"] }), def("Mail", "Email"), def("Alt", "Phone")],
  });
  const seed = seedTeamOpenDraft(withCollisions);

  it("the standard phone is required once set and saved normalized; it syncs the snapshot", () => {
    const blank = buildTeamOpenSavePlan(withCollisions, seed, { ...seed, "std:phone": "" });
    expect("errors" in blank && blank.errors["std:phone"]).toBeTruthy();
    const r = buildTeamOpenSavePlan(withCollisions, seed, { ...seed, "std:phone": "(555) 123-9999" });
    if (!("plan" in r)) throw new Error("expected a plan");
    expect(r.plan.standard).toEqual({ phone: "15551239999" });
    expect(r.plan.snapshotColumns).toEqual(["phone"]);
    expect(r.plan.customSet).toEqual({});
  });

  it("a custom field named 'Phone' routes ONLY to custom_fields.Phone — never leads.phone or the snapshot", () => {
    const r = buildTeamOpenSavePlan(withCollisions, seed, { ...seed, "custom:Phone": "555-222-3333" });
    if (!("plan" in r)) throw new Error("expected a plan");
    expect(r.plan.customSet).toEqual({ Phone: "555-222-3333" });
    expect(r.plan.standard).toEqual({});
    expect(r.plan.snapshotColumns).toEqual([]);
  });

  it("custom Email / Phone values are validated", () => {
    const r = buildTeamOpenSavePlan(withCollisions, seed, { ...seed, "custom:Mail": "bad", "custom:Alt": "123" });
    expect("errors" in r && Object.keys(r.errors).sort()).toEqual(["custom:Alt", "custom:Mail"]);
  });

  it("a legacy Dropdown value outside the options is kept when untouched and allowed when re-selected", () => {
    expect(seed["custom:Pick"]).toBe("Legacy");
    const same = buildTeamOpenSavePlan(withCollisions, seed, { ...seed });
    expect("plan" in same && same.plan.changedIds).toEqual([]);
    const bad = buildTeamOpenSavePlan(withCollisions, seed, { ...seed, "custom:Pick": "Nope" });
    expect("errors" in bad && bad.errors["custom:Pick"]).toBeTruthy();
  });

  it("a custom Date is validated and stored as an ISO string; clearing unsets the key", () => {
    const dated = resolveTeamOpenLeadFields({
      layoutIds: [],
      sources: { snapshot: { id: "cl-1" }, master: { ...master, custom_fields: { Renewal: "2025-01-31" } } },
      definitions: [def("Renewal", "Date")],
    });
    const s0 = seedTeamOpenDraft(dated);
    const ok = buildTeamOpenSavePlan(dated, s0, { ...s0, "custom:Renewal": "2026-02-28" });
    expect("plan" in ok && ok.plan.customSet).toEqual({ Renewal: "2026-02-28" });
    const bad = buildTeamOpenSavePlan(dated, s0, { ...s0, "custom:Renewal": "2026-02-30" });
    expect("errors" in bad && bad.errors["custom:Renewal"]).toBeTruthy();
    const cleared = buildTeamOpenSavePlan(dated, s0, { ...s0, "custom:Renewal": "" });
    expect("plan" in cleared && cleared.plan.customUnset).toEqual(["Renewal"]);
  });
});

describe("mergeCustomFieldsBag", () => {
  it("changes only the edited keys; unrelated and reserved keys survive unchanged (same references)", () => {
    const stored = master.custom_fields;
    const r = mergeCustomFieldsBag(stored, { Goal: "Whole" }, ["Budget"]);
    if (!("bag" in r)) throw new Error("expected a bag");
    expect(r.bag.Goal).toBe("Whole");
    expect(r.bag).not.toHaveProperty("Budget");
    expect(r.bag.Untouched).toBe("keep");
    expect(r.bag.additional_policies).toBe(stored.additional_policies);
    expect(r.bag.__agentflow).toBe(stored.__agentflow);
    expect(r.bag.tags).toBe(stored.tags);
    expect(stored.Goal).toBe("Term"); // input not mutated
  });

  it("refuses to overwrite a non-object stored bag or touch reserved keys", () => {
    expect(mergeCustomFieldsBag("oops", { Goal: "x" }, []).ok).toBe(false);
    expect(mergeCustomFieldsBag([1], { Goal: "x" }, []).ok).toBe(false);
    expect(mergeCustomFieldsBag({}, { additional_policies: "x" }, []).ok).toBe(false);
    expect(mergeCustomFieldsBag({}, {}, ["tags"]).ok).toBe(false);
    const fromNull = mergeCustomFieldsBag(null, { Goal: "x" }, []);
    expect("bag" in fromNull && fromNull.bag).toEqual({ Goal: "x" });
  });
});

describe("access predicates", () => {
  const gate: TeamOpenEditGateInput = {
    callStatus: "connected", masterStatus: "loaded", master: { user_id: "u1", assigned_agent_id: null },
    permissionsLoading: false, hasEditPermission: true, isImpersonating: false, userId: "u1", role: "Agent", isSuperAdmin: false,
  };

  it("edit requires full reveal, permission (fail closed while loading), no View-As, the master row, and ownership or role", () => {
    expect(canEditTeamOpenLead(gate)).toBe(true);
    expect(canEditTeamOpenLead({ ...gate, callStatus: "ringing" })).toBe(false);
    expect(canEditTeamOpenLead({ ...gate, permissionsLoading: true })).toBe(false);
    expect(canEditTeamOpenLead({ ...gate, hasEditPermission: false })).toBe(false);
    expect(canEditTeamOpenLead({ ...gate, isImpersonating: true })).toBe(false);
    expect(canEditTeamOpenLead({ ...gate, masterStatus: "unavailable", master: null })).toBe(false);
    expect(canEditTeamOpenLead({ ...gate, master: { user_id: "other", assigned_agent_id: null } })).toBe(false);
    expect(canEditTeamOpenLead({ ...gate, master: { user_id: null, assigned_agent_id: "u1" } })).toBe(true);
    expect(canEditTeamOpenLead({ ...gate, role: "Admin", master: { user_id: "other" } })).toBe(true);
  });

  it("Sold/Convert fails closed for Team/Open until the master row is loaded; Personal unaffected", () => {
    expect(canConvertTeamOpenLead(true, "unavailable")).toBe(false);
    expect(canConvertTeamOpenLead(true, "error")).toBe(false);
    expect(canConvertTeamOpenLead(true, "loading")).toBe(false);
    expect(canConvertTeamOpenLead(true, "loaded")).toBe(true);
    expect(canConvertTeamOpenLead(false, "unavailable")).toBe(true);
    expect(teamOpenConvertBlockReason(true, "unavailable", true)).toBe(TEAM_OPEN_CONVERT_BLOCKED_MESSAGE);
    expect(teamOpenConvertBlockReason(true, "loaded", true)).toBeNull();
    expect(teamOpenConvertBlockReason(false, "unavailable", false)).toBeNull();
  });

  it("Sold recovery: distinct messages per state; Retry only where a read can help; nothing promises persistence", () => {
    expect(teamOpenConvertBlock(true, "loading", true, true)).toEqual({ message: TEAM_OPEN_CONVERT_MESSAGES.loading, offerRetry: false });
    expect(teamOpenConvertBlock(true, "error", true, false)).toEqual({ message: TEAM_OPEN_CONVERT_MESSAGES.error, offerRetry: true });
    expect(teamOpenConvertBlock(true, "unavailable", true, true)).toEqual({ message: TEAM_OPEN_CONVERT_MESSAGES.unavailableAfterClaim, offerRetry: true });
    expect(teamOpenConvertBlock(true, "unavailable", true, false)).toEqual({ message: TEAM_OPEN_CONVERT_MESSAGES.unavailableBeforeClaim, offerRetry: false });
    expect(teamOpenConvertBlock(true, "loaded", false, true)).toEqual({ message: TEAM_OPEN_CONVERT_MESSAGES.notDialled, offerRetry: false });
    expect(teamOpenConvertBlock(true, "loaded", true, false)).toBeNull();
    expect(teamOpenConvertBlock(false, "unavailable", false, false)).toBeNull();
    const all = Object.values(TEAM_OPEN_CONVERT_MESSAGES).join(" ");
    expect(new Set(Object.values(TEAM_OPEN_CONVERT_MESSAGES)).size).toBe(5);
    // No inaccurate-disposition advice, no unverified Contacts workaround, no persistence promise.
    expect(all).not.toMatch(/different disposition|from Contacts|ask an admin|refresh|saved for later|45\+ seconds/i);
  });

  it("Sold/Convert refuses a lead that was not dialled under the current lock (lock-loss swap), even when loaded", () => {
    expect(teamOpenConvertBlockReason(true, "loaded", false)).toBe(TEAM_OPEN_CONVERT_NOT_DIALLED_MESSAGE);
  });

  it("withTeamOpenMasterLead lays master-only fields over the queue row without touching snapshot fields", () => {
    const row = { id: "cl-1", lead_id: "lead-1", first_name: "Snap", phone: "111", custom_fields: { stale: 1 } };
    const merged: Record<string, unknown> = withTeamOpenMasterLead(row, { ...master, first_name: "Master", phone: "222" });
    expect(merged.first_name).toBe("Snap");
    expect(merged.phone).toBe("111");
    expect(merged.custom_fields).toBe(master.custom_fields);
    expect(merged.date_of_birth).toBe("1980-12-10");
    expect(withTeamOpenMasterLead(row, null)).toBe(row);
  });

  it("leadToMasterRow maps the canonical update's returned Lead back to master columns", () => {
    const lead = { id: "lead-1", firstName: "A", lastName: "B", phone: "p", email: "e", state: "TX", status: "New", leadSource: "S", leadScore: 5, assignedAgentId: "", userId: "u1", customFields: { a: 1 }, createdAt: "c", updatedAt: "u" } as Lead;
    const row = leadToMasterRow(lead);
    expect(row).toMatchObject({ id: "lead-1", first_name: "A", lead_source: "S", custom_fields: { a: 1 }, user_id: "u1" });
    expect(row).not.toHaveProperty("lead_score");
  });
});
