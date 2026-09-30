/**
 * Local wall-clock → absolute instant (src/lib/calendar/localDateTime.ts).
 *
 * A date + wall-clock time a user picks is the BROWSER's local calendar time. The Dialer appointment writer
 * must persist the same instant DialerPage's canonical campaign callback does (`new Date(y, m, d, h, min)`),
 * never a bare `YYYY-MM-DDTHH:mm:ss` that Postgres `timestamptz` reads as UTC (7 h early in PDT).
 *
 * Zone-independent cases run everywhere. The LA / UTC literal cases only run in that zone; the targeted
 * commands are `TZ=America/Los_Angeles npx vitest run …` and `TZ=UTC npx vitest run …` (no CI runs vitest).
 */
import { describe, it, expect } from "vitest";
import { localDateTimeToIso, parseWallClockTime } from "@/lib/calendar/localDateTime";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const laOnly = TZ === "America/Los_Angeles" ? it : it.skip;
const utcOnly = TZ === "UTC" || TZ === "Etc/UTC" ? it : it.skip;

/** Every TimeSelect label: 15-minute steps, 12:00 AM … 11:45 PM (mirrors TimeSelect's generator). */
const TIME_SELECT_LABELS: string[] = Array.from({ length: 96 }, (_, i) => {
  const total = i * 15;
  const h24 = Math.floor(total / 60);
  const minutes = total % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(minutes).padStart(2, "0")} ${period}`;
});

/**
 * VERBATIM copy of DialerPage's canonical campaign-callback parse (saveCallData `callbackDueAtISO` and the
 * proceedSaveAndNext `callbackDueAt` copy). `callbackDate` is local noon, as DialerActions stores it.
 * The page's own blocks are pinned unchanged by dialerAppointmentSaveContract.test.ts.
 */
function canonicalCallbackDueAtISO(callbackDate: Date, callbackTime: string): string {
  const [h, rest] = callbackTime.split(':');
  const [min, period] = (rest || '').split(' ');
  let hours24 = parseInt(h, 10);
  if (period === 'PM' && hours24 < 12) hours24 += 12;
  if (period === 'AM' && hours24 === 12) hours24 = 0;
  return new Date(
    callbackDate.getFullYear(),
    callbackDate.getMonth(),
    callbackDate.getDate(),
    hours24,
    parseInt(min || '0', 10),
  ).toISOString();
}

/** DialerActions stores a picked callback date as local noon (`value + 'T12:00:00'`). */
const localNoon = (ymd: string) => new Date(`${ymd}T12:00:00`);

describe("TimeSelect labels", () => {
  it("covers the full day in 96 labels", () => {
    expect(TIME_SELECT_LABELS).toHaveLength(96);
    expect(TIME_SELECT_LABELS[0]).toBe("12:00 AM");
    expect(TIME_SELECT_LABELS[48]).toBe("12:00 PM");
    expect(TIME_SELECT_LABELS[95]).toBe("11:45 PM");
  });
});

describe("parseWallClockTime", () => {
  it("parses 12-hour TimeSelect values, including the 12 AM / 12 PM edges", () => {
    expect(parseWallClockTime("12:00 AM")).toEqual({ hours: 0, minutes: 0 });
    expect(parseWallClockTime("12:45 AM")).toEqual({ hours: 0, minutes: 45 });
    expect(parseWallClockTime("12:00 PM")).toEqual({ hours: 12, minutes: 0 });
    expect(parseWallClockTime("12:45 PM")).toEqual({ hours: 12, minutes: 45 });
    expect(parseWallClockTime("2:30 PM")).toEqual({ hours: 14, minutes: 30 });
    expect(parseWallClockTime("11:45 PM")).toEqual({ hours: 23, minutes: 45 });
  });

  it("accepts 24-hour HH:mm", () => {
    expect(parseWallClockTime("14:30")).toEqual({ hours: 14, minutes: 30 });
    expect(parseWallClockTime("00:15")).toEqual({ hours: 0, minutes: 15 });
  });

  it("rejects malformed and out-of-range values", () => {
    for (const bad of ["", "   ", "2 PM", "2:3 PM", "25:00", "13:30 PM", "0:30 PM", "2:60 PM", "noon", "2:30 XM"]) {
      expect(parseWallClockTime(bad)).toBeNull();
    }
  });
});

describe("localDateTimeToIso", () => {
  it("returns an absolute ISO instant (offset-bearing), never an offset-less wall-clock string", () => {
    const iso = localDateTimeToIso("2026-09-30", "2:30 PM");
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("equals the local construction new Date(y, m, d, h, min) in the current zone", () => {
    expect(localDateTimeToIso("2026-09-30", "2:30 PM")).toBe(new Date(2026, 8, 30, 14, 30).toISOString());
    expect(localDateTimeToIso("2026-12-15", "9:15 AM")).toBe(new Date(2026, 11, 15, 9, 15).toISOString());
  });

  it("matches the canonical callback parse for all 96 TimeSelect labels across DST dates", () => {
    const dates = [
      "2026-03-08", // US spring-forward (2:00–2:59 AM does not exist in LA)
      "2026-11-01", // US fall-back (1:00–1:59 AM occurs twice in LA)
      "2027-03-14",
      "2027-11-07",
      "2026-09-30",
      "2026-12-15",
      "2026-04-05", // southern-hemisphere transition window
      "2026-09-27",
      "2026-02-28",
      "2028-02-29",
    ];
    for (const ymd of dates) {
      for (const label of TIME_SELECT_LABELS) {
        expect(localDateTimeToIso(ymd, label), `${ymd} ${label}`).toBe(canonicalCallbackDueAtISO(localNoon(ymd), label));
      }
    }
  });

  it("rejects malformed dates, rollovers and two-digit years instead of guessing", () => {
    expect(localDateTimeToIso("2026-02-31", "2:30 PM")).toBeNull();
    expect(localDateTimeToIso("09/30/2026", "2:30 PM")).toBeNull();
    expect(localDateTimeToIso("", "2:30 PM")).toBeNull();
    expect(localDateTimeToIso("0026-10-15", "2:30 PM")).toBeNull();
    expect(localDateTimeToIso("2026-09-30", "")).toBeNull();
    expect(localDateTimeToIso("2026-09-30", "not a time")).toBeNull();
  });

  laOnly("PDT summer: 2026-09-30 2:30 PM Los Angeles → 21:30Z (UTC−7)", () => {
    expect(localDateTimeToIso("2026-09-30", "2:30 PM")).toBe("2026-09-30T21:30:00.000Z");
  });

  laOnly("PST winter: 2026-12-15 2:30 PM Los Angeles → 22:30Z (UTC−8)", () => {
    expect(localDateTimeToIso("2026-12-15", "2:30 PM")).toBe("2026-12-15T22:30:00.000Z");
  });

  laOnly("late evening crosses the UTC day: 2026-10-31 11:30 PM → 2026-11-01T06:30Z", () => {
    expect(localDateTimeToIso("2026-10-31", "11:30 PM")).toBe("2026-11-01T06:30:00.000Z");
  });

  laOnly("day after fall-back uses PST: 2026-11-02 9:00 AM → 17:00Z", () => {
    expect(localDateTimeToIso("2026-11-02", "9:00 AM")).toBe("2026-11-02T17:00:00.000Z");
  });

  laOnly("DST gap: 2027-03-14 2:30 AM does not exist and rolls forward to 3:30 AM PDT (10:30Z)", () => {
    expect(localDateTimeToIso("2027-03-14", "2:30 AM")).toBe("2027-03-14T10:30:00.000Z");
  });

  laOnly("DST overlap: 2026-11-01 1:30 AM resolves to the first (PDT) occurrence (08:30Z)", () => {
    expect(localDateTimeToIso("2026-11-01", "1:30 AM")).toBe("2026-11-01T08:30:00.000Z");
  });

  laOnly("12:00 AM and 12:45 PM edges in LA", () => {
    expect(localDateTimeToIso("2026-09-30", "12:00 AM")).toBe("2026-09-30T07:00:00.000Z");
    expect(localDateTimeToIso("2026-09-30", "12:45 PM")).toBe("2026-09-30T19:45:00.000Z");
  });

  utcOnly("UTC: 2026-09-30 2:30 PM → 14:30Z", () => {
    expect(localDateTimeToIso("2026-09-30", "2:30 PM")).toBe("2026-09-30T14:30:00.000Z");
  });
});
