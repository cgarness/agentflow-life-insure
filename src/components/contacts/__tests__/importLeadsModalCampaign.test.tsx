import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";

const { state } = vi.hoisted(() => ({
  state: { customFields: [] as any[] },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  },
}));

vi.mock("@/lib/supabase-settings", () => ({
  customFieldsSupabaseApi: {
    getAll: () => Promise.resolve(state.customFields),
    create: (d: any) => Promise.resolve({ ...d, id: "cf-new" }),
  },
  pipelineSupabaseApi: { getLeadStages: () => Promise.resolve([]) },
  leadSourcesSupabaseApi: { getAll: () => Promise.resolve([]), create: vi.fn() },
  contactManagementSettingsSupabaseApi: { getSettings: () => Promise.resolve(null) },
}));

vi.mock("@/lib/supabase-campaign-leads", () => ({
  addLeadsToCampaignBatched: () => Promise.resolve({ added: 0, skipped: 0 }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import type { CreateImportCampaignArgs } from "@/lib/supabase-import-campaign";
import ImportLeadsModal from "@/components/contacts/ImportLeadsModal";

const ME = "11111111-1111-1111-1111-111111111111";
const AGENT_A = "22222222-2222-2222-2222-222222222222";
const AGENT_B = "33333333-3333-3333-3333-333333333333";

const CSV = "First Name,Last Name,Phone\nJane,Doe,5551112222\nJohn,Roe,5553334444\n";

const personalOf = (owner: string, id = "c-personal") => ({
  id, name: `Personal ${owner.slice(0, 4)}`, type: "Personal", status: "Active",
  user_id: owner, assigned_agent_ids: [owner],
});
const teamWith = (participants: string[], id = "c-team") => ({
  id, name: "Team A", type: "Team", status: "Active", user_id: ME, assigned_agent_ids: participants,
});

function renderModal(overrides: Record<string, unknown> = {}) {
  // Typed with its real parameter so `mock.calls[0][0]` is a known element rather than an
  // element of a zero-length tuple (the handler is invoked with the created-campaign payload).
  const onCampaignCreated = vi.fn(async (_payload: CreateImportCampaignArgs) => ({ id: "camp-new" }));
  const utils = render(
    <ImportLeadsModal
      open
      renderAsPage
      onClose={vi.fn()}
      existingLeads={[] as any}
      onPersistImportHistory={vi.fn(async () => ({ id: "imp-1" }))}
      onFinalizeImport={vi.fn(async () => ({ status: "completed" }))}
      onCampaignCreated={onCampaignCreated}
      organizationId="org-1"
      currentUserId={ME}
      currentUserDisplayName="Admin User"
      agentProfiles={[
        { id: ME, firstName: "Admin", lastName: "User" },
        { id: AGENT_A, firstName: "Chris", lastName: "Test" },
        { id: AGENT_B, firstName: "Alexa", lastName: "Segura" },
      ]}
      viewerRole="Admin"
      assignableAgentIds={[ME, AGENT_A, AGENT_B]}
      campaigns={[]}
      {...overrides}
    />,
  );
  return { ...utils, onCampaignCreated };
}

async function reachStep3(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([CSV], "leads.csv", { type: "text/csv" })] } });
  await waitFor(() => expect((screen.getByText("Continue") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText("Continue"));
  await waitFor(() => expect(screen.getByText("Map Your Fields")).toBeTruthy());
  await waitFor(() => expect((screen.getByText("Continue to Review") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText("Continue to Review"));
  await waitFor(() => expect(screen.getByText("Review Your Import")).toBeTruthy());
}

/** The assignment <select> is the one holding the strategy values. */
function assignSelect(container: HTMLElement): HTMLSelectElement {
  const sel = Array.from(container.querySelectorAll("select")).find((s) =>
    Array.from(s.options).some((o) => o.value === "specific_agent"),
  );
  if (!sel) throw new Error("assignment select not found");
  return sel as HTMLSelectElement;
}

/** The new-campaign type <select> (Personal / Team / Open Pool). */
function typeSelect(container: HTMLElement): HTMLSelectElement {
  const sel = Array.from(container.querySelectorAll("select")).find((s) =>
    Array.from(s.options).some((o) => o.value === "Open Pool"),
  );
  if (!sel) throw new Error("campaign type select not found");
  return sel as HTMLSelectElement;
}

const typeOptions = (container: HTMLElement) =>
  Array.from(typeSelect(container).options).map((o) => o.value);

beforeEach(() => {
  cleanup();
  state.customFields.length = 0;
  vi.clearAllMocks();
});

describe("ImportLeadsModal — new-campaign type availability", () => {
  it("offers Personal for a Specific Agent import", async () => {
    const { container } = renderModal();
    await reachStep3(container);
    fireEvent.change(assignSelect(container), { target: { value: "specific_agent" } });
    fireEvent.click(screen.getByText(/Create new campaign/i));
    await waitFor(() => expect(typeOptions(container)).toContain("Personal"));
  });

  it("does NOT offer Personal for a Round Robin import", async () => {
    const { container } = renderModal();
    await reachStep3(container);
    fireEvent.change(assignSelect(container), { target: { value: "round_robin" } });
    fireEvent.click(screen.getByText(/Create new campaign/i));
    await waitFor(() => expect(typeOptions(container)).toEqual(["Team", "Open Pool"]));
  });

  it("does NOT offer Personal for an Unassigned import", async () => {
    const { container } = renderModal();
    await reachStep3(container);
    fireEvent.change(assignSelect(container), { target: { value: "unassigned" } });
    fireEvent.click(screen.getByText(/Create new campaign/i));
    await waitFor(() => expect(typeOptions(container)).toEqual(["Team", "Open Pool"]));
  });
});

describe("ImportLeadsModal — existing-campaign compatibility filtering", () => {
  it("hides a Personal campaign owned by someone other than the selected agent", async () => {
    const { container } = renderModal({
      campaigns: [personalOf(AGENT_B, "c-b"), personalOf(AGENT_A, "c-a")],
    });
    await reachStep3(container);
    fireEvent.change(assignSelect(container), { target: { value: "specific_agent" } });

    // Pick AGENT_A as the target.
    const agentSel = Array.from(container.querySelectorAll("select")).find((s) =>
      Array.from(s.options).some((o) => o.value === AGENT_A),
    ) as HTMLSelectElement;
    fireEvent.change(agentSel, { target: { value: AGENT_A } });

    fireEvent.click(screen.getByText(/Add to existing campaign/i));

    await waitFor(() => {
      expect(screen.queryByText(personalOf(AGENT_A, "c-a").name)).toBeTruthy();
    });
    expect(screen.queryByText(personalOf(AGENT_B, "c-b").name)).toBeNull();
  });

  it("hides every Personal campaign for a Round Robin import, while a covering Team stays", async () => {
    const { container } = renderModal({
      // The Team lists every assignable agent, so it stays compatible once all are in rotation.
      campaigns: [personalOf(AGENT_A, "c-a"), teamWith([ME, AGENT_A, AGENT_B])],
    });
    await reachStep3(container);
    fireEvent.change(assignSelect(container), { target: { value: "round_robin" } });

    // Put every agent in the rotation.
    const rotation = await screen.findByText(/Include in rotation/i);
    const box = rotation.parentElement as HTMLElement;
    within(box).getAllByRole("checkbox").forEach((cb) => fireEvent.click(cb));

    fireEvent.click(screen.getByText(/Add to existing campaign/i));

    await waitFor(() => expect(screen.queryByText("Team A")).toBeTruthy());
    // Personal can never receive a round-robin import, whoever owns it.
    expect(screen.queryByText(personalOf(AGENT_A, "c-a").name)).toBeNull();
  });

  it("hides a Team campaign whose participant list excludes the selected agent", async () => {
    const { container } = renderModal({ campaigns: [teamWith([AGENT_B])] });
    await reachStep3(container);
    fireEvent.change(assignSelect(container), { target: { value: "specific_agent" } });
    const agentSel = Array.from(container.querySelectorAll("select")).find((s) =>
      Array.from(s.options).some((o) => o.value === AGENT_A),
    ) as HTMLSelectElement;
    fireEvent.change(agentSel, { target: { value: AGENT_A } });
    fireEvent.click(screen.getByText(/Add to existing campaign/i));

    await waitFor(() => expect(screen.getByText(/No campaigns|no campaigns/i)).toBeTruthy());
  });
});

describe("ImportLeadsModal — Specific Agent + new Personal campaign ownership", () => {
  it("asks the server to create the campaign OWNED BY the selected agent", async () => {
    const { container, onCampaignCreated } = renderModal();
    await reachStep3(container);

    fireEvent.change(assignSelect(container), { target: { value: "specific_agent" } });
    const agentSel = Array.from(container.querySelectorAll("select")).find((s) =>
      Array.from(s.options).some((o) => o.value === AGENT_A),
    ) as HTMLSelectElement;
    fireEvent.change(agentSel, { target: { value: AGENT_A } });

    fireEvent.click(screen.getByText(/Create new campaign/i));
    const nameInput = await screen.findByPlaceholderText(/campaign name/i);
    fireEvent.change(nameInput, { target: { value: "Q3 FEX" } });
    await waitFor(() => expect(typeSelect(container).value).toBe("Personal"));

    const importBtn = screen.getByText(/^Import \d+ Leads$/);
    await waitFor(() => expect((importBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(importBtn);

    await waitFor(() => expect(onCampaignCreated).toHaveBeenCalled());
    const arg = onCampaignCreated.mock.calls[0][0] as any;
    expect(arg.type).toBe("Personal");
    // THE FIX: the selected agent, not the importing Admin.
    expect(arg.ownerId).toBe(AGENT_A);
    expect(arg.ownerId).not.toBe(ME);
    expect(arg.participantIds).toEqual([AGENT_A]);
    expect(arg.strategy).toBe("specific_agent");
  });
});
