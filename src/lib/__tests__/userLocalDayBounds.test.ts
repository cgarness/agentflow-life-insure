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

  // `localDate` is the Dialer's Sold Date: the agent's own calendar date, never the UTC date.
  it.each([
    ["America/Los_Angeles", "2026-10-17T02:00:00.000Z", "2026-10-16", "2026-10-16T07:00:00.000Z"], // 7 PM PDT, UTC already the 17th
    ["America/New_York", "2026-03-10T02:00:00.000Z", "2026-03-09", "2026-03-09T04:00:00.000Z"],
    ["America/Los_Angeles", "2026-11-01T20:00:00.000Z", "2026-11-01", "2026-11-01T07:00:00.000Z"], // 25h fall-back day
    ["UTC", "2026-05-29T13:30:00.000Z", "2026-05-29", "2026-05-29T00:00:00.000Z"],
    ["Pacific/Kiritimati", "2026-10-16T12:00:00.000Z", "2026-10-17", "2026-10-16T10:00:00.000Z"], // UTC+14
    ["Pacific/Pago_Pago", "2026-10-16T05:00:00.000Z", "2026-10-15", "2026-10-15T11:00:00.000Z"], // UTC-11
  ])("%s at %s is local date %s", (zone, at, localDate, startIso) => {
    const bounds = userLocalDayBounds(zone, new Date(at));
    expect(bounds.localDate).toBe(localDate);
    expect(bounds.startIso).toBe(startIso);
  });
});
