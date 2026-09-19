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

import { toast } from "sonner";

import ImportLeadsModal from "@/components/contacts/ImportLeadsModal";

const ME = "11111111-1111-1111-1111-111111111111";
const cf = (id: string, name: string, extra: Record<string, any> = {}) => ({
  id, name, type: "Text", appliesTo: ["Leads"], required: false, active: true,
  defaultValue: "", dropdownOptions: [],
  scope: "personal", createdBy: ME, createdAt: "2026-08-04T18:31:30Z",
  ...extra,
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

/** The step-2 "Continue to Review" button (distinct from step 1's "Continue"). */
function continueToReview(): HTMLButtonElement {
  return screen.getByText("Continue to Review").closest("button") as HTMLButtonElement;
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

    const select = mappingSelect(container, 3);
    const opts = Array.from(select.options);
    const custom = opts.find((o) => o.value === "custom:cf-x")!;
    expect(custom).toBeTruthy();
    // The "(Custom)" decoration now lives on the GROUP heading, not on every row.
    expect(custom.textContent).toBe("New Field");
    expect(custom.parentElement).toBeInstanceOf(HTMLOptGroupElement);
    expect((custom.parentElement as HTMLOptGroupElement).label).toBe("Custom Fields");
    // ...while the value stays undecorated and id-based.
    expect(custom.value).not.toContain("Custom)");
  });

  it("groups built-ins and custom fields under separate headings, with the sentinels outside both", async () => {
    state.customFields.push(cf("cf-x", "New Field"));
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("Unrelated Column"));

    const select = mappingSelect(container, 3);
    const groups = Array.from(select.querySelectorAll("optgroup")).map((g) => g.label);
    expect(groups).toEqual(["AgentFlow Fields", "Custom Fields"]);

    const topLevel = Array.from(select.children).filter(
      (c): c is HTMLOptionElement => c.tagName === "OPTION",
    );
    expect(topLevel.map((o) => o.value)).toEqual(["Do Not Import", "__create_new__"]);

    const firstName = Array.from(select.options).find((o) => o.value === "First Name")!;
    expect((firstName.parentElement as HTMLOptGroupElement).label).toBe("AgentFlow Fields");
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

describe("Reuse before create — one logical name per agency", () => {
  it("REUSES an existing visible field instead of inserting another definition", async () => {
    state.customFields.push(cf("cf-x", "Gender"));
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("Unrelated Column"));

    fireEvent.change(mappingSelect(container, 3), { target: { value: "__create_new__" } });
    const nameInput = await screen.findByDisplayValue("Unrelated Column");
    fireEvent.change(nameInput, { target: { value: "  gender  " } });
    fireEvent.click(screen.getByText(/Create & Map Field/i));

    // No INSERT, and the column is mapped to the field that already exists.
    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-x"));
    expect(state.createCalls).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/already exists and was selected/i));
  });

  it("reuses the logical field when duplicates exist, still without inserting", async () => {
    state.customFields.push(
      cf("cf-1", "Gender", { createdBy: "u1", createdAt: "2026-08-04T00:00:00Z" }),
      cf("cf-2", "Gender", { createdBy: "u2", createdAt: "2026-08-05T00:00:00Z" }),
    );
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("Unrelated Column"));

    fireEvent.change(mappingSelect(container, 3), { target: { value: "__create_new__" } });
    const nameInput = await screen.findByDisplayValue("Unrelated Column");
    fireEvent.change(nameInput, { target: { value: "GENDER" } });
    fireEvent.click(screen.getByText(/Create & Map Field/i));

    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-1"));
    expect(state.createCalls).toHaveLength(0);
  });

  it("MAPS TO THE BUILT-IN instead of letting a custom field shadow it", async () => {
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("Unrelated Column"));

    fireEvent.change(mappingSelect(container, 3), { target: { value: "__create_new__" } });
    const nameInput = await screen.findByDisplayValue("Unrelated Column");
    fireEvent.change(nameInput, { target: { value: "date of birth" } });
    fireEvent.click(screen.getByText(/Create & Map Field/i));

    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("Date of Birth"));
    expect(state.createCalls).toHaveLength(0);
  });

  it("selects the field when the DB guard rejects but a refetch makes it visible", async () => {
    // The definition existed all along; this client simply had not loaded it yet.
    state.createImpl = () => {
      const e: any = new Error("A custom field named \"Gender\" already exists in this organization.");
      e.code = "23505";
      state.customFields.push(cf("cf-late", "Gender", { createdBy: "someone-else" }));
      return Promise.reject(e);
    };
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("Unrelated Column"));

    fireEvent.change(mappingSelect(container, 3), { target: { value: "__create_new__" } });
    const nameInput = await screen.findByDisplayValue("Unrelated Column");
    fireEvent.change(nameInput, { target: { value: "Gender" } });
    fireEvent.click(screen.getByText(/Create & Map Field/i));

    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-late"));
  });

  it("FAILS CLOSED when the guard rejects and the definition stays invisible", async () => {
    // The agency owns "Gender" in another user's PERSONAL scope. RLS hides it, so a refetch
    // still cannot see it. Importing by name would write into a definition this account could
    // never resolve through the normal contact-field read path — so nothing is mapped.
    state.createImpl = () => {
      const e: any = new Error("A custom field named \"Gender\" already exists in this organization.");
      e.code = "23505";
      return Promise.reject(e);
    };
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("Unrelated Column"));

    fireEvent.change(mappingSelect(container, 3), { target: { value: "__create_new__" } });
    const nameInput = await screen.findByDisplayValue("Unrelated Column");
    fireEvent.change(nameInput, { target: { value: "Gender" } });
    fireEvent.click(screen.getByText(/Create & Map Field/i));

    // Returned to Do Not Import — never a name-only mapping into an invisible field.
    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("Do Not Import"));
    expect(
      Array.from(mappingSelect(container, 3).options).some((o) => o.value.startsWith("custom:")),
    ).toBe(false);

    // And the reason persists on the row after the toast is gone.
    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toMatch(/already exists in this agency/i);
    expect(notice.textContent).toMatch(/isn't available to your account/i);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Ask an Admin/i));
  });

  it("clears the blocked-field notice once the user maps that column themselves", async () => {
    state.createImpl = () => {
      const e: any = new Error("A custom field named \"Gender\" already exists in this organization.");
      e.code = "23505";
      return Promise.reject(e);
    };
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("Unrelated Column"));

    fireEvent.change(mappingSelect(container, 3), { target: { value: "__create_new__" } });
    fireEvent.change(await screen.findByDisplayValue("Unrelated Column"), { target: { value: "Gender" } });
    fireEvent.click(screen.getByText(/Create & Map Field/i));
    await screen.findByRole("alert");

    fireEvent.change(mappingSelect(container, 3), { target: { value: "Notes" } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
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

  // INVERTED by the Custom-Field Canonicalization build: physical duplicates of one
  // canonical name are ONE logical field and auto-match normally.
  it("auto-matches when two custom fields normalize identically, offering ONE option", async () => {
    state.customFields.push(
      cf("cf-a", "New Field", { createdBy: "u1", createdAt: "2026-08-04T00:00:00Z" }),
      cf("cf-b", "new  field", { createdBy: "u2", createdAt: "2026-08-06T00:00:00Z" }),
    );
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("New Field"));

    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-a"));
    const customOpts = Array.from(mappingSelect(container, 3).options).filter((o) =>
      o.value.startsWith("custom:"),
    );
    expect(customOpts).toHaveLength(1);
  });

  it("auto-matches THREE physical duplicates owned by three different users", async () => {
    state.customFields.push(
      cf("cf-1", "Gender", { createdBy: "admin", createdAt: "2026-08-04T18:31:30Z" }),
      cf("cf-2", "Gender", { createdBy: "agent-1", createdAt: "2026-08-05T16:05:05Z" }),
      cf("cf-3", "Gender", { createdBy: "agent-2", createdAt: "2026-08-05T18:57:41Z" }),
    );
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("Gender"));

    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-1"));
    expect(
      Array.from(mappingSelect(container, 3).options).filter((o) => o.value.startsWith("custom:")),
    ).toHaveLength(1);
  });

  it("prefers an agency-wide definition over a personal one as the representative", async () => {
    state.customFields.push(
      cf("cf-personal", "Gender", { createdBy: "u1", createdAt: "2020-01-01T00:00:00Z" }),
      cf("cf-agency", "Gender", { scope: "agency", createdBy: null, createdAt: "2026-09-01T00:00:00Z" }),
    );
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("Gender"));

    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-agency"));
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

describe("Logical collapse keeps the mapping gates correct", () => {
  it("does not block Continue when a REQUIRED field has several physical rows", async () => {
    // The required check used to match by physical id. Only the logical representative is
    // offered as an option, so the other rows could never be "mapped" and Continue stayed
    // disabled forever. It now matches by canonical NAME — which is also what
    // leads.custom_fields is keyed by.
    state.customFields.push(
      cf("cf-1", "Gender", { required: true, createdBy: "u1", createdAt: "2026-08-04T00:00:00Z" }),
      cf("cf-2", "Gender", { required: true, createdBy: "u2", createdAt: "2026-08-05T00:00:00Z" }),
      cf("cf-3", "Gender", { required: true, createdBy: "u3", createdAt: "2026-08-06T00:00:00Z" }),
    );
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("Gender"));

    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-1"));
    await waitFor(() =>
      expect(continueToReview().disabled).toBe(false),
    );
  });

  it("still blocks Continue while a required custom field is genuinely unmapped", async () => {
    state.customFields.push(cf("cf-1", "Gender", { required: true }));
    const { container } = renderModal();
    await uploadAndMap(container, csvWith("Unrelated Column"));

    await waitFor(() => expect(screen.getByText("Map Your Fields")).toBeTruthy());
    expect(continueToReview().disabled).toBe(true);

    fireEvent.change(mappingSelect(container, 3), { target: { value: "custom:cf-1" } });
    await waitFor(() =>
      expect(continueToReview().disabled).toBe(false),
    );
  });

  it("flags two columns mapped to the SAME logical field as a duplicate mapping", async () => {
    // Before the collapse these were two DIFFERENT option values, so the duplicate check
    // missed them entirely — and both resolved to the canonical name "Gender", silently
    // colliding in the payload with last-write-wins.
    state.customFields.push(
      cf("cf-1", "Gender", { createdBy: "u1", createdAt: "2026-08-04T00:00:00Z" }),
      cf("cf-2", "Gender", { createdBy: "u2", createdAt: "2026-08-05T00:00:00Z" }),
    );
    const { container } = renderModal();
    await uploadAndMap(
      container,
      "First Name,Last Name,Phone,Gender,Sex\nJane,Doe,5551112222,F,F\n",
    );

    await waitFor(() => expect(mappingSelect(container, 3).value).toBe("custom:cf-1"));
    fireEvent.change(mappingSelect(container, 4), { target: { value: "custom:cf-1" } });

    await waitFor(() => expect(screen.getAllByText("Already mapped").length).toBeGreaterThan(0));
    expect(continueToReview().disabled).toBe(true);
  });
});
