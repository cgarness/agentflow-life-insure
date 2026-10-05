/**
 * dialer-api `saveAppointment` — the Main Dialer's single appointment / callback-shadow writer.
 *
 * Contract (implementation_plan.md root §19):
 *   - `start_time` / `end_time` are ABSOLUTE instants of the user's local wall-clock (never a bare
 *     `YYYY-MM-DDTHH:mm:ss`, which Postgres `timestamptz` reads as UTC — 7 h early in PDT);
 *   - `user_id` = `created_by` = the dialing agent (`agent_id`), so the canonical "Appointments Set"
 *     attribution `COALESCE(created_by, user_id)` no longer relies on the legacy fallback;
 *   - organization, "Scheduled" status, contact identity, title/notes and the activity row are unchanged,
 *     and NO `type` is written (the callback shadow's suppression relies on the DB default);
 *   - invalid input throws BEFORE any write; a database error throws.
 * The Supabase client is mocked, so this suite needs no `.env`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    inserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
    failTable: null as string | null,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (_name: string, args: any) => {
      state.inserts.push({ table: "appointments", payload: args.p_appointment });
      return Promise.resolve(state.failTable === "appointments" ? { data: null, error: {message: "boom:appointments"} } : { data: {id: "booking", booking_request_id: args.p_request_id, ...args.p_appointment}, error: null });
    },
  },
}));

import { saveAppointment } from "@/lib/dialer-api";

const ORG = "a0000000-0000-4000-8000-00000000000a";
const AGENT = "b0000000-0000-4000-8000-00000000000b";
const LEAD = "c0000000-0000-4000-8000-00000000000c";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const laOnly = TZ === "America/Los_Angeles" ? it : it.skip;

/** An offset-bearing ISO instant. An offset-less string must fail: JS would parse it as LOCAL time and
 *  hide the bug, while Postgres timestamptz reads it as UTC. */
const ABSOLUTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/;

function base(overrides: Partial<Parameters<typeof saveAppointment>[0]> = {}): Parameters<typeof saveAppointment>[0] {
  return {
    request_id: "f0000000-0000-4000-8000-00000000000f",
    master_lead_id: LEAD,
    campaign_lead_id: "d0000000-0000-4000-8000-00000000000d",
    agent_id: AGENT,
    campaign_id: "e0000000-0000-4000-8000-00000000000e",
    title: "Callback",
    date: "2026-10-15",
    time: "2:30 PM",
    end_time: "",
    notes: "call back after lunch",
    ...overrides,
  };
}

const appointmentInserts = () => state.inserts.filter((i) => i.table === "appointments");
const activityInserts = () => state.inserts.filter((i) => i.table === "contact_activities");

beforeEach(() => {
  state.inserts = [];
  state.failTable = null;
});

describe("saveAppointment payload", () => {
  it("writes one appointment with absolute start/end instants of the local wall-clock", async () => {
    await saveAppointment(base({ title: "Call with Jane", time: "2:30 PM", end_time: "3:00 PM" }), ORG);
    expect(appointmentInserts()).toHaveLength(1);
    const p = appointmentInserts()[0].payload;
    expect(p.start_time).toMatch(ABSOLUTE_ISO);
    expect(p.end_time).toMatch(ABSOLUTE_ISO);
    expect(p.start_time).toBe(new Date(2026, 9, 15, 14, 30).toISOString());
    expect(p.end_time).toBe(new Date(2026, 9, 15, 15, 0).toISOString());
  });

  it("stores end_time null when no end time is given (callback shadow)", async () => {
    await saveAppointment(base(), ORG);
    const p = appointmentInserts()[0].payload;
    expect(p.start_time).toMatch(ABSOLUTE_ISO);
    expect(p.end_time).toBeNull();
  });

  it("stamps user_id AND created_by with the dialing agent", async () => {
    await saveAppointment(base(), ORG);
    const p = appointmentInserts()[0].payload;
    expect(p.user_id).toBe(AGENT);
    expect(p).not.toHaveProperty("created_by");
  });

  it("keeps organization, Scheduled status, contact identity, title and notes — and writes no type", async () => {
    await saveAppointment(base(), ORG);
    const p = appointmentInserts()[0].payload;
    expect(p).not.toHaveProperty("organization_id");
    expect(p.status).toBe("Scheduled");
    expect(p.contact_id).toBe(LEAD);
    expect(p.title).toBe("Callback");
    expect(p.notes).toBe("call back after lunch");
    expect(p).not.toHaveProperty("type");
    expect(Object.keys(p).sort()).toEqual(
      ["contact_id", "end_time", "notes", "start_time", "status", "title", "user_id"].sort(),
    );
  });

  it("delegates appointment and activity to one atomic service (no second browser write)", async () => {
    await saveAppointment(base(), ORG);
    expect(state.inserts.map(i => i.table)).toEqual(["appointments"]);
    expect(activityInserts()).toHaveLength(0);
  });

  it("accepts a 24-hour HH:mm time", async () => {
    await saveAppointment(base({ time: "14:30" }), ORG);
    expect(appointmentInserts()[0].payload.start_time).toBe(new Date(2026, 9, 15, 14, 30).toISOString());
  });

  it("throws BEFORE any write on an invalid date or time", async () => {
    await expect(saveAppointment(base({ time: "not a time" }), ORG)).rejects.toThrow(/nothing was saved/i);
    await expect(saveAppointment(base({ date: "2026-02-31" }), ORG)).rejects.toThrow(/nothing was saved/i);
    await expect(saveAppointment(base({ end_time: "25:99" }), ORG)).rejects.toThrow(/nothing was saved/i);
    expect(state.inserts).toHaveLength(0);
  });

  it("throws on an appointments insert error and writes no activity row", async () => {
    state.failTable = "appointments";
    await expect(saveAppointment(base(), ORG)).rejects.toThrow("boom:appointments");
    expect(activityInserts()).toHaveLength(0);
  });

  laOnly("PDT: 2:30 PM on 2026-10-15 is stored as 21:30Z, not the naive 14:30", async () => {
    await saveAppointment(base(), ORG);
    expect(appointmentInserts()[0].payload.start_time).toBe("2026-10-15T21:30:00.000Z");
  });

  laOnly("PST: 2:30 PM on 2026-12-15 is stored as 22:30Z", async () => {
    await saveAppointment(base({ date: "2026-12-15" }), ORG);
    expect(appointmentInserts()[0].payload.start_time).toBe("2026-12-15T22:30:00.000Z");
  });
});
