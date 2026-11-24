import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { automationApi, type DraftRecord } from "@/lib/automation-api";
import AutomationEditor from "../AutomationEditor";
import WorkflowWorkspace from "../editor/WorkflowWorkspace";
import { emptyGraph, validateGraph, type AutomationGraph } from "../../../../supabase/functions/_shared/automations/graph";

vi.mock("@/hooks/useMinWidth", () => ({useMinWidth: () => false}));
vi.mock("@/lib/automation-api", () => ({automationApi:{
  status:vi.fn(), save:vi.fn(), validate:vi.fn(async () => []), overlap:vi.fn(async () => []), publish:vi.fn(),
  smsRequirements:vi.fn(async () => []), campaigns:vi.fn(), dispositions:vi.fn(),
}}));
vi.mock("../AutomationReview", () => ({default:() => null}));
vi.mock("../AutomationActivity", () => ({AutomationActivity:() => null}));
vi.mock("@/lib/automation-channels", () => ({getAutomationChannelOptions:vi.fn()}));

const id = "00000000-0000-4000-8000-000000000001";
const start = "00000000-0000-4000-8000-000000000002";
const wait = "00000000-0000-4000-8000-000000000003";
const task = "00000000-0000-4000-8000-000000000005";
const graphWith = (config: Record<string, unknown>): AutomationGraph => ({...emptyGraph(), nodes:[
  {id:start,type:"lead_created",version:1,config:{}}, {id:wait,type:"wait",version:1,config},
  {id:task,type:"create_task",version:1,config:{title:"Call {{first_name}}",task_type:"Follow Up",due_amount:1,due_unit:"days"}},
], edges:[{id:"00000000-0000-4000-8000-000000000004",source:start,target:wait},
  {id:"00000000-0000-4000-8000-000000000006",source:wait,target:task}]});
const incomplete = graphWith({});
const complete = graphWith({duration:5,unit:"minutes"});
const record = (graph: AutomationGraph): DraftRecord => ({id,name:"Follow-up",automation_draft_name:"Follow-up",status:"draft",
  automation_graph:graph,automation_revision:1,automation_version_id:null});
// The browser check and the server word the same problem differently.
const browserIssues = validateGraph(incomplete).filter(issue => issue.nodeId === wait);
const serverIssues = browserIssues.map(issue => ({node_id:wait,message:"Server: " + issue.message}));
const countLabel = (count: number) => count === 1 ? "1 issue" : count + " issues";

async function mount(graph: AutomationGraph) {
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
    <MemoryRouter><AutomationEditor record={record(graph)} scope="fixture" session={3} onBack={vi.fn()} onSaved={vi.fn()}/></MemoryRouter>
  </QueryClientProvider>);
  // A saved draft is editable once its live status is known.
  await screen.findByRole("button",{name:"Save draft"});
}
const waitRow = () => document.querySelector<HTMLElement>(`[data-step="${wait}"]`)!;

beforeEach(() => {
  vi.mocked(automationApi.status).mockResolvedValue({id,status:"draft",revision:1,trigger_type:null,controls:null});
  vi.mocked(automationApi.save).mockResolvedValue({id,revision:2});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.mocked(automationApi.validate).mockResolvedValue([]); });

describe("Save & review", () => {
  it("saves an incomplete draft and says it cannot be published yet", async () => {
    expect(browserIssues.length).toBeGreaterThan(0);
    vi.mocked(automationApi.validate).mockResolvedValue(serverIssues);
    await mount(incomplete);
    fireEvent.change(screen.getByLabelText("Automation name"),{target:{value:"Follow-up call"}});
    fireEvent.click(screen.getByRole("button",{name:"Save & review"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Draft saved. Fix the highlighted steps before publishing.");
    expect(automationApi.save).toHaveBeenCalledWith(id,"Follow-up call",incomplete,1,3);
    expect(screen.getByText("All changes saved")).toBeVisible();
    expect(screen.queryByRole("button",{name:"Publish version"})).toBeNull();
    expect(waitRow()).toHaveTextContent(countLabel(serverIssues.length));
  });

  it("reports a saved draft once, in the toolbar's saved state, so the steps start right below it", async () => {
    await mount(complete);
    fireEvent.change(screen.getByLabelText("Automation name"),{target:{value:"Follow-up call"}});
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"Save draft"}));
    expect(await screen.findByText("Draft saved.")).toBeVisible();
    expect(screen.queryByText("All changes saved")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("moves a complete draft to the review", async () => {
    expect(validateGraph(complete)).toEqual([]);
    await mount(complete);
    fireEvent.click(screen.getByRole("button",{name:"Save & review"}));
    expect(await screen.findByRole("button",{name:"Publish version"})).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("issues on the open step", () => {
  it("shows each saved problem once, in the live wording, with the same count open or closed", async () => {
    vi.mocked(automationApi.validate).mockResolvedValue(serverIssues);
    await mount(incomplete);
    fireEvent.change(screen.getByLabelText("Automation name"),{target:{value:"Follow-up call"}});
    fireEvent.click(screen.getByRole("button",{name:"Save draft"}));
    expect(await screen.findByText("Draft saved.")).toBeVisible();
    const closed = countLabel(serverIssues.length);
    expect(waitRow()).toHaveTextContent(closed);

    fireEvent.click(waitRow());
    const sheet = await screen.findByRole("dialog");
    expect(waitRow()).toHaveTextContent(closed);
    expect(within(sheet).queryByText(/^Server:/)).toBeNull();
    for (const issue of browserIssues) expect(within(sheet).getAllByText(issue.message).length).toBeGreaterThan(0);
    fireEvent.click(within(sheet).getByRole("button",{name:"Done"}));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(waitRow()).toHaveTextContent(closed);
  });
});

describe("phone step settings", () => {
  it("returns focus to the new step's row after adding it and closing its settings", async () => {
    function Workspace() {
      const [graph, setGraph] = useState<AutomationGraph>({...emptyGraph(), nodes:[{id:start,type:"lead_created",version:1,config:{}}]});
      const [selected, setSelected] = useState<string | null>(null);
      return <WorkflowWorkspace graph={graph} selected={selected} issues={[]} names={{}} scope="fixture" readOnly={false}
        onChange={setGraph} onSelect={setSelected}/>;
    }
    render(<QueryClientProvider client={new QueryClient()}><Workspace/></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button",{name:"Add step"}));
    fireEvent.click(within(screen.getByRole("dialog",{name:"Add step"})).getByRole("button",{name:"Wait"}));
    const sheet = await screen.findByRole("dialog",{name:"Wait"});
    fireEvent.click(within(sheet).getByRole("button",{name:"Done"}));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toHaveAttribute("data-step"));
    expect((document.activeElement as HTMLElement).dataset.step).not.toBe(start);
    expect(document.activeElement).toHaveAccessibleName(/^Wait/);
  });
});
