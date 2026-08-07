import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const { state } = vi.hoisted(() => ({
  state: {
    attach: { added: 0, skipped: 0 } as { added: number; skipped: number },
    finalize: null as any,
    retry: null as any,
    retryCalls: [] as string[],
    edgeResponse: null as any,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "tok" } } }) },
  },
}));

// The modal POSTs directly to the import-contacts Edge Function.
vi.stubGlobal("fetch", () =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(state.edgeResponse) } as unknown as Response),
);

vi.mock("@/lib/supabase-settings", () => ({
  customFieldsSupabaseApi: { getAll: () => Promise.resolve([]), create: vi.fn() },
  pipelineSupabaseApi: { getLeadStages: () => Promise.resolve([]) },
  leadSourcesSupabaseApi: { getAll: () => Promise.resolve([]), create: vi.fn() },
  contactManagementSettingsSupabaseApi: { getSettings: () => Promise.resolve(null) },
}));

vi.mock("@/lib/supabase-campaign-leads", () => ({
  addLeadsToCampaignBatched: () => Promise.resolve(state.attach),
}));

vi.mock("@/lib/supabase-import-campaign", async (orig) => {
  const actual = await orig<typeof import("@/lib/supabase-import-campaign")>();
  return {
    ...actual,
    retryImportCampaignAttachment: (id: string) => {
      state.retryCalls.push(id);
      return Promise.resolve(state.retry);
    },
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import ImportLeadsModal from "@/components/contacts/ImportLeadsModal";

const ME = "11111111-1111-1111-1111-111111111111";
const AGENT_A = "22222222-2222-2222-2222-222222222222";
const CSV = "First Name,Last Name,Phone\nJane,Doe,5551112222\nJohn,Roe,5553334444\n";
const CAMPAIGN = { id: "c-1", name: "Aged FEX", type: "Open Pool", status: "Active", user_id: ME, assigned_agent_ids: [] };

function renderModal(finalizeStatus: any, attach: { added: number; skipped: number }) {
  state.attach = attach;
  state.finalize = finalizeStatus;
  state.edgeResponse = {
    success: true,
    imported: 2,
    conflicts_count: 0,
    skipped_duplicates: 0,
    flagged_duplicates: 0,
    rejected_count: 0,
    rejected: [],
    conflicts: [],
    inserted_lead_ids: [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ],
  };
  return render(
    <ImportLeadsModal
      open
      renderAsPage
      onClose={vi.fn()}
      existingLeads={[] as any}
      onPersistImportHistory={vi.fn(async () => ({ id: "imp-1" }))}
      onFinalizeImport={vi.fn(async () => state.finalize)}
      onCampaignCreated={vi.fn(async () => ({ id: "c-1" }))}
      organizationId="org-1"
      currentUserId={ME}
      agentProfiles={[
        { id: ME, firstName: "Admin", lastName: "User" },
        { id: AGENT_A, firstName: "Chris", lastName: "Test" },
      ]}
      viewerRole="Admin"
      assignableAgentIds={[ME, AGENT_A]}
      campaigns={[CAMPAIGN]}
    />,
  );
}

/** Runs the whole wizard through to the result screen with the campaign selected. */
async function runImport(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([CSV], "leads.csv", { type: "text/csv" })] } });
  await waitFor(() => expect((screen.getByText("Continue") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText("Continue"));
  await waitFor(() => expect((screen.getByText("Continue to Review") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText("Continue to Review"));
  await waitFor(() => expect(screen.getByText("Review Your Import")).toBeTruthy());

  fireEvent.click(screen.getByText(/Add to existing campaign/i));
  await waitFor(() => expect(screen.getByText("Aged FEX")).toBeTruthy());
  fireEvent.click(screen.getByText("Aged FEX"));

  const importBtn = await screen.findByText(/^Import \d+ Leads$/);
  await waitFor(() => expect((importBtn as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(importBtn);
  await waitFor(() => expect(screen.queryByText(/leads imported and kept/i)).toBeTruthy(), { timeout: 3000 });
}

beforeEach(() => {
  cleanup();
  state.retryCalls.length = 0;
  state.retry = null;
  vi.clearAllMocks();
});

describe("Import result screen — 0/N attachment (the 106-lead shape)", () => {
  it("shows an incomplete failure state with NO green success chrome", async () => {
    const { container } = renderModal(
      { status: "campaign_failed", has_campaign: true, imported_count: 2, attached_count: 0, already_present: 0, remaining_count: 2, ineligible_count: 0 },
      { added: 0, skipped: 2 },
    );
    await runImport(container);

    // The defect: this screen used to render CheckCircle2 + "Import Complete!" regardless.
    expect(screen.queryByText("Import Complete!")).toBeNull();
    expect(screen.getByText(/campaign attachment failed/i)).toBeTruthy();
    expect(container.querySelector(".text-green-500.w-8")).toBeNull();
    // Leads are never presented as lost.
    expect(screen.getByText(/2 leads imported and kept/i)).toBeTruthy();
  });

  it("offers Retry Campaign Attachment", async () => {
    const { container } = renderModal(
      { status: "campaign_failed", has_campaign: true, imported_count: 2, attached_count: 0, already_present: 0, remaining_count: 2, ineligible_count: 0 },
      { added: 0, skipped: 2 },
    );
    await runImport(container);
    expect(screen.getByText(/Retry Campaign Attachment/i)).toBeTruthy();
  });

  it("shows truthful server-derived counts, not client arithmetic", async () => {
    const { container } = renderModal(
      { status: "campaign_failed", has_campaign: true, imported_count: 2, attached_count: 0, already_present: 0, remaining_count: 2, ineligible_count: 0 },
      { added: 0, skipped: 2 },
    );
    await runImport(container);
    expect(screen.getByText("0 attached by this import")).toBeTruthy();
    expect(screen.getByText("2 still to attach")).toBeTruthy();
  });
});

describe("Import result screen — partial attachment", () => {
  it("reports partial counts and stays non-success", async () => {
    const { container } = renderModal(
      { status: "campaign_partial", has_campaign: true, imported_count: 2, attached_count: 1, already_present: 0, remaining_count: 1, ineligible_count: 0 },
      { added: 1, skipped: 1 },
    );
    await runImport(container);
    expect(screen.queryByText("Import Complete!")).toBeNull();
    expect(screen.getByText(/campaign attachment incomplete/i)).toBeTruthy();
    expect(screen.getByText("1 attached by this import")).toBeTruthy();
    expect(screen.getByText("1 still to attach")).toBeTruthy();
    expect(screen.getByText(/Retry Campaign Attachment/i)).toBeTruthy();
  });
});

describe("Import result screen — N/N attachment", () => {
  it("reports the true completed state and offers NO retry", async () => {
    const { container } = renderModal(
      { status: "completed", has_campaign: true, imported_count: 2, attached_count: 2, already_present: 0, remaining_count: 0, ineligible_count: 0 },
      { added: 2, skipped: 0 },
    );
    await runImport(container);
    expect(screen.getByText("Import Complete!")).toBeTruthy();
    expect(screen.getByText("2 attached by this import")).toBeTruthy();
    expect(screen.queryByText(/Retry Campaign Attachment/i)).toBeNull();
  });
});

describe("Import result screen — unconfirmed finalize", () => {
  it("never renders success when the finalize result is missing", async () => {
    const { container } = renderModal(null, { added: 0, skipped: 2 });
    await runImport(container);
    expect(screen.queryByText("Import Complete!")).toBeNull();
    expect(screen.getByText(/attachment not confirmed/i)).toBeTruthy();
  });
});

describe("Import result screen — retry behaviour", () => {
  it("sends only the import id and refreshes the result from the server response", async () => {
    const { container } = renderModal(
      { status: "campaign_failed", has_campaign: true, imported_count: 2, attached_count: 0, already_present: 0, remaining_count: 2, ineligible_count: 0 },
      { added: 0, skipped: 2 },
    );
    await runImport(container);

    state.retry = {
      ok: true, status: "completed", has_campaign: true, imported_count: 2, attached_count: 2,
      newly_attached: 2, already_present: 0, ineligible_count: 0, remaining_count: 0,
    };
    fireEvent.click(screen.getByText(/Retry Campaign Attachment/i));

    await waitFor(() => expect(screen.getByText("Import Complete!")).toBeTruthy());
    expect(state.retryCalls).toEqual(["imp-1"]);
    expect(screen.getByText("2 attached by this import")).toBeTruthy();
    // Once complete, retry is withdrawn.
    expect(screen.queryByText(/Retry Campaign Attachment/i)).toBeNull();
  });

  it("keeps the failure state and does not fake success when the server refuses", async () => {
    const { container } = renderModal(
      { status: "campaign_failed", has_campaign: true, imported_count: 2, attached_count: 0, already_present: 0, remaining_count: 2, ineligible_count: 0 },
      { added: 0, skipped: 2 },
    );
    await runImport(container);

    state.retry = { ok: false, reason: "not_authorized" };
    fireEvent.click(screen.getByText(/Retry Campaign Attachment/i));

    await waitFor(() => expect(state.retryCalls).toHaveLength(1));
    expect(screen.queryByText("Import Complete!")).toBeNull();
    expect(screen.getByText(/campaign attachment failed/i)).toBeTruthy();
  });
});


describe("Import result screen — the four categories are distinct and truthful (item 4)", () => {
  it("reports attached / already present / ineligible / remaining separately", async () => {
    const { container } = renderModal(
      {
        status: "campaign_partial", has_campaign: true, imported_count: 10,
        attached_count: 4, already_present: 3, ineligible_count: 2, remaining_count: 1,
      },
      { added: 4, skipped: 6 },
    );
    await runImport(container);

    expect(screen.getByText("4 attached by this import")).toBeTruthy();
    expect(screen.getByText("3 already in the campaign")).toBeTruthy();
    expect(screen.getByText("2 not eligible for this campaign")).toBeTruthy();
    expect(screen.getByText("1 still to attach")).toBeTruthy();
    // 4 + 3 + 2 + 1 === 10
  });

  it("does NOT label ineligible leads as still-to-attach", async () => {
    const { container } = renderModal(
      {
        status: "completed_with_skips", has_campaign: true, imported_count: 5,
        attached_count: 1, already_present: 0, ineligible_count: 4, remaining_count: 0,
      },
      { added: 1, skipped: 4 },
    );
    await runImport(container);

    expect(screen.getByText("4 not eligible for this campaign")).toBeTruthy();
    expect(screen.queryByText(/still to attach/i)).toBeNull();
  });

  it("shows NO counts at all when the server omits the partition", async () => {
    const { container } = renderModal(
      { status: "campaign_failed", has_campaign: true, imported_count: 2 },
      { added: 0, skipped: 2 },
    );
    await runImport(container);
    // Never invent a zero.
    expect(screen.queryByText(/attached by this import/i)).toBeNull();
  });
});

describe("Import result screen — import with NO campaign (item 4)", () => {
  /** Runs the wizard WITHOUT selecting a campaign. */
  async function runImportNoCampaign(container: HTMLElement) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([CSV], "leads.csv", { type: "text/csv" })] } });
    await waitFor(() => expect((screen.getByText("Continue") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect((screen.getByText("Continue to Review") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText("Continue to Review"));
    await waitFor(() => expect(screen.getByText("Review Your Import")).toBeTruthy());

    const importBtn = await screen.findByText(/^Import \d+ Leads$/);
    await waitFor(() => expect((importBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(importBtn);
    await waitFor(() => expect(screen.queryByText(/leads imported and kept/i)).toBeTruthy(), { timeout: 3000 });
  }

  it("reports a true completed import with NO campaign-attachment wording, counts or retry", async () => {
    const { container } = renderModal(
      {
        status: "completed", has_campaign: false, imported_count: 2,
        attached_count: null, already_present: null, ineligible_count: null, remaining_count: null,
      },
      { added: 0, skipped: 0 },
    );
    await runImportNoCampaign(container);

    expect(screen.getByText("Import Complete!")).toBeTruthy();
    // The defect: this used to say "All imported leads were added to the campaign"
    // and "0 attached to the campaign" for an import that targeted no campaign at all.
    expect(screen.queryByText(/added to the campaign/i)).toBeNull();
    expect(screen.queryByText(/attached by this import/i)).toBeNull();
    expect(screen.queryByText(/attached to the campaign/i)).toBeNull();
    expect(screen.queryByText(/Retry Campaign Attachment/i)).toBeNull();
  });
});
