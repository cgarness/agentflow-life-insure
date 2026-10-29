import { describe, expect, it } from "vitest";
import { addCalendarDays, daysBetween, localCalendarDateOfTimestamp, observedDate } from "@/lib/calendar-date";
import {
  computeMilestones,
  type MilestoneClientRow,
  type MilestoneOptions,
  type MilestoneReviewRow,
} from "@/lib/dashboard-milestones";
import { parseMilestoneConfig } from "@/lib/dashboard-milestones-config";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function client(overrides: Partial<MilestoneClientRow> = {}): MilestoneClientRow {
  return {
    id: C1,
    first_name: "Riley",
    last_name: "Stone",
    phone: "5551234567",
    created_at: "2025-01-10T15:00:00Z",
    date_of_birth: null,
    effective_date: null,
    draft_date: null,
    primary_policy_id: null,
    policy_type: "Term",
    carrier: "",
    policy_number: "",
    premium: 0,
    face_amount: 0,
    sold_date: null,
    custom_fields: null,
    ...overrides,
  };
}

/** A client that carries a primary policy (evidence: carrier) with the given effective date. */
function policyClient(effective: string, overrides: Partial<MilestoneClientRow> = {}) {
  return client({ carrier: "Mutual of Omaha", policy_type: "Final Expense", primary_policy_id: P1, effective_date: effective, ...overrides });
}

function review(overrides: Partial<MilestoneReviewRow>): MilestoneReviewRow {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    milestone_kind: "client_birthday",
    client_id: C1,
    event_key: "birthday",
    occurrence_year: 2026,
    occurrence_date: "2026-11-03",
    state: "reviewed",
    remind_at: null,
    updated_at: "2026-10-29T12:00:00Z",
    ...overrides,
  };
}

function opts(overrides: Partial<MilestoneOptions> = {}): MilestoneOptions {
  return {
    today: "2026-10-29",
    now: new Date("2026-10-29T18:00:00Z"),
    anniversaryWindowDays: 30,
    reviews: [],
    firstPaymentStart: "2026-10-29",
    // Deterministic: the test treats the stored timestamp's UTC date as the local date.
    localDateOf: (ts: string) => ts.slice(0, 10),
    ...overrides,
  };
}

const run = (rows: MilestoneClientRow[], o: Partial<MilestoneOptions> = {}) => computeMilestones(rows, opts(o)).items;

