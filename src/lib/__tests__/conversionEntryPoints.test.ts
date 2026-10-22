import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { prepareConversion, type AdditionalPolicyPayload, type LeadConversionPayload } from "@/lib/supabase-conversion";
import { rowToLead, rowToLeadWithAggregates } from "@/lib/supabase-contacts";
import { withTeamOpenMasterLead } from "@/lib/teamOpenLeadAccess";
import { emptyCommissionPayload } from "@/lib/commission/capture";
import type { Lead } from "@/lib/types";

/**
 * Every conversion entry point — Contacts (table, kanban, profile), the Personal, Team and Open Pool Dialer, and the
 * Floating Dialer — hands ConvertLeadModal a lead object of a different shape and freshness. After 20261021200000 the
 * server reads every preserved field from the locked lead row, so the submission must be the same for all of them:
 * the lead id plus the agent's conversion inputs. Lead-only data in a (possibly stale) object never decides anything.
 */
const ROOT = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const masterRow = {
  id: "lead-1", first_name: "Pat", last_name: "Lee", phone: "5550101", email: "pat@example.test", state: "CA",
  status: "Interested", lead_source: "Facebook", lead_score: 8, age: 64, date_of_birth: "1961-04-12",
  best_time_to_call: "Morning", spouse_info: { name: "Sam" }, notes: "Current lead notes",
  custom_fields: { Gender: "Female" }, assigned_agent_id: "agent-1", user_id: "agent-1",
  created_at: "2026-09-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z",
};
// Stale copies the browser may hold: an outdated notes/custom-field copy and the campaign row's own columns.
const staleRow = { ...masterRow, notes: "Older notes copy", custom_fields: { Gender: "Male (stale)" }, age: null, lead_source: "" };

const shapes: Array<[string, Lead]> = [
  ["Contacts table / kanban (search_contacts_leads row)", rowToLeadWithAggregates({ ...staleRow, attempt_count: 3, last_disposition: "Sold" })],
  ["Contacts profile (selected lead after local edits)", { ...rowToLead(staleRow), notes: "Unsaved local edit" }],
  ["Personal Dialer (campaign row merged over the master)", {
    ...rowToLead({ ...staleRow, status: "Queued" }), id: "lead-1", leadSource: "campaign source", age: undefined }],
  ["Team / Open Pool Dialer (master overlay)", rowToLead(withTeamOpenMasterLead({ ...staleRow, status: "Queued" }, masterRow))],
  ["Floating Dialer (fresh database row)", rowToLead(masterRow)],
];

const policy: LeadConversionPayload = {
  policyType: "Term", carrier: "Synthetic Life", policyNumber: "P-1", premiumAmount: "$50.00", faceAmount: "100,000",
  soldDate: "2026-10-01", effectiveDate: "2026-11-01", draftDate: "", paymentFrequency: "monthly",
  beneficiaryName: "B", beneficiaryRelationship: "Spouse", beneficiaryPhone: "5552223333",
};

const submission = (lead: Lead, notes?: string) =>
  prepareConversion(lead, { ...policy, notes }, "org-1", null, "request-1", emptyCommissionPayload()).saleArgs as Record<string, unknown> & {
    p_client: Record<string, unknown>;
  };

describe("conversion entry points submit the same server-authoritative payload", () => {
  it.each(shapes)("%s: lead id + conversion inputs only; no lead-only field is sent", (_label, lead) => {
    const args = submission(lead);
    expect(args.p_lead_id).toBe("lead-1");
    expect(args.p_expected_org).toBe("org-1");
    const keys = Object.keys(args.p_client).sort();
    expect(keys).toEqual(["beneficiary_name", "beneficiary_phone", "beneficiary_relationship", "carrier", "custom_fields",
      "draft_date", "effective_date", "face_amount", "issue_date", "notes", "notes_source", "payment_frequency",
      "policy_number", "policy_type", "premium", "sold_date"]);
    expect(args.p_client.notes).toBeNull(); // the agent wrote nothing; never this lead object's notes copy
    expect(args.p_client.notes_source).toBe("conversion_note");
  });

  it("everything except the lead's own custom-field copy is identical across entry points", () => {
    const strip = (lead: Lead): Record<string, unknown> => ({ ...submission(lead, "Agent note").p_client, custom_fields: undefined });
    const first = strip(shapes[0][1]);
    for (const [, lead] of shapes) expect(strip(lead)).toEqual(first);
    expect(first.notes).toBe("Agent note");
    expect(first.notes_source).toBe("conversion_note");
  });

  it("additional policies are the agent's input and pass through verbatim for every shape", () => {
    const extra: AdditionalPolicyPayload[] = [{ policyId: "p-2", policyType: "Final Expense", carrier: "Synthetic Life", policyNumber: "", faceAmount: "",
      premiumAmount: "30.00", soldDate: "2026-10-01", effectiveDate: null }];
    for (const [, lead] of shapes) {
      const args = prepareConversion(lead, { ...policy, additionalPolicies: extra }, "org-1", "camp-1", "r", emptyCommissionPayload()).saleArgs as {
        p_client: { custom_fields: Record<string, unknown> }; p_campaign_id: string };
      expect(args.p_client.custom_fields.additional_policies).toEqual(extra);
      expect(args.p_campaign_id).toBe("camp-1");
    }
  });
});

describe("source contract: every Convert surface uses the one conversion writer", () => {
  it("each mount site renders ConvertLeadModal and the modal submits only through the handoff companion", () => {
    for (const path of ["src/pages/Contacts.tsx", "src/components/contacts/FullScreenContactView.tsx", "src/pages/DialerPage.tsx",
      "src/components/layout/FloatingDialer.tsx"]) {
      expect(read(path), path).toMatch(/<ConvertLeadModal\b/);
    }
    const modal = read("src/components/contacts/ConvertLeadModal.tsx");
    expect(modal).toContain("conversionSupabaseApi.convertLeadToClientHandoff(");
    expect(modal).not.toMatch(/convert_lead_to_client_atomic|convert_lead_to_client_with_sales\b/);
    const writer = read("src/lib/policySaleRecording.ts");
    expect(writer).toContain('"convert_lead_to_client_with_sales_handoff"');
  });
});
