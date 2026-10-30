import { describe, expect, it } from "vitest";
import {
  MANUAL_MESSAGE_TEMPLATE_TOKENS,
  applyMessageTemplateMerge,
  unresolvedTemplateFields,
  templateMatchesChannel,
  templateUsesManualMergeFields,
} from "../messageTemplateMerge";

describe("message template merge and manual warning", () => {
  const full = {
    contact: { first_name: "Jane", lastName: "Smith", phone: "5551234567" },
    agentFirstName: "Marcus",
    agentLastName: "Rivera",
    agentPhone: "(555) 100-2222",
    agentEmail: "marcus@example.com",
    agencyName: "Example Agency",
  };

  it("resolves snake- and camel-case contact fields without changing existing syntax", () => {
    expect(applyMessageTemplateMerge(
      "Hi {{contact_first_name}} {{contact_last_name}}, from {{agent_first_name}} at {{agency_name}}.",
      full,
    )).toBe("Hi Jane Smith, from Marcus at Example Agency.");
    expect(unresolvedTemplateFields(
      "{{contact_first_name}} {{contact_last_name}} {{agent_first_name}} {{agency_name}}",
      full,
    )).toEqual([]);
  });

  it("flags missing fields before composing, including an unavailable appointment", () => {
    const body = "Hi {{contact_first_name}}, your appointment is {{appointment_date}} at {{appointment_time}}.";
    const input = { contact: { first_name: "" }, agentFirstName: "Marcus" };
    expect(applyMessageTemplateMerge(body, input)).toBe("Hi , your appointment is  at .");
    expect(unresolvedTemplateFields(body, input)).toEqual(["First Name", "Appointment Date", "Appointment Time"]);
  });

  it("flags unknown placeholders and never assumes a value exists", () => {
    const input = { contact: { firstName: "Jane" } };
    const message = "{{agent_phone}} | {{unknown_field}} | {{agent_phone}}";
    expect(unresolvedTemplateFields(message, input)).toEqual(["Agent Phone", "Unknown Field"]);
    expect(applyMessageTemplateMerge(message, input)).toContain("{{unknown_field}}");
  });

  it("detects manual-only merge syntax and accepts workflow-native contact syntax", () => {
    expect(MANUAL_MESSAGE_TEMPLATE_TOKENS).toContain("{{contact_first_name}}");
    expect(templateUsesManualMergeFields("Hello {{contact_first_name}}")).toBe(true);
    expect(templateUsesManualMergeFields("Plain body", "For {{agent_first_name}}")).toBe(true);
    expect(templateUsesManualMergeFields("Hi {{ first_name }}. Your {{ last_name }} is here.")).toBe(false);
    expect(templateUsesManualMergeFields("Static workflow notification")).toBe(false);
  });

  it("keeps SMS and email channel filtering unchanged", () => {
    expect(templateMatchesChannel("sms", "sms")).toBe(true);
    expect(templateMatchesChannel("email", "sms")).toBe(false);
    expect(templateMatchesChannel("email", "email")).toBe(true);
  });
});
