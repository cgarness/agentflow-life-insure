import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Contact identity + type resolution, asserted against the IMPORTED production helpers.
 *
 * Previously these rules were duplicated inside the test file because the real functions
 * were module-private in `DashboardDetailModal.tsx`, so the tests pinned a copy and would
 * have kept passing if the component drifted. They are now exported and imported.
 */

const { state } = vi.hoisted(() => ({
  state: {
    // id -> which contact tables it exists in (simulates RLS-visible rows)
    leads: [] as Array<{ id: string; first_name: string; last_name: string; phone: string }>,
    clients: [] as Array<{ id: string; first_name: string; last_name: string; phone: string }>,
    recruits: [] as Array<{ id: string; first_name: string; last_name: string; phone: string }>,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: "leads" | "clients" | "recruits") => ({
      select: () => ({
        in: (_col: string, ids: string[]) =>
          Promise.resolve({
            data: state[table].filter((r) => ids.includes(r.id)),
            error: null,
          }),
      }),
    }),
  },
}));

import {
  contactHref,
  contactsTabFor,
  isValidContactType,
  resolveContactDetailsByIds,
  resolveContactId,
  resolveContactType,
  resolveContactTypesByIds,
} from "@/lib/dashboard-contact-identity";

const CALL_ROW_ID = "caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LEAD_ID = "1ead0000-0000-0000-0000-000000000001";
const CLIENT_ID = "c11e0000-0000-0000-0000-000000000002";
const RECRUIT_ID = "5ec50000-0000-0000-0000-000000000003";

const row = (id: string, first: string) => ({ id, first_name: first, last_name: "Test", phone: "5551112222" });

beforeEach(() => {
  state.leads = [row(LEAD_ID, "Lee")];
  state.clients = [row(CLIENT_ID, "Cleo")];
  state.recruits = [row(RECRUIT_ID, "Remy")];
});

describe("isValidContactType", () => {
  it.each([
    ["lead", true], ["client", true], ["recruit", true],
    ["agent", false], ["", false], [null, false], [undefined, false], [7, false],
  ])("isValidContactType(%s) === %s", (v, expected) => {
    expect(isValidContactType(v)).toBe(expected);
  });
});

describe("resolveContactId — calls.id is NEVER a contact identity", () => {
  it("uses contact_id for a calls-sourced row", () => {
    expect(resolveContactId({ contactId: LEAD_ID, ownId: CALL_ROW_ID })).toBe(LEAD_ID);
  });

  it("returns null when a calls row has no contact_id — never falls back to calls.id", () => {
    expect(resolveContactId({ contactId: null, ownId: CALL_ROW_ID })).toBeNull();
    expect(resolveContactId({ ownId: CALL_ROW_ID })).toBeNull();
    expect(resolveContactId({ contactId: "", ownId: CALL_ROW_ID })).toBeNull();
  });

  it("uses the row's own id ONLY when explicitly marked as a contact row", () => {
    expect(resolveContactId({ ownId: CLIENT_ID, ownIdIsContact: true })).toBe(CLIENT_ID);
    expect(resolveContactId({ ownId: CLIENT_ID, ownIdIsContact: false })).toBeNull();
  });

  it("handles empty input without throwing", () => {
    expect(resolveContactId({})).toBeNull();
  });
});

describe("resolveContactType — never defaults unknown to lead", () => {
  it("honours a valid explicit calls.contact_type", () => {
    expect(resolveContactType({ explicitType: "client" })).toBe("client");
    expect(resolveContactType({ explicitType: "recruit" })).toBe("recruit");
    expect(resolveContactType({ explicitType: "lead" })).toBe("lead");
  });

  it("ignores a garbage explicit type and falls through", () => {
    expect(resolveContactType({ explicitType: "agent" })).toBeNull();
    expect(resolveContactType({ explicitType: "agent" }, "client")).toBe("client");
  });

  it("uses a trusted row-source marker when there is no explicit type", () => {
    expect(resolveContactType({ sourceMarker: "client" })).toBe("client");
  });

  it("uses the batched lookup result last", () => {
    expect(resolveContactType({}, "recruit")).toBe("recruit");
  });

  it("returns null — NOT lead — when nothing resolves", () => {
    expect(resolveContactType({})).toBeNull();
    expect(resolveContactType({ explicitType: null }, null)).toBeNull();
  });
});

