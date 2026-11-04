import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ response: null as unknown, calls: [] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args: unknown) => { h.calls.push([name, args]); return Promise.resolve(h.response); } },
}));
import { OUTCOME_NOT_SAVED, OUTCOME_UNAVAILABLE, appointmentOutcomeMessage, recordAppointmentOutcome } from "@/lib/appointmentOutcome";
import { canRecordAppointmentOutcome, isPastDueOpenSlotMove } from "@/lib/appointmentOutcomeGate";

const NOW = new Date("2026-11-04T12:00:00Z");
const ID = "00000000-0000-4000-8000-0000000000a1";
describe("appointment outcome gate (D4 §4)", () => {
  it("offers Held / No show only for an originally open slot whose start has passed", () => {
    expect(canRecordAppointmentOutcome({ status: "Scheduled", startTime: "2026-11-04T11:00:00Z" }, NOW)).toBe(true);
    expect(canRecordAppointmentOutcome({ status: " confirmed ", startTime: "2026-11-04T12:00:00Z" }, NOW)).toBe(true);
    expect(canRecordAppointmentOutcome({ status: "Scheduled", startTime: "2026-11-04T13:00:00Z" }, NOW)).toBe(false);
    for (const status of ["Completed", "No Show", "Cancelled", null]) expect(canRecordAppointmentOutcome({ status, startTime: "2026-11-01T00:00:00Z" }, NOW)).toBe(false);
    expect(canRecordAppointmentOutcome({ status: "Scheduled", startTime: null }, NOW)).toBe(false);
  });
  it("nudges (never blocks) a move of a past-due open slot", () => {
    expect(isPastDueOpenSlotMove({ status: "Scheduled", startTime: "2026-11-03T00:00:00Z" }, "2026-11-05T00:00:00Z", NOW)).toBe(true);
    expect(isPastDueOpenSlotMove({ status: "Scheduled", startTime: "2026-11-05T00:00:00Z" }, "2026-11-06T00:00:00Z", NOW)).toBe(false);
  });
});

describe("appointment outcome adapter", () => {
  it("maps refusals to 'temporarily unavailable' and lock or timeout to 'not saved'", () => {
    expect(["PT409", "42501", "22023"].map((code) => appointmentOutcomeMessage({ code }))).toEqual([OUTCOME_UNAVAILABLE, OUTCOME_UNAVAILABLE, OUTCOME_UNAVAILABLE]);
    expect(appointmentOutcomeMessage({ code: "42883", message: "permission denied for function record_appointment_outcome" })).toBe(OUTCOME_UNAVAILABLE);
    expect(["55P03", "57014"].map((code) => appointmentOutcomeMessage({ code }))).toEqual([OUTCOME_NOT_SAVED, OUTCOME_NOT_SAVED]);
    expect(OUTCOME_UNAVAILABLE).toBe("Outcome recording is temporarily unavailable");
    expect(OUTCOME_NOT_SAVED).toBe("The outcome wasn't saved. Try again.");
  });
  it("sends the exact RPC arguments and parses the result", async () => {
    h.response = { data: { appointment_id: ID, request_id: ID, outcome: "held", status: "Completed", start_time: "2026-11-04T11:00:00Z" }, error: null };
    const result = await recordAppointmentOutcome({ requestId: ID, appointmentId: ID, expectedStart: "2026-11-04T11:00:00Z", outcome: "held" });
    expect(result.status).toBe("Completed");
    expect(h.calls.at(-1)).toEqual(["record_appointment_outcome", { p_request_id: ID, p_appointment_id: ID, p_expected_start: "2026-11-04T11:00:00Z", p_outcome: "held" }]);
    h.response = { data: null, error: { code: "PT409", message: "changed" } };
    await expect(recordAppointmentOutcome({ requestId: ID, appointmentId: ID, expectedStart: "x", outcome: "no_show" })).rejects.toThrow(OUTCOME_UNAVAILABLE);
  });
});
