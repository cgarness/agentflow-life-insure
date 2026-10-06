import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
type Row = Record<string, unknown>;
type Query = { table: string; filters: Array<[string, unknown]> };
type Reply = { data: Row[] | null; error: { message: string } | null };
const h = vi.hoisted(() => ({
  rpc: vi.fn(), error: vi.fn(), converting: false, state: "idle", makeCall: vi.fn(), win: vi.fn(),
  organizationId: "org-a" as string | null, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  notes: false, callback: false, failedTable: "", empty: false,
  queries: [] as Query[], inserts: [] as Array<{ table: string; rows: Row[] }>,
  execute: vi.fn<(q: Query, reply: Reply) => Promise<Reply>>(),
  conversionSuccess: null as null | ((clientId: string) => void),
}));
const user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", first_name: "A", last_name: "Agent" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { ...user, id: h.userId }, profile: user }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.organizationId }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: h.error } }));
vi.mock("@/lib/win-trigger", () => ({ triggerWin: h.win }));
vi.mock("@/lib/incomingCallAlerts", () => ({ primeIncomingCallAudio: vi.fn() }));
vi.mock("@/hooks/useInboundCallerDisplayLines", () => ({ useInboundCallerDisplayLines: () => ({ primary: "", secondary: "" }), usefulIncomingSdkDisplayName: () => "" }));
vi.mock("@/components/shared/DateInput", () => ({
  DateInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <input type="date" aria-label="Callback date" value={value} onChange={e => onChange(e.target.value)} />,
}));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default:
  ({ open, onSuccess, onClose }: { open: boolean; onSuccess: (id: string) => void; onClose: () => void }) => {
    if (!open) return null;
    h.conversionSuccess = onSuccess;
    return <div role="dialog"><button onClick={() => { onSuccess("client-a"); onClose(); }}>Complete conversion</button></div>;
  },
}));
const init = vi.fn();
const smartId = async () => "+15559990000";
const numbers = [{ phone_number: "+15559990000", status: "active", assignment_type: "agency" }];
vi.mock("@/contexts/TwilioContext", () => ({ useTwilio: () => ({
  status: "ready", isReady: true, callState: h.state, callDuration: 3,
  lastCallDirection: "outbound", availableNumbers: numbers,
  selectedCallerNumber: "+15559990000", makeCall: h.makeCall, hangUp: vi.fn(), initializeClient: init,
  incomingCallAlerts: { optIn: true },
  setSelectedCallerNumber: vi.fn(), getSmartCallerId: smartId,
}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: h.rpc,
  from: (table: string) => {
    const query: Query = { table, filters: [] };
    function reply(): Reply {
      const rows: Row[] = table === "dispositions" ? (h.empty ? [] : ["a", "b"].map(org => ({
        id: "disp-" + org, organization_id: "org-" + org, name: "Result",
        color: org === "a" ? "#9CA3AF" : "#3B82F6", sort_order: 1,
        require_notes: h.notes, min_note_chars: h.notes ? 4 : 0,
        callback_scheduler: h.callback, pipeline_stage_id: h.converting ? "stage-" + org : null,
      }))) : table === "pipeline_stages" ? ["a", "b"].map(org => ({
        id: "stage-" + org, organization_id: "org-" + org, pipeline_type: "lead", convert_to_client: true,
      })) : table === "leads" ? [{
        id: "lead-a", organization_id: "org-a", first_name: "Jane", last_name: "Lead",
        phone: "5551234567", custom_fields: { retained: true },
      }] : [];
      return h.failedTable === table ? { data: null, error: { message: "private diagnostic" } }
        : { data: rows.filter(row => query.filters.every(([key, value]) => row[key] === value)), error: null };
    }
    const b = {
      select: () => b, in: () => b, not: () => b, order: () => b, limit: () => b, gte: () => b,
      eq: (key: string, value: unknown) => { query.filters.push([key, value]); return b; },
      insert: (rows: Row[]) => { h.inserts.push({ table, rows }); return b; },
      then: (resolve: (r: Reply) => unknown, reject: (e: unknown) => unknown) => {
        h.queries.push(query);
        return h.execute(query, reply()).then(resolve, reject);
      },
      maybeSingle: async () => {
        h.queries.push(query);
        const result = await h.execute(query, reply());
        return { ...result, data: result.data?.[0] ?? null };
      },
    };
    return b;
  },
} }));
import FloatingDialer from "../FloatingDialer";
beforeEach(() => {
  h.rpc.mockReset().mockResolvedValue({ data: { call_id: "call-a", contact_id: "lead-a", contact_type: "lead", dnc_suppressed: true, lock_released: true, replayed: false }, error: null });
  h.makeCall.mockReset().mockResolvedValue("call-a"); h.error.mockClear(); h.win.mockClear();
  h.state = "idle"; h.converting = false; h.notes = false; h.callback = false;
  h.failedTable = ""; h.empty = false; h.organizationId = "org-a"; h.userId = user.id;
  h.queries = []; h.inserts = []; h.conversionSuccess = null;
  h.execute.mockReset().mockImplementation(async (_query, reply) => reply);
});
afterEach(cleanup);
async function wrapUp(select = true) {
  const view = render(<FloatingDialer />);
  await act(async () => window.dispatchEvent(new CustomEvent("quick-call", { detail: { contactId: "lead-a", phone: "5551234567", name: "Jane Lead", type: "lead" } })));
  const callButton = (await screen.findAllByRole("button", { name: /^call$/i }))[0];
  await act(async () => { fireEvent.click(callButton); });
  await screen.findByRole("button", { name: /hang up/i });
  h.state = "ended";
  view.rerender(<FloatingDialer />);
  await screen.findByText("Call outcome");
  if (select) fireEvent.click(await screen.findByRole("button", { name: "Result" }));
  return view;
}
it("a failed core save keeps wrap-up and retries the same call without another call attempt", async () => {
  h.notes = true;
  await wrapUp();
  fireEvent.change(screen.getByPlaceholderText("Add notes..."), { target: { value: "Keep these notes" } });
  h.rpc.mockResolvedValueOnce({ data: null, error: { message: "DNC persistence failed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & Close" }));
  await waitFor(() => expect(h.error).toHaveBeenCalledWith("DNC persistence failed"));
  expect(screen.getByRole("button", { name: "Save & Close" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Save & Close" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Save & Close" })).toBeNull());
  expect(h.rpc.mock.calls.map(c => c[1].p_input.p_operation_id)).toEqual(["call-a", "call-a"]);
  expect(h.rpc.mock.calls.map(c => c[1].p_input.p_disposition_id)).toEqual(["disp-a", "disp-a"]);
  expect(h.rpc.mock.calls.map(c => c[1].p_input.p_notes)).toEqual(["Keep these notes", "Keep these notes"]);
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
  expect(h.rpc.mock.calls.map(c => c[1].p_input.p_converted_client_id)).toEqual(["client-a", "client-a"]);
  expect(h.win).not.toHaveBeenCalled(); // Modal owns the conversion win.
});

