import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";

type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null };
type Query = { table: string; select: string; eqs: Array<[string, unknown]>; signal: AbortSignal; resolve: (r: Result) => void };

const { db, identity, attach, toastMock } = vi.hoisted(() => ({
  db: { queries: [] as Query[], auto: null as null | ((q: Query) => Result) },
  identity: { orgId: "org-a" as string | null, userId: "agent-1", role: "Agent", isSuperAdmin: false },
  attach: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const q = { table, select: "", eqs: [] } as unknown as Query;
      const chain = {
        select: (cols: string) => { q.select = cols; return chain; },
        eq: (col: string, val: unknown) => { q.eqs.push([col, val]); return chain; },
        order: () => chain,
        abortSignal: (signal: AbortSignal) => {
          q.signal = signal;
          db.queries.push(q);
          return new Promise<Result>((resolve) => {
            q.resolve = resolve;
            if (db.auto) resolve(db.auto(q));
          });
        },
      };
      return chain;
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: identity.userId },
    profile: { role: identity.role, is_super_admin: identity.isSuperAdmin },
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: identity.orgId }) }));
vi.mock("@/lib/supabase-campaign-leads", () => ({ addLeadsToCampaignBatched: attach }));
vi.mock("sonner", () => ({ toast: toastMock }));

import AddToCampaignModal from "@/components/contacts/AddToCampaignModal";

const campaign = (id: string, type: string, user_id: string | null, assigned: string[] = [], status = "Active") => ({
  id, name: id, type, status, user_id, assigned_agent_ids: assigned, total_leads: 2,
});

const ORG_A_ROWS = [
  campaign("A Personal mine", "Personal", "agent-1", ["agent-1"]),
  campaign("A Personal other", "Personal", "agent-2", ["agent-2"]),
  campaign("A Team mine", "Team", "admin-1", ["agent-1", "agent-2"]),
  campaign("A Team other", "Team", "admin-1", ["agent-2"]),
  campaign("A Open Pool", "Open Pool", "admin-1"),
];
const ORG_B_ROWS = [campaign("B Open Pool", "Open Pool", "admin-9")];
const rowsFor = (q: Query) => {
  const org = q.eqs.find(([c]) => c === "organization_id")?.[1];
  return org === "org-a" ? ORG_A_ROWS : org === "org-b" ? ORG_B_ROWS : [];
};

const contact = { id: "lead-1", firstName: "Jane", lastName: "Doe", phone: "5551112222", email: "", state: "NV" };
const ui = (open = true) => (
  <AddToCampaignModal open={open} onClose={vi.fn()} selectedContacts={[contact]} onSuccess={vi.fn()} />
);
const addButton = () => screen.getByRole("button", { name: "Add to Campaign" });

beforeEach(() => {
  cleanup();
  db.queries.length = 0;
  db.auto = (q) => ({ data: rowsFor(q), error: null });
  Object.assign(identity, { orgId: "org-a", userId: "agent-1", role: "Agent", isSuperAdmin: false });
  attach.mockReset();
  Object.values(toastMock).forEach((fn) => fn.mockReset());
});

describe("AddToCampaignModal — campaign visibility", () => {
  it("shows an Agent their own Personal, assigned Team and Open Pool campaigns (production regression)", async () => {
    render(ui());
    expect(await screen.findByText("A Personal mine")).toBeInTheDocument();
    expect(screen.getByText("A Team mine")).toBeInTheDocument();
    expect(screen.getByText("A Open Pool")).toBeInTheDocument();
    expect(screen.queryByText("A Personal other")).not.toBeInTheDocument();
    expect(screen.queryByText("A Team other")).not.toBeInTheDocument();
  });

  it("reads only this organization's Active campaigns, with the scope columns", async () => {
    render(ui());
    await screen.findByText("A Open Pool");
    expect(db.queries).toHaveLength(1);
    const [q] = db.queries;
    expect(q.table).toBe("campaigns");
    expect(q.select).toContain("user_id");
    expect(q.select).toContain("assigned_agent_ids");
    expect(q.eqs).toEqual([["organization_id", "org-a"], ["status", "Active"]]);
  });

  it("shows a Team Leader their own Personal and every Team campaign, but no other Personal", async () => {
    Object.assign(identity, { userId: "tl-1", role: "Team Leader" });
    const tlRows = [...ORG_A_ROWS, campaign("A Personal tl", "Personal", "tl-1", ["tl-1"])];
    db.auto = () => ({ data: tlRows, error: null });
    render(ui());
    expect(await screen.findByText("A Personal tl")).toBeInTheDocument();
    expect(screen.getByText("A Team other")).toBeInTheDocument();
    expect(screen.queryByText("A Personal mine")).not.toBeInTheDocument();
  });

  it("keeps Admin visibility of every campaign in the organization", async () => {
    Object.assign(identity, { userId: "admin-1", role: "Admin" });
    render(ui());
    await screen.findByText("A Open Pool");
    for (const r of ORG_A_ROWS) expect(screen.getByText(r.id)).toBeInTheDocument();
  });
});

