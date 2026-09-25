import { describe, it, expect } from "vitest";
import {
  computeTeamOpenCallStatus,
  dialSessionOnAnswered,
  dialSessionOnDialing,
  dialSessionOnLockChange,
  isInboundActivity,
  type TeamOpenRevealInput,
} from "@/lib/teamOpenReveal";

const base: TeamOpenRevealInput = {
  currentCampaignLeadId: "cl-A",
  confirmedLockLeadId: "cl-A",
  callState: "idle",
  inboundActive: false,
  dialSession: null,
  showWrapUp: false,
};
const answeredA = { campaignLeadId: "cl-A", answered: true };
const ringingA = { campaignLeadId: "cl-A", answered: false };

describe("computeTeamOpenCallStatus — staged reveal preserved", () => {
  it("idle before any dial (skeleton), ringing while dialling (partial), connected once answered", () => {
    expect(computeTeamOpenCallStatus(base)).toBe("idle");
    expect(computeTeamOpenCallStatus({ ...base, callState: "dialing", dialSession: ringingA })).toBe("ringing");
    expect(computeTeamOpenCallStatus({ ...base, callState: "active", dialSession: answeredA })).toBe("connected");
    expect(computeTeamOpenCallStatus({ ...base, callState: "ended", dialSession: answeredA })).toBe("connected");
    expect(computeTeamOpenCallStatus({ ...base, callState: "idle", showWrapUp: true, dialSession: answeredA })).toBe("connected");
  });

  it("never reveals without the server-confirmed lock for the displayed lead", () => {
    expect(computeTeamOpenCallStatus({ ...base, confirmedLockLeadId: null, callState: "active", dialSession: answeredA })).toBe("idle");
    expect(computeTeamOpenCallStatus({ ...base, currentCampaignLeadId: null })).toBe("idle");
  });
});

describe("display-state corrections (plan §4.3-5, D-8)", () => {
  it("a lock-loss reload that swaps in lead B mid-call / mid-wrap-up does NOT reveal B", () => {
    // Lock lost: confirmed lock cleared → masked immediately.
    expect(computeTeamOpenCallStatus({ ...base, confirmedLockLeadId: null, callState: "active", dialSession: answeredA })).toBe("idle");
    // Reload confirms B while A's call / wrap-up is still open: B was never dialled.
    const swapped = { ...base, currentCampaignLeadId: "cl-B", confirmedLockLeadId: "cl-B", dialSession: answeredA };
    expect(computeTeamOpenCallStatus({ ...swapped, callState: "active" })).toBe("idle");
    expect(computeTeamOpenCallStatus({ ...swapped, callState: "idle", showWrapUp: true })).toBe("idle");
    // And the session itself is dropped by the lock change.
    expect(dialSessionOnLockChange(answeredA, null)).toBeNull();
    expect(dialSessionOnLockChange(answeredA, "cl-B")).toBeNull();
    expect(dialSessionOnLockChange(answeredA, "cl-A")).toBe(answeredA);
  });

  it("inbound activity never satisfies the outbound reveal gate", () => {
    expect(computeTeamOpenCallStatus({ ...base, callState: "incoming", inboundActive: true, dialSession: answeredA })).toBe("idle");
    expect(computeTeamOpenCallStatus({ ...base, callState: "active", inboundActive: true, dialSession: answeredA })).toBe("idle");
    expect(computeTeamOpenCallStatus({ ...base, callState: "active", dialSession: null })).toBe("idle");
    expect(isInboundActivity("incoming", "outbound", false)).toBe(true);
    expect(isInboundActivity("active", "inbound", true)).toBe(true);
    expect(isInboundActivity("ended", "inbound", false)).toBe(true);
    expect(isInboundActivity("active", "outbound", false)).toBe(false);
    expect(isInboundActivity("idle", "inbound", false)).toBe(false);
  });

  it("an unanswered outbound call never flashes full details", () => {
    expect(computeTeamOpenCallStatus({ ...base, callState: "ended", dialSession: ringingA })).toBe("idle");
    expect(computeTeamOpenCallStatus({ ...base, callState: "active", dialSession: ringingA })).toBe("ringing");
    expect(computeTeamOpenCallStatus({ ...base, showWrapUp: true, dialSession: ringingA })).toBe("idle");
  });

  it("dial-session transitions are tied to the dialled lead", () => {
    expect(dialSessionOnDialing("cl-A")).toEqual(ringingA);
    expect(dialSessionOnDialing(null)).toBeNull();
    expect(dialSessionOnAnswered(ringingA, "cl-A")).toEqual(answeredA);
    expect(dialSessionOnAnswered(ringingA, "cl-B")).toBe(ringingA);
    expect(dialSessionOnAnswered(null, "cl-A")).toBeNull();
    // A redial resets the answered flag for the new attempt.
    expect(dialSessionOnDialing("cl-A")).toEqual(ringingA);
  });
});
