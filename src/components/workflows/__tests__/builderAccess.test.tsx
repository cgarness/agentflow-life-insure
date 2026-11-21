import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import WorkflowBuilder from "@/components/settings/WorkflowBuilder";

const h = vi.hoisted(() => ({
  auth: {user:{id:"actor"},profile:{id:"actor",organization_id:"org"},automationSessionRevision:1,isImpersonating:false},
  access: {visible:true,can_author:true}, list: vi.fn(async () => []), save: vi.fn(), load: vi.fn(),
  activity: vi.fn(), folders: vi.fn(async () => []),
}));
vi.mock("@/contexts/AuthContext", () => ({useAuth: () => h.auth}));
vi.mock("@/lib/automation-api", () => ({
  useAutomationAccess: () => ({data:h.access}), automationApi: {list:h.list,save:h.save,load:h.load},
}));
vi.mock("@/lib/supabase-workflow-folders", () => ({workflowFolderApi: {list:h.folders}}));
vi.mock("@/lib/automation-channels", () => ({getAutomationChannelOptions: vi.fn()}));
vi.mock("@/components/workflows/AutomationActivity", () => ({AutomationActivity: () => {h.activity(); return <div>Scoped run history</div>;}}));
vi.mock("@/integrations/supabase/client", () => ({supabase:{}}));

function mount(path: string) {
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
    <MemoryRouter initialEntries={[path]}><WorkflowBuilder/></MemoryRouter>
  </QueryClientProvider>);
}

describe("automation entry and blank abandonment", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks(); Object.assign(h.access,{visible:true,can_author:true});
    Object.assign(h.auth,{isImpersonating:false,automationSessionRevision:1});
  });
  it("opens a blank canvas and leaves without creating a definition", async () => {
    mount("/automations");
    fireEvent.click(await screen.findByRole("button",{name:"Create automation"}));
    expect(screen.getByRole("button",{name:"Choose trigger"})).toBeVisible();
    expect(screen.getByLabelText("Automation name")).toHaveValue("");
    fireEvent.click(screen.getByRole("button",{name:"Back to automations"}));
    expect(await screen.findByRole("button",{name:"Create automation"})).toBeVisible();
    expect(h.save).not.toHaveBeenCalled();
  });
  it.each(["/automations?workflow=new","/settings?section=automation&workflow=foreign"])(
    "mounts only scoped activity on %s in View As", path => {
      h.auth.isImpersonating = true;
      mount(path);
      expect(screen.getByText("Scoped run history")).toBeVisible();
      expect(h.list).not.toHaveBeenCalled(); expect(h.load).not.toHaveBeenCalled();
      expect(h.save).not.toHaveBeenCalled(); expect(h.folders).not.toHaveBeenCalled();
    }
  );
  it.each([
    {format:1,nodes:[],edges:[]},
    {format:1,nodes:[null],edges:[],settings:{reentry:"once",stop_on_reply:false}},
    {format:1,nodes:[],edges:[null],settings:{reentry:"once",stop_on_reply:false}},
    {format:1,nodes:[{id:"x",type:"send_email",version:1}],edges:[],settings:{reentry:"once",stop_on_reply:false}},
    {format:1,nodes:[{id:"x",type:"send_email",version:99,config:{}}],edges:[],settings:{reentry:"once",stop_on_reply:false}},
  ])("opens unsupported or malformed saved graphs for inspection", async automation_graph => {
    h.load.mockResolvedValueOnce({id:"saved",name:"Existing",automation_graph});
    mount("/automations?workflow=saved");
    expect(await screen.findByText("Saved graph")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Back to automations"})).toBeVisible();
    expect(screen.queryByRole("button",{name:"Save draft"})).toBeNull();
    expect(h.save).not.toHaveBeenCalled();
  });
  it("keeps the editor and reads closed without a verified revision", () => {
    h.auth.automationSessionRevision = null;
    mount("/automations?workflow=foreign");
    expect(screen.getByRole("status")).toHaveTextContent("unavailable");
    expect(h.activity).not.toHaveBeenCalled(); expect(h.load).not.toHaveBeenCalled();
  });
});
