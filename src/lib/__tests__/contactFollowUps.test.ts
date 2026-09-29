/**
 * Contact follow-ups normalization: three real sources, ONE contact, the Dashboard callback contract.
 */
import { describe, expect, it, vi } from "vitest";

// contactFollowUps imports the Dashboard contract module, which creates the Supabase client at import.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import { APPOINTMENT_CALLBACK_TYPES } from "@/lib/dashboard-callbacks";
import {
  buildContactFollowUps,
  groupFollowUps,
  isContractAppointmentCallback,
  isMainDialerCallbackShadow,
  normalizeAppointmentFollowUp,
  normalizeCampaignCallbackFollowUp,
  normalizeTaskFollowUp,
  summarizeFollowUps,
  viewerTimeZoneLabel,
  type ContactRef,
  type FollowUpAppointmentRow,
  type FollowUpCampaignRow,
  type FollowUpTaskRow,
} from "@/lib/contactFollowUps";

const LEAD = "11111111-1111-4111-8111-111111111111";
const OTHER_CONTACT = "22222222-2222-4222-8222-222222222222";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const lead: ContactRef = { id: LEAD, type: "lead" };
const client: ContactRef = { id: LEAD, type: "client" };
const NOW = new Date(2026, 8, 28, 12, 0, 0); // local noon, Sep 28
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 8, 28 + dayOffset, h, m, 0).toISOString();

function apptRow(overrides: Partial<FollowUpAppointmentRow> = {}): FollowUpAppointmentRow {
  return {
    id: "appt-1",
    title: "Final Expense Consultation",
    type: "Sales Call",
    status: "Scheduled",
    start_time: at(14, 30),
    end_time: at(15, 0),
    notes: null,
    user_id: AGENT_A,
    created_by: ADMIN,
    contact_id: LEAD,
    ...overrides,
  };
}

function campaignRow(overrides: Partial<FollowUpCampaignRow> = {}): FollowUpCampaignRow {
  return {
    id: "cl-1",
    lead_id: LEAD,
    status: "Called",
    callback_due_at: at(16),
    scheduled_callback_at: at(16),
    callback_agent_id: AGENT_A,
    callback_note: "Call after 4",
    campaigns: { name: "Final Expense Q3" },
    ...overrides,
  };
}

function taskRow(overrides: Partial<FollowUpTaskRow> = {}): FollowUpTaskRow {
  return {
    id: "task-1",
    contact_id: LEAD,
    contact_type: "lead",
    assigned_to: AGENT_A,
    title: "Send quote",
    task_type: "Send Quote",
    due_date: new Date(2026, 8, 29).toISOString(),
    completed_at: null,
    notes: null,
    assignee: { first_name: "Alexa", last_name: "Stone" },
    ...overrides,
  };
}

describe("appointments", () => {
  it("an open appointment on the matching contact appears, assigned to user_id", () => {
    const item = normalizeAppointmentFollowUp(apptRow(), lead, NOW)!;
    expect(item).toMatchObject({
      kind: "appointment",
      source: "appointment",
      title: "Final Expense Consultation",
      assigneeId: AGENT_A,
      isOverdue: false,
      inProgress: false,
      statusLabel: "Scheduled",
    });
  });

  it("assignee falls back to created_by only for a NULL user_id row (invariant #22)", () => {
    expect(normalizeAppointmentFollowUp(apptRow({ user_id: null }), lead, NOW)!.assigneeId).toBe(ADMIN);
  });

  it("cross-contact rows never appear", () => {
    expect(normalizeAppointmentFollowUp(apptRow({ contact_id: OTHER_CONTACT }), lead, NOW)).toBeNull();
  });

  it.each(["Cancelled", "Completed", "No Show", "cancelled"])("%p is not an open follow-up", (status) => {
    expect(normalizeAppointmentFollowUp(apptRow({ status }), lead, NOW)).toBeNull();
  });

  it("carries notes", () => {
    expect(normalizeAppointmentFollowUp(apptRow({ notes: "Bring illustration" }), lead, NOW)!.note).toBe(
      "Bring illustration",
    );
  });

  it("D-17: a meeting is listed until it ends, shows 'In progress', and is never overdue", () => {
    const started = normalizeAppointmentFollowUp(apptRow({ start_time: at(11, 45), end_time: at(12, 30) }), lead, NOW)!;
    expect(started).toMatchObject({ inProgress: true, isOverdue: false, statusLabel: "In progress" });
    expect(normalizeAppointmentFollowUp(apptRow({ start_time: at(10), end_time: at(11) }), lead, NOW)).toBeNull();
  });

  it("D-17: without an end time a meeting stays listed until start + 30 min", () => {
    expect(normalizeAppointmentFollowUp(apptRow({ start_time: at(11, 40), end_time: null }), lead, NOW)).not.toBeNull();
    expect(normalizeAppointmentFollowUp(apptRow({ start_time: at(11, 30), end_time: null }), lead, NOW)).toBeNull();
  });
});

