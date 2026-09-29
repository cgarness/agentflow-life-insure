/**
 * ContactFollowUpsCard — the compact, read-only Follow-ups card on the existing contact page.
 *
 * The data hook is mocked (its own suite covers the reads); this pins what each state renders: loading,
 * error + Retry, empty + "Add follow-up" (Appointment → the page's Schedule modal, Task → AddTaskModal),
 * ready (next item, assignee, "N other follow-ups · M overdue", "at least" when capped), a failed background
 * refresh — including over an EMPTY list, which must not read as "nothing scheduled" alone — and View all.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactFollowUp } from "@/lib/contactFollowUps";
import type { UseContactFollowUpsResult } from "@/hooks/useContactFollowUps";

const h = vi.hoisted(() => ({
  result: null as unknown,
  refetch: vi.fn(),
  hookArgs: [] as unknown[],
  taskModal: [] as Record<string, unknown>[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useContactFollowUps", () => ({
  useContactFollowUps: (args: unknown) => {
    h.hookArgs.push(args);
    return h.result;
  },
}));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({
    formatDate: (d: string) => `DATE(${d.slice(0, 10)})`,
    formatDateTime: (d: string) => `DATETIME(${d.slice(0, 16)})`,
  }),
}));
vi.mock("@/components/contacts/AddTaskModal", () => ({
  AddTaskModal: (props: Record<string, unknown>) => {
    h.taskModal.push(props);
    return <div data-testid="add-task-modal" />;
  },
}));

import { ContactFollowUpsCard } from "@/components/contacts/followups/ContactFollowUpsCard";
import { summarizeFollowUps } from "@/lib/contactFollowUps";

const LEAD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ORG = "11111111-1111-4111-8111-111111111111";
const AGENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function item(over: Partial<ContactFollowUp> & { sourceRowId: string }): ContactFollowUp {
  const dueAt = over.dueAt ?? "2026-10-02T17:00:00.000Z";
  return {
    key: `appointment:${over.sourceRowId}`,
    source: "appointment",
    kind: "appointment",
    title: `Meeting ${over.sourceRowId}`,
    dueAt,
    rankAt: Date.parse(dueAt),
    dateOnly: false,
    assigneeId: AGENT_A,
    assigneeName: null,
    statusLabel: "Scheduled",
    isOverdue: false,
    inProgress: false,
    contactId: LEAD,
    contactType: "lead",
    note: null,
    ...over,
  };
}

function setResult(over: Partial<UseContactFollowUpsResult> & { items?: ContactFollowUp[]; truncated?: boolean } = {}) {
  const items = over.items ?? [];
  h.result = {
    state: "ready",
    items,
    summary: summarizeFollowUps(items, over.truncated ?? false),
    refreshFailed: false,
    refetch: h.refetch,
    ...over,
  };
}

const onAddAppointment = vi.fn();
function renderCard() {
  return render(
    <ContactFollowUpsCard
      contactId={LEAD}
      contactType="lead"
      organizationId={ORG}
      agents={[{ id: AGENT_A, firstName: "Alice", lastName: "Agent" }]}
      resolveAgentName={(id) => (id === AGENT_A ? "Alice Agent" : "")}
      refreshKey={3}
      onAddAppointment={onAddAppointment}
    />,
  );
}
const card = () => screen.getByTestId("contact-follow-ups-card");
const body = () => card().children[1] as HTMLElement;

beforeEach(() => {
  h.refetch.mockReset();
  h.hookArgs = [];
  h.taskModal = [];
  onAddAppointment.mockReset();
});

describe("header and wiring", () => {
  it("passes the contact, tenant and refreshKey to the hook, and explains the visibility scope", () => {
    setResult();
    renderCard();
    expect(h.hookArgs[0]).toEqual({ contactId: LEAD, contactType: "lead", organizationId: ORG, refreshKey: 3 });
    expect(screen.getByText("Follow-ups")).toHaveAttribute("title", "Shows follow-ups you have access to");
  });

  it.each(["loading", "error", "empty", "ready"])("the body keeps its fixed height in the %s state", (kind) => {
    if (kind === "loading") setResult({ state: "loading" });
    else if (kind === "error") setResult({ state: "error" });
    else if (kind === "empty") setResult();
    else setResult({ items: [item({ sourceRowId: "a1" })] });
    renderCard();
    expect(body().className).toContain("h-[72px]");
  });
});

describe("states", () => {
  it("loading: skeletons only, no View all", () => {
    setResult({ state: "loading" });
    renderCard();
    expect(screen.queryByText("View all")).toBeNull();
    expect(screen.queryByText("No follow-ups scheduled")).toBeNull();
  });

  it("error: says so and Retry refetches", () => {
    setResult({ state: "error" });
    renderCard();
    expect(screen.getByText("Couldn't load follow-ups")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("View all")).toBeNull();
  });

  it("empty: 'No follow-ups scheduled' with an Add follow-up menu; Appointment opens the page's Schedule modal", async () => {
    setResult();
    renderCard();
    expect(screen.getByText("No follow-ups scheduled")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't refresh/)).toBeNull();
    expect(screen.queryByText("View all")).toBeNull();

    fireEvent.keyDown(screen.getByRole("button", { name: /add follow-up/i }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Appointment" }));
    expect(onAddAppointment).toHaveBeenCalledTimes(1);
  });

  it("empty: Task opens AddTaskModal for this contact (mounted only when opened)", async () => {
    setResult();
    renderCard();
    expect(screen.queryByTestId("add-task-modal")).toBeNull();

    fireEvent.keyDown(screen.getByRole("button", { name: /add follow-up/i }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Task" }));
    expect(await screen.findByTestId("add-task-modal")).toBeInTheDocument();
    expect(h.taskModal.at(-1)).toMatchObject({ open: true, contactId: LEAD, contactType: "lead" });
  });

  it("empty + a failed background refresh: still says it couldn't refresh, with Retry (review finding)", () => {
    setResult({ refreshFailed: true });
    renderCard();
    expect(screen.getByText("No follow-ups scheduled")).toBeInTheDocument();
    expect(screen.getByText(/Couldn't refresh/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("ready: the next item's kind, due text with zone, title and assignee; counts of the rest", () => {
    setResult({
      items: [
        item({ sourceRowId: "a1", dueAt: "2026-10-02T17:00:00.000Z" }),
        item({ sourceRowId: "a2", dueAt: "2026-10-03T17:00:00.000Z" }),
        item({
          sourceRowId: "t1",
          key: "task:t1",
          source: "task",
          kind: "task",
          title: "Send illustration",
          dueAt: "2026-10-04T07:00:00.000Z",
          dateOnly: true,
          assigneeName: "Tess Task",
        }),
      ],
    });
    renderCard();
    const text = body().textContent ?? "";
    expect(text).toContain("Appointment");
    expect(text).toContain("DATETIME(2026-10-02T17:00)");
    expect(text).toContain("Meeting a1");
    expect(text).toContain("Alice Agent");
    expect(text).toContain("2 other follow-ups");
    expect(text).not.toContain("overdue");
    expect(screen.getByText("View all")).toBeInTheDocument();
  });

  it("ready: the next actionable item leads; earlier overdue ones are counted, with an Overdue chip when shown", () => {
    setResult({
      items: [
        item({ sourceRowId: "cb1", kind: "callback", title: "Callback", dueAt: "2026-09-20T17:00:00.000Z", isOverdue: true }),
        item({ sourceRowId: "a2", dueAt: "2026-10-03T17:00:00.000Z" }),
      ],
    });
    renderCard();
    const text = body().textContent ?? "";
    expect(text).toContain("Meeting a2");
    expect(text).toContain("1 other follow-up");
    expect(text).toContain("1 overdue");
  });

  it("ready: only overdue items → the latest overdue one leads with its Overdue chip", () => {
    setResult({
      items: [item({ sourceRowId: "cb1", kind: "callback", title: "Call back re quote", isOverdue: true })],
    });
    renderCard();
    expect(within(body()).getByText("Overdue")).toBeInTheDocument();
    expect(body().textContent).toContain("Callback");
  });

  it("ready: an unassigned item reads 'Unassigned'", () => {
    setResult({ items: [item({ sourceRowId: "a1", assigneeId: null })] });
    renderCard();
    expect(body().textContent).toContain("Unassigned");
  });

  it("ready + capped source: counts read 'at least'", () => {
    setResult({ items: [item({ sourceRowId: "a1" }), item({ sourceRowId: "a2" })], truncated: true });
    renderCard();
    expect(body().textContent).toContain("at least 1 other follow-up");
  });

  it("ready + a failed background refresh keeps the item and offers Retry", () => {
    setResult({ items: [item({ sourceRowId: "a1" })], refreshFailed: true });
    renderCard();
    expect(body().textContent).toContain("Meeting a1");
    expect(body().textContent).toContain("Couldn't refresh");
    fireEvent.click(within(body()).getByRole("button", { name: "Retry" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });
});

describe("View all", () => {
  it("opens a read-only list grouped into Overdue and Upcoming", async () => {
    setResult({
      items: [
        item({ sourceRowId: "cb1", kind: "callback", title: "Past callback", isOverdue: true }),
        item({ sourceRowId: "a2", title: "Future meeting", dueAt: "2026-10-03T17:00:00.000Z" }),
      ],
    });
    renderCard();
    fireEvent.click(screen.getByText("View all"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Overdue (1)")).toBeInTheDocument();
    expect(within(dialog).getByText("Upcoming (1)")).toBeInTheDocument();
    expect(within(dialog).getByText("Past callback")).toBeInTheDocument();
    expect(within(dialog).getByText("Future meeting")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /edit|delete|complete/i })).toBeNull();
  });
});
