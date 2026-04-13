import { describe, it, expect } from "vitest";
import {
  resolveInboundCallerRawNumber,
  buildOrgDidLast10Set,
  telnyxCallControlIdsEqual,
  isCallsRowInboundDirection,
  isCallsRowOutboundDirection,
} from "./telnyxInboundCaller";

describe("resolveInboundCallerRawNumber", () => {
  it("uses options.remoteCallerNumber when present", () => {
    const call = {
      options: { remoteCallerNumber: "+18097756963", callerNumber: "+15550001111" },
    };
    expect(resolveInboundCallerRawNumber(call)).toBe("+18097756963");
  });

  it("ignores callerNumber even when it is the only long string", () => {
    const call = {
      options: { callerNumber: "+15550001111" },
    };
    expect(resolveInboundCallerRawNumber(call)).toBe("");
  });

  it("falls back to notification envelope fields", () => {
    const call = { options: {} };
    const notification = { from: "+18097756963" };
    expect(resolveInboundCallerRawNumber(call, notification)).toBe("+18097756963");
  });

  it("excludes org-owned last-10", () => {
    const exclude = buildOrgDidLast10Set([{ phone_number: "+15550001111" }]);
    const call = {
      options: { remoteCallerNumber: "+15550001111", caller_id_number: "+18097756963" },
    };
    const notification = { caller_id_number: "+18097756963" };
    expect(resolveInboundCallerRawNumber(call, notification, exclude)).toBe("+18097756963");
  });
});

describe("buildOrgDidLast10Set", () => {
  it("collects last 10 from extras", () => {
    const s = buildOrgDidLast10Set([], "+1 (555) 000-2222");
    expect(s.has("5550002222")).toBe(true);
  });
});

describe("telnyxCallControlIdsEqual", () => {
  it("matches ids with or without v3: prefix", () => {
    const bare = "Pb5PxRu5ZSFAXZEfJXiRXgoUS3Ooog1ZeyI2ovRSzJu_ddfJCTFCg";
    expect(telnyxCallControlIdsEqual(`v3:${bare}`, bare)).toBe(true);
    expect(telnyxCallControlIdsEqual(`v3:${bare}`, `v3:${bare}`)).toBe(true);
  });

  it("returns false for empty or unrelated ids", () => {
    expect(telnyxCallControlIdsEqual("", "abc")).toBe(false);
    expect(telnyxCallControlIdsEqual("a", "b")).toBe(false);
  });
});

describe("isCallsRowInboundDirection", () => {
  it("accepts inbound and incoming labels", () => {
    expect(isCallsRowInboundDirection("inbound")).toBe(true);
    expect(isCallsRowInboundDirection("incoming")).toBe(true);
    expect(isCallsRowInboundDirection("outbound")).toBe(false);
  });
});

describe("isCallsRowOutboundDirection", () => {
  it("accepts outbound and outgoing labels", () => {
    expect(isCallsRowOutboundDirection("outbound")).toBe(true);
    expect(isCallsRowOutboundDirection("outgoing")).toBe(true);
    expect(isCallsRowOutboundDirection("OUTBOUND")).toBe(true);
    expect(isCallsRowOutboundDirection("inbound")).toBe(false);
    expect(isCallsRowOutboundDirection("")).toBe(false);
  });
});
