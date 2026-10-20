/**
 * The drawer reuses the Phase 2A tracking controls and their unresolved-write registry: a payment whose outcome is
 * unknown stays locked across closing the dialog and the drawer, and Retry resends exactly that payment (same request
 * id). A restricted contact keeps its financial history and controls but shows no name or link.
 */
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORG, USER, drawer } from "./centerFixtures";

const h = vi.hoisted(() => ({
  calls: [] as Array<[string, Record<string, unknown>]>,
  read: null as unknown,
  writes: [] as Array<{ data: unknown; error: unknown }>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      h.calls.push([name, args]);
      const response = name === "get_my_policy_commission" ? { data: h.read, error: null } : h.writes.shift() ?? { data: null, error: { message: "unset" } };
      const request = Promise.resolve(response);
      return Object.assign(request, { abortSignal: () => request });
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: USER }, isImpersonating: false, profile: { id: USER, role: "Agent", organization_id: ORG } }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: ORG, role: "Agent" }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ canSeeCommission: () => true, isLoading: false }) }));
vi.mock("@/components/commission/preview/PolicyCommissionEstimate", () => ({
  PolicyCommissionEstimate: () => <p>Estimate inputs</p>,
}));

import { resetUnresolvedTrackingWrites } from "@/hooks/useClientPolicyCommissions";
import { CommissionDrawer, type DrawerTarget } from "../CommissionDrawer";

const POLICY = "00000000-0000-4000-8000-000000000301";
const ADVANCE = "00000000-0000-4000-8000-000000000601";
let setTarget: (t: DrawerTarget | null) => void;
function Harness({ initial }: { initial: DrawerTarget | null }) {
  const [target, set] = useState<DrawerTarget | null>(initial);
  setTarget = set;
  return <CommissionDrawer target={target} onClose={() => set(null)} />;
}
const renderDrawer = (initial: DrawerTarget | null) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><Harness initial={initial} /></MemoryRouter>
  </QueryClientProvider>,
);
const receipts = () => h.calls.filter(([n]) => n === "record_policy_commission_receipt");
const reads = () => h.calls.filter(([n]) => n === "get_my_policy_commission");

beforeEach(() => {
  resetUnresolvedTrackingWrites();
  h.calls = [];
  h.writes = [];
  h.read = drawer();
});
afterEach(cleanup);

describe("Commission drawer", () => {
  it("shows the policy with the existing tracking controls and a link to the contact", async () => {
    renderDrawer({ policyId: POLICY, opened: 1 });
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByText("Client 1");
    expect(within(sheet).getByText("Synthetic Life · Synthetic Term")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "View policy" }).getAttribute("href")).toBe("/clients/00000000-0000-4000-8000-000000000401");
    expect(within(sheet).getAllByRole("button", { name: "Record payment" })).toHaveLength(4);
    expect(within(sheet).getByRole("button", { name: "Edit dates" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Place on hold" })).toBeInTheDocument();
    expect(reads()).toEqual([["get_my_policy_commission", { p_policy_id: POLICY }]]);
  });

  it("restricted contact: no name and no link, but the payments and controls remain", async () => {
    h.read = drawer({ contact: null, source: null });
    renderDrawer({ policyId: POLICY, opened: 1 });
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByText("Restricted contact");
    expect(within(sheet).queryByRole("link", { name: "View policy" })).toBeNull();
    expect(within(sheet).getAllByRole("button", { name: "Record payment" })).toHaveLength(4);
  });

  it("no estimate: Record estimate opens the existing dialog", async () => {
    h.read = drawer({ state: "not_recorded", estimate: null });
    renderDrawer({ policyId: POLICY, opened: 1 });
    fireEvent.click(await screen.findByRole("button", { name: "Record estimate" }));
    expect(await screen.findByRole("dialog", { name: "Record commission estimate" })).toBeInTheDocument();
  });

  it("an unknown payment outcome stays locked across closing the dialog and the drawer; Retry resends the same request", async () => {
    h.writes.push({ data: null, error: { code: "", message: "TypeError: Failed to fetch" } });
    renderDrawer({ policyId: POLICY, payment: ADVANCE, opened: 1 });
    const dialog = await screen.findByRole("dialog", { name: "Record payment received" });
    await waitFor(() => expect((within(dialog).getByLabelText("Amount received") as HTMLInputElement).value).toBe("429.75"));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Record payment" })).not.toBeDisabled());
    fireEvent.change(within(dialog).getByLabelText("Amount received"), { target: { value: "300.00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record payment" }));
    await within(dialog).findByText("We couldn't confirm this change. Retry sends exactly the same change.");
    const first = receipts()[0][1];
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    setTarget(null);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    setTarget({ policyId: POLICY, opened: 2 });
    const sheet = await screen.findByRole("dialog");
    fireEvent.click((await within(sheet).findAllByRole("button", { name: "Record payment" }))[0]);
    const again = await screen.findByRole("dialog", { name: "Record payment received" });
    expect((within(again).getByLabelText("Amount received") as HTMLInputElement).value).toBe("300.00");
    expect(within(again).getByLabelText("Amount received")).toBeDisabled();
    h.writes.push({ data: { receipt_id: "00000000-0000-4000-8000-000000000777", status: "recorded", idempotent: true }, error: null });
    const before = reads().length;
    await waitFor(() => expect(within(again).getByRole("button", { name: "Retry" })).not.toBeDisabled());
    fireEvent.click(within(again).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Record payment received" })).toBeNull());
    expect(receipts()).toHaveLength(2);
    expect(receipts()[1][1]).toEqual(first);
    await waitFor(() => expect(reads().length).toBeGreaterThan(before));
  });
});
