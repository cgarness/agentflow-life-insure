/**
 * FloatingDialer Recent tab (Part B, B4-43): a failed recent-calls load is not an empty history.
 *
 * Pins: the existing recentError state renders "Couldn't load recent calls." and never
 * "No recent calls"; a successful empty list renders "No recent calls" and never the error;
 * rows render with neither message. The calls query itself is unchanged (still `calls`,
 * newest first, limited to 15).
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Reply = { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  callsReply: { data: [], error: null } as { data: unknown; error: unknown },
  callsQueries: [] as Array<Array<[string, unknown[]]>>,
  setCaller: vi.fn(), makeCall: vi.fn(), errors: [] as string[],
}));

const user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", first_name: "A", last_name: "Agent" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user, profile: user }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-a" }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: (message: string) => { h.errors.push(message); }, success: vi.fn() } }));
vi.mock("@/lib/win-trigger", () => ({ triggerWin: vi.fn() }));
vi.mock("@/lib/incomingCallAlerts", () => ({ primeIncomingCallAudio: vi.fn() }));
vi.mock("@/hooks/useInboundCallerDisplayLines", () => ({
  useInboundCallerDisplayLines: () => ({ primary: "", secondary: "" }),
  usefulIncomingSdkDisplayName: () => "",
}));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: () => null }));
vi.mock("@/contexts/TwilioContext", () => ({
  useTwilio: () => ({
    status: "ready", isReady: true, callState: "idle", callDuration: 0,
    lastCallDirection: "outbound", availableNumbers: [],
    selectedCallerNumber: "", makeCall: h.makeCall, hangUp: vi.fn(), initializeClient: vi.fn(),
    incomingCallAlerts: { optIn: true },
    setSelectedCallerNumber: h.setCaller, getSmartCallerId: async () => "",
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: (table: string) => {
      const chain: Array<[string, unknown[]]> = [];
      const reply = (): Reply => (table === "calls" ? h.callsReply : { data: [], error: null });
      const b: Record<string, unknown> = new Proxy({}, {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (r: Reply) => unknown, reject: (e: unknown) => unknown) => {
              if (table === "calls") h.callsQueries.push(chain);
              return Promise.resolve(reply()).then(resolve, reject);
            };
          }
          if (prop === "maybeSingle" || prop === "single") return async () => ({ data: null, error: null });
          return (...args: unknown[]) => {
            chain.push([String(prop), args]);
            return b;
          };
        },
      });
      return b;
    },
  },
}));

import FloatingDialer from "../FloatingDialer";
import { dispatchQuickCall, type QuickCallDetail } from "@/lib/quick-call";

beforeEach(() => {
  h.callsReply = { data: [], error: null };
  h.callsQueries = [];
  h.setCaller.mockReset(); h.makeCall.mockReset(); h.errors = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openRecentTab() {
  render(<FloatingDialer />);
  await act(async () => {
    window.dispatchEvent(new CustomEvent("toggle-floating-dialer"));
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Recent" }));
  });
}

it("shows the failed state, not the empty state, when the recent-calls load fails", async () => {
  h.callsReply = { data: null, error: { message: "private diagnostic" } };
  await openRecentTab();
  expect(await screen.findByText("Couldn't load recent calls.")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load recent calls.");
  expect(screen.queryByText("No recent calls")).not.toBeInTheDocument();
  expect(screen.queryByText("private diagnostic")).not.toBeInTheDocument();
  expect(screen.queryByText("Your call history will appear here")).not.toBeInTheDocument();
});

it("shows the empty state, not the failed state, after a successful empty load", async () => {
  await openRecentTab();
  expect(await screen.findByText("No recent calls")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText("Couldn't load recent calls.")).not.toBeInTheDocument();
  expect(screen.queryByText("Your call history will appear here")).not.toBeInTheDocument();
  // The calls query is the existing one: own/org-inbound scope, newest first, 15 rows.
  expect(h.callsQueries).toHaveLength(1);
  const methods = h.callsQueries[0].map(([m]) => m);
  expect(methods).toEqual(expect.arrayContaining(["select", "order", "limit", "or"]));
  expect(h.callsQueries[0].find(([m]) => m === "limit")?.[1]).toEqual([15]);
});

it("shows the calls and neither message when rows load", async () => {
  h.callsReply = {
    data: [{
      id: "call-1", contact_id: null, contact_name: "Pat Caller", contact_phone: "5551234567",
      disposition_name: null, started_at: "2026-10-11T12:00:00.000Z", created_at: "2026-10-11T12:00:00.000Z",
      contact_type: null, direction: "outbound", agent_id: user.id,
    }],
    error: null,
  };
  await openRecentTab();
  expect(await screen.findByText("Pat Caller")).toBeInTheDocument();
  expect(screen.queryByText("No recent calls")).not.toBeInTheDocument();
  expect(screen.queryByText("Couldn't load recent calls.")).not.toBeInTheDocument();
});

const scopedCall: QuickCallDetail = {
  contactId: "11111111-1111-4111-8111-111111111111", type: "lead", name: "Pat Caller",
  phone: "+15551112222", fromNumber: "+15559998888", expectedCallerNumber: "+15559998888",
};

async function openScopedCall(extra: Partial<QuickCallDetail> = {}) {
  render(<FloatingDialer />);
  await act(async () => { dispatchQuickCall({ ...scopedCall, ...extra }); });
}

it("shows the exact contact FROM without changing the global preference or starting a call", async () => {
  await openScopedCall();
  const control = screen.getByRole("combobox", { name: "Calling from" });
  expect(control).toHaveValue(scopedCall.expectedCallerNumber);
  expect(control).toBeDisabled();
  expect(h.setCaller).not.toHaveBeenCalled();
  expect(h.makeCall).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /^Call$/ })[0]); });
  expect(h.makeCall).toHaveBeenCalledWith(scopedCall.phone, scopedCall.fromNumber, expect.objectContaining({
    expectedCallerNumber: scopedCall.expectedCallerNumber, oneCallNumberId: undefined,
    contactId: scopedCall.contactId, contactType: "lead", isAttemptCurrent: expect.any(Function),
  }));
});

it("both Call buttons preserve the temporary choice and leave the global preference alone", async () => {
  await openScopedCall({ oneCallNumberId: "number-b" });
  await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /^Call$/ })[1]); });
  expect(h.makeCall).toHaveBeenCalledWith(expect.any(String), scopedCall.fromNumber, expect.objectContaining({
    expectedCallerNumber: scopedCall.expectedCallerNumber, oneCallNumberId: "number-b", contactId: scopedCall.contactId,
  }));
  const options = h.makeCall.mock.calls[0][2];
  expect(options.isAttemptCurrent()).toBe(true);
  await act(async () => { fireEvent.change(screen.getByPlaceholderText("Phone number"), { target: { value: "5553334444" } }); });
  expect(options.isAttemptCurrent()).toBe(false);
  expect(screen.getByRole("combobox", { name: "Calling from" })).not.toBeDisabled();
  expect(h.setCaller).not.toHaveBeenCalled();
});

it("refuses an expired origin visit before calling instead of using a global fallback", async () => {
  let current = true;
  await openScopedCall({ isSelectionCurrent: () => current });
  current = false;
  await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /^Call$/ })[0]); });
  expect(h.makeCall).not.toHaveBeenCalled();
  expect(h.setCaller).not.toHaveBeenCalled();
  expect(h.errors).toContain("The FROM number changed. Review it before calling.");
});

it("preserves legacy quick-call preference behavior when no expected caller is supplied", async () => {
  await openScopedCall();
  await act(async () => { dispatchQuickCall({ ...scopedCall, expectedCallerNumber: undefined, fromNumber: "+15556667777" }); });
  expect(h.setCaller).toHaveBeenCalledExactlyOnceWith("+15556667777");
  expect(screen.getByRole("combobox", { name: "Calling from" })).not.toBeDisabled();
});
