import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  toast: vi.fn(),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: (details: unknown) => state.toast(details) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => {
    if (table !== "message_templates") throw new Error(`Unexpected table ${table}`);
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      then: (done: (result: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: state.rows, error: null }).then(done),
    };
    return q;
  } },
}));
vi.mock("@/lib/supabase-settings", () => ({ pipelineSupabaseApi: {} }));
vi.mock("@/components/workflows/panels/PanelShell", () => ({
  default: ({ children, onSave }: { children: React.ReactNode; onSave: () => void }) =>
    <div><button type="button" onClick={onSave}>Save action</button>{children}</div>,
}));
vi.mock("@/components/workflows/panels/actionForms", () => ({
  SmsForm: ({ templates }: { templates: Array<{ name: string }> }) => <div data-testid="available-templates">{templates.map((t) => t.name).join("|")}</div>,
  EmailForm: ({ templates }: { templates: Array<{ name: string }> }) => <div data-testid="available-templates">{templates.map((t) => t.name).join("|")}</div>,
  StageForm: () => null, TagForm: () => null, AssignAgentForm: () => null, WebhookForm: () => null,
}));
import ActionConfigPanel from "@/components/workflows/panels/ActionConfigPanel";

const smsRows = [
  { id: "manual", name: "New Lead Introduction", type: "sms", subject: null, content: "Hi {{contact_first_name}}", sms_purpose: "marketing" },
  { id: "workflow", name: "Workflow Native", type: "sms", subject: null, content: "Hi {{first_name}}", sms_purpose: "marketing" },
];
const emailRows = [
  { id: "email-manual", name: "Meet Your Agent", type: "email", subject: "Hello {{contact_first_name}}", content: "Hi {{agent_first_name}}", sms_purpose: null },
  { id: "email-workflow", name: "Workflow Email", type: "email", subject: "Hello {{first_name}}", content: "Hi {{first_name}}", sms_purpose: null },
];
const node = (action: "send_sms" | "send_email", template: string) => ({
  id: "node-1",
  action_type: action,
  label: "Send message",
  config: { template_id: template, purpose: "marketing", body: "Test body", subject: "Test subject" },
}) as React.ComponentProps<typeof ActionConfigPanel>["node"];

beforeEach(() => { state.toast.mockReset(); state.rows = smsRows; });
afterEach(cleanup);

describe("workflow builder guards manual-only starter templates", () => {
  it("does not offer manual SMS templates and refuses to resave an incompatible selection", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ActionConfigPanel node={node("send_sms", "manual")} onSave={onSave} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("available-templates")).toHaveTextContent("Workflow Native"));
    expect(screen.getByTestId("available-templates")).not.toHaveTextContent("New Lead Introduction");
    fireEvent.click(screen.getByRole("button", { name: "Save action" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "This template is for manual messages only" }));
  });

  it("excludes manual email templates while retaining native workflow email templates", async () => {
    state.rows = emailRows;
    render(<ActionConfigPanel node={node("send_email", "email-manual")} onSave={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("available-templates")).toHaveTextContent("Workflow Email"));
    expect(screen.getByTestId("available-templates")).not.toHaveTextContent("Meet Your Agent");
  });
});
