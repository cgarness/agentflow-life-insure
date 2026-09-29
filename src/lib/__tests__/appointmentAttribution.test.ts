/**
 * "Appointments Set" setter credit — the shared PostgREST expression (AGENT_RULES #23 / #38).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { appointmentSetterOrExpression } from "@/lib/appointmentAttribution";
import { DashboardQueryError } from "@/lib/dashboard-contact-identity";
import { ASSIGNEE_B, OTHER_C, SETTER_A, parseOrExpression } from "./appointmentRowsFixture";

describe("appointmentSetterOrExpression", () => {
  it("emits COALESCE(created_by, user_id) = id as PostgREST: created_by, else user_id only when created_by IS NULL", () => {
    expect(appointmentSetterOrExpression(SETTER_A)).toBe(
      `created_by.eq.${SETTER_A},and(created_by.is.null,user_id.eq.${SETTER_A})`,
    );
  });

  it("credits exactly one person per row, the same way the SQL COALESCE does", () => {
    const rows = [
      { created_by: SETTER_A, user_id: ASSIGNEE_B }, // delegated booking → the setter
      { created_by: null, user_id: ASSIGNEE_B }, // legacy writer gap → the approved fallback
      { created_by: SETTER_A, user_id: SETTER_A }, // self-booked → once
      { created_by: OTHER_C, user_id: SETTER_A }, // booked FOR A by C → C, never A
      { created_by: null, user_id: null }, // unattributable → nobody
    ];
    const coalesce = (r: { created_by: string | null; user_id: string | null }) => r.created_by ?? r.user_id;
    for (const person of [SETTER_A, ASSIGNEE_B, OTHER_C]) {
      const credited = parseOrExpression(appointmentSetterOrExpression(person));
      for (const r of rows) expect(credited(r), JSON.stringify({ person, r })).toBe(coalesce(r) === person);
    }
  });

  it.each([undefined, null, "", "not-a-uuid", `${SETTER_A},user_id.not.is.null`, 42])(
    "refuses %p before any filter is built (never a widened count)",
    (bad) => {
      expect(() => appointmentSetterOrExpression(bad)).toThrow(DashboardQueryError);
    },
  );
});
