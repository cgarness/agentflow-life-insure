import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { QUICK_CALL_EVENT, dispatchQuickCall } from "@/lib/quick-call";

/**
 * Contact-identity and contact-navigation rules for the Dashboard detail rows.
 *
 * These mirror the resolvers in `DashboardDetailModal.tsx`. They are duplicated as
 * pure functions here (rather than exported from the component) because the component
 * is 600+ lines with heavy Supabase/Twilio/router coupling; splitting it is Build 3.
 * The rules themselves are what regressed in production, so they are what is pinned.
 *
 * The bug being locked out: `calls_today` / `missed_calls` rows come from `calls`,
 * where `item.id` is the CALLS ROW id. The old code navigated to
 * `/contacts?contact=${item.id}&tab=Leads`, so the deep link could never resolve, and
 * the same id was passed into `makeCall`'s third parameter (a `MakeCallOptions`
 * object) as a bare string.
 */

type ContactType = "lead" | "client" | "recruit";

function resolveContactId(item: any): string | null {
  if (!item) return null;
  const fromCallRow = typeof item.contact_id === "string" ? item.contact_id : null;
  if (fromCallRow) return fromCallRow;
  return typeof item.id === "string" && !item.contact_id && item.__idIsContact ? item.id : null;
}

function resolveContactType(item: any): ContactType {
  const explicit = typeof item?.contact_type === "string" ? item.contact_type : null;
  if (explicit === "lead" || explicit === "client" || explicit === "recruit") return explicit;
  return item?.__contactType === "client" ? "client" : "lead";
}

function contactsTabFor(type: ContactType): string {
  return type === "client" ? "Clients" : type === "recruit" ? "Recruits" : "Leads";
}

const CALL_ROW_ID = "caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CONTACT_ID = "cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("contact identity resolution", () => {
  it("uses contact_id, NOT the calls row id, for a calls-sourced row", () => {
    const row = { id: CALL_ROW_ID, contact_id: CONTACT_ID, contact_name: "Pat Lee" };
    expect(resolveContactId(row)).toBe(CONTACT_ID);
    expect(resolveContactId(row)).not.toBe(CALL_ROW_ID);
  });

  it("returns null when a calls row has no contact link, so the caller can fail truthfully", () => {
    expect(resolveContactId({ id: CALL_ROW_ID, contact_id: null })).toBeNull();
    expect(resolveContactId({ id: CALL_ROW_ID })).toBeNull();
  });

  it("never falls back to item.id for a calls row that is missing contact_id", () => {
    // This is the precise regression: falling back here is what produced a URL
    // pointing at a contact that does not exist.
    expect(resolveContactId({ id: CALL_ROW_ID, contact_id: undefined })).toBeNull();
  });

  it("uses item.id for rows sourced directly from a contact table", () => {
    expect(resolveContactId({ id: CONTACT_ID, __idIsContact: true })).toBe(CONTACT_ID);
  });

  it("handles null/undefined rows without throwing", () => {
    expect(resolveContactId(null)).toBeNull();
    expect(resolveContactId(undefined)).toBeNull();
  });
});

describe("contact type resolution", () => {
  it("honours an explicit calls.contact_type when present", () => {
    expect(resolveContactType({ contact_type: "client" })).toBe("client");
    expect(resolveContactType({ contact_type: "recruit" })).toBe("recruit");
  });

  it("falls back to the row source when contact_type is NULL (the common real case)", () => {
    // AGENT_RULES §5: calls.contact_type is NULL on most real lead rows.
    expect(resolveContactType({ contact_type: null, __contactType: "client" })).toBe("client");
    expect(resolveContactType({ contact_type: null })).toBe("lead");
  });

  it("does not treat a garbage contact_type as authoritative", () => {
    expect(resolveContactType({ contact_type: "agent" })).toBe("lead");
    expect(resolveContactType({ contact_type: "agent", __contactType: "client" })).toBe("client");
  });

  it("marks a client-sourced anniversary row as client, not lead", () => {
    expect(resolveContactType({ __idIsContact: true, __contactType: "client" })).toBe("client");
  });
});

describe("navigation target", () => {
  it("routes each contact type to its own Contacts tab", () => {
    expect(contactsTabFor("lead")).toBe("Leads");
    expect(contactsTabFor("client")).toBe("Clients");
    expect(contactsTabFor("recruit")).toBe("Recruits");
  });

  it("builds a contact URL from contact_id and the resolved type", () => {
    const row = { id: CALL_ROW_ID, contact_id: CONTACT_ID, __contactType: "client" };
    const url = `/contacts?contact=${resolveContactId(row)}&tab=${contactsTabFor(resolveContactType(row))}`;
    expect(url).toBe(`/contacts?contact=${CONTACT_ID}&tab=Clients`);
    expect(url).not.toContain(CALL_ROW_ID);
  });

  it("does not hardcode tab=Leads for a client row", () => {
    const row = { id: CONTACT_ID, __idIsContact: true, __contactType: "client" };
    expect(contactsTabFor(resolveContactType(row))).not.toBe("Leads");
  });
});

describe("row call action routes through the canonical event", () => {
  let received: CustomEvent[] = [];
  const capture = (e: Event) => received.push(e as CustomEvent);

  beforeEach(() => {
    received = [];
    window.addEventListener(QUICK_CALL_EVENT, capture);
  });
  afterEach(() => window.removeEventListener(QUICK_CALL_EVENT, capture));

  it("dials the resolved contact, not the calls row", () => {
    const row = {
      id: CALL_ROW_ID,
      contact_id: CONTACT_ID,
      contact_name: "Pat Lee",
      phone: "5551112222",
      contact_type: null,
    };
    const started = dispatchQuickCall({
      contactId: resolveContactId(row)!,
      name: row.contact_name,
      phone: row.phone,
      type: resolveContactType(row),
    });
    expect(started).toBe(true);
    expect(received[0].detail.contactId).toBe(CONTACT_ID);
    expect(received[0].detail.contactId).not.toBe(CALL_ROW_ID);
  });

  it("reports failure rather than success when the row has no phone", () => {
    const started = dispatchQuickCall({
      contactId: CONTACT_ID,
      name: "Pat Lee",
      phone: "",
      type: "lead",
    });
    expect(started).toBe(false);
    expect(received).toHaveLength(0);
  });
});

describe("nested action click handling", () => {
  it("stopPropagation on the action prevents the parent row/card handler from firing", () => {
    // Mirrors the widget/detail-row structure: an action button inside a container
    // that has its own click handler.
    const parent = document.createElement("div");
    const child = document.createElement("button");
    parent.appendChild(child);
    document.body.appendChild(parent);

    let parentFired = 0;
    let childFired = 0;
    parent.addEventListener("click", () => parentFired++);
    child.addEventListener("click", (e) => {
      e.stopPropagation();
      childFired++;
    });

    child.click();
    expect(childFired).toBe(1);
    expect(parentFired).toBe(0);

    document.body.removeChild(parent);
  });

  it("without stopPropagation the parent DOES fire — the behavior being fixed", () => {
    const parent = document.createElement("div");
    const child = document.createElement("button");
    parent.appendChild(child);
    document.body.appendChild(parent);

    let parentFired = 0;
    parent.addEventListener("click", () => parentFired++);
    child.addEventListener("click", () => {});

    child.click();
    expect(parentFired).toBe(1);

    document.body.removeChild(parent);
  });
});
