/**
 * Contact-name boundary guard (2026-08-11).
 *
 * Production defect: a raw Supabase row (`first_name`/`last_name`) reached
 * `FullScreenContactView`, which reads canonical camelCase, so its Call button emitted the
 * literal "undefined undefined" — and `TwilioContext.makeCall` snapshotted that into
 * `calls.contact_name`.
 *
 * These pin the two pure helpers that make the string half of that impossible:
 * `contactDisplayName` (reads either shape) and `sanitizeContactName` (last guard before
 * the persisted snapshot).
 */
import { describe, it, expect } from "vitest";
import { contactDisplayName, sanitizeContactName } from "@/lib/contact-name";
import { rowToLead } from "@/lib/supabase-contacts";
import { rowToClient } from "@/lib/supabase-clients";
import { rowToRecruit } from "@/lib/supabase-recruits";

/** A raw `leads` row exactly as `select("*")` returns it — the reported production case. */
const RAW_LEAD_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  first_name: "Charlotte",
  last_name: "Kearney",
  phone: "5125550123",
  email: "charlotte@example.com",
  state: "TX",
  status: "New",
  lead_source: "Facebook Ads",
  assigned_agent_id: "aaaa0000-0000-0000-0000-000000000001",
  organization_id: "0f000000-0000-0000-0000-0000000000aa",
};

const RAW_CLIENT_ROW = {
  id: "22222222-2222-2222-2222-222222222222",
  first_name: "Charlotte",
  last_name: "Kearney",
  phone: "5125550124",
  policy_type: "Term",
  organization_id: "0f000000-0000-0000-0000-0000000000aa",
};

const RAW_RECRUIT_ROW = {
  id: "33333333-3333-3333-3333-333333333333",
  first_name: "Charlotte",
  last_name: "Kearney",
  phone: "5125550125",
  status: "Prospect",
  organization_id: "0f000000-0000-0000-0000-0000000000aa",
};

describe("sanitizeContactName — placeholder debris can never be persisted", () => {
  it("reduces the exact reported production value to empty", () => {
    expect(sanitizeContactName("undefined undefined")).toBe("");
  });

  it.each([
    ["null null", ""],
    ["undefined", ""],
    ["null", ""],
    ["", ""],
    ["   ", ""],
    ["\t\n  ", ""],
    ["undefined null", ""],
  ])("sanitizeContactName(%j) === %j", (input, expected) => {
    expect(sanitizeContactName(input)).toBe(expected);
  });

  it("writes NULL, never an empty string, when a caller persists the result", () => {
    // This is the exact expression TwilioContext uses for the calls.contact_name insert.
    expect(sanitizeContactName("undefined undefined") || null).toBeNull();
    expect(sanitizeContactName("   ") || null).toBeNull();
    expect(sanitizeContactName("Charlotte Kearney") || null).toBe("Charlotte Kearney");
  });

  it("keeps the real half of a half-resolved name", () => {
    expect(sanitizeContactName("Charlotte undefined")).toBe("Charlotte");
    expect(sanitizeContactName("undefined Kearney")).toBe("Kearney");
  });

  it("leaves a real name completely untouched", () => {
    expect(sanitizeContactName("Charlotte Kearney")).toBe("Charlotte Kearney");
    expect(sanitizeContactName("Mary Jo Van Der Berg")).toBe("Mary Jo Van Der Berg");
    expect(sanitizeContactName("Cher")).toBe("Cher");
  });

  it("does NOT strip a real surname that only resembles a placeholder (case-sensitive by design)", () => {
    expect(sanitizeContactName("Werner Null")).toBe("Werner Null");
    expect(sanitizeContactName("Null")).toBe("Null");
    expect(sanitizeContactName("Undefined Jones")).toBe("Undefined Jones");
    expect(sanitizeContactName("NULL")).toBe("NULL");
  });

  it("collapses stray whitespace instead of emitting a padded name", () => {
    expect(sanitizeContactName("  Charlotte   Kearney  ")).toBe("Charlotte Kearney");
  });

  it("returns '' for non-string input without throwing", () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(sanitizeContactName(bad)).toBe("");
    }
  });
});

