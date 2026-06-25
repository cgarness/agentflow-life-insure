/**
 * Contacts Build 5 (CP2) — Contacts permission catalog + resolution logic.
 *
 * Pure-logic coverage for the new normalized Contacts permission framework:
 *   - catalog integrity (unique keys, defaults, danger flags, NO conversion key)
 *   - default resolution per role (incl. Admin/Super Admin locked full-access)
 *   - stored-block merge + override precedence
 *   - resolveContactsPermission (the exact logic behind usePermissions().hasContactsPermission)
 */
import { describe, it, expect } from "vitest";
import {
  CONTACTS_PERMISSIONS,
  CONTACTS_PERMISSION_KEYS,
  CONTACTS_PERMISSION_GROUPS,
  resolveContactsPermissionDefault,
  getDefaultContactsPermissions,
  mergeContactsPermissions,
  resolveContactsPermission,
} from "@/config/permissionDefaults";

const EXPECTED_KEYS = [
  "contacts.leads.view_assigned",
  "contacts.leads.view_unassigned",
  "contacts.leads.view_all",
  "contacts.leads.create",
  "contacts.leads.edit",
  "contacts.leads.delete",
  "contacts.leads.import",
  "contacts.leads.undo_own_import",
  "contacts.leads.undo_team_import",
  "contacts.leads.assign",
  "contacts.leads.bulk_assign",
  "contacts.leads.bulk_status",
  "contacts.leads.update_status",
  "contacts.leads.add_to_campaign",
  "contacts.clients.view",
  "contacts.clients.edit",
  "contacts.clients.delete",
  "contacts.recruits.view",
  "contacts.recruits.create",
  "contacts.recruits.edit",
  "contacts.recruits.delete",
  "contacts.notes.manage",
  "contacts.tasks.manage",
  "contacts.appointments.manage",
  "contacts.messages.manage",
];

describe("Contacts permission catalog — integrity", () => {
  it("contains exactly the locked CP2 keys", () => {
    expect(CONTACTS_PERMISSION_KEYS.slice().sort()).toEqual(EXPECTED_KEYS.slice().sort());
  });

  it("has unique keys", () => {
    expect(new Set(CONTACTS_PERMISSION_KEYS).size).toBe(CONTACTS_PERMISSION_KEYS.length);
  });

  it("every entry has a label, help text, a valid group, and boolean role defaults", () => {
    for (const def of CONTACTS_PERMISSIONS) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.help.length).toBeGreaterThan(0);
      expect(CONTACTS_PERMISSION_GROUPS).toContain(def.group);
      expect(typeof def.agent).toBe("boolean");
      expect(typeof def.teamLeader).toBe("boolean");
    }
  });

  it("flags destructive/high-impact permissions as danger", () => {
    const danger = CONTACTS_PERMISSIONS.filter((d) => d.danger).map((d) => d.key);
    for (const k of [
      "contacts.leads.delete",
      "contacts.clients.delete",
      "contacts.recruits.delete",
      "contacts.leads.import",
      "contacts.leads.undo_own_import",
      "contacts.leads.undo_team_import",
    ]) {
      expect(danger).toContain(k);
    }
  });

  it("does NOT contain a conversion permission key (conversion is hardcoded universal)", () => {
    expect(CONTACTS_PERMISSION_KEYS.some((k) => k.includes("convert"))).toBe(false);
    expect(CONTACTS_PERMISSIONS.some((d) => /convert/i.test(d.label))).toBe(false);
  });
});

describe("resolveContactsPermissionDefault", () => {
  it("Admin and Super Admin always resolve true (locked full-access)", () => {
    for (const key of CONTACTS_PERMISSION_KEYS) {
      expect(resolveContactsPermissionDefault("Admin", key)).toBe(true);
      expect(resolveContactsPermissionDefault("Super Admin", key)).toBe(true);
    }
  });

  it("Agent defaults match the catalog (view_assigned on, delete/import/unassigned off)", () => {
    expect(resolveContactsPermissionDefault("Agent", "contacts.leads.view_assigned")).toBe(true);
    expect(resolveContactsPermissionDefault("Agent", "contacts.leads.create")).toBe(true);
    expect(resolveContactsPermissionDefault("Agent", "contacts.leads.delete")).toBe(false);
    expect(resolveContactsPermissionDefault("Agent", "contacts.leads.import")).toBe(false);
    // D-unassigned-default: Agent off
    expect(resolveContactsPermissionDefault("Agent", "contacts.leads.view_unassigned")).toBe(false);
  });

  it("Team Leader defaults match the catalog (unassigned on, import on, delete off)", () => {
    // D-unassigned-default: Team Leader on
    expect(resolveContactsPermissionDefault("Team Leader", "contacts.leads.view_unassigned")).toBe(true);
    expect(resolveContactsPermissionDefault("Team Leader", "contacts.leads.import")).toBe(true);
    expect(resolveContactsPermissionDefault("Team Leader", "contacts.leads.bulk_assign")).toBe(true);
    expect(resolveContactsPermissionDefault("Team Leader", "contacts.leads.delete")).toBe(false);
  });

  it("unknown role or unknown key resolves false (safe deny)", () => {
    expect(resolveContactsPermissionDefault("Agent", "contacts.leads.nope")).toBe(false);
    expect(resolveContactsPermissionDefault("Gremlin", "contacts.leads.delete")).toBe(false);
    expect(resolveContactsPermissionDefault(null, "contacts.leads.view_assigned")).toBe(false);
  });
});

