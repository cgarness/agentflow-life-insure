/**
 * AddTaskModal — the due date is a LOCAL calendar date.
 *
 * Before the fix, `new Date("YYYY-MM-DD")` read the picked date as UTC midnight: in US time zones "today"
 * failed validation, the default was tomorrow's date every evening, and the stored instant was the previous
 * local day. The day-boundary cases only mean something in a negative-offset zone, so they are LA-gated
 * (`TZ=America/Los_Angeles`), like `taskDates.test.ts`; the rest run everywhere.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const AGENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const h = vi.hoisted(() => {
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  // STABLE identity: AddTaskModal's roster effect depends on `profile`; a fresh object per render loops it.
  const auth = { user: { id }, profile: { id, role: "Agent" } };
  return { createTask: vi.fn(), toast: vi.fn(), auth };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/tasksApi", () => ({ tasksApi: { createTask: (p: unknown) => h.createTask(p) } }));
vi.mock("@/lib/supabase-users", () => ({ usersSupabaseApi: { getDownlineAgents: vi.fn(async () => []) } }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: ORG }) }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));

import { AddTaskModal } from "@/components/contacts/AddTaskModal";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const laOnly = TZ === "America/Los_Angeles" ? it : it.skip;

const AGENTS = [{ id: AGENT_A, firstName: "Alice", lastName: "Agent" }];

let client: QueryClient;
function renderModal() {
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AddTaskModal
        open
        onOpenChange={onOpenChange}
        contactId={LEAD}
        contactType="lead"
        agents={AGENTS}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

const dueInput = () => screen.getByLabelText("Due Date") as HTMLInputElement;
async function submit(title = "Send the illustration") {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: title } });
  fireEvent.click(screen.getByRole("button", { name: "Save Task" }));
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  h.createTask.mockReset();
  h.createTask.mockResolvedValue({ id: "t1" });
  h.toast.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  client.clear();
});

describe("Los Angeles day boundaries", () => {
  laOnly("at 9:30 PM PDT the default due date is still TODAY (the UTC date is already tomorrow)", () => {
    vi.setSystemTime(new Date("2026-09-29T04:30:00.000Z"));
    renderModal();
    expect(dueInput().value).toBe("2026-09-28");
  });

  laOnly("at noon PDT today's date validates and is stored as PDT midnight (07:00Z), not UTC midnight", async () => {
    vi.setSystemTime(new Date("2026-09-28T19:00:00.000Z"));
    renderModal();
    fireEvent.change(dueInput(), { target: { value: "2026-09-28" } });
    await submit();

    await waitFor(() => expect(h.createTask).toHaveBeenCalledTimes(1));
    expect(h.createTask.mock.calls[0][0]).toMatchObject({ due_date: "2026-09-28T07:00:00.000Z" });
    expect(screen.queryByText("Due date must be today or in the future")).toBeNull();
  });
});

describe("any time zone", () => {
  it("persists local midnight of the picked date with the contact, type and tenant, then refreshes the Tasks key", async () => {
    vi.setSystemTime(new Date(2026, 8, 28, 12, 0, 0));
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { onOpenChange } = renderModal();
    fireEvent.change(dueInput(), { target: { value: "2026-09-30" } });
    await submit();

    await waitFor(() => expect(h.createTask).toHaveBeenCalledTimes(1));
    expect(h.createTask.mock.calls[0][0]).toEqual({
      title: "Send the illustration",
      task_type: "Follow Up",
      due_date: new Date(2026, 8, 30).toISOString(),
      assigned_to: AGENT_A,
      notes: "",
      organization_id: ORG,
      contact_id: LEAD,
      contact_type: "lead",
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tasks", LEAD] });
  });

  it("defaults to today's LOCAL date", () => {
    vi.setSystemTime(new Date(2026, 8, 28, 23, 30, 0));
    renderModal();
    expect(dueInput().value).toBe("2026-09-28");
  });

  it("rejects yesterday and never writes", async () => {
    vi.setSystemTime(new Date(2026, 8, 28, 12, 0, 0));
    renderModal();
    fireEvent.change(dueInput(), { target: { value: "2026-09-27" } });
    await submit();

    expect(await screen.findByText("Due date must be today or in the future")).toBeInTheDocument();
    expect(h.createTask).not.toHaveBeenCalled();
  });
});
