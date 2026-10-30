import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Polish V2 §3.1 / §4.1 — one badge palette (always a text label, the approved colors) and the
 * approved vocabulary: CLEAR / CLEARED on Missed Calls and Callbacks, DISMISS / DISMISSED on Client
 * Milestones, and never "Handled" (or Done / Complete / Resolve) for hiding an alert.
 */
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/voicemail/VoicemailPlayer", () => ({ VoicemailPlayer: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DASHBOARD_STATUS, type DashboardStatusKey } from "@/components/dashboard/ui/dashboardTones";
import { DashboardStatusBadge } from "@/components/dashboard/ui/DashboardListRow";
import { CallbackRow } from "@/components/dashboard/callbacks/CallbackRow";
import { MissedCallRow } from "@/components/dashboard/missed-calls/MissedCallRow";
import { MilestoneRow } from "@/components/dashboard/milestones/MilestoneRow";
import { describeInboundCallOutcome } from "@/lib/inbound-call-labels";

afterEach(cleanup);

const APPROVED: Partial<Record<DashboardStatusKey, RegExp>> = {
  scheduled: /\bpurple-/, overdue: /\bred-/, dueToday: /\bblue-/, upcoming: /\bviolet-/,
  missed: /\bred-/, voicemail: /\bred-/, cleared: /\bemerald-/, dismissed: /\bemerald-/,
  firstPayment: /\bpink-/, birthday: /\brose-/, anniversary: /\bpurple-/,
};

describe("status badges", () => {
  it("every badge renders its text label and an icon; the approved statuses use the approved colors", () => {
    for (const [key, { label, className }] of Object.entries(DASHBOARD_STATUS) as Array<[DashboardStatusKey, { label: string; className: string }]>) {
      const { container, unmount } = render(<DashboardStatusBadge status={key} />);
      expect(container.textContent).toBe(label);
      expect(container.querySelector("svg")).not.toBeNull();
      if (APPROVED[key]) expect(className).toMatch(APPROVED[key]!);
      unmount();
    }
  });

  it("distinguishes visually close statuses by more than hue (Upcoming vs Scheduled, Voicemail vs Missed)", () => {
    expect(DASHBOARD_STATUS.upcoming.className).toContain("bg-transparent");
    expect(DASHBOARD_STATUS.scheduled.className).not.toContain("bg-transparent");
    expect(DASHBOARD_STATUS.voicemail.label).not.toBe(DASHBOARD_STATUS.missed.label);
    expect(DASHBOARD_STATUS.answeredOnMobile.className).toContain("bg-transparent");
  });
});

describe("vocabulary", () => {
  const handlers = { onCall: vi.fn(), onView: vi.fn(), onClear: vi.fn(), onUndo: vi.fn() };
  const callback = {
    key: "campaign:1", source: "campaign" as const, sourceRowId: "1", dueAt: "2026-10-29T15:00:00Z", contactId: "l1", contactType: "lead" as const,
    contactName: "Pat Lee", phone: "5551110000", note: null, canAct: true, blockedReason: null,
  };
  const missed = {
    key: "missed_call:1", id: "1", contactId: null, contactName: "Unknown", createdAt: "2026-10-29T18:00:00Z", phone: "+15550001111",
    contactType: null, voicemailId: "vm", clearance: null, missed_recipient_ids: [],
    outcome: describeInboundCallOutcome({ direction: "inbound", is_missed: true, missed_reason: "no_answer", voicemail_id: "vm" }),
  };
  const milestone = {
    key: "m1", kind: "client_birthday" as const, clientId: "c1", clientName: "Riley Stone", phone: "", eventKey: "birthday",
    occurrenceDate: "2026-11-03", occurrenceYear: 2026, daysUntil: 5, status: "pending" as const, followUp: false, reviewId: null,
    reviewUpdatedAt: null, remindAt: null, age: 66, policyYears: null, policyType: null, carrier: null, actionBlockedReason: null,
  };

  const everything = () => {
    const accessible = Array.from(document.querySelectorAll("[aria-label],[title]"))
      .map((el) => `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`).join(" ");
    return `${document.body.textContent} ${accessible}`;
  };

  it("Clear on Missed Calls and Callbacks, Dismiss on Milestones — and the history labels to match", () => {
    render(
      <MemoryRouter>
        <ul>
          <CallbackRow row={callback} bucket="overdue" clearable busy={false} handlers={handlers} />
          <CallbackRow row={{ ...callback, key: "campaign:2", clearance: { id: "d", sourceType: "campaign_callback", sourceId: "2", occurrenceAt: "o", clearedAt: "2026-10-29T19:00:00Z" } }}
            bucket="overdue" clearable busy={false} handlers={handlers} />
          <MissedCallRow item={missed} clearable busy={false} handlers={{ onCallBack: vi.fn(), onView: vi.fn(), onClear: vi.fn(), onUndo: vi.fn() }} />
          <MilestoneRow item={milestone} reviewsEnabled busy={false}
            handlers={{ onCall: vi.fn(), onView: vi.fn(), onDismiss: vi.fn(), onRemindLater: vi.fn(), onRestore: vi.fn() }} />
          <MilestoneRow item={{ ...milestone, key: "m2", status: "reviewed", reviewId: "r", reviewUpdatedAt: "2026-10-29T19:00:00Z" }} reviewsEnabled busy={false}
            handlers={{ onCall: vi.fn(), onView: vi.fn(), onDismiss: vi.fn(), onRemindLater: vi.fn(), onRestore: vi.fn() }} />
        </ul>
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Clear callback for Pat Lee" })).toHaveTextContent("Clear");
    expect(screen.getByRole("button", { name: "Clear missed call from +15550001111" })).toHaveTextContent("Clear");
    expect(screen.getByRole("button", { name: "Dismiss birthday for Riley Stone" })).toHaveTextContent("Dismiss");
    expect(document.querySelector('[data-status="cleared"]')).toHaveTextContent(/^Cleared /);
    expect(document.querySelector('[data-status="dismissed"]')).toHaveTextContent(/^Dismissed /);
    const text = everything();
    expect(text).not.toMatch(/handled/i);
    expect(text).not.toMatch(/\b(mark(ed)? (as )?(done|complete)|resolve[ds]?|completed callback)\b/i);
    // Milestones never say "Clear"; attention items never say "Dismiss".
    expect(screen.queryByRole("button", { name: /^Clear .*Riley Stone/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Dismiss .*(Pat Lee|\+1555)/ })).not.toBeInTheDocument();
  });
});
