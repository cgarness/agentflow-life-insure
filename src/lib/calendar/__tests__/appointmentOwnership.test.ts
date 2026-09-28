import { describe, expect, it } from "vitest";
import {
  OPEN_APPOINTMENT_STATUSES,
  appointmentResponsibleUserId,
  buildAppointmentInsertOwnership,
  isAppointmentResponsibleUser,
  isOpenAppointmentStatus,
  resolveAppointmentAssignee,
} from "@/lib/calendar/appointmentOwnership";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGENT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORG = "11111111-1111-4111-8111-111111111111";

describe("resolveAppointmentAssignee — an explicit assignee is never rewritten", () => {
  it("keeps an explicit assignee", () => {
    expect(resolveAppointmentAssignee(AGENT_A, ADMIN)).toBe(AGENT_A);
  });

  it.each([undefined, null, "", "   ", 42, {}])("falls back to the scheduler for %p", (explicit) => {
    expect(resolveAppointmentAssignee(explicit, ADMIN)).toBe(ADMIN);
  });
});

describe("buildAppointmentInsertOwnership", () => {
  it("Admin books for Agent A: user_id = A, created_by = Admin, organization stamped", () => {
    expect(
      buildAppointmentInsertOwnership({ explicitAssigneeId: AGENT_A, creatorUserId: ADMIN, organizationId: ORG }),
    ).toEqual({ user_id: AGENT_A, created_by: ADMIN, organization_id: ORG });
  });

  it("self-assignment when no assignee is supplied", () => {
    expect(
      buildAppointmentInsertOwnership({ explicitAssigneeId: undefined, creatorUserId: AGENT_A, organizationId: ORG }),
    ).toEqual({ user_id: AGENT_A, created_by: AGENT_A, organization_id: ORG });
  });
});

describe("responsible user — invariant #22 (user_id wins; created_by only when user_id IS NULL)", () => {
  it("user_id is authoritative whenever populated", () => {
    expect(appointmentResponsibleUserId({ user_id: AGENT_A, created_by: ADMIN })).toBe(AGENT_A);
  });

  it("created_by is the fallback only for a NULL user_id row (quick-call callback)", () => {
    expect(appointmentResponsibleUserId({ user_id: null, created_by: AGENT_B })).toBe(AGENT_B);
  });

  it("no owner at all is null", () => {
    expect(appointmentResponsibleUserId({ user_id: null, created_by: null })).toBeNull();
    expect(appointmentResponsibleUserId(null)).toBeNull();
  });

  it("created_by never rescues a row whose user_id belongs to someone else", () => {
    expect(isAppointmentResponsibleUser({ user_id: AGENT_A, created_by: ADMIN }, ADMIN)).toBe(false);
    expect(isAppointmentResponsibleUser({ user_id: AGENT_A, created_by: ADMIN }, AGENT_A)).toBe(true);
  });

  it("an empty viewer id is never responsible", () => {
    expect(isAppointmentResponsibleUser({ user_id: null, created_by: null }, "")).toBe(false);
    expect(isAppointmentResponsibleUser({ user_id: "", created_by: "" }, undefined)).toBe(false);
  });
});

describe("open statuses", () => {
  it("is exactly Scheduled + Confirmed", () => {
    expect([...OPEN_APPOINTMENT_STATUSES]).toEqual(["Scheduled", "Confirmed"]);
  });

  it.each(["Scheduled", "Confirmed", " scheduled ", "CONFIRMED"])("%p is open", (status) => {
    expect(isOpenAppointmentStatus(status)).toBe(true);
  });

  it.each(["Cancelled", "cancelled", "Completed", "No Show", "no_show", "Rescheduled", "", null, undefined])(
    "%p is not open",
    (status) => {
      expect(isOpenAppointmentStatus(status)).toBe(false);
    },
  );
});
