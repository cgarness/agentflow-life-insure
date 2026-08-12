/**
 * Lead-score exposure fix (2026-08-06).
 *
 * `leads.lead_score` is INTERNAL queue metadata. It must never resolve into a
 * user-facing individual contact field on Lead Details (read or edit) or on the
 * Dialer lead card.
 *
 * Removing the constant from source is not sufficient: migration
 * `20260326220000_add_field_order_to_settings.sql` set the
 * `contact_management_settings.field_order_lead` column DEFAULT to an array that
 * CONTAINS "leadScore", so live agency rows — and any user layout cloned from
 * one — still carry the key. `resolveFieldOrder` is the one funnel every layout
 * consumer uses (FullScreenContactView, Settings → Field Layout, DialerPage), so
 * the stale key is sanitized there on read. No migration, no data rewrite.
 *
 * Queue behaviour (Min/Max Score filters, the "Highest Score" sort, claiming,
 * locking) is deliberately NOT covered here — it is unchanged by this fix.
 */
import { describe, it, expect } from "vitest";
import {
  getDefaultFieldOrder,
  resolveFieldOrder,
  leadLayoutIdsToDialerDescriptors,
} from "@/lib/contactFieldLayout";

/**
 * Verbatim `field_order_lead` column default from migration
 * `20260326220000_add_field_order_to_settings.sql`. This is what production
 * agency rows actually hold — the exact payload that must be sanitized.
 */
const MIGRATION_DEFAULT_FIELD_ORDER_LEAD = [
  "firstName",
  "lastName",
  "phone",
  "email",
  "state",
  "leadSource",
  "leadScore",
  "age",
  "dateOfBirth",
  "spouseInfo",
  "assignedAgentId",
  "notes",
];

describe("getDefaultFieldOrder — system default lead layout", () => {
  it("excludes leadScore", () => {
    expect(getDefaultFieldOrder("lead")).not.toContain("leadScore");
  });

  it("keeps Age and every other lead field, in order", () => {
    expect(getDefaultFieldOrder("lead")).toEqual([
      "firstName",
      "lastName",
      "phone",
      "email",
      "state",
      "leadSource",
      "age",
      "dateOfBirth",
      "spouseInfo",
      "assignedAgentId",
      "notes",
    ]);
  });

  it("client default carries the policy-schedule fields (soldDate replaced issueDate); recruit untouched", () => {
    expect(getDefaultFieldOrder("client")).toEqual([
      "firstName",
      "lastName",
      "phone",
      "email",
      "policyType",
      "carrier",
      "state",
      "policyNumber",
      "premiumAmount",
      "faceAmount",
      "soldDate",
      "effectiveDate",
      "draftDate",
      "paymentFrequency",
      "assignedAgentId",
      "notes",
    ]);
    // issueDate is retired from the DEFAULT layout only — saved layouts containing it still render.
    expect(getDefaultFieldOrder("client")).not.toContain("issueDate");
    expect(getDefaultFieldOrder("recruit")).toEqual([
      "firstName",
      "lastName",
      "phone",
      "email",
      "status",
      "state",
      "assignedAgentId",
      "notes",
    ]);
  });
});

describe("resolveFieldOrder — stale saved layouts are sanitized", () => {
  it("strips leadScore from a saved USER layout and preserves the rest in order", () => {
    const userOrder = ["firstName", "leadScore", "phone", "age", "notes"];

    const resolved = resolveFieldOrder("lead", userOrder, undefined);

    expect(resolved).not.toContain("leadScore");
    expect(resolved).toEqual(["firstName", "phone", "age", "notes"]);
  });

  it("strips leadScore from a saved AGENCY layout and preserves the rest in order", () => {
    const resolved = resolveFieldOrder("lead", undefined, MIGRATION_DEFAULT_FIELD_ORDER_LEAD);

    expect(resolved).not.toContain("leadScore");
    expect(resolved).toEqual([
      "firstName",
      "lastName",
      "phone",
      "email",
      "state",
      "leadSource",
      "age",
      "dateOfBirth",
      "spouseInfo",
      "assignedAgentId",
      "notes",
    ]);
  });

  it("sanitizes the user layout even when an agency layout also exists (user still wins)", () => {
    const resolved = resolveFieldOrder(
      "lead",
      ["leadScore", "firstName", "phone"],
      MIGRATION_DEFAULT_FIELD_ORDER_LEAD
    );

    expect(resolved).toEqual(["firstName", "phone"]);
  });

  it("falls through to the agency layout when the user layout is only leadScore", () => {
    const resolved = resolveFieldOrder("lead", ["leadScore"], ["firstName", "phone", "notes"]);

    expect(resolved).toEqual(["firstName", "phone", "notes"]);
  });

  it("falls through to the system default when BOTH saved layouts are only leadScore", () => {
    const resolved = resolveFieldOrder("lead", ["leadScore"], ["leadScore"]);

    expect(resolved).toEqual(getDefaultFieldOrder("lead"));
    expect(resolved).not.toContain("leadScore");
  });

  it("never returns an empty field list for a lead", () => {
    expect(resolveFieldOrder("lead", ["leadScore"], ["leadScore"]).length).toBeGreaterThan(0);
  });

  it("does not disturb layouts that never contained leadScore", () => {
    const userOrder = ["phone", "firstName", "custom:Beneficiary", "notes"];

    expect(resolveFieldOrder("lead", userOrder, undefined)).toEqual(userOrder);
    expect(resolveFieldOrder("client", ["carrier", "policyNumber"], undefined)).toEqual([
      "carrier",
      "policyNumber",
    ]);
  });
});

describe("leadLayoutIdsToDialerDescriptors — the Dialer registry cannot expose the score", () => {
  it("emits no descriptor for a stale leadScore id", () => {
    const descriptors = leadLayoutIdsToDialerDescriptors([
      "firstName",
      "leadScore",
      "age",
      "phone",
    ]);

    expect(descriptors.map((d) => d.key)).not.toContain("lead_score");
    expect(descriptors.map((d) => d.label)).not.toContain("Score");
    expect(descriptors.map((d) => d.key)).toEqual(["first_name", "age", "phone"]);
  });

  it("emits no score descriptor for the raw production agency default", () => {
    const descriptors = leadLayoutIdsToDialerDescriptors(MIGRATION_DEFAULT_FIELD_ORDER_LEAD);

    expect(descriptors.some((d) => d.key === "lead_score")).toBe(false);
    expect(descriptors.some((d) => d.label === "Score")).toBe(false);
  });

  it("still maps Age, standard fields and custom fields", () => {
    const descriptors = leadLayoutIdsToDialerDescriptors([
      "age",
      "dateOfBirth",
      "leadSource",
      "custom:Beneficiary",
    ]);

    expect(descriptors).toEqual([
      { label: "Age", key: "age", kind: "standard" },
      { label: "DOB", key: "date_of_birth", kind: "standard" },
      { label: "Source", key: "source", kind: "standard" },
      { label: "Beneficiary", key: "Beneficiary", kind: "custom" },
    ]);
  });
});
