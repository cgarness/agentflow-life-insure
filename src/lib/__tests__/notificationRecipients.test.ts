import { describe, expect, it } from "vitest";
import {
  buildDialedNumberCandidates,
  buildMissedCallNotificationRows,
  inboundEmailEventKey,
  inboundSmsEventKey,
  missedCallEventKey,
  resolveMissedCallRecipients,
} from "../../../supabase/functions/_shared/notification-recipients";

const A1 = "aaaaaaaa-0000-0000-0000-0000000000a1";
const A2 = "aaaaaaaa-0000-0000-0000-0000000000a2";
const AD = "aaaaaaaa-0000-0000-0000-0000000000ad";
const TL = "aaaaaaaa-0000-0000-0000-0000000000d1";

describe("resolveMissedCallRecipients — priority chain", () => {
  it("routed agents win over every other tier (a known routed agent never falls to managers)", () => {
    const { recipients, tier } = resolveMissedCallRecipients({
      routedAgentIds: [A1, A2],
      numberOwnerId: AD,
      contactAssignedAgentId: AD,
      managerIds: [AD, TL],
    });
    expect(tier).toBe("routed");
    expect(recipients).toEqual([A1, A2]);
  });

  it("all rung agents each receive one alert (all-ring / chain-union, rulings D2/D3)", () => {
    const { recipients } = resolveMissedCallRecipients({
      routedAgentIds: [A1, A2, AD, A1],
      numberOwnerId: null,
      contactAssignedAgentId: null,
      managerIds: [],
    });
    expect(recipients).toEqual([A1, A2, AD]);
  });

  it("falls back to the dialed-number owner when no routed agents were captured", () => {
    const { recipients, tier } = resolveMissedCallRecipients({
      routedAgentIds: [],
      numberOwnerId: A1,
      contactAssignedAgentId: A2,
      managerIds: [AD],
    });
    expect(tier).toBe("number_owner");
    expect(recipients).toEqual([A1]);
  });

  it("falls back to the contact's assigned agent when no routing info and no number owner", () => {
    const { recipients, tier } = resolveMissedCallRecipients({
      routedAgentIds: [],
      numberOwnerId: null,
      contactAssignedAgentId: A2,
      managerIds: [AD, TL],
    });
    expect(tier).toBe("contact_agent");
    expect(recipients).toEqual([A2]);
  });

  it("managers are a true last resort only", () => {
    const { recipients, tier } = resolveMissedCallRecipients({
      routedAgentIds: [],
      numberOwnerId: null,
      contactAssignedAgentId: null,
      managerIds: [AD, TL, AD],
    });
    expect(tier).toBe("managers");
    expect(recipients).toEqual([AD, TL]);
  });

  it("returns an empty set (tier none) when nobody resolves", () => {
    const { recipients, tier } = resolveMissedCallRecipients({
      routedAgentIds: [],
      numberOwnerId: null,
      contactAssignedAgentId: null,
      managerIds: [],
    });
    expect(tier).toBe("none");
    expect(recipients).toEqual([]);
  });

  it("drops empty/duplicate ids defensively", () => {
    const { recipients } = resolveMissedCallRecipients({
      routedAgentIds: ["", A1, A1],
      numberOwnerId: null,
      contactAssignedAgentId: null,
      managerIds: [],
    });
    expect(recipients).toEqual([A1]);
  });
});

describe("event keys", () => {
  it("missed-call key embeds the call id", () => {
    expect(missedCallEventKey("call-1")).toBe("missed_call:call-1");
  });

  it("inbound SMS prefers the Twilio MessageSid and falls back to the message row id", () => {
    expect(inboundSmsEventKey("SM123", "row-1")).toBe("inbound_sms:SM123");
    expect(inboundSmsEventKey("  ", "row-1")).toBe("inbound_sms:msg:row-1");
    expect(inboundSmsEventKey(null, "row-1")).toBe("inbound_sms:msg:row-1");
    expect(inboundSmsEventKey(null, null)).toBeNull();
  });

  it("inbound email keys on the contact_emails row id", () => {
    expect(inboundEmailEventKey("ce-1")).toBe("inbound_email:ce-1");
    expect(inboundEmailEventKey("")).toBeNull();
    expect(inboundEmailEventKey(undefined)).toBeNull();
  });
});

