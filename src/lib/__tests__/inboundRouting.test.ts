// Fail-first tests — twilio-voice-inbound pure routing helpers (plan rev5: T17, T18, T21, T22, R14).
import { describe, it, expect } from "vitest";
import {
  filterActiveRingTargets,
  excludeAlreadyRoutedAgents,
  validateAssignedProfile,
  shouldMarkMissedOnDialReturn,
  isAnsweredDialStatus,
  buildWavePlan,
} from "../../../supabase/functions/twilio-voice-inbound/routing";

const ORG = "aaaaaaaa-0000-0000-0000-00000000000a";
const p = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  organization_id: ORG,
  status: "Active",
  twilio_client_identity: `agent_${id.slice(-2)}`,
  ...over,
});

describe("filterActiveRingTargets (T17/T18 org+Active+identity)", () => {
  it("T17: excludes inactive profiles from all-ring targets", () => {
    const rows = [p("a1"), p("a2", { status: "Inactive" }), p("a3", { status: "Active" })];
    const t = filterActiveRingTargets(rows, ORG);
    expect(t.agentIds).toEqual(["a1", "a3"].map((s) => s));
    expect(t.identities).toHaveLength(2);
  });
  it("T18: excludes cross-org profiles even when Active", () => {
    const rows = [p("a1"), p("b1", { organization_id: "bbbbbbbb-0000-0000-0000-00000000000b" })];
    const t = filterActiveRingTargets(rows, ORG);
    expect(t.agentIds).toEqual(["a1"]);
  });
  it("excludes identity-less profiles", () => {
    const rows = [p("a1"), p("a2", { twilio_client_identity: null }), p("a3", { twilio_client_identity: "  " })];
    const t = filterActiveRingTargets(rows, ORG);
    expect(t.agentIds).toEqual(["a1"]);
  });
});

describe("excludeAlreadyRoutedAgents (T21)", () => {
  it("agents rung in an earlier wave are never re-rung", () => {
    const targets = { identities: ["agent_a1", "agent_a2", "agent_a3"], agentIds: ["a1", "a2", "a3"] };
    const t = excludeAlreadyRoutedAgents(targets, ["a2"]);
    expect(t.agentIds).toEqual(["a1", "a3"]);
    expect(t.identities).toEqual(["agent_a1", "agent_a3"]);
  });
  it("handles null/empty exclusion sets", () => {
    const targets = { identities: ["agent_a1"], agentIds: ["a1"] };
    expect(excludeAlreadyRoutedAgents(targets, null).agentIds).toEqual(["a1"]);
    expect(excludeAlreadyRoutedAgents(targets, []).agentIds).toEqual(["a1"]);
  });
});

describe("validateAssignedProfile (T18 assigned/direct-line)", () => {
  it("accepts an Active same-org owner with an identity", () => {
    expect(validateAssignedProfile(p("a1"), ORG)).toBe("agent_a1");
  });
  it("rejects inactive, cross-org, identity-less, and missing owners", () => {
    expect(validateAssignedProfile(p("a1", { status: "Inactive" }), ORG)).toBeNull();
    expect(validateAssignedProfile(p("a1", { organization_id: "bbbbbbbb-0000-0000-0000-00000000000b" }), ORG)).toBeNull();
    expect(validateAssignedProfile(p("a1", { twilio_client_identity: null }), ORG)).toBeNull();
    expect(validateAssignedProfile(null, ORG)).toBeNull();
  });
});

describe("missed-call decisions (T22)", () => {
  it("an answered forward/dial return is never missed", () => {
    expect(isAnsweredDialStatus("completed")).toBe(true);
    expect(isAnsweredDialStatus("answered")).toBe(true);
    expect(shouldMarkMissedOnDialReturn("completed")).toBe(false);
    expect(shouldMarkMissedOnDialReturn("answered")).toBe(false);
  });
  it("an unanswered forward return is missed", () => {
    for (const s of ["no-answer", "busy", "failed", "canceled", ""]) {
      expect(shouldMarkMissedOnDialReturn(s)).toBe(true);
    }
  });
});

describe("buildWavePlan (R14 — routed persistence precedes ringing)", () => {
  const targets = { identities: ["agent_a1"], agentIds: ["a1"] };
  it("a successful persist rings the wave", () => {
    expect(buildWavePlan(targets, true, { voicemailEnabled: true })).toEqual({ action: "ring", targets });
  });
  it("persist failure (false) suppresses the wave and takes the safe fallback", () => {
    expect(buildWavePlan(targets, false, { voicemailEnabled: true })).toEqual({ action: "voicemail" });
    expect(buildWavePlan(targets, false, { voicemailEnabled: false })).toEqual({ action: "hangup" });
  });
  it("empty targets never ring regardless of persistence", () => {
    expect(buildWavePlan({ identities: [], agentIds: [] }, true, { voicemailEnabled: true })).toEqual({ action: "none" });
  });
});