describe("AddToCampaignModal — loading, error and empty states", () => {
  it("shows loading until the read settles, then the list", async () => {
    db.auto = null;
    render(ui());
    expect(screen.getByRole("status", { name: "Loading campaigns" })).toBeInTheDocument();
    await act(async () => db.queries[0].resolve({ data: ORG_A_ROWS, error: null }));
    expect(screen.queryByRole("status", { name: "Loading campaigns" })).not.toBeInTheDocument();
    expect(screen.getByText("A Open Pool")).toBeInTheDocument();
  });

  it("shows a load failure as an error with Retry, never as an empty result", async () => {
    db.auto = () => ({ data: null, error: { message: "boom" } });
    render(ui());
    expect(await screen.findByText("Campaigns couldn't be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No active campaigns found")).not.toBeInTheDocument();

    db.auto = (q) => ({ data: rowsFor(q), error: null });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("A Open Pool")).toBeInTheDocument();
    expect(db.queries).toHaveLength(2);
  });

  it("shows the empty state only when the read succeeds with no campaigns", async () => {
    db.auto = () => ({ data: [], error: null });
    render(ui());
    expect(await screen.findByText("No active campaigns found")).toBeInTheDocument();
  });

  it("sends no read and says so when the organization is missing", async () => {
    identity.orgId = null;
    render(ui());
    expect(screen.getByText("Campaigns aren't available without an organization.")).toBeInTheDocument();
    expect(db.queries).toHaveLength(0);
  });

  it("clears the campaign search when the modal is reopened", async () => {
    const { rerender } = render(ui());
    await screen.findByText("A Open Pool");
    fireEvent.change(screen.getByLabelText("Search campaigns"), { target: { value: "team" } });
    expect(screen.queryByText("A Open Pool")).not.toBeInTheDocument();
    rerender(ui(false));
    rerender(ui(true));
    expect(screen.getByLabelText("Search campaigns")).toHaveValue("");
    expect(await screen.findByText("A Open Pool")).toBeInTheDocument();
    expect(db.queries).toHaveLength(2); // every open is a fresh read
  });
});

describe("AddToCampaignModal — identity changes", () => {
  it("never shows a late response from the previous organization", async () => {
    db.auto = null;
    const { rerender } = render(ui());
    identity.orgId = "org-b";
    rerender(ui());
    expect(db.queries.map((q) => q.signal.aborted)).toEqual([true, false]);

    await act(async () => db.queries[1].resolve({ data: ORG_B_ROWS, error: null }));
    await act(async () => db.queries[0].resolve({ data: ORG_A_ROWS, error: null }));
    expect(screen.getByText("B Open Pool")).toBeInTheDocument();
    expect(screen.queryByText("A Open Pool")).not.toBeInTheDocument();
  });

  it("masks the previous organization's list immediately while the new one loads", async () => {
    const { rerender } = render(ui());
    await screen.findByText("A Open Pool");
    db.auto = null;
    identity.orgId = "org-b";
    rerender(ui());
    expect(screen.queryByText("A Open Pool")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading campaigns" })).toBeInTheDocument();
  });

  it("never shows the previous user's Personal campaigns after a user change", async () => {
    const { rerender } = render(ui());
    await screen.findByText("A Personal mine");
    identity.userId = "agent-2";
    rerender(ui());
    expect(await screen.findByText("A Personal other")).toBeInTheDocument();
    expect(screen.queryByText("A Personal mine")).not.toBeInTheDocument();
  });

  it("does not let a selection from the previous organization be submitted", async () => {
    const { rerender } = render(ui());
    fireEvent.click(await screen.findByText("A Open Pool"));
    expect(addButton()).toBeEnabled();
    identity.orgId = "org-b";
    rerender(ui());
    await screen.findByText("B Open Pool");
    expect(addButton()).toBeDisabled();
    expect(attach).not.toHaveBeenCalled();
  });
});

describe("AddToCampaignModal — adding", () => {
  it("adds the contact to the selected campaign and reports the result", async () => {
    attach.mockResolvedValue({ added: 1, skipped: 0, alreadyPresent: 0 });
    render(ui());
    fireEvent.click(await screen.findByText("A Personal mine"));
    fireEvent.click(addButton());
    await waitFor(() => expect(attach).toHaveBeenCalledWith("A Personal mine", ["lead-1"]));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("1 leads added to A Personal mine", expect.anything()));
  });

  it("says Already in Campaign for an existing member instead of not eligible", async () => {
    attach.mockResolvedValue({ added: 0, skipped: 1, alreadyPresent: 1 });
    render(ui());
    fireEvent.click(await screen.findByText("A Team mine"));
    fireEvent.click(addButton());
    await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith("Already in A Team mine", expect.anything()));
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("shows a permission message when the server refuses the campaign", async () => {
    attach.mockRejectedValue({ code: "42501", message: "not authorized for campaign x" });
    render(ui());
    fireEvent.click(await screen.findByText("A Open Pool"));
    fireEvent.click(addButton());
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("You don't have permission to add leads to this campaign."));
  });
});
