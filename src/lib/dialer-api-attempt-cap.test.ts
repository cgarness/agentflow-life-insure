import { describe, expect, it } from "vitest";
import { isOverCampaignAttemptCap } from "./dialer-api";

describe("isOverCampaignAttemptCap", () => {
  it("treats null/undefined campaign max as unlimited", () => {
    expect(isOverCampaignAttemptCap(0, null)).toBe(false);
    expect(isOverCampaignAttemptCap(100, null)).toBe(false);
    expect(isOverCampaignAttemptCap(0, undefined)).toBe(false);
  });

  it("is over cap when attempts >= finite max", () => {
    expect(isOverCampaignAttemptCap(2, 3)).toBe(false);
    expect(isOverCampaignAttemptCap(3, 3)).toBe(true);
    expect(isOverCampaignAttemptCap(4, 3)).toBe(true);
  });

  it("coalesces null/undefined attempts to 0", () => {
    expect(isOverCampaignAttemptCap(null, 1)).toBe(false);
    expect(isOverCampaignAttemptCap(undefined, 1)).toBe(false);
    expect(isOverCampaignAttemptCap(null, 0)).toBe(true);
  });
});