describe("calendar-date", () => {
  it("counts whole calendar days across DST changes", () => {
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2027-03-13", "2027-03-15")).toBe(2);
    expect(addCalendarDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("observes Feb 29 on Feb 28 in non-leap years only", () => {
    expect(observedDate(2027, 2, 29)).toBe("2027-02-28");
    expect(observedDate(2028, 2, 29)).toBe("2028-02-29");
    expect(observedDate(2100, 2, 29)).toBe("2100-02-28");
    expect(observedDate(2000, 2, 29)).toBe("2000-02-29");
  });

  it("returns null for an unparseable stored timestamp", () => {
    expect(localCalendarDateOfTimestamp("not a date")).toBeNull();
    expect(localCalendarDateOfTimestamp(null)).toBeNull();
  });
});

describe("client birthdays", () => {
  it("uses only client rows and shows the next 14 days inclusive", () => {
    const rows = [
      client({ id: C1, date_of_birth: "1960-10-29" }), // today
      client({ id: C2, date_of_birth: "1958-11-12" }), // day 14
      client({ id: "33333333-3333-4333-8333-333333333333", date_of_birth: "1958-11-13" }), // day 15
    ];
    const items = run(rows);
    expect(items.map((i) => [i.clientId, i.daysUntil, i.kind])).toEqual([
      [C1, 0, "client_birthday"],
      [C2, 14, "client_birthday"],
    ]);
    expect(items[0].age).toBe(66);
  });

  it("parses non-ISO stored dates of birth and ignores invalid or future ones", () => {
    const items = run([
      client({ id: C1, date_of_birth: "11/02/1961" }),
      client({ id: C2, date_of_birth: "02/31/1961" }),
      client({ id: P3, date_of_birth: "2027-11-01" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ clientId: C1, occurrenceDate: "2026-11-02", age: 65 });
  });

  it("rolls over the new year", () => {
    const items = run([client({ date_of_birth: "1970-01-05" })], { today: "2026-12-28" });
    expect(items[0]).toMatchObject({ occurrenceDate: "2027-01-05", occurrenceYear: 2027, daysUntil: 8 });
  });

  it("observes a Feb 29 birthday on Feb 28 in 2027 and on Feb 29 in 2028", () => {
    const row = client({ date_of_birth: "1960-02-29" });
    expect(run([row], { today: "2027-02-20" })[0]).toMatchObject({ occurrenceDate: "2027-02-28", age: 67 });
    expect(run([row], { today: "2028-02-20" })[0]).toMatchObject({ occurrenceDate: "2028-02-29", age: 68 });
  });
});

describe("policy anniversaries", () => {
  it("covers the primary and every additional policy through the normalized model", () => {
    const row = policyClient("2020-11-05", {
      custom_fields: {
        additional_policies: [
          { policyId: P2, policyType: "Whole Life", carrier: "Aetna", effectiveDate: "2023-11-10" },
          // Legacy entry: no stored identity, legacy sale-date key.
          { policyType: "Term", carrier: "Banner", issueDate: "2022-01-01", effectiveDate: "2024-11-20" },
          { policyType: "Term", carrier: "No date" },
        ],
      },
    });
    const items = run([row]);
    expect(items.map((i) => [i.eventKey, i.occurrenceDate, i.policyYears, i.carrier])).toEqual([
      [P1, "2026-11-05", 6, "Mutual of Omaha"],
      [P2, "2026-11-10", 3, "Aetna"],
      [null, "2026-11-20", 2, "Banner"],
    ]);
    expect(items[2].actionBlockedReason).toMatch(/no saved identity/);
  });

  it("falls back to the 'primary' key for a legacy primary policy without a stored identity", () => {
    const items = run([policyClient("2021-11-01", { primary_policy_id: null })]);
    expect(items[0]).toMatchObject({ eventKey: "primary", actionBlockedReason: null });
  });

  it("never treats the effective date itself as an anniversary", () => {
    expect(run([policyClient("2026-11-15")])).toEqual([]);
    expect(run([policyClient("2025-11-15")])[0]).toMatchObject({ occurrenceDate: "2026-11-15", policyYears: 1 });
  });

  it("shows an anniversary that falls today", () => {
    expect(run([policyClient("2019-10-29")])[0]).toMatchObject({ daysUntil: 0, policyYears: 7 });
  });

  it("applies the 30-day (widget) and 90-day (detail) windows inclusively", () => {
    const rows = [policyClient("2020-11-28"), policyClient("2020-11-29", { id: C2, primary_policy_id: P2 })];
    expect(run(rows).map((i) => i.daysUntil)).toEqual([30]);
    const wide = run(
      [policyClient("2020-01-27"), policyClient("2020-01-28", { id: C2, primary_policy_id: P2 })],
      { anniversaryWindowDays: 90 },
    );
    expect(wide.map((i) => i.daysUntil)).toEqual([90]);
  });

  it("skips clients without policy evidence (CSV phantoms) and counts malformed additional data", () => {
    const phantom = client({ effective_date: "2020-11-05" });
    const malformed = policyClient("2020-11-05", { id: C2, custom_fields: { additional_policies: "[object Object]" } });
    const result = computeMilestones([phantom, malformed], opts());
    expect(result.items.map((i) => i.clientId)).toEqual([C2]);
    expect(result.malformedPolicyClients).toBe(1);
  });

  it("never labels anything a renewal or expiration", () => {
    const item = run([policyClient("2020-11-05")])[0];
    expect(JSON.stringify(item).toLowerCase()).not.toMatch(/renew|expir/);
  });
});

describe("first payment reminders", () => {
  const draftClient = (draft: string, overrides: Partial<MilestoneClientRow> = {}) =>
    client({ draft_date: draft, created_at: "2026-10-01T15:00:00Z", ...overrides });

  it("appears 3 days before the Draft Date, not 4", () => {
    expect(run([draftClient("2026-11-02")])).toEqual([]);
    expect(run([draftClient("2026-11-01")])[0]).toMatchObject({ kind: "first_payment", daysUntil: 3, status: "pending" });
  });

  it("stays pending after the Draft Date until reviewed", () => {
    const row = draftClient("2026-11-01");
    expect(run([row], { today: "2026-11-01" })[0].daysUntil).toBe(0);
    expect(run([row], { today: "2026-11-11" })[0]).toMatchObject({ daysUntil: -10, status: "pending" });
  });

  it("creates no historical reminder for a Draft Date before go-live", () => {
    expect(run([draftClient("2026-10-28")])).toEqual([]);
  });

  it("keeps existing clients with a valid future Draft Date eligible", () => {
    const longStanding = draftClient("2026-10-31", { created_at: "2019-03-01T15:00:00Z" });
    expect(run([longStanding])[0]).toMatchObject({ kind: "first_payment", occurrenceDate: "2026-10-31" });
  });

  it("excludes a client entered after go-live whose Draft Date had already passed", () => {
    const enteredLate = draftClient("2026-11-02", { created_at: "2026-11-04T15:00:00Z" });
    expect(run([enteredLate], { today: "2026-11-04" })).toEqual([]);
  });

  it("is one-time: a reviewed reminder never returns, even when the Draft Date later moves", () => {
    const reviewed = review({ milestone_kind: "first_payment", event_key: "first_payment", occurrence_date: "2026-11-01", updated_at: "2026-11-01T12:00:00Z" });
    // Listed as reviewed for 30 days, then gone; a moved date does not re-arm it.
    expect(run([draftClient("2026-12-01")], { today: "2026-11-29", reviews: [reviewed] })[0].status).toBe("reviewed");
    expect(run([draftClient("2026-12-01")], { today: "2026-12-05", reviews: [reviewed] })).toEqual([]);
  });

  it("is off without reviews or without a valid start date (fail closed)", () => {
    expect(run([draftClient("2026-11-01")], { reviews: null })).toEqual([]);
    expect(run([draftClient("2026-11-01")], { firstPaymentStart: null })).toEqual([]);
  });

  it("never invents payment dates for additional policies", () => {
    const row = draftClient("2026-11-01", {
      custom_fields: { additional_policies: [{ policyId: P2, carrier: "Aetna", draftDate: "2026-10-30" }] },
    });
    expect(run([row]).filter((i) => i.kind === "first_payment")).toHaveLength(1);
  });
});

describe("review state", () => {
  const birthday = client({ date_of_birth: "1960-11-03" });

  it("hides nothing by itself: reviewed and snoozed items are returned with their status", () => {
    const reviewed = run([birthday], { reviews: [review({})] });
    expect(reviewed[0].status).toBe("reviewed");
    const snoozed = run([birthday], { reviews: [review({ state: "snoozed", remind_at: "2026-10-30T07:00:00Z" })] });
    expect(snoozed[0]).toMatchObject({ status: "snoozed", remindAt: "2026-10-30T07:00:00Z" });
  });

  it("returns a snoozed item to pending when its reminder time arrives", () => {
    const due = run([birthday], { reviews: [review({ state: "snoozed", remind_at: "2026-10-29T07:00:00Z" })] });
    expect(due[0].status).toBe("pending");
  });

  it("ignores a review recorded for a different date in the same year (edited date)", () => {
    const stale = review({ occurrence_date: "2026-11-04" });
    expect(run([birthday], { reviews: [stale] })[0].status).toBe("pending");
  });

  it("brings back a snoozed past anniversary as a follow-up at its reminder time (R3)", () => {
    const row = policyClient("2020-10-20");
    const snooze = review({
      milestone_kind: "policy_anniversary", event_key: P1, occurrence_date: "2026-10-20",
      state: "snoozed", remind_at: "2026-10-27T07:00:00Z",
    });
    const items = run([row], { reviews: [snooze] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ followUp: true, status: "pending", daysUntil: -9, policyYears: 6 });
    // Not yet due: listed as snoozed (detail view), not pending.
    const later = run([row], { reviews: [{ ...snooze, remind_at: "2026-11-02T07:00:00Z" }] });
    expect(later[0]).toMatchObject({ followUp: true, status: "snoozed" });
    // Reviewed past occurrences are done.
    expect(run([row], { reviews: [{ ...snooze, state: "reviewed", remind_at: null }] })).toEqual([]);
  });

  it("does not follow a snooze to an occurrence the client no longer has", () => {
    const snooze = review({
      milestone_kind: "policy_anniversary", event_key: P1, occurrence_date: "2026-10-20",
      state: "snoozed", remind_at: "2026-10-27T07:00:00Z",
    });
    expect(run([policyClient("2020-10-21")], { reviews: [snooze] })).toEqual([]);
  });

  it("orders pending first, past first-payment dates before upcoming events", () => {
    const rows = [
      client({ id: C1, date_of_birth: "1960-10-30" }),
      client({ id: C2, draft_date: "2026-10-29", created_at: "2026-10-01T00:00:00Z" }),
    ];
    const items = run(rows, { today: "2026-10-30" });
    expect(items.map((i) => i.kind)).toEqual(["first_payment", "client_birthday"]);
  });
});

describe("milestone config", () => {
  it("enables First Payment Reminders only with reviews on and a real start date", () => {
    expect(parseMilestoneConfig({})).toEqual({ reviewsEnabled: false, firstPaymentStart: null });
    expect(parseMilestoneConfig({ VITE_FIRST_PAYMENT_REMINDERS_START: "2026-11-02" }).firstPaymentStart).toBeNull();
    expect(
      parseMilestoneConfig({ VITE_DASHBOARD_MILESTONE_REVIEWS: "true", VITE_FIRST_PAYMENT_REMINDERS_START: "2026-02-30" }),
    ).toEqual({ reviewsEnabled: true, firstPaymentStart: null });
    expect(
      parseMilestoneConfig({ VITE_DASHBOARD_MILESTONE_REVIEWS: "true", VITE_FIRST_PAYMENT_REMINDERS_START: "2026-11-02" }),
    ).toEqual({ reviewsEnabled: true, firstPaymentStart: "2026-11-02" });
  });
});
