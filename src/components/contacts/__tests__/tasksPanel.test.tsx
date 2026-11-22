import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TasksPanel } from "../TasksPanel";

const api = vi.hoisted(() => ({getTasks: vi.fn(), completeTask: vi.fn()}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({supabase: {}}));
vi.mock("@/lib/tasksApi", () => ({tasksApi: api}));
vi.mock("@/components/ui/use-toast", () => ({useToast: () => ({toast})}));
vi.mock("@/contexts/BrandingContext", () => ({useBranding: () => ({formatDateTime: (value: string) => "at:" + value})}));
vi.mock("../AddTaskModal", () => ({AddTaskModal: () => null}));

const hours = (count: number) => new Date(Date.now() + count * 3_600_000).toISOString();
const task = (extra: Record<string, unknown>) => ({
  id: "task-1", title: "Call the new lead", task_type: "Follow Up", due_date: hours(48), completed_at: null, notes: null,
  assignee: {first_name: "Alexa", last_name: "Stone"}, ...extra,
});
function mount() {
  return render(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
    <TasksPanel contactId="contact" contactType="lead" organizationId="agency" agents={[]}/>
  </QueryClientProvider>);
}
beforeEach(() => { api.completeTask.mockResolvedValue({}); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("contact tasks", () => {
  it("shows a timed automation task with its actual due date and time and an Automation badge", async () => {
    const due = hours(48);
    api.getTasks.mockResolvedValue([task({due_date: due, all_day: false, automation_run_id: "run-1"})]);
    mount();
    expect(await screen.findByText("Call the new lead")).toBeVisible();
    expect(screen.getByText(new RegExp("^at:" + due.replace(/[.+]/g, "\\$&")))).toBeVisible();
    expect(screen.getByText("Automation")).toBeVisible();
    expect(screen.getByText("Upcoming")).toBeVisible();
  });

  it("keeps an all-day task on its relative wording with no time and no badge", async () => {
    api.getTasks.mockResolvedValue([task({all_day: true}), task({id: "task-2", title: "Older row without the flag"})]);
    mount();
    expect(await screen.findByText("Older row without the flag")).toBeVisible();
    expect(screen.getAllByText(/^in (about )?\d+ (days|hours)$/)).toHaveLength(2);
    expect(screen.queryByText(/^at:/)).toBeNull();
    expect(screen.queryByText("Automation")).toBeNull();
  });

  it("marks a timed task overdue the moment its time passes, while an all-day task due today is not", async () => {
    api.getTasks.mockResolvedValue([
      task({id: "timed", title: "Timed", due_date: hours(-1 / 60), all_day: false}),
      task({id: "day", title: "All day", due_date: new Date(new Date().setHours(0, 0, 0, 0)).toISOString()}),
    ]);
    mount();
    const overdue = (await screen.findByText("Overdue")).parentElement!;
    expect(within(overdue).getByText("Timed")).toBeVisible();
    expect(within(overdue).getByText(/^Overdue · at:/)).toBeVisible();
    expect(within(screen.getByText("Due Today").parentElement!).getByText("All day")).toBeVisible();
  });

  it("says so when a completion is not saved", async () => {
    api.getTasks.mockResolvedValue([task({})]);
    api.completeTask.mockRejectedValue(new Error("Task completion was not applied"));
    mount();
    fireEvent.click(await screen.findByRole("checkbox", {name: "Mark “Call the new lead” complete"}));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({title: "Task was not marked complete", variant: "destructive"})));
  });
});
