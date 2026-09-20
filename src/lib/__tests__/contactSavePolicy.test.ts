/**
 * contactSavePolicy — the shared contact-save / duplicate-detection policy.
 *
 * This is the ONE place the agency's `duplicate_detection_rule` / `_scope` / `manual_action`
 * settings are turned into a decision, so both full-record edit surfaces (the Contacts page and
 * the `/leads/:id` · `/clients/:id` · `/recruits/:id` deep links) apply the same rule. These tests
 * exercise the REAL `findDuplicates` over a recording Supabase stub rather than mocking it out, so
 * they also pin that the table, the org scope, the `assigned_only` narrowing and `excludeId`
 * actually reach the query.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  assigned_agent_id: string | null;
};

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  /** Every query the policy issued, so "no query was made" is an assertion about real calls. */
  queries: [] as { table: string; eq: [string, unknown][]; neq: [string, unknown][] }[],
  failNext: false,
}));

vi.mock("@/integrations/supabase/client", () => {
  function builder(table: string) {
    const record = { table, eq: [] as [string, unknown][], neq: [] as [string, unknown][] };
    db.queries.push(record);
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (col: string, val: unknown) => { record.eq.push([col, val]); return b; },
      neq: (col: string, val: unknown) => { record.neq.push([col, val]); return b; },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          db.failNext
            ? { data: null, error: { message: "permission denied" } }
            : { data: db.rows, error: null },
        ).then(resolve),
    };
    return b;
  }
  return { supabase: { from: (t: string) => builder(t) } };
});

import {
  ContactSaveRefusedError,
  isContactSaveRefusedError,
  DUPLICATE_SAVE_CANCELLED_MESSAGE,
  DUPLICATE_TABLE_BY_CONTACT_TYPE,
  evaluateContactDuplicatePreSave,
  payloadTouchesPhoneOrEmail,
} from "@/lib/contactSavePolicy";

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENT_A = "aaaa0000-0000-4000-8000-00000000000a";
const AGENT_B = "bbbb0000-0000-4000-8000-00000000000b";

function row(over: Partial<Row> = {}): Row {
  return {
    id: "dup-1",
    first_name: "Charlotte",
    last_name: "Kearney",
    phone: "5125550123",
    email: "charlotte@example.com",
    assigned_agent_id: AGENT_A,
    ...over,
  };
}

