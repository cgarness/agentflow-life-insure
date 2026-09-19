/**
 * `additional_policies` corruption fix (BUGFIX, 2026-09-19).
 *
 * `clients.custom_fields.additional_policies` is reserved, structured AgentFlow metadata: the array
 * of extra policies written at conversion time, and — since AGENT_RULES invariant #34 — one of the
 * two stores the book of business is computed from. It has exactly ONE writer
 * (`ConvertLeadModal` -> `conversionSupabaseApi.convertLeadToClient`).
 *
 * Before this fix `FullScreenContactView` enumerated EVERY key of the `customFields` bag and handed
 * each one to `renderField`, whose default branch is a plain text `<input>`. So the policy array
 * rendered as an editable box reading "[object Object]", the first keystroke replaced the array with
 * a string, and `handleSave` persisted that string over the whole JSONB column. Permanent, with
 * nothing in the app able to rebuild it.
 *
 * This suite pins U1 (never bound to a generic editor) and U2 (an unrelated edit carries the array
 * through byte-for-structure), and proves the exclusion is ONE key and not a category — the fixture's
 * ordinary agency custom fields still render, still edit and still save.
 *
 * Harness mirrors `fullScreenContactViewQuickCall.test.tsx` / `fullScreenContactViewScore.test.tsx`
 * (the established FSCV mock pattern). Every fixture is synthetic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

/**
 * Chainable Supabase stub: every builder method returns the same thenable, so any
 * `.from(...).select(...).eq(...)` chain (awaited directly or via `.maybeSingle()`) resolves to the
 * table's configured payload.
 */
const tableData: Record<string, unknown> = {};

function makeQuery(table: string) {
  const result = { data: tableData[table] ?? null, error: null };
  const query: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of ["select", "eq", "in", "or", "not", "order", "limit", "gte", "lt", "neq", "is"]) {
    query[method] = () => query;
  }
  query.maybeSingle = () => Promise.resolve(result);
  query.single = () => Promise.resolve(result);
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => makeQuery(table) },
}));

