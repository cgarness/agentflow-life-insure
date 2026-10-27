import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { classifyRequestedFieldName } from "@/lib/import-field-matching";
import {
  makeCustomFieldAgencyWide, provisionStandardLeadFields, STANDARD_LEAD_FIELD_NAMES, standardFieldForName, StandardFieldsError,
} from "@/lib/standard-lead-fields";

beforeEach(() => rpc.mockReset());

describe("standard lead fields: catalog", () => {
  it("names match by the logical normalization only — an agency's existing \"Zip Code\" is the standard ZIP field", () => {
    expect(STANDARD_LEAD_FIELD_NAMES).toEqual(["Address", "City", "ZIP Code"]);
    expect(standardFieldForName("  zip   code ")?.key).toBe("zip_code");
    expect(standardFieldForName("Zip")).toBeNull();
    expect(standardFieldForName("Street Address")).toBeNull();
  });
});

describe("standard lead fields: server calls", () => {
  it("passes the dry-run flag and snapshot exactly", async () => {
    rpc.mockResolvedValue({ data: { status: "complete", fields: [], last_attempt: null }, error: null });
    await provisionStandardLeadFields(true);
    await provisionStandardLeadFields(false);
    await makeCustomFieldAgencyWide("f1", "a".repeat(64), false);
    expect(rpc.mock.calls).toEqual([
      ["provision_standard_lead_fields", { p_dry_run: true }], ["provision_standard_lead_fields", { p_dry_run: false }],
      ["custom_field_make_agency_wide", { p_field: "f1", p_snapshot: "a".repeat(64), p_dry_run: false }],
    ]);
  });

  it("maps refusals to codes; an undeployed function reads as unavailable", async () => {
    const cases: [Record<string, string>, string][] = [
      [{ code: "PGRST202", message: "Could not find the function" }, "unavailable"], [{ code: "42883", message: "function does not exist" }, "unavailable"],
      [{ code: "42501", message: "not_permitted" }, "not_permitted"], [{ code: "42501", message: "permission denied for function" }, "not_permitted"],
      [{ code: "P0001", message: "field_changed" }, "field_changed"], [{ code: "P0001", message: "agency_field_exists" }, "agency_field_exists"],
      [{ code: "P0002", message: "not_found" }, "not_found"], [{ code: "XX000", message: "boom" }, "failed"],
    ];
    for (const [error, code] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error });
      const e = await makeCustomFieldAgencyWide("f1", null, true).catch((x) => x);
      expect(e).toBeInstanceOf(StandardFieldsError);
      expect([error.message, (e as StandardFieldsError).code]).toEqual([error.message, code]);
    }
  });
});

describe("classifyRequestedFieldName: the standard verdict is opt-in", () => {
  const fields = [{ id: "1", name: "Gender", createdBy: "u", createdAt: null }, { id: "2", name: "zip code", createdBy: "u", createdAt: null }];
  it("without standardNames the result is exactly as before", () => {
    expect(classifyRequestedFieldName("City", fields)).toEqual({ kind: "available" });
    expect(classifyRequestedFieldName("Address", [])).toEqual({ kind: "available" });
  });
  it("with standardNames, a standard name no visible field holds is 'standard'; a visible one is still reused", () => {
    const opts = { standardNames: STANDARD_LEAD_FIELD_NAMES };
    expect(classifyRequestedFieldName(" city ", fields, opts)).toEqual({ kind: "standard", name: "City" });
    expect(classifyRequestedFieldName("ZIP CODE", fields, opts)).toEqual({ kind: "existing", field: fields[1] });
    expect(classifyRequestedFieldName("Email", fields, opts)).toEqual({ kind: "builtin", builtInName: "Email" });
    expect(classifyRequestedFieldName("Street", fields, opts)).toEqual({ kind: "available" });
  });
});
