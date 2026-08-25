// R8 — FloatingDialer recent-calls identity: one resolver. Linked rows resolve by
// contact_id/contact_type against the right table; unlinked rows render snapshot-name-else-ANI;
// the leads-only `.ilike` phone probe (third divergent resolver) is deleted outright, along with
// its `status === "Closed Won" ⇒ 'client'` type invention; typed quick-call passes the TRUE
// contact_type (never an invented one).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRecentCallDisplay,
  collectLinkedContactRefs,
  applyLinkedContactNames,
  quickCallContactFromRecent,
  type RecentCallsSourceRow,
} from "@/lib/dialerRecentCalls";

const base: RecentCallsSourceRow = {
  id: "call-1",
  contact_id: null,
  contact_name: null,
  contact_phone: "+15550001111",
  disposition_name: null,
  started_at: "2026-08-22T10:00:00Z",
  created_at: "2026-08-22T10:00:01Z",
  contact_type: null,
};

describe("R8 — linked rows resolve by contact_id/contact_type", () => {
  it("keeps the row's contact_id and true contact_type (recruit preserved)", () => {
    const r = buildRecentCallDisplay({
      ...base,
      contact_id: "rec-9",
      contact_type: "recruit",
      contact_name: "Rita Recruit",
    });
    expect(r.matched_lead_id).toBe("rec-9");
    expect(r.matched_contact_type).toBe("recruit");
    expect(r.display_name).toBe("Rita Recruit");
  });

  it("collects id batches per true type for by-id CRM name enrichment (no phone probe)", () => {
    const rows = [
      buildRecentCallDisplay({ ...base, id: "c1", contact_id: "l1", contact_type: "lead" }),
      buildRecentCallDisplay({ ...base, id: "c2", contact_id: "cl1", contact_type: "client" }),
      buildRecentCallDisplay({ ...base, id: "c3", contact_id: "r1", contact_type: "recruit" }),
      buildRecentCallDisplay({ ...base, id: "c4" }),
    ];
    expect(collectLinkedContactRefs(rows)).toEqual({
      leadIds: ["l1"],
      clientIds: ["cl1"],
      recruitIds: ["r1"],
    });
  });

  it("applies CRM names to linked rows only, keyed by contact_id", () => {
    const rows = [
      buildRecentCallDisplay({ ...base, id: "c1", contact_id: "l1", contact_type: "lead" }),
      buildRecentCallDisplay({ ...base, id: "c2", contact_name: "Snapshot Sam" }),
    ];
    const named = applyLinkedContactNames(
      rows,
      new Map([["l1", { first_name: "Lucy", last_name: "Lead" }]]),
    );
    expect(named[0].display_name).toBe("Lucy Lead");
    expect(named[1].display_name).toBe("Snapshot Sam");
  });
});

describe("R8 — unlinked rows render snapshot-name-else-ANI", () => {
  it("snapshot name wins when present", () => {
    expect(buildRecentCallDisplay({ ...base, contact_name: " Snap Name " }).display_name).toBe(
      "Snap Name",
    );
  });

  it("falls back to the ANI, then 'Unknown'", () => {
    expect(buildRecentCallDisplay(base).display_name).toBe("+15550001111");
    expect(
      buildRecentCallDisplay({ ...base, contact_phone: "" }).display_name,
    ).toBe("Unknown");
  });

  it("never invents a contact_type for unlinked rows", () => {
    expect(buildRecentCallDisplay(base).matched_contact_type).toBeUndefined();
  });
});

describe("R8 — typed quick-call passes the true contact_type", () => {
  it("linked recruit quick-calls as a recruit", () => {
    const r = buildRecentCallDisplay({
      ...base,
      contact_id: "r1",
      contact_type: "recruit",
      contact_name: "Rita Recruit",
    });
    const c = quickCallContactFromRecent(r);
    expect(c.id).toBe("r1");
    expect(c.type).toBe("recruit");
    expect(c.first_name).toBe("Rita");
    expect(c.last_name).toBe("Recruit");
    expect(c.phone).toBe("+15550001111");
  });

  it("unlinked rows quick-call with NO type (never a default 'lead')", () => {
    const c = quickCallContactFromRecent(buildRecentCallDisplay(base));
    expect(c.id).toBe("");
    expect(c.type).toBeUndefined();
  });
});

describe("R8 — the FloatingDialer phone probe is deleted at the source", () => {
  const src = readFileSync(
    resolve(__dirname, "../../components/layout/FloatingDialer.tsx"),
    "utf8",
  );

  const fnStart = src.indexOf("fetchRecentCalls");
  const fnEnd = src.indexOf("[user, organizationId]");
  const recentBody = fnStart >= 0 && fnEnd > fnStart ? src.slice(fnStart, fnEnd) : "";

  it("fetchRecentCalls exists and issues zero .ilike probes", () => {
    expect(recentBody.length).toBeGreaterThan(0);
    expect(recentBody.includes(".ilike")).toBe(false);
    expect(recentBody.includes("phone.ilike")).toBe(false);
  });

  it("fetchRecentCalls selects contact_id for linked-row resolution", () => {
    expect(recentBody.includes("contact_id")).toBe(true);
  });

  it("the 'Closed Won' ⇒ client type invention is gone from the file", () => {
    expect(src.includes("Closed Won")).toBe(false);
  });
});