const h = vi.hoisted(() => ({
  customFieldDefs: [] as unknown[],
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/supabase-notes", () => ({ notesSupabaseApi: { getByContact: vi.fn(async () => []) } }));
vi.mock("@/lib/supabase-activities", () => ({
  activitiesSupabaseApi: { getByContact: vi.fn(async () => []), add: vi.fn(async () => ({ id: "a1" })) },
}));
vi.mock("@/lib/supabase-settings", () => ({
  pipelineSupabaseApi: { getLeadStages: vi.fn(async () => []), getRecruitStages: vi.fn(async () => []) },
  customFieldsSupabaseApi: { getAll: vi.fn(async () => h.customFieldDefs) },
  leadSourcesSupabaseApi: { getAll: vi.fn(async () => []) },
}));
vi.mock("@/lib/supabase-email", () => ({
  emailSupabaseApi: { getMyConnections: vi.fn(async () => []), getContactEmails: vi.fn(async () => []) },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    profile: { id: "user-1", first_name: "Alexa", last_name: "Segura" },
  }),
}));
vi.mock("@/contexts/CalendarContext", () => ({ useCalendar: () => ({ addAppointment: vi.fn() }) }));
vi.mock("@/contexts/SidebarContext", () => ({ useSidebarContext: () => ({ collapsed: false }) }));
vi.mock("@/contexts/BrandingContext", () => ({
  useBranding: () => ({
    formatDate: (v: string) => v,
    formatDateTime: (v: string) => v,
    branding: { companyName: "AgentFlow" },
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasContactsPermission: () => true }),
}));

// Heavy children irrelevant to the field grid.
vi.mock("@/components/calendar/AppointmentModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/ConvertLeadModal", () => ({ default: () => null }));
vi.mock("@/components/contacts/AddToCampaignModal", () => ({ default: () => null }));
vi.mock("@/components/messaging/MessageComposePanel", () => ({ MessageComposePanel: () => null }));
vi.mock("@/components/messaging/MessageTemplatesPickerModal", () => ({
  MessageTemplatesPickerModal: () => null,
}));
vi.mock("../TasksPanel", () => ({ TasksPanel: () => null }));

import FullScreenContactView from "@/components/contacts/FullScreenContactView";
import { ADDITIONAL_POLICIES_KEY } from "@/lib/reservedCustomFields";

/** Exactly the writer's `AdditionalPolicyPayload[]` shape (src/lib/supabase-conversion.ts). */
const ADDITIONAL_POLICIES = [
  {
    policyType: "Whole Life",
    carrier: "Mutual of Omaha",
    policyNumber: "WL-4471",
    faceAmount: "$25,000",
    premiumAmount: "$150/mo",
    soldDate: "2026-04-02",
    effectiveDate: "2026-05-01",
  },
  {
    policyType: "Term",
    carrier: "Foresters",
    policyNumber: "TR-9910",
    faceAmount: "100000",
    premiumAmount: "$42.10",
    soldDate: null,
    effectiveDate: null,
  },
];

/**
 * Three ordinary agency custom fields, chosen from the keys real production clients carry:
 *   - "Gender"        — has a definition AND is placed by the saved layout
 *   - "Favorite Hobby" — has a definition, NOT in the layout (the second generic path)
 *   - "Platform"      — NO definition at all, present only in the JSONB bag (the generic loop)
 * Plus the reserved key, which must appear on none of those paths.
 */
const CLIENT_CUSTOM_FIELDS: Record<string, unknown> = {
  Gender: "F",
  "Favorite Hobby": "Gardening",
  Platform: "Facebook",
  [ADDITIONAL_POLICIES_KEY]: ADDITIONAL_POLICIES,
};

const CUSTOM_FIELD_DEFS = [
  {
    id: "cf-1",
    name: "Gender",
    type: "Text",
    appliesTo: ["Clients"],
    required: false,
    active: true,
    usageCount: 0,
  },
  {
    id: "cf-2",
    name: "Favorite Hobby",
    type: "Text",
    appliesTo: ["Clients"],
    required: false,
    active: true,
    usageCount: 0,
  },
];

const CLIENT_FIELD_ORDER_WITH_CUSTOM = [
  "firstName",
  "lastName",
  "phone",
  "email",
  "policyType",
  "carrier",
  "state",
  "policyNumber",
  "premiumAmount",
  "faceAmount",
  "soldDate",
  "effectiveDate",
  "draftDate",
  "paymentFrequency",
  "custom:Gender",
  "assignedAgentId",
  "notes",
];

const client = {
  id: "client-1",
  firstName: "Dana",
  lastName: "Reyes",
  phone: "5125550123",
  email: "dana@example.com",
  state: "TX",
  policyType: "Final Expense",
  carrier: "Americo",
  policyNumber: "FE-1001",
  premiumAmount: "$95.00",
  faceAmount: "$15,000.00",
  soldDate: "2026-03-01",
  effectiveDate: "2026-03-15",
  assignedAgentId: "user-1",
  notes: "Primary policy issued.",
  customFields: CLIENT_CUSTOM_FIELDS,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

let onUpdate: ReturnType<typeof vi.fn>;

const baseProps = () => ({
  contact: client,
  type: "client" as const,
  onClose: vi.fn(),
  onUpdate,
  onDelete: vi.fn(async () => {}),
});

/** The saved payload FullScreenContactView handed to onUpdate. */
const savedForm = () => onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1] as Record<string, any>;
const savedCustomFields = () => savedForm().customFields as Record<string, unknown>;

/** Wait for the core load (custom fields + layout) to settle. */
async function renderAndSettle() {
  render(<FullScreenContactView {...baseProps()} />);
  await waitFor(() => expect(screen.getAllByText("Carrier").length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getAllByText("Gender").length).toBeGreaterThan(0));
}

const enterEditMode = () => fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
const save = () => fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

/** Every text-ish input currently on screen. */
const allInputs = () =>
  Array.from(document.querySelectorAll("input, textarea")) as Array<HTMLInputElement | HTMLTextAreaElement>;

/** Find the editor bound to a given custom field by walking up to its labelled container. */
function inputForLabel(label: string): HTMLInputElement {
  const labelEl = Array.from(document.querySelectorAll("label")).find(
    (l) => l.textContent?.trim() === label
  );
  if (!labelEl) throw new Error(`no label "${label}" on screen`);
  const input = labelEl.parentElement?.querySelector("input, textarea, select");
  if (!input) throw new Error(`label "${label}" has no editor`);
  return input as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  onUpdate = vi.fn(async () => {});
  for (const key of Object.keys(tableData)) delete tableData[key];
  h.customFieldDefs = CUSTOM_FIELD_DEFS;
  tableData["contact_management_settings"] = {
    field_order_client: CLIENT_FIELD_ORDER_WITH_CUSTOM,
    required_fields_client: {},
  };
});

