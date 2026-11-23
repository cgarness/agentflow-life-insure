import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AutomationActivity } from "../AutomationActivity";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({supabase: {rpc}}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({profile: {id: "viewer", organization_id: "agency"}, automationSessionRevision: 7}),
}));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({formatDateTime: (value: string) => "agency format " + value}),
}));

afterEach(() => { cleanup(); rpc.mockReset(); });

it("loads older scoped activity with the original timestamp and run ID", async () => {
  const run = {
    updated_at: "2026-11-20T12:00:00.234567+00:00", contact_name: "Contact", status: "held",
    node_type: "wait", version_revision: 2, can_stop: false,
  };
  rpc.mockResolvedValueOnce({data: Array.from({length: 100}, (_, i) => ({
    ...run, run_id: String(i), workflow_name: "Recent automation",
  }))}).mockResolvedValueOnce({data: [{...run, run_id: "old", workflow_name: "Older automation"}]});
  render(<AutomationActivity workflowId="selected" />);
  fireEvent.click(await screen.findByRole("button", {name: "Load older activity"}));
  expect(await screen.findByText("Older automation")).toBeInTheDocument();
  expect(screen.getAllByText("Recent automation")).toHaveLength(100);
  // Times use the agency's date and time format, as the rest of the contact screen does.
  expect(screen.getAllByText("agency format " + run.updated_at)).toHaveLength(101);
  expect(rpc).toHaveBeenLastCalledWith("automation_activity", {
    p_session_revision: 7, p_viewer_id: "viewer", p_workflow: "selected", p_contact: null, p_type: null,
    p_before_run: "99", p_before_at: run.updated_at,
  });
  expect(screen.queryByRole("button", {name: "Load older activity"})).toBeNull();
});
