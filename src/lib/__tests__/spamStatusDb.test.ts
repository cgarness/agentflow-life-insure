import { describe, it, expect } from "vitest";

/** Mirrors `phone_numbers_spam_status_check` in 20260422183000_phone_numbers_spam_status_check_normalize.sql */
const ALLOWED = new Set([
  "unknown",
  "checking",
  "clean",
  "at_risk",
  "flagged",
  "insufficient_data",
  "evaluating",
]);

function normalizedSpamStatusKey(spamStatus: string): string {
  return spamStatus.trim().toLowerCase().replace(/\s+/g, "_");
}

describe("spam_status DB constraint (normalized)", () => {
  it("accepts Title Case and snake_case variants used by AgentFlow + Twilio reputation", () => {
    const samples = [
      "Clean",
      "At Risk",
      "Flagged",
      "Insufficient Data",
      "Evaluating",
      "Unknown",
      "checking",
      "clean",
      "at_risk",
      "INSUFFICIENT_DATA",
    ];
    for (const s of samples) {
      expect(ALLOWED.has(normalizedSpamStatusKey(s)), s).toBe(true);
    }
  });
});
