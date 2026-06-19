import { describe, it, expect } from "vitest";
import {
  ATTEMPT_BUCKETS,
  NO_DISPOSITION,
  buildLeadFilterPayload,
  resolveTimezoneStates,
  resolveAgentFilterOptions,
  callBelongsToLead,
  countLeadCallAttempts,
  matchesAttemptBucket,
  type LeadCallRow,
} from "@/lib/contactsFilters";

describe("attempt buckets", () => {
  it("uses 0 / 1-3 / 4+ — the orphaned '5+' bucket is gone, 4 is now matchable", () => {
    expect(ATTEMPT_BUCKETS).toEqual(["0", "1-3", "4+"]);
    expect(ATTEMPT_BUCKETS).not.toContain("5+");
  });
});

describe("call→lead linkage (compat: lead_id future + contact_id with type 'lead' OR null)", () => {
  const L = "lead-1";

  it("(1) links a future call via lead_id", () => {
    expect(callBelongsToLead({ id: "c2", lead_id: L }, L)).toBe(true);
  });
  it("(2) links a call via contact_id + contact_type='lead'", () => {
    expect(callBelongsToLead({ id: "c1", lead_id: null, contact_type: "lead", contact_id: L }, L)).toBe(true);
  });
  it("(3) links a call via contact_id + contact_type IS NULL (real prod Dialer rows)", () => {
    expect(callBelongsToLead({ id: "c0", lead_id: null, contact_type: null, contact_id: L }, L)).toBe(true);
  });
  it("(4) does NOT link explicit contact_type='client'", () => {
    expect(callBelongsToLead({ id: "c4", lead_id: null, contact_type: "client", contact_id: L }, L)).toBe(false);
  });
  it("(5) does NOT link explicit contact_type='recruit'", () => {
    expect(callBelongsToLead({ id: "c6", lead_id: null, contact_type: "recruit", contact_id: L }, L)).toBe(false);
  });
  it("does NOT link a call whose lead_id points at a different lead (no contact_id fallback)", () => {
    expect(callBelongsToLead({ id: "c5", lead_id: "other", contact_type: "lead", contact_id: L }, L)).toBe(false);
  });
});

describe("attempt count = distinct OUTBOUND dial rows linked to the lead", () => {
  const L = "lead-1";

  it("(7) counts outbound null-typed contact_id calls + outbound lead_id calls", () => {
    const calls: LeadCallRow[] = [
      { id: "c0", direction: "outbound", lead_id: null, contact_type: null, contact_id: L }, // null-typed ✓
      { id: "c1", direction: "outbound", lead_id: null, contact_type: "lead", contact_id: L }, // 'lead' ✓
      { id: "c2", direction: "outbound", lead_id: L }, // future ✓
    ];
    expect(countLeadCallAttempts(calls, L)).toBe(3);
  });

  it("(8) does NOT count inbound calls (incl. null-typed) even when linked", () => {
    const calls: LeadCallRow[] = [
      { id: "i0", direction: "inbound", lead_id: null, contact_type: null, contact_id: L }, // null-typed inbound ✗
      { id: "i1", direction: "inbound", lead_id: null, contact_type: "lead", contact_id: L },
      { id: "i2", direction: "inbound", lead_id: L },
    ];
    expect(countLeadCallAttempts(calls, L)).toBe(0);
  });

  it("counts failed / busy / no-answer / completed OUTBOUND rows each as one attempted dial", () => {
    const calls: LeadCallRow[] = [
      { id: "a", direction: "outbound", status: "failed", lead_id: null, contact_type: null, contact_id: L },
      { id: "b", direction: "outbound", status: "busy", lead_id: null, contact_type: "lead", contact_id: L },
      { id: "c", direction: "outbound", status: "no-answer", lead_id: null, contact_type: null, contact_id: L },
      { id: "d", direction: "outbound", status: "completed", lead_id: L },
    ];
    expect(countLeadCallAttempts(calls, L)).toBe(4);
  });

  it("(6) counts a row carrying BOTH link fields exactly once", () => {
    const both: LeadCallRow = { id: "c3", direction: "outbound", lead_id: L, contact_type: "lead", contact_id: L };
    expect(countLeadCallAttempts([both], L)).toBe(1);
  });

  it("counts distinct ids across mixed outbound/inbound/client/recruit/foreign rows", () => {
    const calls: LeadCallRow[] = [
      { id: "c0", direction: "outbound", lead_id: null, contact_type: null, contact_id: L }, // ✓ null-typed
      { id: "c2", direction: "outbound", lead_id: L }, // ✓ future
      { id: "c3", direction: "outbound", lead_id: L, contact_type: "lead", contact_id: L }, // ✓ once
      { id: "i1", direction: "inbound", lead_id: L }, // ✗ inbound
      { id: "c4", direction: "outbound", lead_id: null, contact_type: "client", contact_id: L }, // ✗ client
      { id: "c7", direction: "outbound", lead_id: null, contact_type: "recruit", contact_id: L }, // ✗ recruit
      { id: "c5", direction: "outbound", lead_id: "other", contact_type: "lead", contact_id: L }, // ✗ foreign
    ];
    expect(countLeadCallAttempts(calls, L)).toBe(3);
  });

  it("(10) feeds the 0 / 1-3 / 4+ buckets — exactly 4 attempts matches 4+", () => {
    expect(matchesAttemptBucket(0, ["0"])).toBe(true);
    expect(matchesAttemptBucket(3, ["1-3"])).toBe(true);
    expect(matchesAttemptBucket(4, ["4+"])).toBe(true); // the bucket-gap fix
    expect(matchesAttemptBucket(4, ["1-3"])).toBe(false);
    expect(matchesAttemptBucket(0, ["1-3", "4+"])).toBe(false);
    expect(matchesAttemptBucket(7, [])).toBe(true); // no buckets → no filter
  });

  it("(9) Last Disposition uses the SAME linkage (null-typed dispositioned call participates)", () => {
    // Disposition derivation is linkage-only (direction-agnostic). callBelongsToLead is
    // the shared relationship; a null-typed dispositioned call is linked → participates.
    expect(callBelongsToLead({ id: "d1", lead_id: null, contact_type: null, contact_id: L }, L)).toBe(true);
    expect(callBelongsToLead({ id: "d2", lead_id: null, contact_type: "client", contact_id: L }, L)).toBe(false);
  });
});

