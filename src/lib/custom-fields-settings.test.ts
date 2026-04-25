import { describe, it, expect } from "vitest";
import { customFieldsSupabaseApi } from "@/lib/supabase-settings";

describe("customFieldsSupabaseApi.getAll", () => {
  it("returns empty array when organizationId is missing", async () => {
    await expect(customFieldsSupabaseApi.getAll(null)).resolves.toEqual([]);
    await expect(customFieldsSupabaseApi.getAll(undefined)).resolves.toEqual([]);
    await expect(customFieldsSupabaseApi.getAll("")).resolves.toEqual([]);
  });
});
