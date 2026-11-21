import { describe, expect, it } from "vitest";
import {
  contactAssignment,
  contactFromReadiness,
  contactNumberRevision,
  initialContactFrom,
  stickyFromEnabled,
} from "@/lib/contact-from-number";
import type { ContactNumberAffinity, ContactNumberOption, SenderChoice } from "@/lib/number-affinity";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const NUMBER_A = "+15551112222";
const NUMBER_B = "+15553334444";
const sender = (overrides: Partial<SenderChoice> = {}): SenderChoice => ({
  id: A, number: NUMBER_A, readiness: "ready", provisional: true, state: "unassigned", version: 0,
  ...overrides,
});
const option = (overrides: Partial<ContactNumberOption> = {}): ContactNumberOption => ({
  ...sender(), voice_readiness: "ready", ...overrides,
});
const preview = (overrides: Partial<ContactNumberAffinity> = {}): ContactNumberAffinity => ({
  voice_mode: "enforced", sms_mode: "enforced", generation: 1, history: "new",
  voice: sender(), sms: sender(), ...overrides,
});

describe("contact FROM identity versus a saved assignment", () => {
  it.each(["unassigned", undefined])("uses an untouched first sender without displaying it as saved (%s)", state => {
    const data = preview({ voice: sender({ state }), sms: sender({ state }) });
    const before = JSON.stringify(data);
    expect(contactAssignment(data)).toMatchObject({ voice: null, sms: null, number: null, split: false, pending: false });
    expect(initialContactFrom(data, [option()])).toMatchObject({ id: A, number: NUMBER_A, state });
    expect(JSON.stringify(data)).toBe(before);
  });

  it.each(["voice", "sms"] as const)("recognizes one saved %s channel without inventing the other assignment", channel => {
    const data = preview({ [channel]: sender({ state: "established", version: 4 }), history: "reconciled" });
    const assignment = contactAssignment(data);
    expect(assignment[channel]).toMatchObject({ id: A, state: "established" });
    expect(assignment[channel === "voice" ? "sms" : "voice"]).toBeNull();
    expect(assignment).toMatchObject({ number: NUMBER_A, split: false, pending: false });
    expect(initialContactFrom(data)).toMatchObject({ id: A, number: NUMBER_A });
  });

  it("retains a reserved SMS identity and marks its pending state", () => {
    const data = preview({ sms: sender({ state: "reserved", version: 2 }) });
    expect(contactAssignment(data)).toMatchObject({ voice: null, sms: { id: A }, pending: true, number: NUMBER_A });
    expect(initialContactFrom(data)).toMatchObject({ id: A, state: "reserved" });
  });

  it.each([
    [B, NUMBER_B],
    [B, NUMBER_A],
  ])("requires a deliberate selection for distinct saved identities (%s)", (id, number) => {
    const data = preview({ voice: sender({ state: "established" }), sms: sender({ id, number, state: "established" }) });
    expect(contactAssignment(data)).toMatchObject({ split: true, number: null });
    expect(initialContactFrom(data, [option(), option({ id, number })])).toBeNull();
  });

  it("never treats coalesced review numbers as saved winners", () => {
    const data = preview({ voice: sender({ state: "needs_review" }), sms: sender({ state: "needs_review" }) });
    expect(contactAssignment(data)).toMatchObject({ voice: null, sms: null, number: null, review: true });
    expect(initialContactFrom(data, [option()])).toBeNull();
  });

  it.each(["voice", "sms"] as const)("blocks only the reviewed %s channel when the other has a saved identity", channel => {
    const other = channel === "voice" ? "sms" : "voice";
    const data = preview({
      [channel]: sender({ state: "needs_review" }),
      [other]: sender({ state: "established", version: 3 }),
    });
    expect(contactAssignment(data)[channel]).toBeNull();
    expect(contactAssignment(data)[other]).toMatchObject({ id: A, state: "established" });
    const choice = initialContactFrom(data, [option()]);
    expect(choice).toMatchObject({ id: A, number: NUMBER_A });
    expect(contactFromReadiness(data, choice, false)).toEqual({
      call: channel === "voice" ? "needs_review" : "ready",
      sms: channel === "sms" ? "needs_review" : "ready",
    });
    expect(contactFromReadiness(data, option(), true)).toEqual({ call: "ready", sms: "ready" });
  });

  it("requires deliberate selection for unresolved endpoint history despite an available saved number", () => {
    const data = preview({ history: "needs_review", voice: sender({ state: "established" }) });
    expect(initialContactFrom(data, [option()])).toBeNull();
    expect(contactFromReadiness(data, option(), false)).toEqual({ call: "needs_review", sms: "needs_review" });
    expect(contactFromReadiness(data, option(), true)).toEqual({ call: "ready", sms: "ready" });
  });

  it("keeps a deleted number's saved snapshot without reconnecting identical purchased digits", () => {
    const deleted = sender({ id: null, state: "established", readiness: "unavailable", version: 7 });
    const data = preview({ voice: deleted, sms: { ...deleted }, history: "reconciled" });
    const purchasedAgain = option({ id: B, number: NUMBER_A });
    expect(contactAssignment(data)).toMatchObject({ number: NUMBER_A, voice: { id: null }, sms: { id: null } });
    const choice = initialContactFrom(data, [purchasedAgain]);
    expect(choice).toMatchObject({ id: null, number: NUMBER_A });
    expect(contactFromReadiness(data, choice, false)).toEqual({ call: "unavailable", sms: "unavailable" });
  });
});

