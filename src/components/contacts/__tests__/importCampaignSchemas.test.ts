import { describe, it, expect } from "vitest";

import {
  canDialCampaignSchema,
  createImportCampaignArgsSchema,
  createdImportCampaignSchema,
  importCompletionStatusSchema,
  importCustomFieldsPayloadSchema,
  importFinalizeOutcomeSchema,
  importRetryResultSchema,
} from "@/components/contacts/importCampaignSchemas";
import { customFieldSchema } from "@/components/settings/contact-flow/contactFlowSchemas";
import {
  buildImportFieldOptions,
  customFieldOptionValue,
  resolveMappingToCanonicalName,
} from "@/lib/import-field-matching";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";

describe("createImportCampaignArgsSchema — outbound payload shape", () => {
  const base = {
    name: "Q3 FEX",
    type: "Personal" as const,
    description: "",
    ownerId: U1,
    participantIds: [U1],
    strategy: "specific_agent" as const,
  };

  it("accepts a well-formed payload", () => {
    expect(createImportCampaignArgsSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a null owner (the server defaults it to the caller)", () => {
    expect(createImportCampaignArgsSchema.safeParse({ ...base, ownerId: null }).success).toBe(true);
  });

  it("rejects a non-UUID owner", () => {
    expect(createImportCampaignArgsSchema.safeParse({ ...base, ownerId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a non-UUID participant", () => {
    expect(createImportCampaignArgsSchema.safeParse({ ...base, participantIds: [U1, "nope"] }).success).toBe(false);
  });

  it("rejects an unknown campaign type and an unknown strategy", () => {
    expect(createImportCampaignArgsSchema.safeParse({ ...base, type: "Open" }).success).toBe(false);
    expect(createImportCampaignArgsSchema.safeParse({ ...base, strategy: "self" }).success).toBe(false);
  });

  it("rejects a blank name and trims a padded one", () => {
    expect(createImportCampaignArgsSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
    const ok = createImportCampaignArgsSchema.safeParse({ ...base, name: "  Q3  " });
    expect(ok.success && ok.data.name).toBe("Q3");
  });

  it("does NOT encode eligibility rules (Round Robin + Personal is a server decision)", () => {
    // Shape-only: the schema must accept this so the SERVER can reject it with its own message.
    expect(
      createImportCampaignArgsSchema.safeParse({ ...base, strategy: "round_robin", ownerId: null }).success,
    ).toBe(true);
  });
});

describe("createdImportCampaignSchema — inbound envelope", () => {
  it("accepts the server response and normalizes participants", () => {
    const r = createdImportCampaignSchema.safeParse({
      id: U1, type: "Personal", user_id: U2, created_by: U1,
      assigned_agent_ids: [U2], organization_id: U1,
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.assigned_agent_ids).toEqual([U2]);
  });

  it("falls back to an empty participant list rather than propagating garbage", () => {
    const r = createdImportCampaignSchema.safeParse({
      id: U1, type: "Team", user_id: U2, assigned_agent_ids: "not-an-array", organization_id: U1,
    });
    expect(r.success && r.data.assigned_agent_ids).toEqual([]);
  });

  it("rejects a response with a malformed campaign id", () => {
    expect(
      createdImportCampaignSchema.safeParse({
        id: "17", type: "Personal", user_id: U2, assigned_agent_ids: [], organization_id: U1,
      }).success,
    ).toBe(false);
  });
});

describe("importRetryResultSchema — truthful counts", () => {
  it("accepts a success envelope", () => {
    expect(
      importRetryResultSchema.safeParse({
        ok: true, status: "completed", imported_count: 106, attached_count: 106,
        newly_attached: 106, already_present: 0, ineligible_count: 0, remaining_count: 0,
      }).success,
    ).toBe(true);
  });

  it("accepts a refusal envelope with only a reason", () => {
    const r = importRetryResultSchema.safeParse({ ok: false, reason: "not_authorized" });
    expect(r.success && r.data.reason).toBe("not_authorized");
  });

  it("preserves an unrecognized future reason code instead of dropping it", () => {
    const r = importRetryResultSchema.safeParse({ ok: false, reason: "some_new_server_code" });
    expect(r.success && r.data.reason).toBe("some_new_server_code");
  });

  it("rejects negative or fractional counts — these are rendered to the user", () => {
    expect(importRetryResultSchema.safeParse({ ok: true, attached_count: -1 }).success).toBe(false);
    expect(importRetryResultSchema.safeParse({ ok: true, attached_count: 1.5 }).success).toBe(false);
  });

  it("rejects an unknown completion status", () => {
    expect(importRetryResultSchema.safeParse({ ok: true, status: "kind_of_done" }).success).toBe(false);
  });
});

describe("importFinalizeOutcomeSchema / importCompletionStatusSchema", () => {
  it("accepts every status the database CHECK constraint allows", () => {
    for (const s of ["pending_campaign", "completed", "completed_with_skips", "campaign_partial", "campaign_failed"]) {
      expect(importCompletionStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("accepts a null status (legacy rows) and a refusal envelope", () => {
    expect(importFinalizeOutcomeSchema.safeParse({ finalized: true, status: null }).success).toBe(true);
    expect(importFinalizeOutcomeSchema.safeParse({ finalized: false, reason: "expired" }).success).toBe(true);
  });

  it("rejects an invented status", () => {
    expect(importFinalizeOutcomeSchema.safeParse({ status: "mostly_done" }).success).toBe(false);
  });
});

describe("canDialCampaignSchema — strictly boolean, fails closed", () => {
  it("accepts only real booleans", () => {
    expect(canDialCampaignSchema.safeParse(true).success).toBe(true);
    expect(canDialCampaignSchema.safeParse(false).success).toBe(true);
  });

  it("rejects truthy non-booleans that must never be read as a grant", () => {
    for (const v of ["true", 1, {}, [], null, undefined]) {
      expect(canDialCampaignSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe("importCustomFieldsPayloadSchema — the Edge Function boundary", () => {
  it("accepts a payload keyed by canonical field NAMES", () => {
    const r = importCustomFieldsPayloadSchema.safeParse({
      "New Field": "hello",
      "Amt Requested": "25000",
      "Date/Time Received": "2026-01-02",
    });
    expect(r.success).toBe(true);
  });

  it("accepts the Edge Function's reserved markers", () => {
    expect(
      importCustomFieldsPayloadSchema.safeParse({
        __agentflow: { duplicateImport: true },
        tags: ["Duplicate"],
        "Full Name": "Jane Doe",
      }).success,
    ).toBe(true);
  });

  it("REJECTS a stable option value leaking in as a key", () => {
    const r = importCustomFieldsPayloadSchema.safeParse({ [`custom:${U1}`]: "hello" });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0].message).toMatch(/stable option value/i);
  });

  it("REJECTS a bare database UUID as a key", () => {
    const r = importCustomFieldsPayloadSchema.safeParse({ [U1]: "hello" });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0].message).toMatch(/database UUID/i);
  });

  it('REJECTS a key carrying the UI-only "(Custom)" suffix', () => {
    const r = importCustomFieldsPayloadSchema.safeParse({ "New Field (Custom)": "hello" });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0].message).toMatch(/\(Custom\)/i);
  });
});

describe("END-TO-END KEY CONTRACT: CSV header → stable id → canonical name → Edge Function", () => {
  it("produces a payload the unchanged Edge Function can store, with no UUID leakage", () => {
    // 1. The field as it exists in the database.
    const options = buildImportFieldOptions([{ id: U1, name: "New Field" }]);

    // 2. What UI mapping state holds for the CSV column — a STABLE ID, not a name.
    const mappingValue = customFieldOptionValue(U1);
    expect(mappingValue).toBe(`custom:${U1}`);
    expect(options.some((o) => o.value === mappingValue)).toBe(true);

    // 3. What the payload builder emits — the CANONICAL NAME.
    const canonical = resolveMappingToCanonicalName(mappingValue, options);
    expect(canonical).toBe("New Field");

    // 4. The object handed to the unchanged Edge Function, which writes it verbatim into
    //    `leads.custom_fields` (flat JSONB keyed by name).
    const payload = { [canonical!]: "some csv value" };
    expect(importCustomFieldsPayloadSchema.safeParse(payload).success).toBe(true);
    expect(Object.keys(payload)).toEqual(["New Field"]);
    expect(Object.keys(payload)[0]).not.toContain(U1);
    expect(Object.keys(payload)[0]).not.toContain("custom:");
    expect(Object.keys(payload)[0]).not.toContain("(Custom)");
  });

  it("catches the regression where the stable id is submitted instead of the name", () => {
    // The exact bug this contract exists to prevent.
    const broken = { [customFieldOptionValue(U1)]: "some csv value" };
    expect(importCustomFieldsPayloadSchema.safeParse(broken).success).toBe(false);
  });

  it("a display label can never become a payload key", () => {
    const opt = buildImportFieldOptions([{ id: U1, name: "New Field" }]).find((o) => o.kind === "custom")!;
    expect(opt.label).toBe("New Field (Custom)");
    expect(importCustomFieldsPayloadSchema.safeParse({ [opt.label]: "v" }).success).toBe(false);
    expect(importCustomFieldsPayloadSchema.safeParse({ [opt.canonicalName]: "v" }).success).toBe(true);
  });
});

describe("shared customFieldSchema is reused, not duplicated", () => {
  it("is the contract the import mapper validates against", () => {
    expect(
      customFieldSchema.safeParse({
        name: "New Field", type: "Text", appliesTo: ["Leads"], required: false,
        active: true, defaultValue: "", dropdownOptions: [], orgWide: false,
      }).success,
    ).toBe(true);
  });

  it("enforces the 40-character cap the import path previously bypassed", () => {
    const r = customFieldSchema.safeParse({
      name: "x".repeat(41), type: "Text", appliesTo: ["Leads"], required: false,
      active: true, defaultValue: "", dropdownOptions: [], orgWide: false,
    });
    expect(r.success).toBe(false);
    expect(r.success === false && r.error.issues[0].message).toMatch(/40 characters/i);
  });

  it("enforces the dropdown minimum the import path previously bypassed", () => {
    const r = customFieldSchema.safeParse({
      name: "Pick One", type: "Dropdown", appliesTo: ["Leads"], required: false,
      active: true, defaultValue: "", dropdownOptions: ["only"], orgWide: false,
    });
    expect(r.success).toBe(false);
  });
});
