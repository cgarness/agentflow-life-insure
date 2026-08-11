/**
 * Case E — CalendarPage carried the SAME raw-row defect as the deep-link page.
 *
 * `handleOpenContact` fetched `leads` with `select('*')` and stored the result as
 * `data as unknown as Lead` — a cast that was not true. `FullScreenContactView` reads
 * canonical camelCase, so opening a contact from the Calendar and pressing Call produced
 * the same `"undefined undefined"` snapshot in `calls.contact_name`.
 *
 * This mounts the REAL CalendarPage at `?contact=<id>` and asserts on the contact object
 * it actually hands to `FullScreenContactView`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, waitFor, cleanup } from "@testing-library/react";
import { contactDisplayName } from "@/lib/contact-name";

const LEAD_ID = "11111111-1111-1111-1111-111111111111";

/** Raw `leads` row exactly as `select('*')` returns it. */
const RAW_LEAD_ROW = {
  id: LEAD_ID,
  first_name: "Charlotte",
  last_name: "Kearney",
  phone: "5125550123",
  email: "charlotte@example.com",
  state: "TX",
  status: "New",
  lead_source: "Facebook Ads",
  assigned_agent_id: "aaaa0000-0000-0000-0000-000000000001",
  organization_id: "0f000000-0000-0000-0000-0000000000aa",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const h = vi.hoisted(() => ({
  capturedContact: null as Record<string, unknown> | null,
  capturedType: "" as string,
}));

vi.mock("@/contexts/CalendarContext", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCalendar: () => ({
    appointments: [],
    loading: false,
    addAppointment: vi.fn(),
    updateAppointment: vi.fn(),
    deleteAppointment: vi.fn(),
    fetchAppointments: vi.fn(async () => {}),
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "aaaa0000-0000-0000-0000-000000000001" } }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "0f000000-0000-0000-0000-0000000000aa" }),
}));
vi.mock("@/hooks/useAppointmentTypes", () => ({ useAppointmentTypes: () => ({ types: [] }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({
    formatDate: (d: Date) => String(d),
    formatDateTime: (d: Date) => String(d),
    formatTime: (d: Date) => String(d),
  }),
}));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/calendar/AppointmentModal", () => ({ default: () => null }));

/** Capture exactly what CalendarPage hands the contact view. */
vi.mock("@/components/contacts/FullScreenContactView", () => ({
  default: (props: { contact: Record<string, unknown>; type: string }) => {
    h.capturedContact = props.contact;
    h.capturedType = props.type;
    return null;
  },
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(`contact=${LEAD_ID}`), vi.fn()],
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/calendar", search: `?contact=${LEAD_ID}`, state: null, hash: "", key: "t" }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ["select", "eq", "gte", "lte", "or", "order", "limit", "insert", "update", "delete", "in", "not", "is"]) {
      q[m] = chain;
    }
    const single = () =>
      Promise.resolve(table === "leads" ? { data: RAW_LEAD_ROW, error: null } : { data: null, error: null });
    q.maybeSingle = single;
    q.single = single;
    q.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
    return q;
  };
  return {
    supabase: {
      from: (table: string) => makeQuery(table),
      functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    },
  };
});

import CalendarPage from "@/pages/CalendarPage";

beforeEach(() => {
  h.capturedContact = null;
  h.capturedType = "";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("E. CalendarPage hands FullScreenContactView a canonical identity", () => {
  it("marshals the raw snake_case lead row into the canonical camelCase shape", async () => {
    render(<CalendarPage />);

    await waitFor(() => expect(h.capturedContact).not.toBeNull(), { timeout: 4000 });

    expect(h.capturedContact?.firstName).toBe("Charlotte");
    expect(h.capturedContact?.lastName).toBe("Kearney");
    expect(h.capturedContact?.phone).toBe("5125550123");
    expect(h.capturedContact?.id).toBe(LEAD_ID);
    expect(h.capturedType).toBe("lead");
  });

  it("resolves to a real display name from the CANONICAL keys alone", async () => {
    render(<CalendarPage />);

    await waitFor(() => expect(h.capturedContact).not.toBeNull(), { timeout: 4000 });

    // Deliberately projected to the canonical keys only: `contactDisplayName` also reads
    // snake_case as a safety net, so passing the whole object would still pass against the
    // unmapped row and prove nothing about THIS page's boundary.
    const canonicalOnly = {
      firstName: h.capturedContact?.firstName,
      lastName: h.capturedContact?.lastName,
    };
    const dispatchedName = contactDisplayName(canonicalOnly);
    expect(dispatchedName).toBe("Charlotte Kearney");
    expect(dispatchedName).not.toBe("undefined undefined");
  });
});