describe("active channel modes", () => {
  it.each([
    ["off", "off"], ["off", "shadow"], ["shadow", "off"], ["shadow", "shadow"],
  ] as const)("does not activate a contact-local FROM for voice=%s / SMS=%s", (voice_mode, sms_mode) => {
    const data = preview({ voice_mode, sms_mode, voice: sender({ state: "established" }), sms: sender({ state: "reserved" }) });
    expect(stickyFromEnabled(data)).toBe(false);
    expect(initialContactFrom(data, [option()])).toBeNull();
    expect(contactAssignment(data)).toMatchObject({ voice: null, sms: null, number: null, pending: false });
  });

  it.each(["enforced", "guard_only"] as const)("uses the guarded channel while ignoring an inactive review (%s)", mode => {
    for (const active of ["voice", "sms"] as const) {
      const other = active === "voice" ? "sms" : "voice";
      for (const inactiveMode of ["off", "shadow"] as const) {
        const data = preview({
          [`${active}_mode`]: mode, [`${other}_mode`]: inactiveMode,
          [active]: sender({ state: "established" }),
          [other]: sender({ id: B, number: NUMBER_B, state: "needs_review" }),
        });
        expect(stickyFromEnabled(data)).toBe(true);
        expect(contactAssignment(data)).toMatchObject({ split: false, review: false, number: NUMBER_A });
        const choice = initialContactFrom(data, [option()]);
        expect(choice).toMatchObject({ id: A, number: NUMBER_A });
        expect(contactFromReadiness(data, choice, false)).toEqual({ call: "ready", sms: "ready" });
      }
    }
  });

  it("does not manufacture a first sender from the options when guard-only preview has none", () => {
    const empty = sender({ id: null, number: null, readiness: "unavailable" });
    const data = preview({ voice_mode: "guard_only", sms_mode: "guard_only", voice: empty, sms: { ...empty } });
    expect(initialContactFrom(data, [option()])).toBeNull();
  });
});

describe("effective FROM readiness", () => {
  it("retains the saved-pin cap exception while a temporary selection uses strict option readiness", () => {
    const data = preview({ voice: sender({ state: "established" }), sms: sender({ state: "established" }) });
    const cappedOption = option({ voice_readiness: "daily_limit" });
    const ordinary = initialContactFrom(data, [cappedOption]);
    expect(contactFromReadiness(data, ordinary, false)).toEqual({ call: "ready", sms: "ready" });
    expect(contactFromReadiness(data, cappedOption, true)).toEqual({ call: "daily_limit", sms: "ready" });
  });

  it("uses the selected alternate's readiness independently for calls and texts", () => {
    const data = preview({ voice: sender({ state: "established" }), sms: sender({ state: "established" }) });
    const alternate = option({ id: B, number: NUMBER_B, readiness: "setup_required" });
    expect(contactFromReadiness(data, alternate, true)).toEqual({ call: "ready", sms: "setup_required" });
    expect(contactAssignment(data).number).toBe(NUMBER_A);
  });

  it("does not authorize an absent preview, absent choice or a choice with no identity", () => {
    expect(initialContactFrom(undefined, [option()])).toBeNull();
    expect(stickyFromEnabled(undefined)).toBe(false);
    for (const [data, choice] of [
      [undefined, option()], [preview(), null], [preview(), option({ id: null })], [preview(), option({ number: null })],
    ] as [ContactNumberAffinity | undefined, ContactNumberOption | null][]) {
      expect(contactFromReadiness(data, choice, false)).toEqual({ call: "unavailable", sms: "unavailable" });
    }
  });

  it("readiness changes preserve saved identity, while a new assignment generation invalidates the revision", () => {
    const before = preview({ voice: sender({ state: "established", version: 2 }), sms: sender({ state: "established", version: 3 }) });
    const paused = { ...before, sms: { ...before.sms, readiness: "texting_paused" } };
    expect(contactAssignment(paused).number).toBe(NUMBER_A);
    expect(contactNumberRevision(paused)).toBe(contactNumberRevision(before));
    expect(contactFromReadiness(paused, initialContactFrom(paused), false)).toEqual({ call: "ready", sms: "texting_paused" });
    expect(contactNumberRevision({ ...before, generation: 2 })).not.toBe(contactNumberRevision(before));
  });
});
