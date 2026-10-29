import { beforeEach, describe, expect, it, vi } from "vitest";

/** Polish V2 §6 — Team-mode names: batched, organization-scoped, honest when unavailable; recipients from routing only. */
const h = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/integrations/supabase/client", async () => {
  const { makeFakeSupabase } = await import("@/test/fakePostgrest");
  return { supabase: { from: (t: string) => makeFakeSupabase(h.db).from(t) } };
});

import { createFakeDb } from "@/test/fakePostgrest";
import {
  describeMissedCallRecipients,
  missedCallPeopleIds,
  missedCallRecipients,
  personLabel,
  PEOPLE_BATCH_SIZE,
  resolveCampaignNames,
  resolvePeople,
} from "@/lib/dashboard-people";
import { PageInactiveError } from "@/lib/pageActivity";

const ORG = "a0000000-0000-4000-8000-00000000000a";
const PEER = "b0000000-0000-4000-8000-00000000000b";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const profile = (n: number, org = ORG) => ({ id: id(n), organization_id: org, first_name: `First${n}`, last_name: `Last${n}` });

beforeEach(() => {
  h.db = createFakeDb({ profiles: [], campaigns: [] });
  Reflect.deleteProperty(document, "visibilityState");
});

describe("resolvePeople", () => {
  it("one organization-scoped read per batch of 100 distinct ids — never N+1, never another agency", async () => {
    h.db.tables.profiles = [...Array.from({ length: 150 }, (_, i) => profile(i)), profile(500, PEER)];
    const ids = [...Array.from({ length: 150 }, (_, i) => id(i)), id(0), id(500), null, "nope"];
    const people = await resolvePeople(ORG, ids);
    // 151 distinct valid ids (150 + one from another agency): two batches of at most 100.
    expect(h.db.queries).toHaveLength(Math.ceil(151 / PEOPLE_BATCH_SIZE));
    expect(h.db.queries.every((q: any) => q.inIds.length <= PEOPLE_BATCH_SIZE)).toBe(true);
    expect(h.db.queries.every((q: any) => q.table === "profiles" && q.filters.includes(`eq:organization_id=${ORG}`))).toBe(true);
    expect(people.names.size).toBe(150);
    expect(personLabel(people, id(3))).toBe("First3 Last3");
    // Another agency's profile never resolves, even when asked for.
    expect(personLabel(people, id(500))).toBe("Name unavailable");
    expect(people.unavailable).toBe(false);
  });

  it("a failed lookup is reported as unavailable — never an invented name, never a thrown section failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.db.failWhen = () => ({ message: "timeout" });
    const people = await resolvePeople(ORG, [id(1)]);
    expect(people.unavailable).toBe(true);
    expect(personLabel(people, id(1))).toBe("Name unavailable");
    expect(await resolveCampaignNames(ORG, ["20000000-0000-4000-8000-000000000001"])).toEqual(new Map());
  });

  it("without an organization nothing is read; a hidden tab defers instead of reading", async () => {
    expect((await resolvePeople(null, [id(1)])).unavailable).toBe(true);
    expect(h.db.queries).toHaveLength(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await expect(resolvePeople(ORG, [id(1)])).rejects.toBeInstanceOf(PageInactiveError);
    expect(h.db.queries).toHaveLength(0);
  });
});

describe("missed-call recipients come from the routing record only", () => {
  const people = { names: new Map([[id(1), { id: id(1), name: "Alex Rivera", initials: "AR" }], [id(2), { id: id(2), name: "Sam Lee", initials: "SL" }]]), unavailable: false };

  it("the intended recipient first, then the durable snapshot, then legacy waves", () => {
    expect(missedCallRecipients({ missed_for_agent_id: id(1), missed_recipient_ids: [id(1), id(2)] })).toEqual({ kind: "one", agentId: id(1) });
    expect(missedCallRecipients({ missed_recipient_ids: [id(2)] })).toEqual({ kind: "one", agentId: id(2) });
    expect(missedCallRecipients({ missed_recipient_ids: [], routed_agent_ids: [id(1), id(2)] })).toEqual({ kind: "several", agentIds: [id(1), id(2)] });
    expect(missedCallRecipients({ missed_recipient_ids: [], routed_agent_ids: null })).toEqual({ kind: "none" });
  });

  it("a call that rang several agents is never attributed to one; agent_id is never used", () => {
    expect(describeMissedCallRecipients({ missed_recipient_ids: [id(1), id(2)] }, people)).toBe("Rang 2 agents: Alex Rivera, Sam Lee");
    expect(describeMissedCallRecipients({ missed_for_agent_id: id(1) }, people)).toBe("Missed for Alex Rivera");
    expect(describeMissedCallRecipients({ missed_for_agent_id: id(9) }, people)).toBe("Missed for Name unavailable");
    expect(describeMissedCallRecipients({ agent_id: id(1) } as any, people)).toBe("No recipient recorded");
    expect(missedCallPeopleIds({ missed_recipient_ids: [id(1)], answered_by_agent_id: id(2) })).toEqual([id(1), id(2)]);
  });
});
