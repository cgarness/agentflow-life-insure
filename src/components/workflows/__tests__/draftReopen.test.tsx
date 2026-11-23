import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import WorkflowBuilder from "@/components/settings/WorkflowBuilder";
import type { DraftRecord } from "@/lib/automation-api";
import { emptyGraph } from "../../../../supabase/functions/_shared/automations/graph";

const h = vi.hoisted(() => ({
  auth: {user:{id:"actor"},profile:{id:"actor",organization_id:"org"},automationSessionRevision:1,isImpersonating:false},
  access: {visible:true,can_author:true},
  list: vi.fn(), load: vi.fn(), save: vi.fn(), validate: vi.fn(async () => []), status: vi.fn(),
  folders: vi.fn(async () => []),
}));
vi.mock("@/contexts/AuthContext", () => ({useAuth: () => h.auth}));
vi.mock("@/lib/automation-api", () => ({
  useAutomationAccess: () => ({data:h.access}),
  automationApi: {list:h.list,load:h.load,save:h.save,validate:h.validate,status:h.status,campaigns:vi.fn(),dispositions:vi.fn()},
}));
vi.mock("@/lib/supabase-workflow-folders", () => ({workflowFolderApi: {list:h.folders}}));
vi.mock("@/lib/automation-channels", () => ({getAutomationChannelOptions: vi.fn()}));
vi.mock("@/components/workflows/AutomationActivity", () => ({AutomationActivity: () => null}));
vi.mock("@/integrations/supabase/client", () => ({supabase:{}}));

const record = (name: string, revision: number): DraftRecord => ({
  id:"saved", name, automation_draft_name:name, status:"draft", automation_graph:emptyGraph(),
  automation_revision:revision, automation_version_id:null,
});
const row = (name: string) => ({id:"saved",name,status:"draft",trigger_type:null,folder_id:null,last_activity_at:null,
  is_legacy:false,release_controls:{enrollment_enabled:false,dispatch_enabled:false}});

function Where() { const location = useLocation(); return <output aria-label="Address">{location.pathname + location.search}</output>; }
function mount(path: string) {
  // A bare client, as in the app: cached query data is kept for five minutes by default.
  return render(<QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[path]}><Link to="/dashboard">Dashboard</Link><Where/><WorkflowBuilder/></MemoryRouter>
  </QueryClientProvider>);
}
const nameField = () => screen.getByLabelText("Automation name");
const address = () => screen.getByLabelText("Address").textContent;

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.status.mockImplementation(async () => ({id:"saved",status:"draft",revision:3,trigger_type:null,controls:null}));
  h.validate.mockResolvedValue([]);
});

describe("reopening a saved draft", () => {
  it("waits for the current record instead of mounting the copy from the last visit", async () => {
    h.load.mockResolvedValueOnce(record("Old name",3));
    h.save.mockResolvedValueOnce({id:"saved",revision:4});
    mount("/automations?workflow=saved");
    await waitFor(() => expect(nameField()).toHaveValue("Old name"));
    fireEvent.change(nameField(),{target:{value:"Renamed"}});
    fireEvent.click(screen.getByRole("button",{name:"Save draft"}));
    expect(await screen.findByText("Draft saved.")).toBeVisible();
    expect(h.save).toHaveBeenLastCalledWith("saved","Renamed",expect.anything(),3,1);

    let resolve!: (value: DraftRecord) => void;
    h.load.mockReturnValueOnce(new Promise<DraftRecord>(done => { resolve = done; }));
    h.list.mockResolvedValue([row("Renamed")]);
    fireEvent.click(screen.getByRole("button",{name:"Back to automations"}));
    fireEvent.click(await screen.findByRole("button",{name:"Renamed"}));
    expect(screen.getByText("Loading automation…")).toBeVisible();
    expect(screen.queryByLabelText("Automation name")).toBeNull();
    resolve(record("Renamed",4));
    await waitFor(() => expect(nameField()).toHaveValue("Renamed"));

    h.save.mockResolvedValueOnce({id:"saved",revision:5});
    fireEvent.change(nameField(),{target:{value:"Renamed again"}});
    fireEvent.click(screen.getByRole("button",{name:"Save draft"}));
    expect(await screen.findByText("Draft saved.")).toBeVisible();
    expect(h.save).toHaveBeenLastCalledWith("saved","Renamed again",expect.anything(),4,1);
  });
});

describe("an open draft and the network", () => {
  it("keeps the editor and its unsaved changes when the window regains focus while the network is down", async () => {
    h.load.mockResolvedValueOnce(record("Old name",3));
    mount("/automations?workflow=saved");
    await waitFor(() => expect(nameField()).toHaveValue("Old name"));
    fireEvent.change(nameField(),{target:{value:"Unsaved edit"}});
    h.load.mockRejectedValue(new Error("offline"));
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise(done => setTimeout(done, 50));
    focusManager.setFocused(undefined);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(nameField()).toHaveValue("Unsaved edit");
    expect(h.load).toHaveBeenCalledTimes(1);
  });
});

describe("leaving a draft with unsaved changes", () => {
  it("asks once from Back to automations, and confirming leaves", async () => {
    h.load.mockResolvedValueOnce(record("Old name",3));
    h.list.mockResolvedValue([row("Old name")]);
    mount("/automations?workflow=saved");
    await waitFor(() => expect(nameField()).toHaveValue("Old name"));
    fireEvent.change(nameField(),{target:{value:"Unsaved"}});
    fireEvent.click(screen.getByRole("button",{name:"Back to automations"}));
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button",{name:"Leave without saving"}));
    expect(await screen.findByRole("button",{name:"Old name"})).toBeVisible();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(address()).toBe("/automations");
    expect(h.save).not.toHaveBeenCalled();
  });

  it("holds a sidebar link until the author confirms, and holds nothing while the draft is saved", async () => {
    h.load.mockResolvedValueOnce(record("Old name",3));
    mount("/automations?workflow=saved");
    await waitFor(() => expect(nameField()).toHaveValue("Old name"));
    fireEvent.change(nameField(),{target:{value:"Unsaved"}});
    fireEvent.click(screen.getByRole("link",{name:"Dashboard"}));
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(address()).toBe("/automations?workflow=saved");
    fireEvent.click(screen.getByRole("button",{name:"Keep editing"}));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(nameField()).toHaveValue("Unsaved");
    fireEvent.click(screen.getByRole("link",{name:"Dashboard"}));
    fireEvent.click(screen.getByRole("button",{name:"Leave without saving"}));
    expect(address()).toBe("/dashboard");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("does not ask when nothing is unsaved, or when a new automation is saved and its address changes", async () => {
    h.save.mockResolvedValueOnce({id:"created",revision:1});
    h.status.mockImplementation(async () => ({id:"created",status:"draft",revision:1,trigger_type:null,controls:null}));
    mount("/automations?workflow=new");
    fireEvent.change(nameField(),{target:{value:"Brand new"}});
    fireEvent.click(screen.getByRole("button",{name:"Save draft"}));
    expect(await screen.findByText("Draft saved.")).toBeVisible();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(address()).toMatch(/^\/automations\?workflow=(?!new)/);
    fireEvent.click(screen.getByRole("link",{name:"Dashboard"}));
    expect(address()).toBe("/dashboard");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