describe("contactDisplayName — resolves canonical AND raw row shapes", () => {
  it("A. raw Supabase LEAD row -> 'Charlotte Kearney' (never 'undefined undefined')", () => {
    expect(contactDisplayName(RAW_LEAD_ROW)).toBe("Charlotte Kearney");
  });

  it("B. raw Supabase CLIENT row -> 'Charlotte Kearney'", () => {
    expect(contactDisplayName(RAW_CLIENT_ROW)).toBe("Charlotte Kearney");
  });

  it("C. raw Supabase RECRUIT row -> 'Charlotte Kearney'", () => {
    expect(contactDisplayName(RAW_RECRUIT_ROW)).toBe("Charlotte Kearney");
  });

  it("resolves the canonical camelCase shape the Contacts page already passes", () => {
    expect(contactDisplayName({ firstName: "Charlotte", lastName: "Kearney" })).toBe("Charlotte Kearney");
  });

  it("prefers canonical camelCase when a row somehow carries both", () => {
    expect(
      contactDisplayName({ firstName: "Charlotte", lastName: "Kearney", first_name: "Stale", last_name: "Row" }),
    ).toBe("Charlotte Kearney");
  });

  it("D. cannot produce a placeholder literal from any missing-name shape", () => {
    for (const shape of [
      {},
      { firstName: undefined, lastName: undefined },
      { first_name: null, last_name: null },
      { firstName: null, lastName: "Kearney" },
      { first_name: "Charlotte", last_name: null },
      { id: "no-name-at-all" },
    ]) {
      const resolved = contactDisplayName(shape);
      expect(resolved).not.toBe("undefined undefined");
      expect(resolved).not.toMatch(/\bundefined\b/);
      expect(resolved).not.toMatch(/\bnull\b/);
    }
    // A one-sided name still yields the real half rather than being discarded.
    expect(contactDisplayName({ firstName: null, lastName: "Kearney" })).toBe("Kearney");
    expect(contactDisplayName({ first_name: "Charlotte", last_name: null })).toBe("Charlotte");
    expect(contactDisplayName({})).toBe("");
  });

  it("returns '' for non-object input without throwing", () => {
    for (const bad of [null, undefined, "Charlotte Kearney", 7]) {
      expect(contactDisplayName(bad)).toBe("");
    }
  });
});

describe("canonical row mappers feed a valid identity (no competing contact shape)", () => {
  it("A. rowToLead marshals the raw row into the shape FullScreenContactView reads", () => {
    const lead = rowToLead(RAW_LEAD_ROW);
    expect(lead.firstName).toBe("Charlotte");
    expect(lead.lastName).toBe("Kearney");
    expect(lead.phone).toBe("5125550123");
    expect(lead.id).toBe(RAW_LEAD_ROW.id);
    expect(contactDisplayName(lead)).toBe("Charlotte Kearney");
  });

  it("B. rowToClient likewise", () => {
    const client = rowToClient(RAW_CLIENT_ROW);
    expect(client.firstName).toBe("Charlotte");
    expect(client.lastName).toBe("Kearney");
    expect(client.phone).toBe("5125550124");
    expect(client.id).toBe(RAW_CLIENT_ROW.id);
    expect(contactDisplayName(client)).toBe("Charlotte Kearney");
  });

  it("C. rowToRecruit likewise — and it is exported, not re-implemented", () => {
    expect(typeof rowToRecruit).toBe("function");
    const recruit = rowToRecruit(RAW_RECRUIT_ROW);
    expect(recruit.firstName).toBe("Charlotte");
    expect(recruit.lastName).toBe("Kearney");
    expect(recruit.phone).toBe("5125550125");
    expect(recruit.id).toBe(RAW_RECRUIT_ROW.id);
    expect(contactDisplayName(recruit)).toBe("Charlotte Kearney");
  });
});
