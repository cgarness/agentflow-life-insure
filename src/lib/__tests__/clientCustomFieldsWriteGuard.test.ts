/**
 * Write-boundary guard for `clients.custom_fields.additional_policies` (BUGFIX, 2026-09-19).
 *
 * `clientsSupabaseApi.update` writes `custom_fields` as a WHOLE-COLUMN REPLACEMENT
 * (`src/lib/supabase-clients.ts`: `if (data.customFields !== undefined) updateData.custom_fields =
 * data.customFields;`), so a caller handing it a corrupted bag persists that corruption
 * irreversibly. `additional_policies` is reserved, structured AgentFlow metadata with exactly ONE
 * writer (`ConvertLeadModal` -> `conversionSupabaseApi`, which INSERTs a new client and never
 * reaches this path) — see AGENT_RULES invariant #34 and `src/lib/reservedCustomFields.ts`.
 *
 * This suite pins U3: a non-array under the reserved key is REFUSED with no request issued, and
 * every legitimate shape still passes through byte-for-structure. It also pins that the three
 * copies of the key literal in the repo still agree, and re-asserts the reader's malformed-data
 * tolerance so hardening the writer cannot quietly redefine it.
 *
 * Every fixture here is synthetic and local: no organization id, no production row, no network.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Captured PostgREST traffic. Nothing here talks to a network or to Supabase. */
