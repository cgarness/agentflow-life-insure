import { describe, expect, it } from "vitest";
import {
  applySnooze,
  isReminderRecipient,
  isReminderStillEligible,
  selectDueReminders,
  type ReminderCandidate,
  type ReminderState,
} from "@/lib/calendar/reminderEligibility";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGENT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const NOW = Date.parse("2026-09-28T21:00:00.000Z");
const MIN = 60 * 1000;

function appt(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    id: "appt-1",
    start_time: new Date(NOW + 5 * MIN).toISOString(),
    user_id: AGENT_A,
    created_by: ADMIN,
    raw_status: "Scheduled",
    ...overrides,
  };
}

const select = (list: ReminderCandidate[], userId: string, state: ReminderState = {}, leadTimeMinutes = 10, now = NOW) =>
  selectDueReminders(list, { userId, now, leadTimeMinutes, state });

describe("recipient = the assigned user only", () => {
  it("Agent A gets the reminder for an appointment an Admin booked for them", () => {
    expect(select([appt()], AGENT_A).due.map((a) => a.id)).toEqual(["appt-1"]);
  });

  it("the Admin who booked it does NOT", () => {
    expect(select([appt()], ADMIN).due).toEqual([]);
  });

  it("an unrelated org-visible appointment never reminds an Admin who holds org-wide rows", () => {
    expect(select([appt({ user_id: AGENT_B, created_by: AGENT_B })], ADMIN).due).toEqual([]);
  });

  it("self-assigned still works", () => {
    expect(select([appt({ user_id: ADMIN, created_by: ADMIN })], ADMIN).due).toHaveLength(1);
  });

  it("invariant #22 fallback: NULL user_id reminds its creator, and only its creator", () => {
    const quickCall = appt({ user_id: null, created_by: AGENT_B });
    expect(select([quickCall], AGENT_B).due).toHaveLength(1);
    expect(select([quickCall], ADMIN).due).toEqual([]);
  });

  it("reassignment A→B moves the recipient", () => {
    const before = appt({ user_id: AGENT_A });
    const after = appt({ user_id: AGENT_B });
    expect(isReminderRecipient(before, AGENT_A)).toBe(true);
    expect(isReminderRecipient(after, AGENT_A)).toBe(false);
    expect(isReminderRecipient(after, AGENT_B)).toBe(true);
  });
});

describe("status gate — raw DB status, open only", () => {
  it.each(["Cancelled", "Completed", "No Show", "cancelled", "no_show", "Rescheduled"])(
    "%p never reminds",
    (raw_status) => {
      expect(select([appt({ raw_status })], AGENT_A).due).toEqual([]);
    },
  );

  it("Confirmed reminds", () => {
    expect(select([appt({ raw_status: "Confirmed" })], AGENT_A).due).toHaveLength(1);
  });

  it("a missing raw status never reminds", () => {
    expect(select([appt({ raw_status: undefined })], AGENT_A).due).toEqual([]);
  });
});

describe("timing is unchanged", () => {
  it("fires at start - leadTime (inclusive) and not before", () => {
    const at = appt({ start_time: new Date(NOW + 10 * MIN).toISOString() });
    expect(select([at], AGENT_A, {}, 10).due).toHaveLength(1);
    const early = appt({ start_time: new Date(NOW + 10 * MIN + 1).toISOString() });
    expect(select([early], AGENT_A, {}, 10).due).toEqual([]);
  });

  it("still fires up to start + 30 min (inclusive), never after", () => {
    const edge = appt({ start_time: new Date(NOW - 30 * MIN).toISOString() });
    expect(select([edge], AGENT_A).due).toHaveLength(1);
    const tooOld = appt({ start_time: new Date(NOW - 30 * MIN - 1).toISOString() });
    expect(select([tooOld], AGENT_A).due).toEqual([]);
  });

  it("skips rows without a start time", () => {
    expect(select([appt({ start_time: undefined })], AGENT_A).due).toEqual([]);
  });

  it("fires once, then again only after a snooze expires", () => {
    const first = select([appt()], AGENT_A);
    expect(first.due).toHaveLength(1);
    expect(first.nextState["appt-1"]).toEqual({ shown: true, snoozeUntil: null });

    expect(select([appt()], AGENT_A, first.nextState).due).toEqual([]);

    const snoozed = applySnooze(first.nextState, "appt-1", NOW);
    expect(snoozed["appt-1"]).toEqual({ shown: true, snoozeUntil: NOW + 5 * MIN });
    expect(select([appt()], AGENT_A, snoozed, 10, NOW + 4 * MIN).due).toEqual([]);
    expect(select([appt()], AGENT_A, snoozed, 10, NOW + 5 * MIN).due).toHaveLength(1);
  });

  it("does not mutate the incoming state", () => {
    const state: ReminderState = {};
    select([appt()], AGENT_A, state);
    expect(state).toEqual({});
  });
});

describe("queue revalidation", () => {
  it("drops a reminder once the row is reassigned away, cancelled or gone", () => {
    expect(isReminderStillEligible("appt-1", [appt()], AGENT_A)).toBe(true);
    expect(isReminderStillEligible("appt-1", [appt({ user_id: AGENT_B })], AGENT_A)).toBe(false);
    expect(isReminderStillEligible("appt-1", [appt({ raw_status: "Cancelled" })], AGENT_A)).toBe(false);
    expect(isReminderStillEligible("appt-1", [], AGENT_A)).toBe(false);
  });
});
