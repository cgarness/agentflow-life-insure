import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Reply = { data: unknown; error: { message: string; code?: string } | null };
type Request = { operation: string; payload?: Record<string, unknown>; filters: Record<string, unknown>; columns?: string };
const h = vi.hoisted(() => ({
  user: "user-a", org: "org-a", role: "Admin", viewAs: false,
  carrier: {} as Record<string, unknown>, requests: [] as Request[],
  replies: [] as (Reply | Promise<Reply>)[], reads: [] as (Reply | Promise<Reply>)[],
  toast: vi.fn(), log: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({
  user: { id: h.user }, profile: { id: h.user, organization_id: h.org, role: h.role, first_name: "Test", last_name: "Admin" }, isImpersonating: h.viewAs,
}) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: h.org }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: h.toast }));
vi.mock("@/lib/activityLogger", () => ({ logActivity: h.log }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  expect(table).toBe("carriers");
  const request: Request = { operation: "read", filters: {} };
  const builder = {
    select: (columns: string) => { request.columns = columns; return builder; },
    eq: (key: string, value: unknown) => { request.filters[key] = value; return builder; },
    order: () => { h.requests.push(request); return Promise.resolve(h.reads.shift() ?? { data: [h.carrier], error: null }); },
    update: (payload: Record<string, unknown>) => { request.operation = "update"; request.payload = payload; return builder; },
    insert: (payload: Record<string, unknown>) => { request.operation = "insert"; request.payload = payload; return builder; },
    delete: () => { request.operation = "delete"; return builder; },
    maybeSingle: () => {
      h.requests.push(request);
      return Promise.resolve(h.replies.shift() ?? { data: { id: h.carrier.id }, error: null }).then((reply) => {
        if (reply.data && !reply.error && request.payload) h.carrier = { ...h.carrier, ...request.payload };
        return reply;
      });
    },
  };
  return builder;
} } }));
import Carriers from "../Carriers";

const resource = { id: "10000000-0000-4000-8000-000000000001", label: "Old guide", url: "https://carrier.example/old", group: "guides_training" };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const element = <QueryClientProvider client={client}><Carriers /></QueryClientProvider>;
  return { ...render(element), client, invalidate, element };
}
async function edit() {
  fireEvent.click(await screen.findByRole("button", { name: "Edit Synthetic Carrier" }));
  return within(screen.getByRole("group", { name: "Carrier resource links" }));
}
beforeEach(() => {
  Object.assign(h, { user: "user-a", org: "org-a", role: "Admin", viewAs: false, requests: [], replies: [], reads: [], carrier: {
    id: "carrier-a", organization_id: "org-a", name: "Synthetic Carrier", portal_url: "https://carrier.example/portal",
    logo_url: null, contact_phones: [{ label: "Service", value: "800-555-0100" }], contact_emails: [],
    is_appointed: true, updated_at: "2026-11-10T12:00:00.123456+00:00", resource_links: [resource],
  } });
  h.toast.mockClear(); h.log.mockClear();
});
afterEach(cleanup);