const { state } = vi.hoisted(() => ({
  state: {
    updates: [] as Array<{ table: string; payload: Record<string, unknown>; id: string }>,
    inserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
    row: {} as Record<string, unknown>,
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const result = () => ({ data: state.row, error: null });
  const terminal = () => ({
    select: () => ({
      single: () => Promise.resolve(result()),
      maybeSingle: () => Promise.resolve(result()),
    }),
  });
  return {
    supabase: {
      from: (table: string) => ({
        update: (payload: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => {
            state.updates.push({ table, payload, id });
            return terminal();
          },
        }),
        insert: (payload: Record<string, unknown>) => {
          state.inserts.push({ table, payload });
          return terminal();
        },
      }),
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

import { clientsSupabaseApi } from "@/lib/supabase-clients";
import {
  ADDITIONAL_POLICIES_KEY,
  RESERVED_CUSTOM_FIELD_KEYS,
  isReservedCustomFieldKey,
  assertCustomFieldsWriteSafe,
} from "@/lib/reservedCustomFields";
import {
  ADDITIONAL_POLICIES_KEY as READER_KEY,
  normalizeClientPolicies,
} from "@/lib/profile/normalized-policy";

/** The canonical writer's exact payload shape (src/lib/supabase-conversion.ts AdditionalPolicyPayload). */
const VALID_POLICIES = [
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

/** The twelve keys two real production clients actually carry (read-only audit, 2026-09-19). */
const PRODUCTION_CUSTOM_FIELD_KEYS = [
  "Ad",
  "Amt Requested",
  "Beneficiary",
  "Date/Time",
  "Favorite Hobby",
  "Full Name",
  "Gender",
  "Have Life Insurance",
  "History of Heart Attack Stroke Cancer",
  "Interested In",
  "Platform",
  "Status",
];

const lastUpdate = () => state.updates[state.updates.length - 1];

/** `src/` — source-contract assertions read the real files from disk, as this repo already does. */
const SRC_ROOT = resolve(__dirname, "../..");
const readSrc = (rel: string) => readFileSync(resolve(SRC_ROOT, rel), "utf8");

beforeEach(() => {
  state.updates.length = 0;
  state.inserts.length = 0;
  state.row = { id: "c1", first_name: "Ada", last_name: "Lovelace", created_at: "2026-01-01" };
});

// ---------------------------------------------------------------------------------------------
// T-6a / T-6b — legitimate shapes still pass, untouched
// ---------------------------------------------------------------------------------------------
describe("clientsSupabaseApi.update — legitimate additional_policies is accepted unchanged", () => {
  it("writes a valid policy array through by reference: not copied, normalized or re-parsed", async () => {
    const bag = { [ADDITIONAL_POLICIES_KEY]: VALID_POLICIES, Gender: "F" };
    await clientsSupabaseApi.update("c1", { phone: "5125550123", customFields: bag });

    expect(state.updates).toHaveLength(1);
    const written = lastUpdate().payload.custom_fields as Record<string, unknown>;
    // Structure preserved exactly — U2. Same array, same entry objects, same key order.
    expect(written).toBe(bag);
    expect(written[ADDITIONAL_POLICIES_KEY]).toBe(VALID_POLICIES);
    expect(written[ADDITIONAL_POLICIES_KEY]).toEqual(VALID_POLICIES);
    expect((written[ADDITIONAL_POLICIES_KEY] as unknown[])[0]).toBe(VALID_POLICIES[0]);
    // The unrelated edit still lands.
    expect(lastUpdate().payload.phone).toBe("5125550123");
  });

  it("accepts an EMPTY array — zero additional policies is a real state, not corruption", async () => {
    await clientsSupabaseApi.update("c1", { customFields: { [ADDITIONAL_POLICIES_KEY]: [] } });
    expect((lastUpdate().payload.custom_fields as Record<string, unknown>)[ADDITIONAL_POLICIES_KEY]).toEqual([]);
  });

  it("omits the column entirely when customFields is undefined (the Add/Edit-Client modal path)", async () => {
    await clientsSupabaseApi.update("c1", { phone: "5125550123" });
    expect(lastUpdate().payload).not.toHaveProperty("custom_fields");
    expect(state.updates).toHaveLength(1);
  });

  it("accepts null, a bag without the key, and a bag of ordinary agency fields", async () => {
    await clientsSupabaseApi.update("c1", { customFields: null as never });
    expect(lastUpdate().payload.custom_fields).toBeNull();

    await clientsSupabaseApi.update("c1", { customFields: { Gender: "M", Platform: "Facebook" } });
    expect(lastUpdate().payload.custom_fields).toEqual({ Gender: "M", Platform: "Facebook" });
  });
});

// ---------------------------------------------------------------------------------------------
// T-5b — the corruption is refused, and NOTHING is written
// ---------------------------------------------------------------------------------------------
describe("clientsSupabaseApi.update — a non-array under the reserved key is REFUSED", () => {
  const CORRUPT_SHAPES: Array<[string, unknown]> = [
    ["the literal string the text <input> produced", "[object Object],[object Object]"],
    ["a single-entry stringification", "[object Object]"],
    ["an emptied text box", ""],
    ["a number", 0],
    ["a boolean", true],
    ["a plain object", { policyType: "Term" }],
    ["an explicit null under the key", null],
  ];

  for (const [label, value] of CORRUPT_SHAPES) {
    it(`rejects ${label} and issues no request`, async () => {
      await expect(
        clientsSupabaseApi.update("c1", {
          phone: "5125550123",
          customFields: { [ADDITIONAL_POLICIES_KEY]: value, Gender: "F" },
        })
      ).rejects.toThrow(/additional_policies/);

      // The decisive assertion: the throw happened BEFORE any PostgREST call was built, so the
      // stored row is untouched — not partially written, not wiped, not "repaired".
      expect(state.updates).toHaveLength(0);
    });
  }

  it("names the caller and says nothing was saved, without echoing the value", async () => {
    let message = "";
    try {
      await clientsSupabaseApi.update("c1", {
        customFields: { [ADDITIONAL_POLICIES_KEY]: "a-users-typed-text" },
      });
      throw new Error("expected the guard to reject");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(
      /^clientsSupabaseApi\.update: refusing to write custom_fields\.additional_policies as a string/
    );
    expect(message).toContain("must be a JSON array");
    expect(message).toContain("Nothing was saved");
    // The rejected value is never interpolated into the message.
    expect(message).not.toContain("a-users-typed-text");
    expect(state.updates).toHaveLength(0);
  });

  it("guards create() at the same boundary", async () => {
    await expect(
      clientsSupabaseApi.create(
        { firstName: "A", lastName: "B", customFields: { [ADDITIONAL_POLICIES_KEY]: "x" } } as never,
        "org-1"
      )
    ).rejects.toThrow(/additional_policies/);
    expect(state.inserts).toHaveLength(0);

    await clientsSupabaseApi.create(
      { firstName: "A", lastName: "B", customFields: { [ADDITIONAL_POLICIES_KEY]: VALID_POLICIES } } as never,
      "org-1"
    );
    expect(state.inserts).toHaveLength(1);
    expect((state.inserts[0].payload.custom_fields as Record<string, unknown>)[ADDITIONAL_POLICIES_KEY])
      .toEqual(VALID_POLICIES);
  });
});

// ---------------------------------------------------------------------------------------------
// T-8b — ordinary agency custom fields are unaffected
// ---------------------------------------------------------------------------------------------
describe("ordinary custom fields are not touched by the guard", () => {
  it("round-trips the twelve keys production clients actually carry", async () => {
    const bag: Record<string, unknown> = {};
    for (const k of PRODUCTION_CUSTOM_FIELD_KEYS) bag[k] = `value for ${k}`;
    // Deliberately include shapes the guard would reject under the reserved key.
    bag["Amt Requested"] = 25000;
    bag["Have Life Insurance"] = false;
    bag["Beneficiary"] = { name: "Pat", relationship: "Spouse" };

    await clientsSupabaseApi.update("c1", { customFields: bag });
    expect(lastUpdate().payload.custom_fields).toBe(bag);
    expect(lastUpdate().payload.custom_fields).toEqual(bag);
  });

  it("isReservedCustomFieldKey matches the one key exactly and nothing near it", () => {
    expect(isReservedCustomFieldKey(ADDITIONAL_POLICIES_KEY)).toBe(true);
    for (const k of [
      ...PRODUCTION_CUSTOM_FIELD_KEYS,
      "Additional Policies",
      "additional_policy",
      "additional_policies ",
      "ADDITIONAL_POLICIES",
      "",
      null,
      undefined,
      7,
    ]) {
      expect(isReservedCustomFieldKey(k)).toBe(false);
    }
  });

  it("assertCustomFieldsWriteSafe tolerates every non-object container without throwing", () => {
    for (const v of [undefined, null, "text", 7, true, [], [1, 2]]) {
      expect(() => assertCustomFieldsWriteSafe(v, "t")).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// T-7 — the reader's malformed-data tolerance is UNCHANGED by hardening the writer
// ---------------------------------------------------------------------------------------------
describe("normalized-policy tolerance still holds after the write-path fix", () => {
  const base = { id: "c9", policy_type: "Term", carrier: "Foresters", premium: 50 };

  it("a string container still yields zero additional policies, ONE signal, primary intact", () => {
    const r = normalizeClientPolicies({
      ...base,
      custom_fields: { [ADDITIONAL_POLICIES_KEY]: "[object Object],[object Object]" },
    });
    expect(r.policies).toHaveLength(1);
    expect(r.policies[0].source).toBe("primary");
    expect(r.malformedAdditionalPolicies).toBe(1);
  });

  it("a mixed array still loads the good entry and counts the bad ones", () => {
    const r = normalizeClientPolicies({
      ...base,
      custom_fields: { [ADDITIONAL_POLICIES_KEY]: [VALID_POLICIES[0], "corrupted", 42, null] },
    });
    expect(r.policies.filter((p) => p.source === "additional")).toHaveLength(1);
    expect(r.malformedAdditionalPolicies).toBe(3);
  });

  it("a valid array still reads back as real policies", () => {
    const r = normalizeClientPolicies({ ...base, custom_fields: { [ADDITIONAL_POLICIES_KEY]: VALID_POLICIES } });
    expect(r.policies.filter((p) => p.source === "additional")).toHaveLength(2);
    expect(r.malformedAdditionalPolicies).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// T-9 — three copies of the key literal, one value
// ---------------------------------------------------------------------------------------------
describe("the reserved key has exactly one value across the three files that declare it", () => {
  it("reservedCustomFields and profile/normalized-policy export the same constant", () => {
    expect(ADDITIONAL_POLICIES_KEY).toBe("additional_policies");
    expect(READER_KEY).toBe(ADDITIONAL_POLICIES_KEY);
    expect(RESERVED_CUSTOM_FIELD_KEYS).toEqual([ADDITIONAL_POLICIES_KEY]);
  });

  it("the canonical writer still declares the same literal", () => {
    // Source-contract assertion (same posture as inboundBrowserLifecycleWrites/profileContracts):
    // supabase-conversion.ts is deliberately NOT edited by this bugfix, so drift is caught here.
    const writer = readSrc("lib/supabase-conversion.ts");
    expect(writer).toContain(`const ADDITIONAL_POLICIES_KEY = "${ADDITIONAL_POLICIES_KEY}"`);
    expect(writer).toContain("base[ADDITIONAL_POLICIES_KEY] = additionalPolicies;");
  });

  it("FullScreenContactView excludes the reserved key on every generic custom-field path", () => {
    const view = readSrc("components/contacts/FullScreenContactView.tsx");
    expect(view).toContain('from "@/lib/reservedCustomFields"');

    // FIVE guarded call sites, pinned so a new generic path cannot be added without failing here:
    //   1. the layout-driven `custom:<name>` branch
    //   2. the generic JSONB key loop (the corruption path itself)
    //   3+4. the "definitions not in the layout" block — the section `.some()` guard AND its
    //        `.filter()`, which must carry the identical predicate or it renders an empty grid
    //   5. the activeCustomFields passed to computeMissingRequired, so a hidden reserved field
    //      can never become an unsatisfiable required field
    expect(view.match(/isReservedCustomFieldKey\(/g) ?? []).toHaveLength(5);

    expect(view).toContain("if (isReservedCustomFieldKey(fieldName)) return null;");
    expect(view).toContain("if (isReservedCustomFieldKey(key)) return null;");
    expect(
      view.match(/!fieldOrder\.includes\(`custom:\$\{f\.name\}`\) && !isReservedCustomFieldKey\(f\.name\)/g) ?? []
    ).toHaveLength(2);
    expect(view).toContain("activeCustomFields: customFields.filter((f) => !isReservedCustomFieldKey(f.name))");

    // The generic loop must still enumerate the live bag — the fix excludes ONE key, it does not
    // stop rendering agency custom fields.
    expect(view).toContain("Object.keys(editForm?.customFields || {}).map(key =>");
  });
});

// ---------------------------------------------------------------------------------------------
// T-9b — AGENT_RULES §10: no mock/seed production data introduced
// ---------------------------------------------------------------------------------------------
describe("no production data path is introduced (AGENT_RULES §10)", () => {
  // Needles are assembled at runtime so this assertion cannot trip over its own source text.
  const FORBIDDEN = [
    ["a0000000-0000", "-0000-0000-000000000001"].join(""), // Chris's home org UUID
    ["jncvvsvckxhq", "gqvkppmj"].join(""), // the production project ref
    ["service", "_role"].join(""),
  ];

  it("the new module introduces no seed data, credential, project ref or org id", () => {
    const text = readSrc("lib/reservedCustomFields.ts");
    for (const needle of FORBIDDEN) expect(text).not.toContain(needle);
    expect(text).not.toMatch(/https?:\/\//);
    // A pure leaf module: no imports at all, so it can reach no client, network or store.
    expect(text).not.toMatch(/^\s*import\s/m);
  });

  it("neither production file changed by this fix gained a data path", () => {
    for (const rel of ["lib/supabase-clients.ts", "components/contacts/FullScreenContactView.tsx"]) {
      const text = readSrc(rel);
      for (const needle of FORBIDDEN) expect(text).not.toContain(needle);
    }
  });
});