describe("resolveContactTypesByIds — resolves against real visible rows", () => {
  it("resolves a lead, a client and a recruit", async () => {
    const map = await resolveContactTypesByIds([LEAD_ID, CLIENT_ID, RECRUIT_ID]);
    expect(map.get(LEAD_ID)).toBe("lead");
    expect(map.get(CLIENT_ID)).toBe("client");
    expect(map.get(RECRUIT_ID)).toBe("recruit");
  });

  it("returns null for an id present in NO contact table", async () => {
    const map = await resolveContactTypesByIds(["deadbeef-0000-0000-0000-000000000000"]);
    expect(map.get("deadbeef-0000-0000-0000-000000000000")).toBeNull();
  });

  it("returns null for an AMBIGUOUS id present in two tables — fails safely", async () => {
    state.clients.push(row(LEAD_ID, "Duplicate"));
    const map = await resolveContactTypesByIds([LEAD_ID]);
    expect(map.get(LEAD_ID)).toBeNull();
  });

  it("de-duplicates and tolerates empty input", async () => {
    expect((await resolveContactTypesByIds([])).size).toBe(0);
    const map = await resolveContactTypesByIds([LEAD_ID, LEAD_ID, ""]);
    expect(map.size).toBe(1);
  });
});

describe("resolveContactDetailsByIds", () => {
  it("returns type, name and phone for a visible contact", async () => {
    const map = await resolveContactDetailsByIds([CLIENT_ID]);
    expect(map.get(CLIENT_ID)).toEqual({ type: "client", name: "Cleo Test", phone: "5551112222" });
  });

  it("omits an ambiguous id entirely", async () => {
    state.recruits.push(row(CLIENT_ID, "Dup"));
    const map = await resolveContactDetailsByIds([CLIENT_ID]);
    expect(map.has(CLIENT_ID)).toBe(false);
  });

  it("omits an id that exists nowhere", async () => {
    const map = await resolveContactDetailsByIds(["deadbeef-0000-0000-0000-000000000000"]);
    expect(map.size).toBe(0);
  });
});

describe("navigation target", () => {
  it("routes each type to its own tab", () => {
    expect(contactsTabFor("lead")).toBe("Leads");
    expect(contactsTabFor("client")).toBe("Clients");
    expect(contactsTabFor("recruit")).toBe("Recruits");
  });

  it("returns null for an unresolved type — meaning DO NOT navigate", () => {
    expect(contactsTabFor(null)).toBeNull();
  });

  it("a null contact_type resolving uniquely to a CLIENT navigates to Clients", async () => {
    const callRow = { id: CALL_ROW_ID, contact_id: CLIENT_ID, contact_type: null };
    const types = await resolveContactTypesByIds([callRow.contact_id]);
    const id = resolveContactId({ contactId: callRow.contact_id, ownId: callRow.id });
    const type = resolveContactType({ explicitType: callRow.contact_type }, types.get(CLIENT_ID));
    expect(contactHref(id, type)).toBe(`/contacts?contact=${CLIENT_ID}&tab=Clients`);
    expect(contactHref(id, type)).not.toContain("tab=Leads");
    expect(contactHref(id, type)).not.toContain(CALL_ROW_ID);
  });

  it("a null contact_type resolving to a RECRUIT navigates to Recruits", async () => {
    const types = await resolveContactTypesByIds([RECRUIT_ID]);
    const type = resolveContactType({ explicitType: null }, types.get(RECRUIT_ID));
    expect(contactHref(RECRUIT_ID, type)).toBe(`/contacts?contact=${RECRUIT_ID}&tab=Recruits`);
  });

  it("a direct client KPI row navigates to Clients", () => {
    const kpiRow = { id: CLIENT_ID, __idIsContact: true, __contactType: "client" as const };
    const id = resolveContactId({ ownId: kpiRow.id, ownIdIsContact: kpiRow.__idIsContact });
    const type = resolveContactType({ sourceMarker: kpiRow.__contactType });
    expect(contactHref(id, type)).toBe(`/contacts?contact=${CLIENT_ID}&tab=Clients`);
  });

  it("an unresolved type produces NO href — it must not navigate", () => {
    expect(contactHref(LEAD_ID, null)).toBeNull();
  });

  it("an unresolved identity produces NO href", () => {
    expect(contactHref(null, "lead")).toBeNull();
  });

  it("an ambiguous id fails safely — no navigation at all", async () => {
    state.clients.push(row(LEAD_ID, "Duplicate"));
    const types = await resolveContactTypesByIds([LEAD_ID]);
    const type = resolveContactType({ explicitType: null }, types.get(LEAD_ID));
    expect(type).toBeNull();
    expect(contactHref(LEAD_ID, type)).toBeNull();
  });
});
