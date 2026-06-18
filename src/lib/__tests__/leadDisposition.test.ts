import { describe, it, expect } from "vitest";
import { deriveLastDisposition, normalizeDispositionValue } from "@/lib/supabase-contacts";

describe("deriveLastDisposition", () => {
  it("returns the newest dispositioned call's name (by created_at)", () => {
    const calls = [
      { disposition_name: "Interested", created_at: "2024-01-01T10:00:00Z" },
      { disposition_name: "Not Interested", created_at: "2024-03-01T10:00:00Z" },
      { disposition_name: "No Answer", created_at: "2024-02-01T10:00:00Z" },
    ];
    expect(deriveLastDisposition(calls)).toBe("Not Interested");
  });

  it("prefers an ID-backed disposition and never reads telephony status", () => {
    // The later row has neither disposition field (only a telephony status) → not a disposition;
    // the newest *dispositioned* call is the ID-backed Voicemail row.
    const calls = [
      { disposition_id: "uuid-1", disposition_name: "Voicemail", status: "completed", created_at: "2024-02-02T00:00:00Z" },
      { disposition_id: null, disposition_name: "", status: "no-answer", created_at: "2024-02-03T00:00:00Z" },
    ] as unknown as Parameters<typeof deriveLastDisposition>[0];
    expect(deriveLastDisposition(calls)).toBe("Voicemail");
  });

  it("ignores telephony status — a call with only status is not a disposition", () => {
    const calls = [{ status: "completed", created_at: "2024-01-01T00:00:00Z" }] as unknown as Parameters<typeof deriveLastDisposition>[0];
    expect(deriveLastDisposition(calls)).toBeUndefined();
  });

  it("returns undefined when there are no calls or none carry a disposition", () => {
    expect(deriveLastDisposition([])).toBeUndefined();
    expect(deriveLastDisposition(null)).toBeUndefined();
    expect(deriveLastDisposition([{ disposition_name: "   ", created_at: "2024-01-01" }])).toBeUndefined();
  });
});

describe("normalizeDispositionValue", () => {
  it("trims and lowercases so filter options match stored values", () => {
    expect(normalizeDispositionValue("  No Answer ")).toBe("no answer");
    expect(normalizeDispositionValue("INTERESTED")).toBe("interested");
    expect(normalizeDispositionValue(null)).toBe("");
    expect(normalizeDispositionValue(undefined)).toBe("");
  });
});