// ---------------------------------------------------------------------------------------------
// T-1 / T-2 — the reserved key is never rendered, in either mode
// ---------------------------------------------------------------------------------------------
describe("FullScreenContactView — additional_policies is never rendered generically", () => {
  it("shows no additional_policies field in READ mode", async () => {
    await renderAndSettle();
    expect(screen.queryByText(ADDITIONAL_POLICIES_KEY)).toBeNull();
    expect(screen.queryByText(/additional_policies/i)).toBeNull();
  });

  it("shows no additional_policies field in EDIT mode, and binds it to no input", async () => {
    await renderAndSettle();
    enterEditMode();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();

    expect(screen.queryByText(ADDITIONAL_POLICIES_KEY)).toBeNull();
    for (const input of allInputs()) {
      expect(input.value).not.toContain("[object Object]");
      expect(input.value).not.toContain("WL-4471");
      expect(input.value).not.toContain("Mutual of Omaha");
    }
  });

  it("never stringifies the policy array as [object Object] anywhere on screen", async () => {
    await renderAndSettle();
    expect(document.body.textContent).not.toContain("[object Object]");
    enterEditMode();
    expect(document.body.textContent).not.toContain("[object Object]");
    expect(document.body.innerHTML).not.toContain("[object Object]");
  });
});

// ---------------------------------------------------------------------------------------------
// T-3 — an unrelated edit preserves the exact array
// ---------------------------------------------------------------------------------------------
describe("FullScreenContactView — unrelated edits preserve additional_policies exactly", () => {
  const unrelated: Array<[string, string, string]> = [
    ["Phone", "phone", "5125559999"],
    ["Carrier", "carrier", "Gerber Life"],
    ["Policy #", "policyNumber", "FE-2002"],
    ["System Notes", "notes", "Called about a rider."],
  ];

  for (const [label, key, value] of unrelated) {
    it(`editing ${label} leaves the array structurally identical`, async () => {
      await renderAndSettle();
      enterEditMode();
      fireEvent.change(inputForLabel(label), { target: { value } });
      save();

      await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
      // The unrelated edit landed...
      expect(savedForm()[key]).toBeTruthy();
      // ...and the reserved key is byte-for-structure what it was: same array, same entry objects,
      // not re-parsed, not normalized, not reordered, not stringified.
      const written = savedCustomFields()[ADDITIONAL_POLICIES_KEY];
      expect(Array.isArray(written)).toBe(true);
      expect(written).toEqual(ADDITIONAL_POLICIES);
      expect(written).toBe(ADDITIONAL_POLICIES);
      expect((written as unknown[])[0]).toBe(ADDITIONAL_POLICIES[0]);
    });
  }

  it("changing the assigned agent preserves it too", async () => {
    tableData["profiles"] = [
      { id: "user-1", first_name: "Alexa", last_name: "Segura" },
      { id: "user-2", first_name: "Sam", last_name: "Ortiz" },
    ];
    await renderAndSettle();
    enterEditMode();
    const select = inputForLabel("Assigned Agent") as unknown as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "" } });
    save();

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(savedCustomFields()[ADDITIONAL_POLICIES_KEY]).toBe(ADDITIONAL_POLICIES);
  });
});

