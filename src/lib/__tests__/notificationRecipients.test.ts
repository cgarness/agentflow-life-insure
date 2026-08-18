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
