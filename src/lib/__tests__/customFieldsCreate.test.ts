/**
 * customFieldsSupabaseApi — the create-only organization pre-check, the unchanged ownership payload,
 * `.maybeSingle()`, and operation-specific error wording (Custom-field creation outage, 2026-09-22).
 *
 * The pre-check compares the page's organization with `public.get_org_id()` — the exact resolver the
 * `custom_fields_insert` policy uses — and must FAIL CLOSED: on a mismatch, or when it cannot confirm,
 * no INSERT may be sent. The Supabase client is mocked, so this suite needs no `.env`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    org: "a0000000-0000-0000-0000-000000000001",
    uid: "11111111-1111-1111-1111-111111111111" as string | null,
    rpcImpl: null as null | (() => Promise<{ data: unknown; error: unknown }>),
    rpcCalls: [] as string[],
    inserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
    insertTerminals: [] as string[],
    insertResult: { data: null as unknown, error: null as unknown },
    updateResult: { data: null as unknown, error: null as unknown },
    deleteResult: { data: null as unknown, error: null as unknown },
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: state.uid ? { id: state.uid } : null }, error: null }),
    },
    rpc: (fn: string) => {
      state.rpcCalls.push(fn);
      return state.rpcImpl ? state.rpcImpl() : Promise.resolve({ data: state.org, error: null });
    },
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        state.inserts.push({ table, payload });
        return {
          select: () => ({
            maybeSingle: () => {
              state.insertTerminals.push("maybeSingle");
              return Promise.resolve(state.insertResult);
            },
            single: () => {
              state.insertTerminals.push("single");
              return Promise.resolve(state.insertResult);
            },
          }),
        };
      },
      update: () => ({
        eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve(state.updateResult) }) }) }),
      }),
      delete: () => ({
        eq: () => ({ eq: () => ({ select: () => Promise.resolve(state.deleteResult) }) }),
      }),
    }),
  },
}));

import { customFieldsSupabaseApi } from "@/lib/supabase-settings";
import {
  CUSTOM_FIELD_MESSAGES,
  CustomFieldContextError,
  isOrganizationWideCustomFieldConflict,
} from "@/lib/custom-field-errors";
import type { CustomField } from "@/lib/types";

const ORG = "a0000000-0000-0000-0000-000000000001";
const OTHER_ORG = "b0000000-0000-0000-0000-000000000002";
const UID = "11111111-1111-1111-1111-111111111111";

const input: Omit<CustomField, "id" | "usageCount" | "createdBy" | "scope"> = {
  name: "Favorite Hobby",
  type: "Text",
  appliesTo: ["Leads"],
  required: false,
  active: true,
  defaultValue: "",
  dropdownOptions: [],
};

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "cf-1",
  name: "Favorite Hobby",
  type: "Text",
  applies_to: ["Leads"],
  required: false,
  active: true,
  default_value: "",
  dropdown_options: [],
  usage_count: 0,
  organization_id: ORG,
  created_by: UID,
  created_at: "2026-09-22T19:20:00Z",
  ...overrides,
});

const RLS_REFUSAL = { code: "42501", message: 'new row violates row-level security policy for table "custom_fields"' };
const NORM_PRIVILEGE = { code: "42501", message: "permission denied for function custom_field_norm" };

async function rejectionOf(promise: Promise<unknown>): Promise<Error & { reason?: string }> {
  try {
    await promise;
  } catch (e) {
    return e as Error & { reason?: string };
  }
  throw new Error("expected the call to reject, but it resolved");
}

beforeEach(() => {
  state.org = ORG;
  state.uid = UID;
  state.rpcImpl = null;
  state.rpcCalls.length = 0;
  state.inserts.length = 0;
  state.insertTerminals.length = 0;
  state.insertResult = { data: row(), error: null };
  state.updateResult = { data: null, error: null };
  state.deleteResult = { data: null, error: null };
});

describe("customFieldsSupabaseApi.create — organization pre-check", () => {
  it("creates a PERSONAL field when the page organization equals get_org_id()", async () => {
    const created = await customFieldsSupabaseApi.create(input, ORG);

    expect(state.rpcCalls).toEqual(["get_org_id"]);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].table).toBe("custom_fields");
    // The ownership payload is unchanged: CSV-created fields stay personal.
    expect(state.inserts[0].payload).toMatchObject({
      name: "Favorite Hobby",
      organization_id: ORG,
      created_by: UID,
    });
    expect(state.insertTerminals).toEqual(["maybeSingle"]);
    expect(created.id).toBe("cf-1");
    expect(created.scope).toBe("personal");
  });

  it("keeps the agency-wide payload unchanged (created_by NULL) when orgWide is requested", async () => {
    state.insertResult = { data: row({ created_by: null }), error: null };
    const created = await customFieldsSupabaseApi.create(input, ORG, { orgWide: true });

    expect(state.inserts[0].payload).toMatchObject({ organization_id: ORG, created_by: null });
    expect(created.scope).toBe("agency");
  });

  it("compares organizations ignoring case and surrounding whitespace", async () => {
    state.rpcImpl = () => Promise.resolve({ data: `  ${ORG.toUpperCase()} `, error: null });
    await customFieldsSupabaseApi.create(input, ORG);
    expect(state.inserts).toHaveLength(1);
  });

  it("MISMATCH fails closed: the approved message, and the INSERT is never sent", async () => {
    state.rpcImpl = () => Promise.resolve({ data: OTHER_ORG, error: null });

    const err = await rejectionOf(customFieldsSupabaseApi.create(input, ORG));

    expect(err).toBeInstanceOf(CustomFieldContextError);
    expect(err.reason).toBe("org_mismatch");
    expect(err.message).toBe(CUSTOM_FIELD_MESSAGES.orgMismatch);
    expect(state.inserts).toHaveLength(0);
  });

  it.each([
    ["an RPC error", () => Promise.resolve({ data: null, error: { code: "PGRST202", message: "not found" } })],
    ["a transport failure", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a null result", () => Promise.resolve({ data: null, error: null })],
    ["a blank result", () => Promise.resolve({ data: "   ", error: null })],
    ["a non-string result", () => Promise.resolve({ data: 42, error: null })],
  ])("UNVERIFIABLE (%s) fails closed and never sends the INSERT", async (_label, impl) => {
    state.rpcImpl = impl as () => Promise<{ data: unknown; error: unknown }>;

    const err = await rejectionOf(customFieldsSupabaseApi.create(input, ORG));

    expect(err).toBeInstanceOf(CustomFieldContextError);
    expect(err.reason).toBe("org_unverified");
    expect(err.message).toBe(CUSTOM_FIELD_MESSAGES.orgUnverified);
    expect(state.inserts).toHaveLength(0);
  });

  it("refuses a signed-out caller before the pre-check or any INSERT", async () => {
    state.uid = null;
    const err = await rejectionOf(customFieldsSupabaseApi.create(input, ORG));
    expect(err.message).toBe("You must be signed in to create a custom field.");
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("refuses a missing organization before making any request", async () => {
    const err = await rejectionOf(customFieldsSupabaseApi.create(input, null));
    expect(err.message).toBe("Organization context is required for this action.");
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });
});

describe("customFieldsSupabaseApi.create — error wording", () => {
  it("words the production outage error as a system problem, never the user's permission", async () => {
    state.insertResult = { data: null, error: NORM_PRIVILEGE };
    const err = await rejectionOf(customFieldsSupabaseApi.create(input, ORG));
    expect(err.message).toBe(CUSTOM_FIELD_MESSAGES.privilegeDefect.create);
    expect(err.message).not.toMatch(/modify/i);
    expect(err.message).not.toMatch(/you don't have permission/i);
  });

  it("words an RLS refusal on INSERT as a create — never 'modify'", async () => {
    state.insertResult = { data: null, error: RLS_REFUSAL };
    const err = await rejectionOf(customFieldsSupabaseApi.create(input, ORG));
    expect(err.message).toBe(CUSTOM_FIELD_MESSAGES.denied.create);
    expect(err.message).not.toMatch(/modify/i);
  });

  it("keeps the organization-wide duplicate marker (duplicate handling unchanged)", async () => {
    state.insertResult = {
      data: null,
      error: { code: "23505", message: 'A custom field named "Gender" already exists in this organization.' },
    };
    const err = await rejectionOf(customFieldsSupabaseApi.create(input, ORG));
    expect(isOrganizationWideCustomFieldConflict(err)).toBe(true);
    expect(err.message).toBe("A custom field with this name already exists in this agency.");
  });

  it("reports 'not created' when the INSERT returns no row", async () => {
    state.insertResult = { data: null, error: null };
    const err = await rejectionOf(customFieldsSupabaseApi.create(input, ORG));
    expect(err.message).toBe(CUSTOM_FIELD_MESSAGES.notCreated);
  });
});

describe("customFieldsSupabaseApi.update / delete — operation-specific wording, no pre-check", () => {
  it("update: zero rows keeps the unchanged 'modify' message", async () => {
    const err = await rejectionOf(customFieldsSupabaseApi.update("cf-1", { name: "X" }, ORG));
    expect(err.message).toBe("You don't have permission to modify this custom field.");
  });

  it("update: an RLS refusal says 'modify'; a privilege defect says the system could not change it", async () => {
    state.updateResult = { data: null, error: RLS_REFUSAL };
    expect((await rejectionOf(customFieldsSupabaseApi.update("cf-1", { name: "X" }, ORG))).message).toBe(
      CUSTOM_FIELD_MESSAGES.denied.update,
    );
    state.updateResult = { data: null, error: NORM_PRIVILEGE };
    expect((await rejectionOf(customFieldsSupabaseApi.update("cf-1", { name: "X" }, ORG))).message).toBe(
      CUSTOM_FIELD_MESSAGES.privilegeDefect.update,
    );
  });

  it("delete: an RLS refusal says 'delete' (it used to say 'modify')", async () => {
    state.deleteResult = { data: null, error: RLS_REFUSAL };
    const err = await rejectionOf(customFieldsSupabaseApi.delete("cf-1", ORG));
    expect(err.message).toBe("You don't have permission to delete this custom field.");
    expect(err.message).not.toMatch(/modify/i);
  });

  it("delete: zero rows keeps the unchanged 'delete' message", async () => {
    state.deleteResult = { data: [], error: null };
    const err = await rejectionOf(customFieldsSupabaseApi.delete("cf-1", ORG));
    expect(err.message).toBe("You don't have permission to delete this custom field.");
  });

  it("the organization pre-check is create-only (D-4): update and delete never call get_org_id", async () => {
    state.updateResult = { data: row({ name: "X" }), error: null };
    state.deleteResult = { data: [{ id: "cf-1" }], error: null };
    await customFieldsSupabaseApi.update("cf-1", { name: "X" }, ORG);
    await customFieldsSupabaseApi.delete("cf-1", ORG);
    expect(state.rpcCalls).toHaveLength(0);
  });
});
