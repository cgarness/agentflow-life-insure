import { describe, it, expect } from "vitest";
import { resolveInboundCallerRawNumber } from "./telnyxInboundCaller";

describe("resolveInboundCallerRawNumber", () => {
  it("uses options.remoteCallerNumber when present", () => {
    const call = {
      options: { remoteCallerNumber: "+18097756963", callerNumber: "+15550001111" },
    };
    expect(resolveInboundCallerRawNumber(call)).toBe("+18097756963");
  });

  it("falls back to notification envelope fields", () => {
    const call = { options: {} };
    const notification = { from: "+18097756963" };
    expect(resolveInboundCallerRawNumber(call, notification)).toBe("+18097756963");
  });
});
