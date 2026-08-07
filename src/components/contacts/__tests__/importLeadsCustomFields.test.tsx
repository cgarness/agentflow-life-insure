import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const { state } = vi.hoisted(() => ({
  state: {
    customFields: [] as any[],
    createCalls: [] as any[],
    createImpl: null as null | ((d: any) => Promise<any>),
    /** When set, getAll() returns this promise instead of resolving immediately. */
    deferredGetAll: null as null | Promise<any[]>,
    getAllCalls: 0,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "tok" } } }) },
  },
}));

vi.mock("@/lib/supabase-settings", () => ({
  customFieldsSupabaseApi: {
    getAll: () => {
      state.getAllCalls += 1;
      return state.deferredGetAll ?? Promise.resolve(state.customFields);
    },
    create: (d: any) => {
      state.createCalls.push(d);
      if (state.createImpl) return state.createImpl(d);
      const row = { ...d, id: `cf-${state.createCalls.length}` };
      state.customFields.push(row);
      return Promise.resolve(row);
    },
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

import ImportLeadsModal from "@/components/contacts/ImportLeadsModal";

const ME = "11111111-1111-1111-1111-111111111111";
const cf = (id: string, name: string) => ({
  id, name, type: "Text", appliesTo: ["Leads"], required: false, active: true,
  defaultValue: "", dropdownOptions: [],
});

const csvWith = (extraHeader: string) =>
  `First Name,Last Name,Phone,${extraHeader}\nJane,Doe,5551112222,hello\n`;

function renderModal() {
  return render(
    <ImportLeadsModal
      open
      renderAsPage
      onClose={vi.fn()}
      existingLeads={[] as any}
      onPersistImportHistory={vi.fn(async () => ({ id: "imp-1" }))}
      onFinalizeImport={vi.fn(async () => ({ status: "completed" }))}
      onCampaignCreated={vi.fn(async () => ({ id: "c-1" }))}
      organizationId="org-1"
      currentUserId={ME}
      agentProfiles={[{ id: ME, firstName: "Admin", lastName: "User" }]}
      viewerRole="Admin"
      assignableAgentIds={[ME]}
      campaigns={[]}
    />,
  );
}

async function uploadAndMap(container: HTMLElement, csv: string) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([csv], "leads.csv", { type: "text/csv" })] } });
  await waitFor(() => expect((screen.getByText("Continue") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText("Continue"));
  await waitFor(() => expect(screen.getByText("Map Your Fields")).toBeTruthy());
}

/** The mapping <select> for the Nth CSV column (0-based). */
function mappingSelect(container: HTMLElement, colIdx: number): HTMLSelectElement {
  const selects = Array.from(container.querySelectorAll("select")).filter((s) =>
    Array.from(s.options).some((o) => o.value === "Do Not Import"),
  );
  return selects[colIdx] as HTMLSelectElement;
}

beforeEach(() => {
  cleanup();
  state.customFields.length = 0;
  state.createCalls.length = 0;
  state.createImpl = null;
  state.deferredGetAll = null;
  state.getAllCalls = 0;
  vi.clearAllMocks();
});

describe("Custom field creation during mapping", () => {
  it("stores the UNDECORATED name and maps the originating column immediately", async () => {
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("New Field"));

    // The 4th column has no built-in match, so it starts unmapped.
    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("Do Not Import"));

    fireEvent.change(mappingSelect(container, 3), { target: { value: "__create_new__" } });
    const nameInput = await screen.findByDisplayValue("New Field");
    fireEvent.click(screen.getByText(/Create & Map Field/i));

    await waitFor(() => expect(state.createCalls).toHaveLength(1));
    // The canonical name must never carry the UI-only suffix.
    expect(state.createCalls[0].name).toBe("New Field");
    expect(state.createCalls[0].name).not.toContain("(Custom)");
    expect(nameInput).toBeTruthy();

    // Mapped in the same commit, by stable id.
    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-1"));
  });

  it("renders the dropdown option with the (Custom) display suffix", async () => {
    state.customFields.push(cf("cf-x", "New Field"));
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("Unrelated Column"));

    const opts = Array.from(mappingSelect(container, 3).options);
    const custom = opts.find((o) => o.value === "custom:cf-x")!;
    expect(custom).toBeTruthy();
    expect(custom.textContent).toBe("New Field (Custom)");
    // ...while the value stays undecorated and id-based.
    expect(custom.value).not.toContain("Custom)");
  });

  it("refuses a name containing the UI-only suffix instead of persisting it", async () => {
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("New Field"));
    fireEvent.change(mappingSelect(container, 3), { target: { value: "__create_new__" } });
    const nameInput = await screen.findByDisplayValue("New Field");
    fireEvent.change(nameInput, { target: { value: "New Field (Custom)" } });
    fireEvent.click(screen.getByText(/Create & Map Field/i));

    await waitFor(() => expect(screen.getByText(/Leave "\(Custom\)" out of the name/i)).toBeTruthy());
    expect(state.createCalls).toHaveLength(0);
  });

  it("leaves NO mapping selected when creation fails", async () => {
    state.createImpl = () => Promise.reject(new Error("insert denied"));
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("New Field"));

    fireEvent.change(mappingSelect(container, 3), { target: { value: "__create_new__" } });
    await screen.findByDisplayValue("New Field");
    fireEvent.click(screen.getByText(/Create & Map Field/i));

    await waitFor(() => expect(state.createCalls).toHaveLength(1));
    // No false selection: the column is still unmapped.
    expect(mappingSelect(container, 3).value).toBe("Do Not Import");
  });
});

