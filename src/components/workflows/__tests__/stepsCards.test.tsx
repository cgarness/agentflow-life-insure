import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrderedWorkflowSteps from "../OrderedWorkflowSteps";
import { orderedSteps } from "../lib/draftGraph";
import { emptyGraph, type AutomationGraph } from "../../../../supabase/functions/_shared/automations/graph";

afterEach(cleanup);

const campaign = "095168bb-3341-43c8-81b4-654183cdacca";
const authored = (): AutomationGraph => ({format:1, nodes:[
  {id:"start",type:"campaign_membership_created",version:1,config:{campaign_id:campaign}},
  {id:"wait",type:"wait",version:1,config:{duration:5,unit:"minutes"}},
  {id:"sms",type:"send_sms",version:2,config:{body:"Hi {{first_name}}"},meta:{name:"Day one text",description:"Internal note."}},
  {id:"check",type:"contact_has_email",version:1,config:{}},
  {id:"email",type:"send_email",version:1,config:{subject:"Welcome aboard"}},
], edges:[
  {id:"e1",source:"start",target:"wait"},{id:"e2",source:"wait",target:"sms"},{id:"e3",source:"sms",target:"check"},
  {id:"e4",source:"check",target:"email",branch:"yes"},
], settings:{reentry:"once",stop_on_reply:false}});

function mount(graph: AutomationGraph, props: Partial<Parameters<typeof OrderedWorkflowSteps>[0]> = {}) {
  const calls = {onSelect: vi.fn(), onInsert: vi.fn(), onChange: vi.fn()};
  render(<OrderedWorkflowSteps graph={graph} selected={null} issues={[]} {...calls} {...props}/>);
  return calls;
}
const rows = () => within(screen.getByRole("list", {name: "Ordered steps"})).getAllByRole("listitem");

