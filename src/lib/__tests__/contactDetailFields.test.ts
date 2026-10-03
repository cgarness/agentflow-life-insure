import { describe, expect, it } from "vitest";
import { buildContactDetailFields, isPopulatedDetailValue, missingRequiredCustomDetails } from "../contact-detail-fields";
import { resolveFieldOrder } from "../contactFieldLayout";
import type { CustomField } from "../types";
const definition = (id: string, name: string, extra: Partial<CustomField> = {}): CustomField => ({
  id, name, type: "Text", active: true, required: false, appliesTo: ["Leads", "Clients", "Recruits"], usageCount: 0, ...extra,
});
const custom = (definitions: CustomField[], values: Record<string, unknown> = {}, order: string[] = []) =>
  buildContactDetailFields({ type: "lead", order, definitions, values }).filter(f => f.kind === "custom");

describe("contact detail field projection", () => {
  it("places one exact stored key once despite duplicate definitions and repeated layout entries", () => {
    expect(custom([definition("a", "Gender"), definition("b", "Gender"), definition("c", "Gender")],
      { Gender: "Synthetic" }, ["custom:Gender", "custom:Gender"])).toHaveLength(1);
  });
  it("uses import representative ranking independently of input order", () => {
    const defs = [definition("a", " gender ", { scope: "personal", createdAt: "2020-01-01" }),
      definition("z", "GENDER", { scope: "agency", createdAt: "2022-01-01" }),
      definition("b", "Gender", { scope: "agency", createdAt: "2021-01-01" })];
    expect(custom(defs)).toEqual(custom([...defs].reverse()));
    expect(custom(defs)[0].key).toBe("Gender");
  });
  it("also breaks missing timestamp ties by id", () => {
    const defs = [definition("z", "GENDER"), definition("a", "Gender")];
    expect(custom(defs)).toEqual(custom([...defs].reverse()));
    expect(custom(defs)[0].key).toBe("Gender");
  });
  it("keeps exact case/space variants and values separately, including equal values", () => {
    const values = { Gender: "A", " gender ": "B", GENDER: "A" };
    const result = custom([definition("a", "Gender")], values, ["custom: gender ", "custom:GENDER", "custom:Gender"]);
    expect(result.map(f => f.key)).toEqual([" gender ", "GENDER", "Gender"]);
    expect(new Set(result.map(f => f.label)).size).toBe(3);
    expect(values).toEqual({ Gender: "A", " gender ": "B", GENDER: "A" });
  });
  it("resolves stale normalized aliases without creating a replacement key", () => {
    expect(custom([definition("a", "Gender")], { " GENDER ": "A" }, ["custom:gender", "custom:Gender"])
      .map(f => f.key)).toEqual([" GENDER "]);
  });
  it("retains unknown/inactive stored keys but offers only active type-relevant definitions", () => {
    const defs = [definition("a", "Inactive", { active: false }), definition("b", "Client only", { appliesTo: ["Clients"] }), definition("c", "Optional")];
    expect(custom(defs, { Inactive: "old", Unknown: 0 }).map(f => f.key)).toEqual(["Inactive", "Optional", "Unknown"]);
  });
  it("keeps punctuation distinct and exact reserved metadata out of all paths", () => {
    const fields = custom([definition("a", "additional_policies", { required: true }), definition("b", "additional_policies "),
      definition("c", "Date/Time"), definition("d", "Date Time")], { additional_policies: [{ premiumAmount: "$20/mo" }] }, ["custom:additional_policies"]);
    expect(fields.map(f => f.key)).toEqual(["additional_policies ", "Date Time", "Date/Time"]);
    expect(missingRequiredCustomDetails(fields)).toEqual([]);
  });
  it.each([0, false, true, "0", "false", { nested: "data" }, ["data"]])("treats %j as populated", value => {
    expect(isPopulatedDetailValue(value)).toBe(true);
  });
  it.each([undefined, null, "", " \n ", [], {}])("treats %j as empty", value => {
    expect(isPopulatedDetailValue(value)).toBe(false);
  });
  it("retains ranges, invalid dates, dropdown legacy choices and structured values", () => {
    const fields = custom([definition("a", "Amount", { type: "Number" }), definition("b", "Date", { type: "Date" }),
      definition("c", "Choice", { type: "Dropdown", dropdownOptions: ["New"] })],
      { Amount: "$30,000+", Date: "legacy", Choice: "Old", Object: { nested: [1, false] } });
    expect(fields.find(f => f.key === "Amount")?.editor).toBe("text");
    expect(fields.find(f => f.key === "Date")?.editor).toBe("text");
    expect(fields.find(f => f.key === "Choice")?.options).toEqual(["New", "Old"]);
    expect(fields.find(f => f.key === "Object")?.readOnly).toBe(true);
  });
  it.each(["2026-02-31", "unknown", "2026-01-01T12:00:00Z"])("keeps legacy date %s visible in a text editor", value => {
    expect(custom([definition("date", "Date", { type: "Date" })], { Date: value })[0].editor).toBe("text");
  });
  it("uses a non-coercing editor for conflicting types/options and retains required constraints", () => {
    const defs = [definition("a", "Amount", { type: "Number" }), definition("b", "amount", { type: "Text", required: true }),
      definition("c", "Choice", { type: "Dropdown", dropdownOptions: ["A"] }), definition("d", "CHOICE", { type: "Dropdown", dropdownOptions: ["B"] })];
    const fields = custom(defs, { AMOUNT: 0 });
    expect(fields.every(f => f.editor === "text")).toBe(true);
    expect(missingRequiredCustomDetails(fields, { AMOUNT: 0 })).toEqual([]);
    expect(missingRequiredCustomDetails(fields, { AMOUNT: " " })).toHaveLength(1);
  });
  it.each(["lead", "client", "recruit"] as const)("preserves user/agency/default order and completes supported %s fields", type => {
    const order = resolveFieldOrder(type, ["phone", "phone", "leadScore", "stale", "firstName"], ["email"]);
    const fields = buildContactDetailFields({ type, order });
    expect(fields.slice(0, 2).map(f => f.id)).toEqual(["phone", "firstName"]);
    expect(new Set(fields.map(f => f.id)).size).toBe(fields.length);
    expect(fields.map(f => f.id)).toContain("state");
    expect(fields.map(f => f.id)).not.toContain("leadScore");
    expect(fields.map(f => f.id)).not.toContain("stale");
  });
});
