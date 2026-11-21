// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NumberSetupStatus } from "../NumberSetupStatus";
import { NumberManagementSection, type PhoneNumberRow } from "../NumberManagementSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { type NumberSetupRow, useNumberSetupStatus } from "../useNumberSetupStatus";
import type { PurchaseScope } from "@/lib/phone-number-purchase";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: scope.actor_id }, realProfile: { id: scope.actor_id, organization_id: scope.organization_id, role: "Admin", status: "Active" },
    profile: { role: "Admin" }, isImpersonating: false,
  }),
}));
const scope: PurchaseScope = {
  organization_id: "11111111-1111-4111-8111-111111111111",
  actor_id: "22222222-2222-4222-8222-222222222222", view_as: false,
};
const id = "33333333-3333-4333-8333-333333333333";
const row: NumberSetupRow = {
  phone_number_id: id, can_retry: false, trust_state: "linked", trust_code: null, sms_state: "registering", sms_code: null,
};
const ok = (data: unknown) => ({ data, error: null });
let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const mount = (numbers: Array<{id: string}> = [{ id }]) => renderHook(
  (props: { scope: PurchaseScope | null }) => useNumberSetupStatus(props.scope, numbers), { wrapper, initialProps: { scope } },
);
beforeEach(() => { rpc.mockReset(); client = new QueryClient({defaultOptions: { queries: { retry: false } }}); });
afterEach(() => { cleanup(); client.clear(); });