describe("non-campaign callbacks (appointments) — the Dashboard contract", () => {
  it("pins the contract literals", () => {
    expect([...APPOINTMENT_CALLBACK_TYPES]).toEqual(["Follow Up", "Call Back"]);
  });

  it.each(["Follow Up", "Call Back"])("a Scheduled %p appointment displays as Callback", (type) => {
    expect(normalizeAppointmentFollowUp(apptRow({ type }), lead, NOW)!.kind).toBe("callback");
  });

  it("parity: the card's callback predicate equals the Dashboard branch (type IN callback types AND status = 'Scheduled')", () => {
    const dashboardBranch = (r: { type: string | null; status: string | null }) =>
      (APPOINTMENT_CALLBACK_TYPES as readonly string[]).includes(r.type ?? "") && r.status === "Scheduled";
    const fixtures = [
      { type: "Follow Up", status: "Scheduled" },
      { type: "Follow Up", status: "Confirmed" },
      { type: "Call Back", status: "Scheduled" },
      { type: "Sales Call", status: "Scheduled" },
      { type: null, status: "Scheduled" },
      { type: "Follow Up", status: "Cancelled" },
    ];
    for (const f of fixtures) expect(isContractAppointmentCallback(f)).toBe(dashboardBranch(f));
  });

  it("a Confirmed callback-type row is not a pending callback (Dashboard parity, D-8)", () => {
    expect(normalizeAppointmentFollowUp(apptRow({ type: "Follow Up", status: "Confirmed" }), lead, NOW)).toBeNull();
  });

  it("an overdue callback stays listed and is flagged overdue", () => {
    const item = normalizeAppointmentFollowUp(apptRow({ type: "Follow Up", start_time: at(9), end_time: null }), lead, NOW)!;
    expect(item).toMatchObject({ kind: "callback", isOverdue: true });
  });

  it("D-7: the main Dialer's 'Callback' shadow row (non-callback type) is suppressed", () => {
    const shadow = apptRow({ title: "Callback", type: "Sales Call" });
    expect(isMainDialerCallbackShadow(shadow)).toBe(true);
    expect(normalizeAppointmentFollowUp(shadow, lead, NOW)).toBeNull();
  });

  it("D-7 is narrow: a 'Callback: Name' row re-typed to Sales Call stays an Appointment", () => {
    const item = normalizeAppointmentFollowUp(apptRow({ title: "Callback: Jane Doe", type: "Sales Call" }), lead, NOW)!;
    expect(item.kind).toBe("appointment");
  });

  it("a FloatingDialer quick-call callback (Follow Up, NULL user_id) is a Callback owned by its creator", () => {
    const item = normalizeAppointmentFollowUp(
      apptRow({ title: "Callback: Jane Doe", type: "Follow Up", user_id: null, created_by: AGENT_A, end_time: null }),
      lead,
      NOW,
    )!;
    expect(item).toMatchObject({ kind: "callback", assigneeId: AGENT_A });
  });
});

