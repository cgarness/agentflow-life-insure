import { describe, expect, it } from "vitest";
import { userLocalDayBounds } from "../supabase-dialer-stats";

describe("userLocalDayBounds", () => {
  it("returns a 24h span for a standard-time day (America/New_York, EST = UTC-5)", () => {
    // 2026-01-15 12:00 EST → local day is 2026-01-15.
    const at = new Date("2026-01-15T17:00:00.000Z");
    const { startIso, endIso } = userLocalDayBounds("America/New_York", at);
    expect(startIso).toBe("2026-01-15T05:00:00.000Z"); // local midnight EST
    expect(endIso).toBe("2026-01-16T05:00:00.000Z");
  });

  it("returns a 24h span for a DST day (America/New_York, EDT = UTC-4)", () => {
    // 2026-07-15 12:00 EDT → local day is 2026-07-15.
    const at = new Date("2026-07-15T16:00:00.000Z");
    const { startIso, endIso } = userLocalDayBounds("America/New_York", at);
    expect(startIso).toBe("2026-07-15T04:00:00.000Z"); // local midnight EDT
    expect(endIso).toBe("2026-07-16T04:00:00.000Z");
  });

  it("rolls the local date correctly when UTC is already the next calendar day", () => {
    // 2026-03-10 02:00 UTC == 2026-03-09 22:00 America/New_York (still the 9th,
    // EDT after the 2026-03-08 spring-forward → UTC-4).
    const at = new Date("2026-03-10T02:00:00.000Z");
    const { startIso, endIso } = userLocalDayBounds("America/New_York", at);
    expect(startIso).toBe("2026-03-09T04:00:00.000Z");
    expect(endIso).toBe("2026-03-10T04:00:00.000Z");
  });

  it("handles UTC zone as a plain calendar day", () => {
    const at = new Date("2026-05-29T13:30:00.000Z");
    const { startIso, endIso } = userLocalDayBounds("UTC", at);
    expect(startIso).toBe("2026-05-29T00:00:00.000Z");
    expect(endIso).toBe("2026-05-30T00:00:00.000Z");
  });

  it("spans exactly 24 hours across the US spring-forward DST transition", () => {
    // DST begins 2026-03-08 in America/New_York. The local day 03-08 is only 23h
    // wall-clock, but the [start,end) UTC span should still bound that local day.
    const at = new Date("2026-03-08T12:00:00.000Z");
    const { startIso, endIso } = userLocalDayBounds("America/New_York", at);
    expect(startIso).toBe("2026-03-08T05:00:00.000Z"); // EST midnight
    expect(endIso).toBe("2026-03-09T04:00:00.000Z"); // EDT midnight (23h later)
  });
});