describe("Settings carrier resource saves", () => {
  it("writes only changed resources, scoped by agency, identity and exact loaded revision, then refreshes", async () => {
    const { invalidate } = mount();
    const editor = await edit();
    fireEvent.change(editor.getByRole("textbox", { name: "Label" }), { target: { value: "Underwriting guide" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.requests.find((request) => request.operation === "update")).toEqual({
      operation: "update", payload: { resource_links: [{ ...resource, label: "Underwriting guide" }] },
      filters: { id: "carrier-a", organization_id: "org-a", updated_at: "2026-11-10T12:00:00.123456+00:00" }, columns: "id",
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["carrier-directory"] });
    const reopened = await edit();
    expect(reopened.getByRole("textbox", { name: "Label" })).toHaveValue("Underwriting guide");
    expect(h.log).toHaveBeenCalledTimes(1);
  });
  it.each([
    { data: null, error: { message: "Network unavailable" } },
    { data: null, error: null },
  ])("preserves the draft and shows no false success after a failed/unacknowledged save", async (reply) => {
    h.replies.push(reply);
    const { invalidate } = mount();
    const editor = await edit();
    fireEvent.change(editor.getByRole("textbox", { name: "Label" }), { target: { value: "Unsaved training" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to save carrier" })));
    expect(editor.getByRole("textbox", { name: "Label" })).toHaveValue("Unsaved training");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(h.log).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(h.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Carrier updated" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("validates unsafe links with inline feedback and makes no write", async () => {
    mount(); const editor = await edit();
    fireEvent.change(editor.getByRole("textbox", { name: "URL" }), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(editor.getByRole("textbox", { name: "URL" })).toHaveAttribute("aria-invalid", "true");
    expect(h.requests.every((request) => request.operation === "read")).toBe(true);
  });
  it("refreshes the backing revision after a conflict so cancel/reopen can recover", async () => {
    h.replies.push({ data: null, error: null });
    mount(); const editor = await edit();
    const refreshed = { ...h.carrier, updated_at: "2026-11-11T12:00:00.654321+00:00" };
    h.reads.push({ data: [refreshed], error: null });
    fireEvent.change(editor.getByRole("textbox", { name: "Label" }), { target: { value: "Conflicting draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to save carrier" })));
    expect(editor.getByRole("textbox", { name: "Label" })).toHaveValue("Conflicting draft");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const reopened = await edit();
    fireEvent.change(reopened.getByRole("textbox", { name: "Label" }), { target: { value: "Recovered edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const writes = h.requests.filter((request) => request.operation === "update");
    expect(writes).toHaveLength(2);
    expect(writes[1].filters.updated_at).toBe(refreshed.updated_at);
  });
  it("supports an explicit empty resource array without clearing carrier identity or contacts", async () => {
    mount(); const editor = await edit();
    fireEvent.click(editor.getByRole("button", { name: "Remove link 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(h.requests.some((request) => request.operation === "update")).toBe(true));
    expect(h.requests.find((request) => request.operation === "update")?.payload).toEqual({ resource_links: [] });
    expect(h.carrier).toMatchObject({ name: "Synthetic Carrier", contact_phones: [{ label: "Service", value: "800-555-0100" }], is_appointed: true });
  });
  it("disables fields and prevents duplicate writes or dismissal while save is pending", async () => {
    let finish!: (reply: Reply) => void;
    h.replies.push(new Promise((resolve) => { finish = resolve; }));
    mount(); const editor = await edit();
    fireEvent.change(editor.getByRole("textbox", { name: "Label" }), { target: { value: "New guide" } });
    const save = screen.getByRole("button", { name: "Save Changes" });
    fireEvent.click(save); fireEvent.click(save);
    expect(editor.getByRole("textbox", { name: "Label" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(h.requests.filter((request) => request.operation === "update")).toHaveLength(1);
    await act(async () => finish({ data: { id: "carrier-a" }, error: null }));
  });
  it("drops prior-scope drafts and ignores a late success after the agency changes", async () => {
    let finish!: (reply: Reply) => void;
    h.replies.push(new Promise((resolve) => { finish = resolve; }));
    const view = mount(); const editor = await edit();
    fireEvent.change(editor.getByRole("textbox", { name: "Label" }), { target: { value: "Old agency draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    h.org = "org-b"; h.carrier = { ...h.carrier, name: "New agency carrier", organization_id: "org-b" };
    view.rerender(<QueryClientProvider client={view.client}><Carriers /></QueryClientProvider>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => finish({ data: { id: "carrier-a" }, error: null }));
    expect(h.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Carrier updated" }));
    expect(h.log).not.toHaveBeenCalled();
    expect(await screen.findByText("New agency carrier")).toBeInTheDocument();
  });
  it("keeps ordinary agents read-only and issues no query under View As", async () => {
    h.role = "Agent"; const view = mount();
    await screen.findByText("Synthetic Carrier");
    expect(screen.queryByRole("button", { name: /Edit Synthetic/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Carrier" })).not.toBeInTheDocument();
    const count = h.requests.length;
    h.viewAs = true;
    view.rerender(<QueryClientProvider client={view.client}><Carriers /></QueryClientProvider>);
    expect(screen.queryByText("Synthetic Carrier")).not.toBeInTheDocument();
    expect(h.requests).toHaveLength(count);
  });
});
