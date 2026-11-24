import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountInspector, step } from "./inspectorHarness";

const api = vi.hoisted(() => ({savedMessages: vi.fn(), dispositions: vi.fn(), campaigns: vi.fn(), sources: vi.fn()}));
const channels = vi.hoisted(() => vi.fn());
vi.mock("@/lib/automation-api", () => ({automationApi: api}));
vi.mock("@/lib/automation-channels", () => ({getAutomationChannelOptions: channels}));

beforeEach(() => {
  api.savedMessages.mockResolvedValue({items: [], more: false});
  channels.mockResolvedValue({senders: [], moreSenders: false});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const RULE = "Counted from the event that started the automation, or from the end of the last wait before this step. "
  + "A step that runs late does not move it.";

describe("Create task due time", () => {
  // The server counts a task's due time from the event, or from the end the last wait was given, so a late or held
  // step never moves the deadline. The builder says the same thing.
  it("says what the due time counts from", () => {
    mountInspector(step("create_task", {title: "Call", task_type: "Call", due_amount: 30, due_unit: "minutes"}));
    expect(screen.getByLabelText("Due")).toHaveAccessibleDescription(RULE);
    expect(screen.queryByText(/when this step runs/)).toBeNull();
  });

  it("calls out a task that is due right away", () => {
    mountInspector(step("create_task", {title: "Call", task_type: "Call", due_amount: 0, due_unit: "minutes"}));
    expect(screen.getByLabelText("Due")).toHaveAccessibleDescription("Due right away. " + RULE);
  });
});