function save() { fireEvent.click(screen.getByRole("button", { name: "Save & Close" })); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function setCallback() {
  fireEvent.change(screen.getByLabelText("Callback date"), { target: { value: "2030-10-03" } });
  fireEvent.change(document.querySelector('input[type="time"]')!, { target: { value: "12:30" } });
}
it("shows only the current agency's same-label option and saves its UUID", async () => {
  await wrapUp();
  expect(screen.getAllByRole("button", { name: "Result" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Result" })).toHaveStyle({ backgroundColor: "#9CA3AF" });
  for (const q of h.queries.filter(q => ["dispositions", "pipeline_stages"].includes(q.table))) {
    expect(q.filters).toContainEqual(["organization_id", "org-a"]);
  }
  save();
  await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
  expect(h.rpc.mock.calls[0][1].p_input).toMatchObject({ p_call_id: "call-a", p_disposition_id: "disp-a" });
  expect(h.inserts).toEqual([]);
});
it.each(["dispositions", "pipeline_stages"])("blocks save on %s failure and recovers on Retry", async table => {
  h.failedTable = table;
  await wrapUp(false);
  expect(await screen.findByText("Couldn't load dispositions. Please retry.")).toBeVisible();
  expect(screen.queryByText("private diagnostic")).toBeNull();
  expect(screen.queryByRole("button", { name: "Result" })).toBeNull();
  expect(screen.getByRole("button", { name: "Save & Close" })).toBeDisabled();
  save();
  expect(h.rpc).not.toHaveBeenCalled();
  h.failedTable = "";
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  fireEvent.click(await screen.findByRole("button", { name: "Result" }));
  save();
  await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
});
it("offers a retry for empty configuration without inventing defaults", async () => {
  h.empty = true;
  await wrapUp(false);
  expect(await screen.findByText("No dispositions are configured for this agency.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save & Close" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  expect(h.rpc).not.toHaveBeenCalled();
});
it("withholds Save and options while pipeline metadata is loading", async () => {
  const pending = deferred<Reply>();
  h.execute.mockImplementation(async (q, reply) => q.table === "pipeline_stages" ? pending.promise : reply);
  await wrapUp(false);
  expect(screen.getByText("Loading dispositions…")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save & Close" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Result" })).toBeNull();
  await act(async () => pending.resolve({ data: [], error: null }));
  expect(await screen.findByRole("button", { name: "Result" })).toBeVisible();
});
it("hides agency A's draft in B, then requires a fresh selection before finishing A's call", async () => {
  h.notes = true;
  const view = await wrapUp();
  fireEvent.change(screen.getByPlaceholderText("Add notes..."), { target: { value: "Agency A private notes" } });
  await act(async () => { h.organizationId = "org-b"; view.rerender(<FloatingDialer />); });
  expect(screen.queryByDisplayValue("Agency A private notes")).toBeNull();
  expect(screen.queryByRole("button", { name: "Result" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save & Close" })).toBeNull();
  expect(h.rpc).not.toHaveBeenCalled();
  await act(async () => { h.organizationId = "org-a"; view.rerender(<FloatingDialer />); });
  await screen.findByRole("button", { name: "Result" });
  expect(screen.getByRole("button", { name: "Save & Close" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Result" }));
  expect(screen.getByPlaceholderText("Add notes...")).toHaveValue("Agency A private notes");
  save();
  await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
  expect(h.rpc.mock.calls[0][1].p_input.p_disposition_id).toBe("disp-a");
});
it("hides the old user's draft when only the authenticated account changes", async () => {
  h.notes = true;
  const view = await wrapUp();
  fireEvent.change(screen.getByPlaceholderText("Add notes..."), { target: { value: "Private draft" } });
  await act(async () => { h.userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; view.rerender(<FloatingDialer />); });
  expect(screen.queryByDisplayValue("Private draft")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save & Close" })).toBeNull();
  expect(h.rpc).not.toHaveBeenCalled();
});
it("does not continue a pending conversion lookup after the agency changes", async () => {
  h.converting = true;
  const view = await wrapUp();
  const pending = deferred<Reply>();
  h.execute.mockImplementation(async (q, reply) => q.table === "leads" ? pending.promise : reply);
  save();
  await waitFor(() => expect(h.queries.some(q => q.table === "leads")).toBe(true));
  await act(async () => { h.organizationId = "org-b"; view.rerender(<FloatingDialer />); });
  await act(async () => pending.resolve({ data: [{ id: "lead-a", first_name: "Jane", last_name: "Lead" }], error: null }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(h.rpc).not.toHaveBeenCalled();
});
it("refuses a stale conversion callback after returning A -> B -> A", async () => {
  h.converting = true;
  const view = await wrapUp();
  save();
  await screen.findByRole("button", { name: "Complete conversion" });
  const oldSuccess = h.conversionSuccess!;
  await act(async () => { h.organizationId = "org-b"; view.rerender(<FloatingDialer />); });
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => { h.organizationId = "org-a"; view.rerender(<FloatingDialer />); });
  await screen.findByRole("button", { name: "Result" });
  await act(async () => oldSuccess("stale-client"));
  expect(h.rpc).not.toHaveBeenCalled();
  expect(h.win).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("preserves callback validation, time, assignment and creator", async () => {
  h.callback = true;
  await wrapUp();
  save();
  expect(h.error).toHaveBeenCalledWith("Please select a callback date and time");
  expect(h.rpc).not.toHaveBeenCalled();
  setCallback();
  save();
  await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
  expect(h.rpc.mock.calls[0][1].p_input.p_callback_due_at).toBe(new Date("2030-10-03T12:30").toISOString());
  expect(h.rpc.mock.calls[0][0]).toBe("save_disposition_with_booking");
  expect(h.inserts).toEqual([]); // Server transaction owns the booking and setter credit.
});
it("does not run callback effects or dismiss wrap-up when a save resolves in a different scope", async () => {
  h.callback = true;
  const view = await wrapUp();
  setCallback();
  const pending = deferred<{ data: Record<string, unknown>; error: null }>();
  h.rpc.mockImplementationOnce(() => pending.promise);
  save();
  await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
  await act(async () => { h.organizationId = "org-b"; view.rerender(<FloatingDialer />); });
  await act(async () => pending.resolve({ data: {
    call_id: "call-a", contact_id: "lead-a", contact_type: "lead",
    dnc_suppressed: true, lock_released: true, replayed: false,
  }, error: null }));
  expect(h.inserts).toHaveLength(0);
  expect(screen.getByText("Call outcome")).toBeVisible();
  expect(h.win).not.toHaveBeenCalled();
});
it("does not duplicate a callback calendar entry for a replayed disposition", async () => {
  h.callback = true;
  await wrapUp();
  setCallback();
  h.rpc.mockResolvedValueOnce({ data: {
    call_id: "call-a", contact_id: "lead-a", contact_type: "lead",
    dnc_suppressed: true, lock_released: true, replayed: true,
  }, error: null });
  save();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Save & Close" })).toBeNull());
  expect(h.inserts).toHaveLength(0);
});
