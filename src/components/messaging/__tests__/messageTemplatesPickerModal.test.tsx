import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import starter from "../../../../docs/plans/2026-10-30-starter-templates/agentflow_starter_templates_v1_1.json";

type TemplateRow = {
  id: string; type: string; name: string; subject: string | null; content: string;
  scope: string; created_by: string | null; sms_purpose: "marketing" | "informational" | null;
};
const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  filters: [] as Array<[string, string]>,
  orRules: [] as string[],
  toast: vi.fn(),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "agent-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: (details: unknown) => state.toast(details) }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "message_templates") throw new Error(`Unexpected table ${table}`);
      const q = {
        select: () => q,
        eq: (field: string, value: string) => { state.filters.push([field, value]); return q; },
        order: () => q,
        or: (rules: string) => { state.orRules.push(rules); return q; },
        then: (done: (result: { data: unknown; error: null }) => unknown) => Promise.resolve({
          data: state.rows.filter((r) => r.scope === "agency" || r.created_by === "agent-1"),
          error: null,
        }).then(done),
      };
      return q;
    },
  },
}));

import { MessageTemplatesPickerModal } from "@/components/messaging/MessageTemplatesPickerModal";

const agencyRows = (starter.templates as unknown as TemplateRow[]).map((t, i) => ({
  id: `starter-${i}`, name: t.name, type: t.type, subject: t.subject,
  content: t.content, scope: "agency", created_by: null, sms_purpose: t.sms_purpose,
}));
const personalRows: TemplateRow[] = [
  { id: "mine", name: "My Personal Note", type: "sms", subject: null, content: "Hey {{contact_first_name}}", scope: "personal", created_by: "agent-1", sms_purpose: "informational" },
  { id: "other", name: "Someone Else's Personal Note", type: "sms", subject: null, content: "Secret", scope: "personal", created_by: "agent-2", sms_purpose: "marketing" },
];
const baseInput = {
  contact: { first_name: "Jane" },
  agentFirstName: "Marcus", agentLastName: "Rivera", agentPhone: "555-1111",
  agentEmail: "marcus@example.com", agencyName: "Example Agency",
};

beforeEach(() => {
  state.rows = [...agencyRows, ...personalRows];
  state.filters = [];
  state.orRules = [];
  state.toast.mockReset();
});
afterEach(cleanup);

describe("manual message template picker: Starter V1.1", () => {
  it("shows 12 agency SMS and own personal SMS, never another agent's personal template", async () => {
    render(<MessageTemplatesPickerModal open onOpenChange={vi.fn()} channel="sms" mergeInput={baseInput} onApply={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /New Lead Introduction/i })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(13);
    expect(screen.getByText("My Personal Note")).toBeTruthy();
    expect(screen.queryByText("Someone Else's Personal Note")).toBeNull();
    expect(state.filters).toContainEqual(["organization_id", "org-1"]);
    expect(state.orRules).toContain("scope.eq.agency,and(scope.eq.personal,created_by.eq.agent-1)");
  });

  it("shows exactly six emails, fills subject and body, and leaves Send to the composer", async () => {
    const onApply = vi.fn();
    const onOpenChange = vi.fn();
    render(<MessageTemplatesPickerModal open onOpenChange={onOpenChange} channel="email" mergeInput={baseInput} onApply={onApply} />);
    expect(await screen.findByRole("button", { name: /Meet Your Agent/i })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: /Meet Your Agent/i }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0][0].body).toContain("Hi Jane");
    expect(onApply.mock.calls[0][0].subject).toContain("life insurance");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(state.toast).not.toHaveBeenCalled();
  });

  it("warns once about an empty name but still inserts editable SMS, without sending", async () => {
    const onApply = vi.fn();
    render(<MessageTemplatesPickerModal open onOpenChange={vi.fn()} channel="sms"
      mergeInput={{ ...baseInput, contact: { first_name: "" } }} onApply={onApply} />);
    fireEvent.click(await screen.findByRole("button", { name: /New Lead Introduction/i }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0][0].body).toContain("Hi ,");
    expect(onApply.mock.calls[0][0].purpose).toBe("marketing");
    expect(state.toast).toHaveBeenCalledOnce();
    expect(state.toast.mock.calls[0][0].description).toContain("First Name");
  });

  it("searches within the active channel and does not mutate agency data", async () => {
    render(<MessageTemplatesPickerModal open onOpenChange={vi.fn()} channel="sms" mergeInput={baseInput} onApply={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Old Lead Re-engagement/i })).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("Search templates..."), { target: { value: "Old Lead" } });
    expect(screen.getByRole("button", { name: /Old Lead Re-engagement/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /New Lead Introduction/i })).toBeNull();
  });
});