describe("buildDialedNumberCandidates", () => {
  it("expands a US E.164 number into stored-format variants", () => {
    expect(buildDialedNumberCandidates("+17025551234")).toEqual([
      "+17025551234",
      "17025551234",
      "7025551234",
    ]);
  });

  it("expands a bare 10-digit number", () => {
    expect(buildDialedNumberCandidates("7025551234")).toEqual([
      "7025551234",
      "+17025551234",
      "17025551234",
    ]);
  });

  it("keeps formatted input as its own candidate", () => {
    expect(buildDialedNumberCandidates("(702) 555-1234")).toContain("(702) 555-1234");
    expect(buildDialedNumberCandidates("(702) 555-1234")).toContain("+17025551234");
  });

  it("returns empty for blank/undefined", () => {
    expect(buildDialedNumberCandidates("")).toEqual([]);
    expect(buildDialedNumberCandidates(null)).toEqual([]);
    expect(buildDialedNumberCandidates(undefined)).toEqual([]);
  });
});

describe("buildMissedCallNotificationRows", () => {
  it("builds one row per recipient with the shared event key and org", () => {
    const rows = buildMissedCallNotificationRows({
      recipients: [A1, A2],
      callId: "call-9",
      organizationId: "org-1",
      contactId: "contact-7",
      contactName: "Pat Lee",
      contactPhone: "+17025551234",
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.type).toBe("missed_call");
      expect(row.title).toBe("Missed Call");
      expect(row.body).toBe("Missed call from Pat Lee (+17025551234)");
      expect(row.action_url).toBe("/contacts?contact=contact-7");
      expect(row.action_label).toBe("View Contact");
      expect(row.organization_id).toBe("org-1");
      expect(row.event_key).toBe("missed_call:call-9");
      expect(row.read).toBe(false);
      expect(row.metadata).toEqual({ contact_id: "contact-7", phone: "+17025551234", call_id: "call-9" });
    }
    expect(rows.map((r) => r.user_id)).toEqual([A1, A2]);
  });

  it("unknown caller: phone-only body, no action when unmatched", () => {
    const rows = buildMissedCallNotificationRows({
      recipients: [A1],
      callId: "call-10",
      organizationId: "org-1",
      contactId: null,
      contactName: null,
      contactPhone: null,
    });
    expect(rows[0].body).toBe("Missed call from Unknown caller");
    expect(rows[0].action_url).toBeNull();
    expect(rows[0].action_label).toBeNull();
  });
});

// ── corrective pass: fail-closed DB-backed tier resolution ─────────────────────────────────────

import { resolveMissedCallRecipientsFromDb, type MissedCallDbCall } from "../../../supabase/functions/_shared/notification-recipients";

type Script = {
  routedValidation?: { data?: Array<{ id: string }>; error?: { message: string } };
  numberLookup?: { data?: { assigned_to: string | null } | null; error?: { message: string } };
  ownerValidation?: { data?: { id: string } | null; error?: { message: string } };
  contactLookup?: { data?: { assigned_agent_id: string | null } | null; error?: { message: string } };
  contactAgentValidation?: { data?: { id: string } | null; error?: { message: string } };
  managerLookup?: { data?: Array<{ id: string }>; error?: { message: string } };
};

type RecordedOp = { table: string; calls: Array<{ m: string; args: unknown[] }> };

function makeDb(script: Script) {
  const ops: RecordedOp[] = [];
  const db = {
    from(table: string) {
      const op: RecordedOp = { table, calls: [] };
      ops.push(op);
      const answer = () => {
        if (table === "profiles") {
          const isManagerQuery = op.calls.some((c) => c.m === "in" && c.args[0] === "role");
          if (isManagerQuery) return script.managerLookup ?? { data: [] };
          const isListValidation = op.calls.some((c) => c.m === "in" && c.args[0] === "id");
          if (isListValidation) return script.routedValidation ?? { data: [] };
          // single-profile validations: distinguish by recorded order — owner first, then contact agent
          const singles = ops.filter(
            (o) => o.table === "profiles" &&
              o.calls.some((c) => c.m === "eq" && c.args[0] === "id") &&
              !o.calls.some((c) => c.m === "in"),
          );
          return (singles.indexOf(op) === 0 ? script.ownerValidation : script.contactAgentValidation) ?? { data: null };
        }
        if (table === "phone_numbers") return script.numberLookup ?? { data: null };
        if (table === "leads" || table === "clients" || table === "recruits") return script.contactLookup ?? { data: null };
        return { data: null };
      };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "not", "limit", "maybeSingle"]) {
        builder[m] = (...args: unknown[]) => {
          op.calls.push({ m, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: null, ...answer() });
      return builder;
    },
  };
  return { db, ops };
}

