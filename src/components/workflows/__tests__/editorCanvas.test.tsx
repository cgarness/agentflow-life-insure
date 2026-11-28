import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkflowCanvas from "../WorkflowCanvas";
import { CARD_WIDTH, layoutSteps } from "../canvas/layout";
import { emptyGraph, type AutomationGraph } from "../../../../supabase/functions/_shared/automations/graph";

beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const campaign = "095168bb-3341-43c8-81b4-654183cdacca";
const authored = (): AutomationGraph => ({format:1, nodes:[
  {id:"start",type:"campaign_membership_created",version:1,config:{campaign_id:campaign}},
  {id:"wait",type:"wait",version:1,config:{duration:5,unit:"minutes"}},
  {id:"task",type:"create_task",version:1,config:{title:"Call {{first_name}}",task_type:"Follow Up",due_amount:1,due_unit:"days"},meta:{name:"Next-day call"}},
  {id:"check",type:"contact_has_email",version:1,config:{}},
  {id:"email",type:"send_email",version:1,config:{subject:"Welcome"}},
], edges:[
  {id:"e1",source:"start",target:"wait"},{id:"e2",source:"wait",target:"task"},{id:"e3",source:"task",target:"check"},
  {id:"e4",source:"check",target:"email",branch:"yes"},
], settings:{reentry:"once",stop_on_reply:false}});

// The canvas library keeps a card hidden until a browser has measured it. jsdom never measures, so the test reveals them.
function mount(ui: ReactElement) {
  const view = render(ui);
  document.querySelectorAll<HTMLElement>(".react-flow__node").forEach(node => { node.style.visibility = "visible"; });
  return view;
}
const card = (name: string) => screen.getByRole("button", {name});

describe("workflow canvas", () => {
  it("renders every step as a labelled button with its configuration summary", () => {
    const onSelect = vi.fn();
    mount(<WorkflowCanvas graph={authored()} selected="wait" names={{campaign: () => "Final Expense Q4"}}
      issues={[{node_id:"email",message:"Select an authorized sender."}]} onSelect={onSelect} onInsert={vi.fn()}/>);
    expect(screen.getByLabelText("Automation canvas")).toBeInTheDocument();
    expect(card("Lead added to campaign")).toHaveAccessibleDescription("Final Expense Q4");
    expect(card("Wait 5 minutes")).toHaveAttribute("aria-pressed", "true");
    // A custom name is the title; the block type and its configured value remain on the second line.
    expect(card("Next-day call")).toHaveAccessibleDescription("Create task for assigned agent · Call {{first_name}} · due in 1 day");
    expect(card("Next-day call")).toHaveAttribute("aria-pressed", "false");
    expect(card("Send email")).toHaveAccessibleDescription("Welcome 1 issue");
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    card("Next-day call").focus();
    expect(card("Next-day call")).toHaveFocus();
    fireEvent.click(card("Next-day call"));
    expect(onSelect).toHaveBeenCalledWith("task");
  });

  it("names an empty branch in words and offers to add a step there and after a last step", () => {
    const onInsert = vi.fn();
    mount(<WorkflowCanvas graph={authored()} selected={null} onSelect={vi.fn()} onInsert={onInsert}/>);
    const no = screen.getByRole("button", {name: "Add step on no after Contact has email"});
    expect(no.parentElement).toHaveTextContent("No");
    expect(screen.queryByRole("button", {name: "Add step on yes after Contact has email"})).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "Add step after Send email"}));
    fireEvent.click(within(screen.getByRole("dialog", {name: "Add step after Send email"})).getByRole("button", {name: "Wait"}));
    expect(onInsert).toHaveBeenCalledWith("email", undefined, "wait");
    fireEvent.click(no);
    fireEvent.click(within(screen.getByRole("dialog", {name: "Add step on no after Contact has email"})).getByRole("button", {name: "Send SMS"}));
    expect(onInsert).toHaveBeenLastCalledWith("check", "no", "send_sms");
  });

  it("shows a blank canvas with one way to start, and no add controls on a read-only workflow", () => {
    const onInsert = vi.fn();
    const blank = mount(<WorkflowCanvas graph={emptyGraph()} selected={null} onSelect={vi.fn()} onInsert={onInsert}/>);
    expect(screen.getByLabelText("Automation canvas")).toBeVisible();
    fireEvent.click(screen.getByRole("button", {name: "Choose trigger"}));
    fireEvent.click(within(screen.getByRole("dialog", {name: "Choose trigger"})).getByRole("button", {name: "Appointment booked"}));
    expect(onInsert).toHaveBeenCalledWith(null, undefined, "appointment_booked");
    blank.unmount();
    mount(<WorkflowCanvas readOnly graph={authored()} selected={null} onSelect={vi.fn()} onInsert={onInsert}/>);
    expect(card("Wait 5 minutes")).toBeVisible();
    expect(screen.queryByRole("button", {name: /^(Add|Insert) step/})).toBeNull();
  });
});

describe("canvas layout", () => {
  it("stacks a straight path in one column", () => {
    const graph = authored();
    const at = layoutSteps({...graph, nodes: graph.nodes.slice(0,3), edges: graph.edges.slice(0,2)});
    expect(new Set([...at.values()].map(point => point.x)).size).toBe(1);
    expect([...at.values()].map(point => point.y)).toEqual([0,184,368]);
  });

  it("gives every branch its own column, so nested conditions never overlap", () => {
    const graph: AutomationGraph = {...emptyGraph(), nodes:[
      {id:"start",type:"lead_created",version:1,config:{}},
      {id:"first",type:"contact_has_email",version:1,config:{}},
      {id:"second",type:"contact_has_email",version:1,config:{}},
      {id:"yesYes",type:"send_email",version:1,config:{}},
      {id:"yesNo",type:"send_sms",version:2,config:{}},
      {id:"no",type:"send_sms",version:2,config:{}},
      {id:"stray",type:"wait",version:1,config:{}},
    ], edges:[
      {id:"1",source:"start",target:"first"},{id:"2",source:"first",target:"second",branch:"yes"},
      {id:"3",source:"first",target:"no",branch:"no"},{id:"4",source:"second",target:"yesYes",branch:"yes"},
      {id:"5",source:"second",target:"yesNo",branch:"no"},
    ]};
    const at = layoutSteps(graph);
    expect(at.size).toBe(7);
    // Yes runs to the left of No at every level.
    expect(at.get("second")!.x).toBeLessThan(at.get("no")!.x);
    expect(at.get("yesYes")!.x).toBeLessThan(at.get("yesNo")!.x);
    // The trigger stays centred over the first condition.
    expect(at.get("start")!.x).toBe(at.get("first")!.x);
    const points = [...at.values()];
    for (const a of points) for (const b of points) {
      if (a !== b && a.y === b.y) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(CARD_WIDTH);
    }
    // A step the trigger does not reach is still placed, clear of the main path.
    expect(at.get("stray")!.x).toBeGreaterThan(Math.max(...["start","first","second","yesYes","yesNo","no"].map(id => at.get(id)!.x)));
  });
});