describe("resolveAgentFilterOptions — scope-aware specific-agent options", () => {
  const self = { id: "me", firstName: "Me", lastName: "A" };
  const desc = { id: "d1", firstName: "Down", lastName: "B" };
  const nonDesc = { id: "x1", firstName: "Other", lastName: "C" };
  const orgAgents = [self, desc, nonDesc]; // Admin's RLS-authorized org set (incl. non-descendant)
  const teamAgents = [self, desc]; // self + recursive downline

  it("mine → no agent options (locked to self)", () => {
    expect(resolveAgentFilterOptions({ scope: "mine", orgAgents, teamAgents })).toEqual([]);
  });

  it("team → self + downline only (excludes non-descendants)", () => {
    const opts = resolveAgentFilterOptions({ scope: "team", orgAgents, teamAgents });
    expect(opts).toEqual([self, desc]);
    expect(opts).not.toContainEqual(nonDesc);
  });

  it("agency (Admin) → ALL authorized org agents, including non-descendants", () => {
    const opts = resolveAgentFilterOptions({ scope: "agency", orgAgents, teamAgents });
    expect(opts).toEqual([self, desc, nonDesc]);
    expect(opts).toContainEqual(nonDesc);
  });
});

describe("resolveTimezoneStates", () => {
  it("returns null when no groups are selected (no filter)", () => {
    expect(resolveTimezoneStates([])).toBeNull();
    expect(resolveTimezoneStates(undefined)).toBeNull();
  });

  it("maps a group to its member states by primary timezone", () => {
    const eastern = resolveTimezoneStates(["Eastern"]);
    expect(eastern).toContain("NY");
    expect(eastern).toContain("FL");
    expect(eastern).not.toContain("CA"); // Pacific
    expect(eastern).not.toContain("TX"); // Central
  });

  it("unions multiple groups", () => {
    const mixed = resolveTimezoneStates(["Pacific", "Central"]);
    expect(mixed).toContain("CA"); // Pacific
    expect(mixed).toContain("TX"); // Central
    expect(mixed).not.toContain("NY"); // Eastern
  });
});

describe("buildLeadFilterPayload — the ONE canonical contract", () => {
  const base = { scope: "mine" as const };

  it("passes scope through and applies page/pageSize defaults", () => {
    const p = buildLeadFilterPayload(base);
    expect(p.scope).toBe("mine");
    expect(p.page).toBe(0);
    expect(p.page_size).toBe(50);
  });

  it("normalizes empty agent list to null, keeps a real selection", () => {
    expect(buildLeadFilterPayload({ ...base, agentIds: [] }).agent_ids).toBeNull();
    expect(buildLeadFilterPayload({ ...base, agentIds: ["a", "b"] }).agent_ids).toEqual(["a", "b"]);
  });

  it("resolves timezone groups to a state set", () => {
    const p = buildLeadFilterPayload({ ...base, timezoneGroups: ["Eastern"] });
    expect(p.timezone_states).toContain("NY");
    expect(p.timezone_states).not.toContain("CA");
  });

  it("freezes callable states when a snapshot is provided; null when callable-now is off", () => {
    const frozen = buildLeadFilterPayload({ ...base, callableNow: true, frozenCallableStates: ["CA", "NV"] });
    expect(frozen.callable_states).toEqual(["CA", "NV"]);
    const off = buildLeadFilterPayload({ ...base, callableNow: false });
    expect(off.callable_states).toBeNull();
  });

  it("passes attempt buckets through; empty → null", () => {
    expect(buildLeadFilterPayload({ ...base, attemptBuckets: ["4+"] }).attempt_buckets).toEqual(["4+"]);
    expect(buildLeadFilterPayload({ ...base, attemptBuckets: [] }).attempt_buckets).toBeNull();
  });

  it("trims text filters and preserves the No-Disposition sentinel", () => {
    expect(buildLeadFilterPayload({ ...base, search: "  bob " }).search).toBe("bob");
    expect(buildLeadFilterPayload({ ...base, search: "   " }).search).toBeNull();
    expect(buildLeadFilterPayload({ ...base, lastDisposition: " Busy " }).last_disposition).toBe("Busy");
    expect(buildLeadFilterPayload({ ...base, lastDisposition: NO_DISPOSITION }).last_disposition).toBe(NO_DISPOSITION);
    expect(buildLeadFilterPayload({ ...base, lastDisposition: "" }).last_disposition).toBeNull();
  });

  it("is deterministic — the same inputs build an identical payload (rows/count/ids parity by construction)", () => {
    const input = {
      scope: "team" as const,
      agentIds: ["a"],
      search: "x",
      status: "New",
      source: "Web",
      state: "CA",
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-02-01T00:00:00.000Z",
      timezoneGroups: ["Pacific"],
      callableNow: true,
      frozenCallableStates: ["CA"],
      attemptBuckets: ["1-3"],
      lastDisposition: "Interested",
      page: 2,
      pageSize: 50,
    };
    expect(buildLeadFilterPayload(input)).toEqual(buildLeadFilterPayload({ ...input }));
  });
});
