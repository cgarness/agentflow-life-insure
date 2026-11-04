// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NumberPurchaseDialog } from "../NumberPurchaseDialog";

const { invoke, auth } = vi.hoisted(() => ({ invoke: vi.fn(), auth: { current: null as unknown } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.current }));
const actor = "00000000-0000-4000-8000-000000000001";
const org = "00000000-0000-4000-8000-000000000002";
const quoteId = "00000000-0000-4000-8000-000000000003";
const scope = { actor_id: actor, organization_id: org, view_as: false };
const profile = { id: actor, organization_id: org, role: "Admin", status: "Active" };
const local = { phone_number: "+12135550123", friendly_name: "Los Angeles", locality: "Los Angeles", region: "CA", postal_code: "90012", country: "US", number_type: "local", monthly_price: "1.15", currency: "USD" };
const tollFree = { ...local, phone_number: "+18005550123", friendly_name: "Toll-free", locality: null, region: null, postal_code: null, number_type: "toll_free", monthly_price: "2.15" };
const reply = (data: object) => ({ data: { protocol_version: 1, ...data }, error: null });
const quote = (number = local, extra: object = {}) => reply({ quote: { ...number, id: quoteId, inbound_per_minute: "0.0085", expires_at: new Date(Date.now() + 300_000).toISOString(), ...extra } });
const onCompleted = vi.fn(async () => undefined);
const calls = (action: string) => invoke.mock.calls.filter(([, options]) => options.body.action === action);
function Harness() {
  const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>Open purchase dialog</button><NumberPurchaseDialog open={open} onOpenChange={setOpen} organizationId={org} onCompleted={onCompleted} /></>;
}
async function localCart() {
  fireEvent.change(screen.getByLabelText("Area code"), { target: { value: "213" } });
  fireEvent.click(screen.getByRole("button", { name: "Search available numbers" }));
  fireEvent.click(await screen.findByRole("button", { name: `Add to cart ${local.phone_number}` }));
}
beforeEach(() => {
  invoke.mockReset(); onCompleted.mockClear(); sessionStorage.clear();
  auth.current = { user: { id: actor }, realProfile: profile, isImpersonating: false };
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000004" });
  invoke.mockImplementation(async (_name, { body }) => body.action === "search" ? reply({ numbers: [local] }) : quote());
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("NumberPurchaseDialog", () => {
  it("defaults to Local and preserves area/state/city search filters and listing metadata", async () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Local" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Search available numbers" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("State (2-letter)"), { target: { value: "ca" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Los Angeles" } });
    await localCart();
    expect(calls("search")[0]).toEqual(["twilio-search-numbers", { body: { ...scope, action: "search", number_type: "local", area_code: "213", state: "CA", locality: "Los Angeles", limit: 20 } }]);
    expect(screen.getByText("Los Angeles, CA, 90012")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Number cart" })).getByText(local.phone_number)).toBeVisible();
    expect(calls("purchase")).toHaveLength(0);
  });
  it("searches Toll-Free without local filters and shows 800 before 888 without duplicates", async () => {
    const eight = { ...tollFree, phone_number: "+18885550123" };
    invoke.mockResolvedValue(reply({ numbers: [eight, tollFree, tollFree] }));
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Los Angeles" } });
    fireEvent.click(screen.getByRole("button", { name: "Toll-Free" }));
    expect(screen.queryByLabelText("City")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search available numbers" }));
    const list = await screen.findByRole("list", { name: "Available numbers" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent?.match(/\+1\d{10}/)?.[0])).toEqual([tollFree.phone_number, eight.phone_number]);
    expect(calls("search")[0][1].body).toEqual({ ...scope, action: "search", number_type: "toll_free", prefix: "prefer_800", limit: 20 });
    expect(within(list).getAllByText("Toll-Free · SMS unavailable")).toHaveLength(2);
    expect(within(list).queryByText(/Los Angeles/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "888 only" }));
    invoke.mockResolvedValue(reply({ numbers: [eight] }));
    fireEvent.click(screen.getByRole("button", { name: "Search available numbers" }));
    await screen.findByRole("button", { name: `Add to cart ${eight.phone_number}` });
    expect(calls("search")[1][1].body.prefix).toBe("888");
  });
  it("shows every exact number, quoted rental, currency and usage before final confirmation", async () => {
    const second = { ...local, phone_number: "+12135550124" };
    invoke.mockImplementation(async (_name, { body }) => body.action === "search" ? reply({ numbers: [local, second] })
      : quote({ ...local, phone_number: body.phone_number }, { monthly_price: body.phone_number === local.phone_number ? "2.15" : "2.25", inbound_per_minute: "0.0085" }));
    render(<Harness />);
    await localCart();
    fireEvent.click(screen.getByRole("button", { name: `Add to cart ${second.phone_number}` }));
    fireEvent.click(screen.getByRole("button", { name: "Review purchase" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm purchase of 2 numbers" })).toBeEnabled());
    const selected = screen.getByRole("list", { name: "Selected numbers" });
    expect(within(selected).getByText(local.phone_number)).toBeVisible();
    expect(within(selected).getByText(second.phone_number)).toBeVisible();
    expect(within(selected).getByText("USD 2.15 / month")).toBeVisible();
    expect(within(selected).getByText("USD 2.25 / month")).toBeVisible();
    expect(within(selected).getAllByText("USD 0.0085 / minute")).toHaveLength(2);
    expect(screen.getByText("USD 4.40 / month")).toBeVisible();
    expect(screen.getByText("Usage and applicable taxes are additional.")).toBeVisible();
    expect(calls("purchase")).toHaveLength(0);
    expect(calls("quote").every(([endpoint]) => endpoint === "twilio-search-numbers")).toBe(true);
  });
  it("fails closed for an older search backend and never uses a legacy buy payload", async () => {
    invoke.mockResolvedValue({ data: { numbers: [local] }, error: null });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Area code"), { target: { value: "213" } });
    fireEvent.click(screen.getByRole("button", { name: "Search available numbers" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refresh the page");
    expect(screen.queryByRole("button", { name: /Add to cart/ })).not.toBeInTheDocument();
    expect(calls("purchase")).toHaveLength(0);
  });
  it("keeps final purchase disabled if review returns an old protocol or unverifiable price", async () => {
    render(<Harness />);
    await localCart();
    invoke.mockResolvedValue(quote(local, { monthly_price: "unknown" }));
    fireEvent.click(screen.getByRole("button", { name: "Review purchase" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refresh the page");
    expect(screen.getByRole("button", { name: "Confirm purchase of 1 number" })).toBeDisabled();
    expect(calls("purchase")).toHaveLength(0);
  });
  it("shows an inventory permission error without proceeding to quotes or purchases", async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ protocol_version: 1, code: "FORBIDDEN", error: "Active agency Admin access is required." }) } } });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Area code"), { target: { value: "213" } });
    fireEvent.click(screen.getByRole("button", { name: "Search available numbers" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Active agency Admin access is required");
    expect(calls("quote")).toHaveLength(0);
    expect(calls("purchase")).toHaveLength(0);
  });
  it.each([
    { realProfile: { ...profile, role: "Agent" }, isImpersonating: false },
    { realProfile: { ...profile, organization_id: "00000000-0000-4000-8000-000000000099" }, isImpersonating: false },
    { realProfile: profile, isImpersonating: true },
  ])("blocks unavailable purchase scope before requests: %j", (overrides) => {
    auth.current = { user: { id: actor }, ...overrides };
    render(<Harness />);
    expect(screen.getByRole("alert")).toHaveTextContent("active agency Admin");
    expect(screen.queryByRole("button", { name: "Search available numbers" })).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("drops a reviewed cart immediately when View As becomes active", async () => {
    const ui = render(<Harness />);
    await localCart();
    fireEvent.click(screen.getByRole("button", { name: "Review purchase" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm purchase of 1 number" })).toBeEnabled());
    auth.current = { user: { id: actor }, realProfile: profile, isImpersonating: true };
    ui.rerender(<Harness />);
    expect(screen.getByRole("alert")).toHaveTextContent("Exit View As");
    expect(screen.queryByRole("list", { name: "Selected numbers" })).not.toBeInTheDocument();
    expect(calls("purchase")).toHaveLength(0);
  });
  it("visibly expires a quote while the review remains open", async () => {
    render(<Harness />);
    await localCart();
    vi.useFakeTimers();
    invoke.mockResolvedValue(quote(local, { expires_at: new Date(Date.now() + 1_000).toISOString() }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review purchase" })); });
    expect(screen.getByRole("button", { name: "Confirm purchase of 1 number" })).toBeEnabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_010); });
    expect(screen.getByText("Price expired. Review current prices before purchasing.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm purchase of 1 number" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review current prices" })).toBeEnabled();
    expect(calls("purchase")).toHaveLength(0);
  });
});
