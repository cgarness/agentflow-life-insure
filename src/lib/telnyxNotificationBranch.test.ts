import { describe, it, expect } from "vitest";
import { resolveTelnyxNotificationBranch } from "./telnyxNotificationBranch";

describe("resolveTelnyxNotificationBranch", () => {
  it("classifies inbound ringing as incoming", () => {
    expect(resolveTelnyxNotificationBranch({ direction: "inbound", state: "ringing" })).toBe("incoming");
  });

  it("classifies inbound new as incoming", () => {
    expect(resolveTelnyxNotificationBranch({ direction: "inbound", state: "new" })).toBe("incoming");
  });

  it("classifies inbound trying/early as incoming (not outbound ringback)", () => {
    expect(resolveTelnyxNotificationBranch({ direction: "inbound", state: "trying" })).toBe("incoming");
    expect(resolveTelnyxNotificationBranch({ direction: "inbound", state: "early" })).toBe("incoming");
  });

  it("classifies inbound recovering as incoming", () => {
    expect(resolveTelnyxNotificationBranch({ direction: "inbound", state: "recovering" })).toBe("incoming");
  });

  it("classifies outbound ringing as dialing", () => {
    expect(resolveTelnyxNotificationBranch({ direction: "outbound", state: "ringing" })).toBe("dialing");
  });

  it("classifies outbound trying as dialing", () => {
    expect(resolveTelnyxNotificationBranch({ direction: "outbound", state: "trying" })).toBe("dialing");
  });

  it("classifies active for both directions", () => {
    expect(resolveTelnyxNotificationBranch({ direction: "inbound", state: "active" })).toBe("active");
    expect(resolveTelnyxNotificationBranch({ direction: "outbound", state: "active" })).toBe("active");
  });

  it("classifies hangup/destroy as ended", () => {
    expect(resolveTelnyxNotificationBranch({ direction: "inbound", state: "hangup" })).toBe("ended");
    expect(resolveTelnyxNotificationBranch({ direction: "outbound", state: "destroy" })).toBe("ended");
  });
});