// ---------------------------------------------------------------------------------------------
// T-4 / T-8a — ordinary custom fields still render, edit and save; the array rides along untouched
// ---------------------------------------------------------------------------------------------
describe("FullScreenContactView — ordinary custom fields are unaffected", () => {
  it("renders all three ordinary fields, from all three paths, in READ mode", async () => {
    await renderAndSettle();
    // Gender: placed by the saved layout. Favorite Hobby: a definition not in the layout.
    // Platform: no definition at all — the generic JSONB loop, the very path that was corrupting.
    for (const label of ["Gender", "Favorite Hobby", "Platform"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("Facebook").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Gardening").length).toBeGreaterThan(0);
  });

  for (const [label, value] of [
    ["Gender", "M"],
    ["Favorite Hobby", "Fishing"],
    ["Platform", "Instagram"],
  ] as Array<[string, string]>) {
    it(`saving the ordinary custom field "${label}" keeps its value AND additional_policies`, async () => {
      await renderAndSettle();
      enterEditMode();
      fireEvent.change(inputForLabel(label), { target: { value } });
      save();

      await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
      const bag = savedCustomFields();
      expect(bag[label]).toBe(value);
      // Siblings survive the spread...
      expect(bag.Gender).toBeDefined();
      expect(bag["Favorite Hobby"]).toBeDefined();
      expect(bag.Platform).toBeDefined();
      // ...and so does the reserved key, unchanged.
      expect(bag[ADDITIONAL_POLICIES_KEY]).toBe(ADDITIONAL_POLICIES);
      expect(bag[ADDITIONAL_POLICIES_KEY]).toEqual(ADDITIONAL_POLICIES);
    });
  }

  it("a client with NO additional_policies still renders and saves its custom fields normally", async () => {
    const { [ADDITIONAL_POLICIES_KEY]: _omitted, ...plainBag } = CLIENT_CUSTOM_FIELDS;
    render(<FullScreenContactView {...baseProps()} contact={{ ...client, customFields: plainBag }} />);
    await waitFor(() => expect(screen.getAllByText("Gender").length).toBeGreaterThan(0));

    enterEditMode();
    fireEvent.change(inputForLabel("Platform"), { target: { value: "TikTok" } });
    save();

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(savedCustomFields().Platform).toBe("TikTok");
    expect(savedCustomFields()).not.toHaveProperty(ADDITIONAL_POLICIES_KEY);
  });
});

// ---------------------------------------------------------------------------------------------
// T-5 — the whole contact-edit flow, through the real clientsSupabaseApi write boundary
// ---------------------------------------------------------------------------------------------
describe("the normal contact-edit flow cannot turn the array into a scalar", () => {
  it("every editable input on the client detail view is a known non-reserved field", async () => {
    await renderAndSettle();
    enterEditMode();

    // The decisive structural claim: no input anywhere in edit mode holds the policy array, so the
    // keystroke that used to corrupt it has nowhere to land.
    const values = allInputs().map((i) => i.value);
    expect(values.join("|")).not.toContain("[object Object]");
    expect(values.some((v) => v.includes("WL-4471"))).toBe(false);

    // And typing into every single one of them still leaves the array intact after a save.
    for (const input of allInputs()) {
      if (input.readOnly || input.disabled) continue;
      fireEvent.change(input, { target: { value: `${input.value ?? ""}x` } });
    }
    save();
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(savedCustomFields()[ADDITIONAL_POLICIES_KEY]).toBe(ADDITIONAL_POLICIES);
    expect(savedCustomFields()[ADDITIONAL_POLICIES_KEY]).toEqual(ADDITIONAL_POLICIES);
  });
});

// ---------------------------------------------------------------------------------------------
// The second generic path — a definition an agency named exactly like the reserved key
// ---------------------------------------------------------------------------------------------
describe("a custom-field DEFINITION named additional_policies cannot re-open the editor", () => {
  const collidingDef = {
    id: "cf-x",
    name: ADDITIONAL_POLICIES_KEY,
    type: "Text",
    appliesTo: ["Clients"],
    required: true,
    active: true,
    usageCount: 0,
  };

  it("is excluded whether or not the saved layout places it, and never blocks the save", async () => {
    h.customFieldDefs = [...CUSTOM_FIELD_DEFS, collidingDef];
    tableData["contact_management_settings"] = {
      field_order_client: [...CLIENT_FIELD_ORDER_WITH_CUSTOM, `custom:${ADDITIONAL_POLICIES_KEY}`],
      required_fields_client: {},
    };

    await renderAndSettle();
    expect(screen.queryByText(ADDITIONAL_POLICIES_KEY)).toBeNull();

    enterEditMode();
    expect(screen.queryByText(ADDITIONAL_POLICIES_KEY)).toBeNull();
    fireEvent.change(inputForLabel("Gender"), { target: { value: "X" } });
    save();

    // The definition is `required: true`. If it were enforced while hidden, handleSave would refuse
    // every save with no box to type into — a hidden field that bricks the contact.
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(savedCustomFields()[ADDITIONAL_POLICIES_KEY]).toBe(ADDITIONAL_POLICIES);
  });

  it("is excluded when it has a definition but the layout does not place it", async () => {
    h.customFieldDefs = [...CUSTOM_FIELD_DEFS, { ...collidingDef, required: false }];
    await renderAndSettle();
    expect(screen.queryByText(ADDITIONAL_POLICIES_KEY)).toBeNull();
    enterEditMode();
    expect(screen.queryByText(ADDITIONAL_POLICIES_KEY)).toBeNull();
    expect(document.body.textContent).not.toContain("[object Object]");
  });
});
