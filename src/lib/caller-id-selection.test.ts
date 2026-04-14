import { describe, it, expect } from "vitest";
import {
  selectOutboundCallerId,
  extractDestinationAreaCode,
  isEligibleStrict,
  type CallerIdPhoneRow,
  type SelectCallerIdInput,
} from "./caller-id-selection";

const basePhone = (over: Partial<CallerIdPhoneRow> = {}): CallerIdPhoneRow => ({
  phone_number: "+15550000001",
  area_code: "555",
  is_default: false,
  daily_call_count: 0,
  daily_call_limit: 100,
  ...over,
});

function input(partial: Partial<SelectCallerIdInput> & { phones: CallerIdPhoneRow[] }): SelectCallerIdInput {
  return {
    destinationPhone: "+13105551212",
    contactId: null,
    phones: partial.phones,
    localPresenceEnabled: true,
    defaultFallback: "+15550000099",
    didLastUsedAt: new Map(),
    now: 1_000_000,
    stickyMinDurationSec: 30,
    ...partial,
  };
}

describe("extractDestinationAreaCode", () => {
  it("reads US 10-digit block", () => {
    expect(extractDestinationAreaCode("+1 (310) 555-1212")).toBe("310");
    expect(extractDestinationAreaCode("3105551212")).toBe("310");
  });
});

describe("isEligibleStrict", () => {
  it("rejects when over daily cap", () => {
    const p = basePhone({ daily_call_count: 100, daily_call_limit: 100 });
    expect(isEligibleStrict(p, { didLastUsedAt: new Map() })).toBe(false);
  });

  it("accepts when under daily cap", () => {
    const p = basePhone({ daily_call_count: 0, daily_call_limit: 100 });
    expect(isEligibleStrict(p, { didLastUsedAt: new Map() })).toBe(true);
  });
});

describe("selectOutboundCallerId", () => {
  it("picks same area code with LRU among strict eligible", async () => {
    const phones = [
      basePhone({ phone_number: "+13105550100", area_code: "310", is_default: false }),
      basePhone({ phone_number: "+13105550200", area_code: "310", is_default: false }),
    ];
    const map = new Map<string, number>([
      ["+13105550100", 500],
      ["+13105550200", 100],
    ]);
    const res = await selectOutboundCallerId(
      input({ phones, didLastUsedAt: map }),
      {
        queryStickyCaller: async () => null,
        getStateByAreaCode: async () => null,
      },
    );
    // +13105550100 used longer ago (500 < 100 in LRU sort means 500 is older... wait)
    // sort: ua = 500, ub = 100 -> ua - ub = 400 > 0 -> b comes first? We want smallest timestamp first (oldest use)
    // Oldest = 100 is smaller than 500, so +13105550200 should win
    expect(res).toBe("+13105550200");
  });

  it("uses sticky when duration qualifies and DID is eligible", async () => {
    const phones = [basePhone({ phone_number: "+12065550100", area_code: "206" })];
    const res = await selectOutboundCallerId(
      input({
        phones,
        destinationPhone: "+13105551212",
        contactId: "c1",
        localPresenceEnabled: true,
      }),
      {
        queryStickyCaller: async () => ({
          caller_id_used: "+12065550100",
          duration_sec: 45,
        }),
        getStateByAreaCode: async () => "CA",
      },
    );
    expect(res).toBe("+12065550100");
  });

  it("ignores sticky when duration too short", async () => {
    const phones = [
      basePhone({ phone_number: "+12065550100", area_code: "206" }),
      basePhone({ phone_number: "+13105550100", area_code: "310" }),
    ];
    const res = await selectOutboundCallerId(
      input({
        phones,
        destinationPhone: "+13105551212",
        contactId: "c1",
      }),
      {
        queryStickyCaller: async () => ({
          caller_id_used: "+12065550100",
          duration_sec: 12,
        }),
        getStateByAreaCode: async () => null,
      },
    );
    expect(res).toBe("+13105550100");
  });

  it("skips local match when localPresenceEnabled is false", async () => {
    const phones = [
      basePhone({ phone_number: "+13105550100", area_code: "310", is_default: true }),
      basePhone({ phone_number: "+19876543210", area_code: "987", is_default: false }),
    ];
    const res = await selectOutboundCallerId(
      input({
        phones,
        localPresenceEnabled: false,
      }),
      {
        queryStickyCaller: async () => null,
        getStateByAreaCode: async () => null,
      },
    );
    expect(res).toBe("+13105550100");
  });
});