describe("campaign callbacks", () => {
  it("appears for the matching lead, titled with its campaign", () => {
    expect(normalizeCampaignCallbackFollowUp(campaignRow(), lead, NOW)).toMatchObject({
      kind: "callback",
      source: "campaign_lead",
      title: "Campaign callback · Final Expense Q3",
      assigneeId: AGENT_A,
      note: "Call after 4",
      statusLabel: "Pending",
    });
  });

  it("callback_due_at wins over scheduled_callback_at", () => {
    const item = normalizeCampaignCallbackFollowUp(campaignRow({ callback_due_at: at(16), scheduled_callback_at: at(9) }), lead, NOW)!;
    expect(item.dueAt).toBe(at(16));
    expect(item.isOverdue).toBe(false);
  });

  it("scheduled_callback_at is used only when callback_due_at is NULL", () => {
    const item = normalizeCampaignCallbackFollowUp(campaignRow({ callback_due_at: null, scheduled_callback_at: at(9) }), lead, NOW)!;
    expect(item.dueAt).toBe(at(9));
    expect(item.isOverdue).toBe(true);
  });

  it("no duplicate when both compatibility timestamps coexist: one row, one item", () => {
    const items = buildContactFollowUps({ contact: lead, appointments: [], campaign: [campaignRow()], tasks: [], now: NOW });
    expect(items).toHaveLength(1);
  });

  it.each(["DNC", "Completed", "Removed", "Failed", null])("terminal/NULL status %p is excluded", (status) => {
    expect(normalizeCampaignCallbackFollowUp(campaignRow({ status }), lead, NOW)).toBeNull();
  });

  it("cross-contact and non-lead contacts never get campaign rows", () => {
    expect(normalizeCampaignCallbackFollowUp(campaignRow({ lead_id: OTHER_CONTACT }), lead, NOW)).toBeNull();
    expect(normalizeCampaignCallbackFollowUp(campaignRow(), client, NOW)).toBeNull();
  });

  it("a row with no callback timestamp is not a follow-up", () => {
    expect(normalizeCampaignCallbackFollowUp(campaignRow({ callback_due_at: null, scheduled_callback_at: null }), lead, NOW)).toBeNull();
  });

  it("accepts the embed as an array", () => {
    expect(normalizeCampaignCallbackFollowUp(campaignRow({ campaigns: [{ name: "Q4" }] }), lead, NOW)!.title).toBe(
      "Campaign callback · Q4",
    );
  });
});

describe("tasks", () => {
  it("an open task appears, owner name from the embed", () => {
    expect(normalizeTaskFollowUp(taskRow(), lead, NOW)).toMatchObject({
      kind: "task",
      dateOnly: true,
      assigneeId: AGENT_A,
      assigneeName: "Alexa Stone",
      statusLabel: "Open",
      isOverdue: false,
    });
  });

  it("a completed task is not an open follow-up", () => {
    expect(normalizeTaskFollowUp(taskRow({ completed_at: "2026-09-28T10:00:00Z" }), lead, NOW)).toBeNull();
  });

  it("a task_type of 'Follow Up' stays a task", () => {
    expect(normalizeTaskFollowUp(taskRow({ task_type: "Follow Up" }), lead, NOW)!.kind).toBe("task");
  });

  it("cross-contact rows never appear (id or contact_type mismatch)", () => {
    expect(normalizeTaskFollowUp(taskRow({ contact_id: OTHER_CONTACT }), lead, NOW)).toBeNull();
    expect(normalizeTaskFollowUp(taskRow({ contact_type: "client" }), lead, NOW)).toBeNull();
  });

  it("TasksPanel parity: due today is 'Due today', not overdue; a past day is overdue", () => {
    expect(normalizeTaskFollowUp(taskRow({ due_date: new Date(2026, 8, 28).toISOString() }), lead, NOW)).toMatchObject({
      isOverdue: false,
      statusLabel: "Due today",
    });
    expect(normalizeTaskFollowUp(taskRow({ due_date: new Date(2026, 8, 27).toISOString() }), lead, NOW)!.isOverdue).toBe(true);
  });
});

