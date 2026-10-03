import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ rpc: vi.fn(), error: vi.fn(), converting: false, state: "idle", makeCall: vi.fn(), win: vi.fn() }));
const user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", first_name: "A", last_name: "Agent" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user, profile: user }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-a" }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: h.error } }));
vi.mock("@/lib/win-trigger", () => ({ triggerWin: h.win }));
vi.mock("@/lib/incomingCallAlerts", () => ({ primeIncomingCallAudio: vi.fn() }));
vi.mock("@/hooks/useInboundCallerDisplayLines", () => ({ useInboundCallerDisplayLines: () => ({ primary: "", secondary: "" }), usefulIncomingSdkDisplayName: () => "" }));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: ({ open, onSuccess, onClose }: any) => open ? <button onClick={() => { onSuccess("client-a"); onClose(); }}>Complete conversion</button> : null }));
const init = vi.fn();
vi.mock("@/contexts/TwilioContext", () => ({ useTwilio: () => ({
  status: "ready", isReady: true, callState: h.state, callDuration: 3,
  lastCallDirection: "outbound", availableNumbers: [{ phone_number: "+15559990000", status: "active", assignment_type: "agency" }],
  selectedCallerNumber: "+15559990000", makeCall: h.makeCall, hangUp: vi.fn(), initializeClient: init,
  incomingCallAlerts: { optIn: true },
  setSelectedCallerNumber: vi.fn(), getSmartCallerId: async () => "+15559990000",
}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: h.rpc,
  from: (table: string) => {
    const rows = table === "dispositions" ? [{ id: "disp", name: "Result", require_notes: false, min_note_chars: 0, pipeline_stage_id: h.converting ? "stage" : null }]
      : table === "pipeline_stages" ? [{ id: "stage", convert_to_client: true }]
      : table === "leads" ? [{ id: "lead-a", first_name: "Jane", last_name: "Lead", phone: "5551234567", custom_fields: { retained: true } }] : [];
    const b: any = { then: (r: any) => Promise.resolve({ data: rows, error: null }).then(r), maybeSingle: async () => ({ data: rows[0] ?? null, error: null }) };
    for (const m of ["select", "eq", "in", "not", "order", "limit", "gte", "insert"]) b[m] = () => b;
    return b;
  },
} }));
import FloatingDialer from "../FloatingDialer";
beforeEach(() => {
  h.rpc.mockReset().mockResolvedValue({ data: { call_id: "call-a", contact_id: "lead-a", contact_type: "lead", dnc_suppressed: true, lock_released: true, replayed: false }, error: null });
  h.makeCall.mockReset().mockResolvedValue("call-a"); h.error.mockClear(); h.win.mockClear();
  h.state = "idle"; h.converting = false;
});
afterEach(cleanup);
async function wrapUp() {
  const view = render(<FloatingDialer />);
  await act(async () => window.dispatchEvent(new CustomEvent("quick-call", { detail: { contactId: "lead-a", phone: "5551234567", name: "Jane Lead", type: "lead" } })));
  fireEvent.click((await screen.findAllByRole("button", { name: /^call$/i }))[0]);
  await screen.findByRole("button", { name: /hang up/i });
  h.state = "ended";
  view.rerender(<FloatingDialer />);
  fireEvent.click(await screen.findByRole("button", { name: "Result" }));
}
it("a failed core save keeps wrap-up and retries the same call without another call attempt", async () => {
  await wrapUp();
  h.rpc.mockResolvedValueOnce({ data: null, error: { message: "DNC persistence failed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & Close" }));
  await waitFor(() => expect(h.error).toHaveBeenCalledWith("DNC persistence failed"));
  expect(screen.getByRole("button", { name: "Save & Close" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Save & Close" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Save & Close" })).toBeNull());
  expect(h.rpc.mock.calls.map(c => c[1].p_operation_id)).toEqual(["call-a", "call-a"]);
  expect(h.makeCall).toHaveBeenCalledTimes(1);
});
it("a converting disposition waits for ConvertLeadModal and retains that client through persistence failure", async () => {
  h.converting = true; await wrapUp();
  fireEvent.click(screen.getByRole("button", { name: "Save & Close" }));
  const convert = await screen.findByRole("button", { name: "Complete conversion" });
  expect(h.rpc).not.toHaveBeenCalled();
  h.rpc.mockResolvedValueOnce({ data: null, error: { message: "retry" } });
  fireEvent.click(convert);
  await waitFor(() => expect(h.error).toHaveBeenCalledWith("retry"));
  fireEvent.click(screen.getByRole("button", { name: "Save & Close" }));
  await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(2));
  expect(h.rpc.mock.calls.map(c => c[1].p_converted_client_id)).toEqual(["client-a", "client-a"]);
  expect(h.win).not.toHaveBeenCalled(); // Modal owns the conversion win.
});