describe("ordered steps", () => {
  it("shows a readable title and configuration summary on every card", () => {
    mount(authored(), {names: {campaign: id => id === campaign ? "Final Expense Q4" : undefined}});
    const [start, wait, sms, check, email] = rows();
    // Trigger is row 0. The selected campaign is named without opening the card.
    expect(within(start).getByRole("button", {name: "Lead added to campaign"})).toHaveAccessibleDescription("Final Expense Q4");
    // A configured wait reads as a sentence and needs no second line.
    expect(within(wait).getByRole("button", {name: "Wait 5 minutes"})).toHaveAccessibleDescription("");
    // A custom name is the title; the block type and its value stay visible beneath it.
    expect(within(sms).getByRole("button", {name: "Day one text"})).toHaveAccessibleDescription("Send SMS · Hi {{first_name}}");
    expect(sms).not.toHaveTextContent("Internal note.");
    expect(within(check).getByRole("button", {name: "Contact has email"})).toBeVisible();
    expect(email).toHaveTextContent("Yes path");
    expect(within(email).getByRole("button", {name: "Send email"})).toHaveAccessibleDescription("Welcome aboard");
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it("falls back to neutral wording while a campaign name is unknown", () => {
    mount(authored());
    expect(within(rows()[0]).getByRole("button", {name: "Lead added to campaign"})).toHaveAccessibleDescription("Selected campaign");
  });

  it("marks the selected step, reports issues in words and selects on press", () => {
    const calls = mount(authored(), {selected: "sms", issues: [{node_id:"sms",message:"Message is required."},
      {node_id:"sms",message:"Unsupported field."},{node_id:"email",message:"Select an authorized sender."},{message:"Graph level"}]});
    const [, wait, sms, , email] = rows();
    expect(within(sms).getByRole("button", {name: "Day one text"})).toHaveAttribute("aria-pressed", "true");
    expect(within(wait).getByRole("button", {name: "Wait 5 minutes"})).toHaveAttribute("aria-pressed", "false");
    expect(sms).toHaveTextContent("2 issues");
    expect(email).toHaveTextContent("1 issue");
    expect(wait).not.toHaveTextContent("issue");
    fireEvent.click(within(wait).getByRole("button", {name: "Wait 5 minutes"}));
    expect(calls.onSelect).toHaveBeenCalledWith("wait");
  });

  it("reorders and removes from the row, never on the trigger, and keeps step details", () => {
    const graph = authored();
    const calls = mount(graph);
    const [start, wait, sms, check] = rows();
    for (const name of ["Move up", "Move down", "Remove"]) expect(within(start).queryByRole("button", {name})).toBeNull();
    expect(within(wait).getByRole("button", {name: "Move up"})).toBeDisabled();
    expect(within(sms).getByRole("button", {name: "Move down"})).toBeDisabled();
    expect(within(check).getByRole("button", {name: "Move up"})).toBeDisabled();
    fireEvent.click(within(sms).getByRole("button", {name: "Move up"}));
    const moved = calls.onChange.mock.calls[0][0] as AutomationGraph;
    expect(orderedSteps(moved).map(step => step.node.id)).toEqual(["start","sms","wait","check","email"]);
    expect(moved.nodes.find(node => node.id === "sms")).toBe(graph.nodes[2]);
    fireEvent.click(within(wait).getByRole("button", {name: "Remove"}));
    const removed = calls.onChange.mock.calls[1][0] as AutomationGraph;
    expect(removed.nodes.map(node => node.id)).toEqual(["start","sms","check","email"]);
    expect(removed.nodes[1].meta).toEqual({name:"Day one text",description:"Internal note."});
  });

  it("keeps keyboard focus on the moved step's control", async () => {
    function Harness() {
      const [graph, setGraph] = useState(authored);
      return <OrderedWorkflowSteps graph={graph} selected={null} issues={[]} onSelect={vi.fn()} onInsert={vi.fn()} onChange={setGraph}/>;
    }
    render(<Harness/>);
    const down = within(rows()[1]).getByRole("button", {name: "Move down"});
    down.focus();
    fireEvent.click(down);
    await waitFor(() => expect(rows()[2]).toHaveTextContent("Wait 5 minutes"));
    // Wait is now last before the condition, so Move down no longer applies: focus lands on the step itself.
    await waitFor(() => expect(within(rows()[2]).getByRole("button", {name: "Wait 5 minutes"})).toHaveFocus());
    const up = within(rows()[2]).getByRole("button", {name: "Move up"});
    up.focus();
    fireEvent.click(up);
    await waitFor(() => expect(within(rows()[1]).getByRole("button", {name: "Move up"})).toBeDisabled());
    await waitFor(() => expect(within(rows()[1]).getByRole("button", {name: "Wait 5 minutes"})).toHaveFocus());
  });

  it("adds after a row and on each branch of a condition through the picker", () => {
    const calls = mount(authored());
    const [, wait, , check] = rows();
    fireEvent.click(within(wait).getByRole("button", {name: "Add step"}));
    fireEvent.click(within(screen.getByRole("dialog", {name: "Add step"})).getByRole("button", {name: "Send email"}));
    expect(calls.onInsert).toHaveBeenLastCalledWith("wait", undefined, "send_email");
    expect(within(check).queryByRole("button", {name: "Add step"})).toBeNull();
    fireEvent.click(within(check).getByRole("button", {name: "Add step on no"}));
    fireEvent.click(within(screen.getByRole("dialog", {name: "Add step on no"})).getByRole("button", {name: "Send SMS"}));
    expect(calls.onInsert).toHaveBeenLastCalledWith("check", "no", "send_sms");
    expect(within(check).getByRole("button", {name: "Add step on yes"})).toBeVisible();
  });

  it("starts a blank workflow with a trigger and renders no rows before that", () => {
    const calls = mount(emptyGraph());
    expect(screen.queryByRole("list", {name: "Ordered steps"})).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", {name: "Choose trigger"}));
    fireEvent.click(within(screen.getByRole("dialog", {name: "Choose trigger"})).getByRole("button", {name: "New lead created"}));
    expect(calls.onInsert).toHaveBeenCalledWith(null, undefined, "lead_created");
  });

  it("lets a read-only workflow be opened step by step without edit controls", () => {
    const calls = mount(authored(), {readOnly: true});
    for (const name of ["Add step", "Add step on yes", "Move up", "Move down", "Remove"]) {
      expect(screen.queryByRole("button", {name})).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", {name: "Day one text"}));
    expect(calls.onSelect).toHaveBeenCalledWith("sms");
  });
});
