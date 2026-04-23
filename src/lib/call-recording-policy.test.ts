import { describe, expect, it } from "vitest";
import { isCallRecordingEnabledDb } from "./call-recording-policy";

describe("isCallRecordingEnabledDb", () => {
  it("treats true and null as enabled", () => {
    expect(isCallRecordingEnabledDb(true)).toBe(true);
    expect(isCallRecordingEnabledDb(null)).toBe(true);
    expect(isCallRecordingEnabledDb(undefined)).toBe(true);
  });

  it("treats explicit false as disabled", () => {
    expect(isCallRecordingEnabledDb(false)).toBe(false);
  });
});