// The app tsconfig has strictNullChecks off, so truthiness checks do not narrow the
// discriminated union — assert the failure arm explicitly instead.
const expectFailedTier = (res: Awaited<ReturnType<typeof resolveMissedCallRecipientsFromDb>>, tier: string) => {
  expect(res.ok).toBe(false);
  expect((res as { ok: false; failedTier: string }).failedTier).toBe(tier);
};

const CALL: MissedCallDbCall = {
  id: "call-1",
  contact_id: "contact-1",
  contact_type: "lead",
  contact_name: "Pat",
  contact_phone: "+17025550000",
  organization_id: "org-1",
  agent_id: null,
  caller_id_used: "+17025551234",
  routed_agent_ids: null,
};

describe("resolveMissedCallRecipientsFromDb — fail closed, never blast managers on error", () => {
  it("routed-agent VALIDATION failure aborts (ok:false) instead of falling through", async () => {
    const { db } = makeDb({ routedValidation: { error: { message: "db down" } } });
    const res = await resolveMissedCallRecipientsFromDb(db, { ...CALL, routed_agent_ids: [A1] });
    expectFailedTier(res, "routed");
  });

  it("number-owner LOOKUP failure aborts instead of falling through", async () => {
    const { db } = makeDb({ numberLookup: { error: { message: "boom" } } });
    const res = await resolveMissedCallRecipientsFromDb(db, CALL);
    expectFailedTier(res, "number_owner");
  });

  it("owner profile VALIDATION failure aborts instead of falling through", async () => {
    const { db } = makeDb({
      numberLookup: { data: { assigned_to: A1 } },
      ownerValidation: { error: { message: "boom" } },
    });
    const res = await resolveMissedCallRecipientsFromDb(db, CALL);
    expectFailedTier(res, "number_owner");
  });

  it("contact LOOKUP failure aborts instead of falling through to the manager blast", async () => {
    const { db } = makeDb({ contactLookup: { error: { message: "boom" } } });
    const res = await resolveMissedCallRecipientsFromDb(db, CALL);
    expectFailedTier(res, "contact_agent");
  });

  it("an INACTIVE or cross-org assigned agent is not notified — validated empty, managers reached legitimately", async () => {
    const { db, ops } = makeDb({
      contactLookup: { data: { assigned_agent_id: A2 } },
      contactAgentValidation: { data: null }, // validation query succeeded, agent not Active/in-org
      managerLookup: { data: [{ id: AD }, { id: TL }] },
    });
    const res = await resolveMissedCallRecipientsFromDb(db, CALL);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tier).toBe("managers");
      expect(res.recipients).toEqual([AD, TL]);
    }
    // the contact-agent validation was org-scoped and Active-only
    const validation = ops.find(
      (o) => o.table === "profiles" && o.calls.some((c) => c.m === "eq" && c.args[0] === "id" && c.args[1] === A2),
    )!;
    expect(validation.calls.some((c) => c.m === "eq" && c.args[0] === "organization_id" && c.args[1] === "org-1")).toBe(true);
    expect(validation.calls.some((c) => c.m === "eq" && c.args[0] === "status" && c.args[1] === "Active")).toBe(true);
  });

  it("manager fallback queries only Active Admins/Team Leaders in the call's org; its failure aborts", async () => {
    const { db, ops } = makeDb({ managerLookup: { data: [{ id: AD }] } });
    const res = await resolveMissedCallRecipientsFromDb(db, { ...CALL, contact_id: null, caller_id_used: null });
    expect(res.ok).toBe(true);
    const managers = ops.find((o) => o.table === "profiles" && o.calls.some((c) => c.m === "in" && c.args[0] === "role"))!;
    expect(managers.calls.some((c) => c.m === "eq" && c.args[0] === "status" && c.args[1] === "Active")).toBe(true);
    expect(managers.calls.some((c) => c.m === "eq" && c.args[0] === "organization_id" && c.args[1] === "org-1")).toBe(true);

    const { db: db2 } = makeDb({ managerLookup: { error: { message: "boom" } } });
    const res2 = await resolveMissedCallRecipientsFromDb(db2, { ...CALL, contact_id: null, caller_id_used: null });
    expectFailedTier(res2, "managers");
  });

  it("happy path: valid routed agents win without touching later tiers", async () => {
    const { db, ops } = makeDb({ routedValidation: { data: [{ id: A1 }, { id: A2 }] } });
    const res = await resolveMissedCallRecipientsFromDb(db, { ...CALL, routed_agent_ids: [A1, A2] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tier).toBe("routed");
      expect(res.recipients).toEqual([A1, A2]);
    }
    expect(ops.some((o) => o.table === "phone_numbers")).toBe(false);
    expect(ops.some((o) => o.table === "leads")).toBe(false);
  });
});
