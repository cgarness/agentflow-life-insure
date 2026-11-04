import { describe, expect, it } from "vitest";
import { numberSearchSchema } from "../numberSearchSchema";

describe("phone-number search validation", () => {
  it("retains local area, state and city searches and trims values", () => {
    expect(numberSearchSchema.parse({ numberType: "local", areaCode: " 213 ", state: " CA ", locality: " Los Angeles " }))
      .toEqual({ numberType: "local", areaCode: "213", state: "CA", locality: "Los Angeles" });
    for (const filter of [{ areaCode: "2" }, { state: "ca" }, { locality: "Boston" }]) {
      expect(numberSearchSchema.safeParse({ numberType: "local", ...filter }).success).toBe(true);
    }
  });
  it("still rejects empty or malformed local filters", () => {
    for (const filter of [{}, { areaCode: "1234" }, { areaCode: "abc" }, { state: "USA" }, { locality: "a".repeat(101) }]) {
      expect(numberSearchSchema.safeParse({ numberType: "local", ...filter }).success).toBe(false);
    }
  });
  it.each(["prefer_800", "800", "888"])("accepts %s without local filters", (prefix) => {
    expect(numberSearchSchema.parse({ numberType: "toll_free", prefix, areaCode: "213", locality: "Los Angeles" }))
      .toEqual({ numberType: "toll_free", prefix });
  });
  it("rejects unsupported prefixes and types", () => {
    expect(numberSearchSchema.safeParse({ numberType: "toll_free", prefix: "877" }).success).toBe(false);
    expect(numberSearchSchema.safeParse({ numberType: "mobile", prefix: "800" }).success).toBe(false);
  });
});