describe("Auto-detection on a later upload", () => {
  const variants: Array<[string, string]> = [
    ["exact", "New Field"],
    ["lowercase", "new field"],
    ["uppercase", "NEW FIELD"],
    ["leading/trailing whitespace", "  New Field  "],
    ["repeated internal whitespace", "New    Field"],
  ];

  it.each(variants)("selects the custom field for a %s header", async (_label, header) => {
    state.customFields.push(cf("cf-x", "New Field"));
    const { container } = renderModal();
    await uploadAndMap(container, csvWith(header));

    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-x"));
  });

  it("leaves the column unmapped when two custom fields normalize identically", async () => {
    state.customFields.push(cf("cf-a", "New Field"), cf("cf-b", "new  field"));
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("New Field"));

    await waitFor(() => expect(screen.getByText("Map Your Fields")).toBeTruthy());
    expect(mappingSelect(container, 3).value).toBe("Do Not Import");
  });

  it("does not silently pick a custom field that shadows a built-in name", async () => {
    state.customFields.push(cf("cf-email", "Email"));
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("Email"));

    await waitFor(() => expect(screen.getByText("Map Your Fields")).toBeTruthy());
    expect(mappingSelect(container, 3).value).toBe("Do Not Import");
  });

  it("keeps built-in auto-detection unchanged", async () => {
    state.customFields.push(cf("cf-x", "New Field"));
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("New Field"));

    await waitFor(() => expect(mappingSelect(container, 0).value).toBe("First Name"));
    expect(mappingSelect(container, 1).value).toBe("Last Name");
    expect(mappingSelect(container, 2).value).toBe("Phone");
  });

  it("survives a rerender: a manual selection is not clobbered by re-detection", async () => {
    state.customFields.push(cf("cf-x", "New Field"));
    const { container, rerender } = renderModal();
    await uploadAndMap(container, csvWith("Unrelated Column"));

    fireEvent.change(mappingSelect(container, 3), { target: { value: "custom:cf-x" } });
    expect(mappingSelect(container, 3).value).toBe("custom:cf-x");

    rerender(
      <ImportLeadsModal
        open
        renderAsPage
        onClose={vi.fn()}
        existingLeads={[] as any}
        onPersistImportHistory={vi.fn(async () => ({ id: "imp-1" }))}
        onFinalizeImport={vi.fn(async () => ({ status: "completed" }))}
        onCampaignCreated={vi.fn(async () => ({ id: "c-1" }))}
        organizationId="org-1"
        currentUserId={ME}
        agentProfiles={[{ id: ME, firstName: "Admin", lastName: "User" }]}
        viewerRole="Admin"
        assignableAgentIds={[ME]}
        campaigns={[]}
      />,
    );

    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-x"));
  });
});


