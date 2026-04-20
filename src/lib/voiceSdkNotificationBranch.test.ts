import { describe, it, expect } from "vitest";
import { resolveVoiceSdkNotificationBranch } from "./voiceSdkNotificationBranch";

describe("resolveVoiceSdkNotificationBranch", () => {
  it("classifies inbound ringing as incoming", () => {
    expect(resolveVoiceSdkNotificationBranch({ direction: "inbound", state: "ringing" })).toBe("incoming");
  });

  it("classifies SDK incoming (synonym) ringing as incoming, not outbound dialing", () => {
    expect(resolveVoiceSdkNotificationBranch({ direction: "incoming", state: "ringing" })).toBe("incoming");
    expect(resolveVoiceSdkNotificationBranch({ direction: "incoming", state: "trying" })).toBe("incoming");
  });

  it("classifies inbound new as incoming", () => {
    expect(resolveVoiceSdkNotificationBranch({ direction: "inbound", state: "new" })).toBe("incoming");
  });

  it("classifies inbound trying/early as incoming (not outbound ringback)", () => {
    expect(resolveVoiceSdkNotificationBranch({ direction: "inbound", state: "trying" })).toBe("incoming");
    expect(resolveVoiceSdkNotificationBranch({ direction: "inbound", state: "early" })).toBe("incoming");
  });

  it("classifies inbound recovering as incoming", () => {
    expect(resolveVoiceSdkNotificationBranch({ direction: "inbound", state: "recovering" })).toBe("incoming");
  });

  it("classifies inbound parked as incoming (Voice API uses parked on call.initiated)", () => {
    expect(resolveVoiceSdkNotificationBranch({ direction: "incoming", state: "parked" })).toBe("incoming");
    expect(resolveVoiceSdkNotificationBranch({ direction: "inbound", state: "parked" })).toBe("incoming");
  });

  it("classifies outbound ringing as dialing", () => {
    expect(resolveVoiceSdkNotificationBranch({ direction: "outbound", state: "ringing" })).toBe("dialing");
  });

  it("classifies outbound trying as dialing", () => {
    expect(resolveVoiceSdkNotificationBranch({ direction: "outbound", state: "trying" })).toBe("dialing");
  });

  it("classifies active for both directions", () => {
    expect(resolveVoiceSdkNotificationBranch({ direction: "inbound", state: "active" })).toBe("active");
    expect(resolveVoiceSdkNotificationBranch({ direction: "outbound", state: "active" })).toBe("active");
  });

  it("classifies hangup/destroy as ended", () => {
    expect(resolveVoiceSdkNotificationBranch({ direction: "inbound", state: "hangup" })).toBe("ended");
    expect(resolveVoiceSdkNotificationBranch({ direction: "outbound", state: "destroy" })).toBe("ended");
  });
});
