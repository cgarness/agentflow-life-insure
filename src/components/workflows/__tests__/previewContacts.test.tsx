import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PreviewForm from "../review/PreviewForm";
import ReviewSteps from "../review/ReviewSteps";
import { orderedSteps } from "../lib/draftGraph";
import type { AutomationGraph } from "../../../../supabase/functions/_shared/automations/graph";

// The preview reads campaign and disposition choices. Nothing here reaches a server.
vi.mock("../useAutomationOptions", () => ({
  useCampaignOptions: () => ({items: [], hasNextPage: false, isFetchingNextPage: false, isError: false, fetchNextPage: vi.fn(), refetch: vi.fn()}),
  useDispositionOptions: () => ({data: [{id: DISPOSITION, name: "Appointment Set"}], isError: false, refetch: vi.fn()}),
}));

afterEach(cleanup);

const DISPOSITION = "5f0f6d43-3c62-4c35-9d1c-3e0f4c2f9a11";
const graph = (trigger: "disposition_recorded" | "lead_created"): AutomationGraph => ({format: 1, nodes: [
  {id: "start", type: trigger, version: 1, config: trigger === "disposition_recorded" ? {disposition_ids: [DISPOSITION]} : {}},
  {id: "sms", type: "send_sms", version: 2, config: {body: "Hi {{first_name}}"}},
  {id: "task", type: "create_task", version: 1, config: {title: "Call {{first_name}}", task_type: "Follow Up", due_amount: 5, due_unit: "minutes"}},
], edges: [{id: "e1", source: "start", target: "sms"}, {id: "e2", source: "sms", target: "task"}],
settings: {reentry: "once", stop_on_reply: false}});
const results = () => within(screen.getByRole("list", {name: "Preview results"})).getAllByRole("listitem");

describe("preview for clients and recruits", () => {
  it("shows a text as skipped for a client or recruit, while the task still runs", () => {
    render(<PreviewForm graph={graph("disposition_recorded")} scope="org" senders={{}}/>);
    fireEvent.change(screen.getByLabelText("First name"), {target: {value: "Sam"}});
    fireEvent.change(screen.getByLabelText("Phone"), {target: {value: "+12025550123"}});
    const contact = screen.getByLabelText("Test contact");
    expect(within(contact).getAllByRole("option").map(option => option.textContent)).toEqual(["Lead", "Client", "Recruit"]);
    // A lead gets the text.
    expect(results().map(row => row.textContent)).toEqual([
      expect.stringContaining("synthetic event qualifies"), expect.stringContaining("Hi Sam"), expect.stringContaining("Call Sam"),
    ]);
    for (const kind of ["client", "recruit"]) {
      fireEvent.change(contact, {target: {value: kind}});
      const [, text, task] = results();
      expect(text).toHaveTextContent("Skipped for a " + kind + ": automated texts and emails go to leads only. The run continues.");
      expect(text).not.toHaveTextContent("Hi Sam");
      expect(task).toHaveTextContent("Call Sam");
    }
  });

  it("offers no contact choice for a trigger that only ever starts a run for a lead", () => {
    render(<PreviewForm graph={graph("lead_created")} scope="org" senders={{}}/>);
    expect(screen.queryByLabelText("Test contact")).toBeNull();
  });

  it("says in the publish review that a client or recruit skips each message", () => {
    const {rerender} = render(<ReviewSteps steps={orderedSteps(graph("disposition_recorded"))} names={{}} senders={{}}
      triggerType="disposition_recorded"/>);
    expect(screen.getByText("Texts and emails go to leads only. A client or recruit skips this step and the run continues.")).toBeVisible();
    rerender(<ReviewSteps steps={orderedSteps(graph("lead_created"))} names={{}} senders={{}} triggerType="lead_created"/>);
    expect(screen.queryByText(/Texts and emails go to leads only/)).toBeNull();
  });
});