describe("Reopen/loading race (item 6)", () => {
  // renderAsPage is FALSE here: in page mode the component ignores `open`, so only modal mode
  // reproduces a close/reopen on a PERSISTED component instance — which is the whole point.
  const props = (open: boolean) => ({
    open,
    onClose: vi.fn(),
    existingLeads: [] as any,
    onPersistImportHistory: vi.fn(async () => ({ id: "imp-1" })),
    onFinalizeImport: vi.fn(async () => ({ status: "completed" })),
    onCampaignCreated: vi.fn(async () => ({ id: "c-1" })),
    organizationId: "org-1",
    currentUserId: ME,
    agentProfiles: [{ id: ME, firstName: "Admin", lastName: "User" }],
    viewerRole: "Admin",
    assignableAgentIds: [ME],
    campaigns: [],
  });

  it("waits for THIS opening's custom fields before latching auto-detection", async () => {
    // Opening 1 resolves with NO custom fields.
    const { container, rerender } = render(<ImportLeadsModal {...props(true)} />);
    await waitFor(() => expect(state.getAllCalls).toBe(1));

    // Close, then reopen with the settings request DEFERRED and a field now available.
    rerender(<ImportLeadsModal {...props(false)} />);
    let resolveGetAll!: (v: any[]) => void;
    state.deferredGetAll = new Promise<any[]>((res) => { resolveGetAll = res; });
    rerender(<ImportLeadsModal {...props(true)} />);
    await waitFor(() => expect(state.getAllCalls).toBe(2));

    // Upload BEFORE the second settings request resolves. Without the gate reset,
    // `settingsLoaded` is still true from opening 1, so detection runs against the stale/empty
    // list, latches the header key, and never re-runs.
    await uploadAndMap(container, csvWith("New Field"));
    expect(mappingSelect(container, 3).value).toBe("Do Not Import");

    resolveGetAll([cf("cf-x", "New Field")]);

    // Detection must now run against THIS opening's authoritative list.
    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-x"));
  });

  it("does not clobber a manual mapping after the deferred load resolves", async () => {
    let resolveGetAll!: (v: any[]) => void;
    state.deferredGetAll = new Promise<any[]>((res) => { resolveGetAll = res; });
    const { container } = render(<ImportLeadsModal {...props(true)} />);

    await uploadAndMap(container, csvWith("New Field"));
    resolveGetAll([cf("cf-x", "New Field"), cf("cf-y", "Other Field")]);
    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-x"));

    fireEvent.change(mappingSelect(container, 3), { target: { value: "custom:cf-y" } });
    expect(mappingSelect(container, 3).value).toBe("custom:cf-y");

    // A rerender must not re-run detection over the manual choice.
    fireEvent.change(mappingSelect(container, 0), { target: { value: "First Name" } });
    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-y"));
  });

  it("retains the loaded field list when the wizard is reset without a reload", async () => {
    // Regression guard: clearing activeLeadCustomFields/settingsLoaded inside reset() would leave
    // the "Import Another File" path with an empty list and NO reload, permanently breaking
    // detection. reset() must keep both.
    state.customFields.push(cf("cf-x", "New Field"));
    const { container } = render(<ImportLeadsModal {...props(true)} />);
    await uploadAndMap(container, csvWith("New Field"));
    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-x"));
    expect(state.getAllCalls).toBe(1);
  });
});
