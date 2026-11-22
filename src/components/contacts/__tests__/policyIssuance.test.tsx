import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PolicyIssuance from "../PolicyIssuance";

const rpc = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({isImpersonating: false}));
vi.mock("@/integrations/supabase/client", () => ({supabase: {rpc}}));
vi.mock("@/contexts/AuthContext", () => ({useAuth: () => auth}));

const FIRST = "00000000-0000-4000-8000-000000000001";
const SECOND = "00000000-0000-4000-8000-000000000002";
const entry = (policy_id: string, extra: Record<string, unknown> = {}) => ({
  policy_id, issued_on: null, confirmed_at: null, confirmed_by_name: null, can_confirm: true, ...extra,
});
let listed: ReturnType<typeof entry>[];
let confirmFailures: {code: string; message: string}[];
const today = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-"); };
beforeEach(() => {
  auth.isImpersonating = false;
  listed = [entry(FIRST), entry(SECOND)];
  confirmFailures = [];
  rpc.mockImplementation(async (name: string, args: Record<string, string>) => {
    if (name === "get_policy_issuance") return {data: listed, error: null};
    const failure = confirmFailures.shift();
    if (failure) return {data: null, error: failure};
    listed = listed.map(item => item.policy_id === args.p_policy_id
      ? entry(item.policy_id, {issued_on: args.p_issued_on, confirmed_at: "2026-11-22T16:00:00Z", confirmed_by_name: "Alexa Stone", can_confirm: false}) : item);
    return {data: {policy_id: args.p_policy_id, issued_on: args.p_issued_on, confirmed_at: "2026-11-22T16:00:00Z", idempotent: false}, error: null};
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function mount() {
  return render(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
    <section aria-label="first"><PolicyIssuance clientId="client" policyId={FIRST} formatDate={value => "date:" + value}/></section>
    <section aria-label="second"><PolicyIssuance clientId="client" policyId={SECOND} formatDate={value => "date:" + value}/></section>
  </QueryClientProvider>);
}
const confirms = () => rpc.mock.calls.filter(call => call[0] === "confirm_policy_issuance").map(call => call[1]);

describe("Confirm issuance on one policy", () => {
  it("confirms one policy with today's date by default and leaves the client's other policy untouched", async () => {
    mount();
    const first = within(await screen.findByRole("region", {name: "first"}));
    fireEvent.click(await first.findByRole("button", {name: "Confirm issuance"}));
    const dialog = within(await screen.findByRole("dialog", {name: "Confirm policy issuance"}));
    expect(dialog.getByLabelText("Issue date")).toHaveValue(today());
    expect(dialog.getByLabelText("Issue date")).toHaveAttribute("max", today());
    fireEvent.click(dialog.getByRole("button", {name: "Confirm issuance"}));
    expect(await first.findByText("Issued")).toBeVisible();
    expect(first.getByText("date:" + today() + " · confirmed by Alexa Stone")).toBeVisible();
    expect(confirms()).toHaveLength(1);
    expect(confirms()[0]).toMatchObject({p_policy_id: FIRST, p_issued_on: today()});
    const second = within(screen.getByRole("region", {name: "second"}));
    expect(second.getByRole("button", {name: "Confirm issuance"})).toBeVisible();
    expect(second.queryByText("Issued")).toBeNull();
  });

  it("refuses a future date before asking the server, and repeats the same request after a failed attempt", async () => {
    mount();
    fireEvent.click(await within(await screen.findByRole("region", {name: "first"})).findByRole("button", {name: "Confirm issuance"}));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Issue date"), {target: {value: "2999-01-01"}});
    fireEvent.click(dialog.getByRole("button", {name: "Confirm issuance"}));
    expect(await dialog.findByRole("alert")).toHaveTextContent("The issue date cannot be in the future.");
    expect(confirms()).toHaveLength(0);
    fireEvent.change(dialog.getByLabelText("Issue date"), {target: {value: "2026-11-01"}});
    confirmFailures = [{code: "XX000", message: "connection lost"}];
    fireEvent.click(dialog.getByRole("button", {name: "Confirm issuance"}));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Issuance was not confirmed. Try again.");
    fireEvent.click(dialog.getByRole("button", {name: "Confirm issuance"}));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(confirms()).toHaveLength(2);
    expect(confirms()[0].p_request_id).toBe(confirms()[1].p_request_id);
    expect(confirms()[1]).toMatchObject({p_policy_id: FIRST, p_issued_on: "2026-11-01"});
  });

  it("explains a conflict with an earlier confirmation", async () => {
    mount();
    fireEvent.click(await within(await screen.findByRole("region", {name: "second"})).findByRole("button", {name: "Confirm issuance"}));
    confirmFailures = [{code: "PT409", message: "different date"}];
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", {name: "Confirm issuance"}));
    expect(await dialog.findByRole("alert")).toHaveTextContent("This policy is already confirmed as issued on a different date.");
  });

  it("offers nothing to someone who may not confirm, or while viewing as another person", async () => {
    listed = [entry(FIRST, {can_confirm: false}), entry(SECOND)];
    auth.isImpersonating = true;
    mount();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", {name: "Confirm issuance"})).toBeNull();
    expect(screen.queryByText("Issued")).toBeNull();
  });

  it("renders nothing when the status cannot be read", async () => {
    rpc.mockImplementation(async () => ({data: null, error: {code: "XX000", message: "down"}}));
    mount();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.getByRole("region", {name: "first"})).toBeEmptyDOMElement();
  });
});
