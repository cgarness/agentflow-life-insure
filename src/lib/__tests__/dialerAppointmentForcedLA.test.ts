/**
 * Forced America/Los_Angeles run of the Main-Dialer appointment instant contract (root plan §19).
 *
 * A naive offset-less `YYYY-MM-DDTHH:mm:ss` regression is already caught in ANY zone, UTC included, by
 * saveAppointmentPayload.test.ts and dialerAppointmentSave.test.tsx (offset guard + exact ISO equality).
 * This file protects real Pacific / DST behaviour: the LA-literal checks elsewhere skip unless the whole suite
 * runs under `TZ=America/Los_Angeles`, and no CI runs vitest, so a UTC run alone cannot tell a correct local
 * instant from a helper that treats the wall-clock as UTC (e.g. appends "Z"). This file pins the zone itself:
 * Vitest 3 runs each test file in its own forked process and Node applies a runtime `TZ` change, so the
 * override is isolated to this file. The first test proves the override is in effect.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.TZ = "America/Los_Angeles";
});

const { state } = vi.hoisted(() => ({
  state: { inserts: [] as Array<{ table: string; payload: Record<string, unknown> }> },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        state.inserts.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  },
}));

import { localDateTimeToIso } from "@/lib/calendar/localDateTime";
import { saveAppointment } from "@/lib/dialer-api";

beforeEach(() => {
  state.inserts = [];
});

describe("forced America/Los_Angeles", () => {
  it("the zone override is in effect (precondition for every literal below)", () => {
    expect(new Date(2026, 9, 15, 14, 30).toISOString()).toBe("2026-10-15T21:30:00.000Z");
    expect(new Date(2026, 11, 15, 14, 30).toISOString()).toBe("2026-12-15T22:30:00.000Z");
  });

  it("helper: PDT, PST, day rollover, DST gap and overlap", () => {
    expect(localDateTimeToIso("2026-09-30", "2:30 PM")).toBe("2026-09-30T21:30:00.000Z");
    expect(localDateTimeToIso("2026-12-15", "2:30 PM")).toBe("2026-12-15T22:30:00.000Z");
    expect(localDateTimeToIso("2026-10-31", "11:30 PM")).toBe("2026-11-01T06:30:00.000Z");
    expect(localDateTimeToIso("2027-03-14", "2:30 AM")).toBe("2027-03-14T10:30:00.000Z");
    expect(localDateTimeToIso("2026-11-01", "1:30 AM")).toBe("2026-11-01T08:30:00.000Z");
  });

  it("saveAppointment stores 2:30 PM PDT as 21:30Z (never the naive 14:30) with created_by", async () => {
    await saveAppointment(
      {
        master_lead_id: "c0000000-0000-4000-8000-00000000000c",
        campaign_lead_id: "d0000000-0000-4000-8000-00000000000d",
        agent_id: "b0000000-0000-4000-8000-00000000000b",
        campaign_id: "e0000000-0000-4000-8000-00000000000e",
        title: "Callback",
        date: "2026-10-15",
        time: "2:30 PM",
        end_time: "",
        notes: "",
      },
      "a0000000-0000-4000-8000-00000000000a",
    );
    const appt = state.inserts.find((i) => i.table === "appointments")!.payload;
    expect(appt.start_time).toBe("2026-10-15T21:30:00.000Z");
    expect(appt.created_by).toBe("b0000000-0000-4000-8000-00000000000b");
  });
});
