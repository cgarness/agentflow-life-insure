import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { automationApi, type DraftRecord } from "@/lib/automation-api";
import { readReleaseControls } from "@/lib/automation-release";
import AutomationEditor from "../AutomationEditor";
import AutomationReleaseStatus from "../AutomationReleaseStatus";
import { emptyGraph } from "../../../../supabase/functions/_shared/automations/graph";

vi.mock("@/lib/automation-api", () => ({automationApi:{
  status:vi.fn(), validate:vi.fn(async () => []), overlap:vi.fn(async () => []), publish:vi.fn(),
  smsRequirements:vi.fn(async () => []), campaigns:vi.fn(), dispositions:vi.fn(),
}}));
vi.mock("../WorkflowCanvas", () => ({default:() => null}));
vi.mock("../OrderedWorkflowSteps", () => ({default:() => null}));
vi.mock("../AutomationReview", () => ({default:() => null}));
vi.mock("@/lib/automation-channels", () => ({getAutomationChannelOptions:vi.fn()}));
vi.mock("../AutomationActivity", () => ({AutomationActivity:() => null}));

const id = "00000000-0000-4000-8000-000000000001";
const trigger = "00000000-0000-4000-8000-000000000002";
const action = "00000000-0000-4000-8000-000000000003";
const document: DraftRecord = {
  id,name:"Authored test",automation_draft_name:"Authored test",status:"draft",automation_revision:1,automation_version_id:null,
  automation_graph:{...emptyGraph(), nodes:[
    {id:trigger,type:"lead_created",version:1,config:{}},
    {id:action,type:"send_sms",version:1,config:{body:"Fixture",purpose:"informational"}},
  ],edges:[{id:"00000000-0000-4000-8000-000000000004",source:trigger,target:action}]},
};
const off = {enrollment_enabled:false,dispatch_enabled:false};
const offOn = {enrollment_enabled:false,dispatch_enabled:true};
const snapshot = {id,status:"draft" as const,revision:1,trigger_type:null,controls:off};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("workflow release settings", () => {
  it.each([
    [false,false,"New events cannot start a run.","Messages cannot be handed to a provider."],
    [false,true,"New events cannot start a run.","Existing runs may send"],
    [true,false,"Qualifying new campaign memberships can start a run.","Messages cannot be handed to a provider."],
    [true,true,"Qualifying new campaign memberships can start a run.","Messages may go out after"],
  ] as const)("combines enrollment %s and sending %s with the published trigger", (enroll,send,admission,dispatch) => {
    render(<AutomationReleaseStatus controls={{enrollment_enabled:enroll,dispatch_enabled:send}}
      status="active" trigger="campaign_membership_created"/>);
    const status = screen.getByRole("region",{name:"Workflow status"});
    expect(status).toHaveTextContent(admission);
    expect(status).toHaveTextContent(dispatch);
    expect(status).toHaveTextContent("Enrollment: " + (enroll ? "On" : "Off"));
    expect(status).toHaveTextContent("Message delivery: " + (send ? "On" : "Off"));
  });

  it.each(["draft","paused","archived"] as const)("respects the %s lifecycle when both agency switches are on", status => {
    render(<AutomationReleaseStatus controls={{enrollment_enabled:true,dispatch_enabled:true}} status={status} trigger="lead_created"/>);
    const panel = screen.getByRole("region",{name:"Workflow status"});
    expect(panel).toHaveTextContent(status);
    expect(panel).not.toHaveTextContent("may go out");
    expect(panel).not.toHaveTextContent("can start a run");
  });

  it("does not infer an audience if the pinned trigger cannot be read", () => {
    render(<AutomationReleaseStatus controls={{enrollment_enabled:true,dispatch_enabled:false}} status="active" trigger={null}/>);
    expect(screen.getByText(/published trigger could not be confirmed/)).toBeVisible();
    expect(screen.queryByText(/can start a run/)).toBeNull();
  });

  it("shows missing and invalid switch values as unknown, never as on or off", () => {
    expect(readReleaseControls({enrollment_enabled:true})).toBeNull();
    const controls = readReleaseControls({enrollment_enabled:false,dispatch_enabled:"true"});
    render(<AutomationReleaseStatus controls={controls} status="active" trigger="lead_created"/>);
    const panel = screen.getByRole("region",{name:"Workflow status"});
    expect(panel).toHaveTextContent("Enrollment: Unknown");
    expect(panel).toHaveTextContent("Message delivery: Unknown");
    expect(panel).not.toHaveTextContent(/: (On|Off)/);
    expect(screen.getByText(/could not be confirmed/)).toBeVisible();
  });

  it("requires another review when controls change before confirmation, then uses the confirmed state", async () => {
    let current = {...snapshot, status:"draft" as "active" | "draft", trigger_type:null as string | null};
    vi.mocked(automationApi.status).mockImplementation(async () => current);
    vi.mocked(automationApi.publish).mockImplementationOnce(async () => {
      current = {...current,controls:offOn};
      throw new Error("Agency controls changed. Review the current settings before publishing.");
    }).mockImplementationOnce(async () => {
      current = {...current,status:"active",revision:2,trigger_type:"lead_created"};
      return {...current,version_id:id,release_controls:current.controls};
    });
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
      <MemoryRouter><AutomationEditor record={document} scope="fixture" session={3} onBack={vi.fn()} onSaved={vi.fn()}/></MemoryRouter>
    </QueryClientProvider>);
    const review = async () => fireEvent.click(await screen.findByRole("button",{name:"Save & review"}));
    await review();
    expect(await screen.findByRole("region",{name:"Publish review controls"})).toHaveTextContent("Message delivery: Off");
    fireEvent.click(screen.getByRole("button",{name:"Publish version"}));
    expect(await screen.findByText(/^Agency controls changed/)).toBeVisible();
    expect(automationApi.publish).toHaveBeenNthCalledWith(1,id,1,3,off);
    expect(screen.getByRole("button",{name:"Publish version"})).toBeDisabled();
    expect(screen.getByRole("region",{name:"Publish review controls"})).toHaveTextContent("Message delivery: On");
    await review();
    await waitFor(() => expect(screen.getByRole("button",{name:"Publish version"})).toBeEnabled());
    fireEvent.click(screen.getByRole("button",{name:"Publish version"}));
    const confirmation = await screen.findByRole("region",{name:"Workflow status"});
    expect(within(confirmation).getByRole("status")).toHaveTextContent("Version published.");
    expect(confirmation).toHaveTextContent("Existing runs may send");
    expect(automationApi.publish).toHaveBeenNthCalledWith(2,id,1,3,offOn);
  });
});