describe("purchased number status", () => {
  it("reads one scoped list, omits legacy numbers and only exposes a ready state after a fresh server result", async () => {
    const old = "44444444-4444-4444-8444-444444444444";
    rpc.mockResolvedValueOnce(ok([row]));
    const hook = mount([{ id: old }, { id }]);
    await waitFor(() => expect(hook.result.current.rows?.get(id)).toEqual(row));
    expect(rpc.mock.calls).toEqual([["phone_number_setup_status", { p_org: scope.organization_id, p_numbers: [id, old] }]]);
    expect(hook.result.current.rows?.has(old)).toBe(false);
    rpc.mockResolvedValueOnce(ok([{ ...row, sms_state: "ready" }]));
    await act(async () => { await hook.result.current.refresh(); });
    await waitFor(() => expect(hook.result.current.rows?.get(id)?.sms_state).toBe("ready"));
    rpc.mockResolvedValueOnce({ data: null, error: {} });
    await act(async () => { await hook.result.current.refresh(); });
    await waitFor(() => expect(hook.result.current.readFailed).toBe(true));
    expect(hook.result.current.rows).toBeUndefined();
  });
  it("keeps a late response in its original agency and disables reads and retries after access loss", async () => {
    let resolve!: (value: unknown) => void;
    rpc.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce(ok([]));
    const hook = mount();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    hook.rerender({ scope: { ...scope, organization_id: "55555555-5555-4555-8555-555555555555" } });
    await waitFor(() => expect(hook.result.current.rows?.size).toBe(0));
    await act(async () => { resolve(ok([{ ...row, sms_state: "ready" }])); });
    expect(hook.result.current.rows?.size).toBe(0);
    hook.rerender({ scope: null });
    expect(hook.result.current.rows).toBeUndefined();
    act(() => { void hook.result.current.refresh(); hook.result.current.retry(id); });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("renders the purchased line in Phone Numbers and immediately hides readiness after an agency change", async () => {
    rpc.mockResolvedValueOnce(ok([row])).mockResolvedValueOnce(ok([{ ...row, sms_state: "ready" }]));
    const line: PhoneNumberRow = {
      id, phone_number: "+12135550123", status: "active", area_code: "213", friendly_name: "Agency line",
      is_default: false, assigned_to: null, assignment_type: "agency", spam_score: null, spam_status: null, spam_checked_at: null,
    };
    const table = (organizationId: string) => (
      <TooltipProvider><NumberManagementSection organizationId={organizationId} numbers={[line]} setNumbers={vi.fn()}
        agents={[]} groups={[]} groupMembers={[]} onRefresh={async () => {}} /></TooltipProvider>
    );
    const view = render(table(scope.organization_id), { wrapper });
    expect(await screen.findByText("SMS registering")).toBeVisible();
    expect(screen.getByText("Voice active")).toBeVisible();
    await act(async () => { await client.invalidateQueries({queryKey: ["phone-number-setup"]}); });
    expect(await screen.findByText("SMS ready")).toBeVisible();
    view.rerender(table("55555555-5555-4555-8555-555555555555"));
    expect(screen.queryByText("SMS ready")).toBeNull();
    expect(screen.queryByRole("button", {name: "Purchase number"})).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("loads more than 200 numbers in bounded batches and rejects an unrequested result", async () => {
    const numbers = Array.from({length:201}, (_, n) => ({id: `88888888-8888-4888-8888-${String(n).padStart(12, "0")}`}));
    rpc.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([row]));
    const hook = mount(numbers);
    await waitFor(() => expect(hook.result.current.readFailed).toBe(true));
    expect(rpc.mock.calls.map(([, args]) => args.p_numbers.length)).toEqual([200, 1]);
    expect(hook.result.current.rows).toBeUndefined();
  });
  it("retries only a recoverable setup record in the same agency and re-reads its status", async () => {
    rpc.mockResolvedValueOnce(ok([{...row, can_retry: true, sms_state: "review", sms_code: "service_configuration" }]))
      .mockResolvedValueOnce(ok(true)).mockResolvedValueOnce(ok([row]));
    const hook = mount();
    await waitFor(() => expect(hook.result.current.rows?.get(id)?.sms_state).toBe("review"));
    act(() => { hook.result.current.retry(id); });
    await waitFor(() => expect(hook.result.current.rows?.get(id)?.sms_state).toBe("registering"));
    expect(rpc.mock.calls[1]).toEqual(["phone_number_setup_retry", {p_org: scope.organization_id, p_number: id}]);
    act(() => { hook.result.current.retry(id); });
    expect(rpc).toHaveBeenCalledTimes(3);
  });
  it("separates linked profiles from texting readiness, shows specific remedies, and offers a retry only when actionable", () => {
    const retry = vi.fn();
    const props = { row, phone: "(213) 555-0123", onRetry: retry, retrying: false, retryQueued: false, retryError: false };
    const view = render(<NumberSetupStatus {...props} />);
    expect(screen.getByText("Agency profile linked")).toBeVisible();
    expect(screen.getByText("SMS registering")).toBeVisible();
    expect(screen.queryByText("SMS ready")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    view.rerender(<NumberSetupStatus {...props} row={{...row, can_retry: true, sms_state: "review", sms_code: "sender_limit"}} />);
    expect(screen.getByText(/campaign has reached its number limit/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Retry setup for/ }));
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<NumberSetupStatus {...props} row={{...row, sms_state: "ready", trust_state: "waiting"}} />);
    expect(screen.getByText("SMS ready")).toBeVisible();
    expect(screen.getByText("Waiting for Trust Hub approval")).toBeVisible();
    view.rerender(<NumberSetupStatus {...props} row={{...row, sms_state: "waiting", sms_code: "waiting_agency"}} />);
    expect(screen.getByText("Waiting for agency A2P approval")).toBeVisible();
    view.rerender(<NumberSetupStatus {...props} row={{...row, sms_state: "waiting", sms_code: "policy_disabled"}} />);
    expect(screen.getByText("SMS on hold")).toBeVisible();
    expect(screen.queryByText("Waiting for agency A2P approval")).toBeNull();
    view.rerender(<NumberSetupStatus {...props} row={{...row, sms_state: "review", sms_code: "sender_removed"}} />);
    expect(screen.queryByRole("button", { name: /Retry setup/ })).toBeNull();
    view.rerender(<NumberSetupStatus {...props} row={{...row, sms_state: "toll_free"}} />);
    expect(screen.getByText("Toll-free verification required")).toBeVisible();
    expect(screen.queryByText("SMS ready")).toBeNull();
  });
});