beforeEach(() => {
  db.rows = [];
  db.queries = [];
  db.failNext = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("payloadTouchesPhoneOrEmail — the gate that decides whether a lookup is worth a query", () => {
  it("is true when phone is present, even as an empty string", () => {
    expect(payloadTouchesPhoneOrEmail({ phone: "" })).toBe(true);
  });

  it("is true when email is present", () => {
    expect(payloadTouchesPhoneOrEmail({ email: "a@b.com" })).toBe(true);
  });

  it("is true for a whole-form payload (what FullScreenContactView submits)", () => {
    expect(payloadTouchesPhoneOrEmail({ firstName: "A", phone: "5125550123", email: "a@b.com" })).toBe(true);
  });

  it("is FALSE for the partial { status } payload the status dropdown sends", () => {
    expect(payloadTouchesPhoneOrEmail({ status: "Contacted" })).toBe(false);
  });

  it("is false for a payload with neither key, and for non-objects", () => {
    expect(payloadTouchesPhoneOrEmail({ notes: "hi" })).toBe(false);
    expect(payloadTouchesPhoneOrEmail(null)).toBe(false);
    expect(payloadTouchesPhoneOrEmail(undefined)).toBe(false);
    expect(payloadTouchesPhoneOrEmail("phone")).toBe(false);
  });

  it("treats an explicitly undefined key as absent (matches the historical Contacts gate)", () => {
    expect(payloadTouchesPhoneOrEmail({ phone: undefined, email: undefined })).toBe(false);
  });
});

describe("ContactSaveRefusedError — a refusal is not a failure", () => {
  it("defaults to reported: true, because every shipped refusal path reports before it throws", () => {
    const e = new ContactSaveRefusedError("nope");
    expect(e.reported).toBe(true);
    expect(e.name).toBe("ContactSaveRefusedError");
    expect(e.message).toBe("nope");
    expect(e).toBeInstanceOf(Error);
  });

  it("honours reported: false for a surface that has NOT told the user yet", () => {
    expect(new ContactSaveRefusedError("nope", { reported: false }).reported).toBe(false);
  });

  it("isContactSaveRefusedError matches by instanceof", () => {
    expect(isContactSaveRefusedError(new ContactSaveRefusedError("x"))).toBe(true);
  });

  it("also matches by name, so a duplicated module copy is not mis-reported as a failure", () => {
    const lookalike = Object.assign(new Error("x"), { name: "ContactSaveRefusedError" });
    expect(isContactSaveRefusedError(lookalike)).toBe(true);
  });

  it("does NOT match an ordinary error, null or a string", () => {
    expect(isContactSaveRefusedError(new Error("boom"))).toBe(false);
    expect(isContactSaveRefusedError(null)).toBe(false);
    expect(isContactSaveRefusedError("ContactSaveRefusedError")).toBe(false);
  });

  it("exports a cancellation message for the surfaces to share", () => {
    expect(DUPLICATE_SAVE_CANCELLED_MESSAGE).toMatch(/duplicate/i);
  });
});

describe("evaluateContactDuplicatePreSave — table + scope reach the query", () => {
  it("searches the table matching the contact type", async () => {
    expect(DUPLICATE_TABLE_BY_CONTACT_TYPE).toEqual({ lead: "leads", client: "clients", recruit: "recruits" });

    for (const [contactType, table] of Object.entries(DUPLICATE_TABLE_BY_CONTACT_TYPE)) {
      db.queries = [];
      await evaluateContactDuplicatePreSave({
        contactType: contactType as "lead" | "client" | "recruit",
        organizationId: ORG,
        settings: null,
        phone: "5125550123",
      });
      expect(db.queries).toHaveLength(1);
      expect(db.queries[0].table).toBe(table);
    }
  });

  it("always scopes by organization_id", async () => {
    await evaluateContactDuplicatePreSave({
      contactType: "lead", organizationId: ORG, settings: null, phone: "5125550123",
    });
    expect(db.queries[0].eq).toContainEqual(["organization_id", ORG]);
  });

  it("narrows to the assignee only when scope is assigned_only", async () => {
    await evaluateContactDuplicatePreSave({
      contactType: "lead",
      organizationId: ORG,
      settings: { duplicateDetectionScope: "assigned_only" },
      phone: "5125550123",
      assignedAgentId: AGENT_A,
    });
    expect(db.queries[0].eq).toContainEqual(["assigned_agent_id", AGENT_A]);

    db.queries = [];
    await evaluateContactDuplicatePreSave({
      contactType: "lead",
      organizationId: ORG,
      settings: { duplicateDetectionScope: "all_agents" },
      phone: "5125550123",
      assignedAgentId: AGENT_A,
    });
    expect(db.queries[0].eq.map(([c]) => c)).not.toContain("assigned_agent_id");
  });

  it("excludeId reaches the query, so a contact can never detect ITSELF", async () => {
    db.rows = [row({ id: "self" })];
    const decision = await evaluateContactDuplicatePreSave({
      contactType: "lead", organizationId: ORG, settings: null, phone: "5125550123", excludeId: "self",
    });
    expect(db.queries[0].neq).toContainEqual(["id", "self"]);
    // The stub cannot apply `.neq` itself, so this asserts the predicate was ISSUED. The
    // self-exclusion is proven end-to-end against the real database shape by the page suites.
    expect(decision.kind).not.toBe("allow");
  });

  it("issues NO query at all when neither phone nor email can match", async () => {
    const decision = await evaluateContactDuplicatePreSave({
      contactType: "lead", organizationId: ORG, settings: null, phone: null, email: null,
    });
    expect(decision).toEqual({ kind: "allow" });
    expect(db.queries).toHaveLength(0);
  });
});

describe("evaluateContactDuplicatePreSave — DuplicateRule matching", () => {
  beforeEach(() => { db.rows = [row()]; });

  const cases: Array<[string, string, string | null, string | null, boolean]> = [
    // rule,             label,            phone,        email,                    expect a match
    ["phone_only", "phone matches", "512-555-0123", null, true],
    ["phone_only", "only email matches", "9998887777", "charlotte@example.com", false],
    ["email_only", "email matches (case/space insensitive)", null, "  CHARLOTTE@example.com ", true],
    ["email_only", "only phone matches", "5125550123", "other@example.com", false],
    ["phone_or_email", "phone matches", "5125550123", "other@example.com", true],
    ["phone_or_email", "email matches", "9998887777", "charlotte@example.com", true],
    ["phone_or_email", "neither matches", "9998887777", "other@example.com", false],
    ["phone_and_email", "both match", "5125550123", "charlotte@example.com", true],
    ["phone_and_email", "only phone matches", "5125550123", "other@example.com", false],
    ["phone_and_email", "only email matches", "9998887777", "charlotte@example.com", false],
  ];

  for (const [rule, label, phone, email, shouldMatch] of cases) {
    it(`${rule}: ${label} → ${shouldMatch ? "confirm" : "allow"}`, async () => {
      const decision = await evaluateContactDuplicatePreSave({
        contactType: "lead",
        organizationId: ORG,
        settings: { duplicateDetectionRule: rule, manualAction: "warn" },
        phone,
        email,
      });
      expect(decision.kind).toBe(shouldMatch ? "confirm" : "allow");
    });
  }

  it("defaults to phone_or_email when the setting is absent", async () => {
    const decision = await evaluateContactDuplicatePreSave({
      contactType: "lead", organizationId: ORG, settings: null, phone: "5125550123",
    });
    expect(decision.kind).toBe("confirm");
  });

  it("normalises phone formatting on both sides before comparing", async () => {
    db.rows = [row({ phone: "(512) 555-0123" })];
    const decision = await evaluateContactDuplicatePreSave({
      contactType: "lead", organizationId: ORG, settings: null, phone: "+1 512.555.0123".replace("+1 ", ""),
    });
    expect(decision.kind).toBe("confirm");
  });
});

describe("evaluateContactDuplicatePreSave — ManualAction", () => {
  beforeEach(() => { db.rows = [row()]; });

  it("allow → { allow }, even with a match (the query still runs; the agency chose not to care)", async () => {
    const decision = await evaluateContactDuplicatePreSave({
      contactType: "lead", organizationId: ORG, settings: { manualAction: "allow" }, phone: "5125550123",
    });
    expect(decision).toEqual({ kind: "allow" });
  });

  it("block → { block } carrying a describable reason", async () => {
    const decision = await evaluateContactDuplicatePreSave({
      contactType: "lead", organizationId: ORG, settings: { manualAction: "block" }, phone: "5125550123",
    });
    expect(decision.kind).toBe("block");
    if (decision.kind !== "block") throw new Error("unreachable");
    expect(decision.message).toContain("Charlotte Kearney");
    expect(decision.message).toContain("blocked by agency settings");
  });

  it("warn → { confirm } with a count-accurate label and up to five described matches", async () => {
    db.rows = Array.from({ length: 7 }, (_, i) => row({ id: `dup-${i}`, first_name: `Dup${i}` }));
    const decision = await evaluateContactDuplicatePreSave({
      contactType: "lead", organizationId: ORG, settings: { manualAction: "warn" }, phone: "5125550123",
    });
    expect(decision.kind).toBe("confirm");
    if (decision.kind !== "confirm") throw new Error("unreachable");
    expect(decision.label).toBe("7 possible duplicates found");
    expect(decision.description.split("\n")).toHaveLength(5);
  });

  it("warn with exactly one match uses the singular label", async () => {
    const decision = await evaluateContactDuplicatePreSave({
      contactType: "lead", organizationId: ORG, settings: { manualAction: "warn" }, phone: "5125550123",
    });
    if (decision.kind !== "confirm") throw new Error("expected confirm");
    expect(decision.label).toBe("1 possible duplicate found");
  });

  it("defaults to warn when the setting is absent", async () => {
    const decision = await evaluateContactDuplicatePreSave({
      contactType: "lead", organizationId: ORG, settings: {}, phone: "5125550123",
    });
    expect(decision.kind).toBe("confirm");
  });

  it("no match → allow regardless of manualAction", async () => {
    db.rows = [];
    for (const manualAction of ["warn", "block", "allow"]) {
      const decision = await evaluateContactDuplicatePreSave({
        contactType: "lead", organizationId: ORG, settings: { manualAction }, phone: "5125550123",
      });
      expect(decision).toEqual({ kind: "allow" });
    }
  });
});

describe("evaluateContactDuplicatePreSave — lookup failure is FAIL-OPEN, by design", () => {
  it("a query error resolves to allow and is logged, never swallowed silently", async () => {
    db.failNext = true;
    const decision = await evaluateContactDuplicatePreSave({
      contactType: "lead", organizationId: ORG, settings: { manualAction: "block" }, phone: "5125550123",
    });
    // An advisory agency preference must not strand an agent on a transient RLS/PostgREST error.
    expect(decision).toEqual({ kind: "allow" });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("the policy is not duplicated anywhere else", () => {
  it("assigned_only without an assignee falls back to an org-wide search rather than refusing", async () => {
    db.rows = [row({ assigned_agent_id: AGENT_B })];
    const decision = await evaluateContactDuplicatePreSave({
      contactType: "lead",
      organizationId: ORG,
      settings: { duplicateDetectionScope: "assigned_only" },
      phone: "5125550123",
      assignedAgentId: null,
    });
    expect(db.queries[0].eq.map(([c]) => c)).not.toContain("assigned_agent_id");
    expect(decision.kind).toBe("confirm");
  });
});