describe("ordering, primary item and summary", () => {
  it("orders chronologically by rankAt with a deterministic tie-break", () => {
    const items = buildContactFollowUps({
      contact: lead,
      appointments: [apptRow({ id: "a2", start_time: at(16), end_time: at(16, 30) }), apptRow({ id: "a1" })],
      campaign: [campaignRow({ id: "c1", callback_due_at: at(16), scheduled_callback_at: null })],
      tasks: [taskRow({ id: "t1" })],
      now: NOW,
    });
    expect(items.map((i) => i.key)).toEqual(["appointment:a1", "campaign_lead:c1", "appointment:a2", "task:t1"]);
  });

  it("the brief's example: primary is the next item, '2 other follow-ups · 1 overdue'", () => {
    const items = buildContactFollowUps({
      contact: lead,
      appointments: [apptRow()],
      campaign: [campaignRow({ callback_due_at: at(9), scheduled_callback_at: null })],
      tasks: [taskRow()],
      now: NOW,
    });
    const summary = summarizeFollowUps(items, false);
    expect(summary.primary!.key).toBe("appointment:appt-1");
    expect(summary).toMatchObject({ total: 3, others: 2, overdue: 1, truncated: false });
  });

  it("with nothing actionable, the primary is the most recently due overdue item", () => {
    const items = buildContactFollowUps({
      contact: lead,
      appointments: [],
      campaign: [
        campaignRow({ id: "old", callback_due_at: at(8), scheduled_callback_at: null }),
        campaignRow({ id: "recent", callback_due_at: at(11), scheduled_callback_at: null }),
      ],
      tasks: [],
      now: NOW,
    });
    const summary = summarizeFollowUps(items, false);
    expect(summary.primary!.sourceRowId).toBe("recent");
    expect(summary).toMatchObject({ others: 1, overdue: 1 });
  });

  it("a task due today, alone, is the primary item (never the empty state)", () => {
    const items = buildContactFollowUps({
      contact: lead,
      appointments: [],
      campaign: [],
      tasks: [taskRow({ due_date: new Date(2026, 8, 28).toISOString() })],
      now: NOW,
    });
    expect(summarizeFollowUps(items, false).primary!.kind).toBe("task");
  });

  it("a task due today outranks tomorrow's appointment but follows today's timed items", () => {
    const items = buildContactFollowUps({
      contact: lead,
      appointments: [
        apptRow({ id: "tomorrow", start_time: at(9, 0, 1), end_time: at(10, 0, 1) }),
        apptRow({ id: "today", start_time: at(17), end_time: at(18) }),
      ],
      campaign: [],
      tasks: [taskRow({ due_date: new Date(2026, 8, 28).toISOString() })],
      now: NOW,
    });
    expect(items.map((i) => i.sourceRowId)).toEqual(["today", "task-1", "tomorrow"]);
  });

  it("an empty list summarizes to no primary and zero counts", () => {
    expect(summarizeFollowUps([], false)).toEqual({ primary: null, total: 0, others: 0, overdue: 0, truncated: false });
  });

  it("truncation is carried through", () => {
    expect(summarizeFollowUps([], true).truncated).toBe(true);
  });

  it("View all groups overdue (oldest first) before upcoming", () => {
    const items = buildContactFollowUps({
      contact: lead,
      appointments: [apptRow()],
      campaign: [
        campaignRow({ id: "b", callback_due_at: at(11), scheduled_callback_at: null }),
        campaignRow({ id: "a", callback_due_at: at(8), scheduled_callback_at: null }),
      ],
      tasks: [],
      now: NOW,
    });
    const { overdue, upcoming } = groupFollowUps(items);
    expect(overdue.map((i) => i.sourceRowId)).toEqual(["a", "b"]);
    expect(upcoming.map((i) => i.sourceRowId)).toEqual(["appt-1"]);
  });
});

describe("viewerTimeZoneLabel", () => {
  const IS_LA = Intl.DateTimeFormat().resolvedOptions().timeZone === "America/Los_Angeles";
  const laOnly = IS_LA ? it : it.skip;

  it("returns a short zone name", () => {
    expect(viewerTimeZoneLabel(new Date("2026-09-28T21:30:00Z")).length).toBeGreaterThan(0);
  });

  laOnly("follows DST at the given instant: PDT before Nov 1 2026, PST after", () => {
    expect(viewerTimeZoneLabel(new Date("2026-10-31T18:00:00Z"))).toBe("PDT");
    expect(viewerTimeZoneLabel(new Date("2026-11-02T18:00:00Z"))).toBe("PST");
  });
});
