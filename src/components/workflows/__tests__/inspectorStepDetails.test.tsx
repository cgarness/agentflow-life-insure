import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  blocks, STEP_DESCRIPTION_MAX, STEP_NAME_MAX, stepTitle, type AutomationNode,
} from "../../../../supabase/functions/_shared/automations/graph";
import { mountInspector, STEP_ID, step, trigger } from "./inspectorHarness";

const api = vi.hoisted(() => ({savedMessages: vi.fn(), dispositions: vi.fn(), campaigns: vi.fn(), sources: vi.fn()}));
const channels = vi.hoisted(() => vi.fn());
vi.mock("@/lib/automation-api", () => ({automationApi: api}));
vi.mock("@/lib/automation-channels", () => ({getAutomationChannelOptions: channels}));

beforeEach(() => {
  api.savedMessages.mockResolvedValue({items: [], more: false});
  api.dispositions.mockResolvedValue([]);
  api.campaigns.mockResolvedValue({items: [], selected: null, next_cursor: null});
  api.sources.mockResolvedValue([]);
  channels.mockResolvedValue({senders: [], moreSenders: false});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const open = () => fireEvent.click(screen.getByRole("button", {name: "Step details"}));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), {target: {value}});
/** Every registered block, each as the step being edited. A trigger is edited as the trigger of its graph. */
const everyBlock = blocks.map(block => [block.label, block.category === "trigger"
  ? trigger(block.type, {}, {version: block.version})
  : step(block.type, {}, {version: block.version})] as [string, AutomationNode]);

describe("Step details", () => {
  it.each(everyBlock)("is collapsed on %s and offers an optional name and description", (label, node) => {
    mountInspector(node, {start: node.id === STEP_ID ? trigger("appointment_booked") : node});
    const toggle = screen.getByRole("button", {name: "Step details"});
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Step name")).toBeNull();
    expect(screen.queryByLabelText("Description")).toBeNull();
    open();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const name = screen.getByLabelText("Step name") as HTMLInputElement;
    expect(name.tagName).toBe("INPUT");
    expect(name).toHaveValue("");
    expect(name).toHaveAttribute("placeholder", label);
    expect(name).toHaveAttribute("maxlength", String(STEP_NAME_MAX));
    const description = screen.getByLabelText("Description");
    expect(description.tagName).toBe("TEXTAREA");
    expect(description).toHaveAttribute("maxlength", String(STEP_DESCRIPTION_MAX));
    expect(description).toHaveAccessibleDescription("Only your team sees this.");
  });

  it.each(everyBlock)("stores the details of %s beside its configuration and removes them cleanly", (_label, node) => {
    const original = {...node, config: {...node.config}};
    const view = mountInspector(node, {start: node.id === STEP_ID ? trigger("appointment_booked") : node});
    open();
    type("Step name", "Day-one welcome");
    expect(view.latest()).toEqual({...original, meta: {name: "Day-one welcome"}});
    expect(stepTitle(view.latest())).toBe("Day-one welcome");
    type("Description", "Agreed with compliance.\nReview in March.");
    expect(view.latest()).toEqual({...original, meta: {name: "Day-one welcome", description: "Agreed with compliance.\nReview in March."}});
    type("Step name", "");
    expect(view.latest()).toEqual({...original, meta: {description: "Agreed with compliance.\nReview in March."}});
    type("Description", "");
    expect(view.latest()).toEqual(original);
    expect(view.latest()).not.toHaveProperty("meta");
    // Configuration, type, version and id never moved.
    for (const change of view.changes) {
      expect(change.config).toEqual(original.config);
      expect([change.id, change.type, change.version]).toEqual([original.id, original.type, original.version]);
      expect(Object.keys(change).filter(key => key !== "meta").sort()).toEqual(["config", "id", "type", "version"]);
    }
  });

  it("opens by itself when the step already has a name or a description", () => {
    const named = mountInspector(step("wait", {duration: 5, unit: "minutes"}, {meta: {name: "Cool-off"}}));
    expect(screen.getByLabelText("Step name")).toHaveValue("Cool-off");
    expect(screen.getByLabelText("Description")).toHaveValue("");
    named.unmount();
    mountInspector(step("contact_has_email", {}, {meta: {description: "Split by email"}}));
    expect(screen.getByLabelText("Description")).toHaveValue("Split by email");
  });

  it("treats blank text as no value and keeps a name on one line", () => {
    const view = mountInspector(step("wait", {duration: 5, unit: "minutes"}, {meta: {name: "Cool-off"}}));
    type("Step name", "   ");
    expect(view.latest()).not.toHaveProperty("meta");
    expect(screen.getByLabelText("Step name")).toHaveValue("");
    // A text input never holds a line break, so a tab stands in for the control characters a paste can carry.
    type("Step name", "First\tline\u0007second");
    expect(view.latest().meta).toEqual({name: "First line second"});
    type("Description", " \n ");
    expect(view.latest().meta).toEqual({name: "First line second"});
  });

  it("leaves an older text step on its definition when only its details change", () => {
    const view = mountInspector(step("send_sms", {body: "Hi", purpose: "informational"}));
    open();
    type("Step name", "Intro text");
    expect(view.latest()).toEqual({id: STEP_ID, type: "send_sms", version: 1, config: {body: "Hi", purpose: "informational"}, meta: {name: "Intro text"}});
  });

  it("can be read but not changed on a read-only step", () => {
    const view = mountInspector(step("wait", {duration: 5, unit: "minutes"}), {readOnly: true});
    open();
    expect(screen.getByLabelText("Step name")).toBeDisabled();
    expect(screen.getByLabelText("Description")).toBeDisabled();
    expect(screen.getByLabelText("Duration")).toBeDisabled();
    expect(view.changes).toEqual([]);
  });

  it("shows a problem with a detail under its field, even while collapsed", () => {
    const message = "Step name must be plain text of 80 characters or fewer.";
    mountInspector(step("wait", {duration: 5, unit: "minutes"}), {issues: [{node_id: STEP_ID, message}]});
    const name = screen.getByLabelText("Step name");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription(message);
    expect(screen.getAllByText(message)).toHaveLength(1);
    expect(screen.queryByRole("list", {name: "Problems with this step"})).toBeNull();
  });
});