describe("getDefaultContactsPermissions", () => {
  it("returns a full block keyed by every catalog key", () => {
    const block = getDefaultContactsPermissions("Agent");
    expect(Object.keys(block).slice().sort()).toEqual(CONTACTS_PERMISSION_KEYS.slice().sort());
  });

  it("Agent vs Team Leader blocks differ on import + unassigned", () => {
    const agent = getDefaultContactsPermissions("Agent");
    const tl = getDefaultContactsPermissions("Team Leader");
    expect(agent["contacts.leads.import"]).toBe(false);
    expect(tl["contacts.leads.import"]).toBe(true);
    expect(agent["contacts.leads.view_unassigned"]).toBe(false);
    expect(tl["contacts.leads.view_unassigned"]).toBe(true);
  });
});

describe("mergeContactsPermissions", () => {
  it("stored boolean override wins over the default", () => {
    const merged = mergeContactsPermissions("Agent", { "contacts.leads.delete": true });
    expect(merged["contacts.leads.delete"]).toBe(true);
  });

  it("missing keys fall back to the role default", () => {
    const merged = mergeContactsPermissions("Agent", { "contacts.leads.delete": true });
    expect(merged["contacts.leads.view_assigned"]).toBe(true); // agent default
    expect(merged["contacts.leads.import"]).toBe(false); // agent default
  });

  it("unknown stored keys are dropped", () => {
    const merged = mergeContactsPermissions("Agent", { "contacts.leads.bogus": true });
    expect("contacts.leads.bogus" in merged).toBe(false);
  });

  it("non-object stored value yields the pure defaults", () => {
    expect(mergeContactsPermissions("Agent", null)).toEqual(getDefaultContactsPermissions("Agent"));
    expect(mergeContactsPermissions("Agent", "oops")).toEqual(getDefaultContactsPermissions("Agent"));
    expect(mergeContactsPermissions("Agent", [1, 2])).toEqual(getDefaultContactsPermissions("Agent"));
  });
});

describe("resolveContactsPermission (hasContactsPermission logic)", () => {
  it("Admin/Super Admin full-access short-circuits to true regardless of stored block", () => {
    expect(resolveContactsPermission("Admin", true, { "contacts.leads.delete": false }, "contacts.leads.delete")).toBe(true);
    expect(resolveContactsPermission("Agent", true, undefined, "contacts.leads.delete")).toBe(true);
  });

  it("no role resolves false", () => {
    expect(resolveContactsPermission(null, false, undefined, "contacts.leads.view_assigned")).toBe(false);
    expect(resolveContactsPermission(undefined, false, undefined, "contacts.leads.view_assigned")).toBe(false);
  });

  it("stored true and stored false both win over defaults", () => {
    // delete defaults false for Agent — stored true wins
    expect(resolveContactsPermission("Agent", false, { "contacts.leads.delete": true }, "contacts.leads.delete")).toBe(true);
    // view_assigned defaults true for Agent — stored false wins
    expect(resolveContactsPermission("Agent", false, { "contacts.leads.view_assigned": false }, "contacts.leads.view_assigned")).toBe(false);
  });

  it("missing key falls back to the role default", () => {
    expect(resolveContactsPermission("Agent", false, {}, "contacts.leads.create")).toBe(true);
    expect(resolveContactsPermission("Agent", false, undefined, "contacts.leads.import")).toBe(false);
    expect(resolveContactsPermission("Team Leader", false, undefined, "contacts.leads.import")).toBe(true);
  });
});
