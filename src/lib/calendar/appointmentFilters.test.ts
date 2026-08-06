import { describe, it, expect } from "vitest";
import {
  isDialerCallbackAppointment,
  excludeDialerCallbacks,
} from "./appointmentFilters";

describe("isDialerCallbackAppointment", () => {
  it("excludes the exact main-Dialer title 'Callback'", () => {
    expect(isDialerCallbackAppointment({ title: "Callback", notes: "" })).toBe(true);
  });

  it("excludes case and whitespace variants of 'Callback'", () => {
    expect(isDialerCallbackAppointment({ title: "callback", notes: "" })).toBe(true);
    expect(isDialerCallbackAppointment({ title: "CALLBACK", notes: "" })).toBe(true);
    expect(isDialerCallbackAppointment({ title: "  Callback  ", notes: "" })).toBe(true);
    expect(isDialerCallbackAppointment({ title: "\tCALLBACK\n", notes: "" })).toBe(true);
  });

  it("excludes FloatingDialer 'Callback:' prefixed titles", () => {
    expect(isDialerCallbackAppointment({ title: "Callback: Jane Doe", notes: "" })).toBe(true);
    expect(isDialerCallbackAppointment({ title: "callback: jane doe", notes: "" })).toBe(true);
    expect(isDialerCallbackAppointment({ title: "  Callback: Jane Doe", notes: "" })).toBe(true);
    expect(isDialerCallbackAppointment({ title: "Callback:Jane", notes: "" })).toBe(true);
    // Empty-name template edge cases still match the prefix signature.
    expect(isDialerCallbackAppointment({ title: "Callback:", notes: "" })).toBe(true);
    expect(isDialerCallbackAppointment({ title: "Callback: ", notes: "" })).toBe(true);
  });

  it("excludes rows carrying the dialer note marker regardless of title", () => {
    expect(
      isDialerCallbackAppointment({
        title: "Prep call",
        notes: "Callback scheduled from dialer. Disposition: Interested",
      })
    ).toBe(true);
    expect(
      isDialerCallbackAppointment({
        title: "Prep call",
        notes: "CALLBACK SCHEDULED FROM DIALER. DISPOSITION: INTERESTED",
      })
    ).toBe(true);
    expect(
      isDialerCallbackAppointment({
        title: "Prep call",
        notes: "Agent memo — Callback scheduled from dialer. Disposition: Busy — follow up",
      })
    ).toBe(true);
  });

  it("retains a legitimate Follow Up appointment (type is never consulted)", () => {
    expect(
      isDialerCallbackAppointment({
        title: "Quarterly check-in",
        notes: "Review term policy options",
      })
    ).toBe(false);
  });

  it("retains an ordinary Scheduled appointment", () => {
    expect(
      isDialerCallbackAppointment({ title: "Policy review with Marcus", notes: "" })
    ).toBe(false);
  });

  it("retains historical Completed/Cancelled real appointments (status is never consulted)", () => {
    expect(isDialerCallbackAppointment({ title: "Annual review", notes: "Went well" })).toBe(false);
    expect(isDialerCallbackAppointment({ title: "Intro meeting", notes: "Client cancelled" })).toBe(false);
  });

  it("retains similar but non-signature titles", () => {
    expect(isDialerCallbackAppointment({ title: "Callback Review Meeting", notes: "" })).toBe(false);
    expect(isDialerCallbackAppointment({ title: "Callbacks", notes: "" })).toBe(false);
    expect(isDialerCallbackAppointment({ title: "Call back", notes: "" })).toBe(false);
    expect(isDialerCallbackAppointment({ title: "Callback :", notes: "" })).toBe(false);
    expect(isDialerCallbackAppointment({ title: "Pre-callback prep", notes: "" })).toBe(false);
    expect(
      isDialerCallbackAppointment({
        title: "Follow up",
        notes: "Client prefers a callback tomorrow",
      })
    ).toBe(false);
    // Non-signature title + another confirmed marker in notes still excludes.
    expect(
      isDialerCallbackAppointment({
        title: "Callback Review Meeting",
        notes: "Callback scheduled from dialer. Disposition: Interested",
      })
    ).toBe(true);
  });

  it("handles missing/null fields without throwing", () => {
    expect(isDialerCallbackAppointment({})).toBe(false);
    expect(isDialerCallbackAppointment({ title: null, notes: null })).toBe(false);
    expect(isDialerCallbackAppointment({ title: undefined, notes: undefined })).toBe(false);
    expect(isDialerCallbackAppointment({ title: "", notes: "" })).toBe(false);
  });
});

describe("excludeDialerCallbacks", () => {
  const real = { id: "r1", title: "Policy review with Marcus", notes: "" };
  const realFollowUp = { id: "r2", title: "Quarterly check-in", notes: "", type: "Follow Up" };
  const realCancelled = { id: "r3", title: "Intro meeting", notes: "", status: "Cancelled" };
  const cbExact = { id: "c1", title: "Callback", notes: "" };
  const cbPrefixed = { id: "c2", title: "Callback: Jane Doe", notes: "" };
  const cbMarker = {
    id: "c3",
    title: "Prep call",
    notes: "Callback scheduled from dialer. Disposition: Interested",
  };

  it("filters callback rows and keeps real appointments in order", () => {
    const input = [cbExact, real, cbPrefixed, realFollowUp, cbMarker, realCancelled];
    const result = excludeDialerCallbacks(input);
    // A Cancelled real appointment is retained — status is never consulted.
    expect(result).toEqual([real, realFollowUp, realCancelled]);
    // Retained elements are the same references, not copies.
    expect(result[0]).toBe(real);
    expect(result[1]).toBe(realFollowUp);
    expect(result[2]).toBe(realCancelled);
  });

  it("never mutates the input array", () => {
    const input = [cbExact, real, cbPrefixed, realFollowUp, cbMarker];
    const elementRefs = [...input];
    const snapshot = JSON.parse(JSON.stringify(input));

    const result = excludeDialerCallbacks(input);

    expect(result).not.toBe(input);
    expect(input).toHaveLength(5);
    input.forEach((el, i) => expect(el).toBe(elementRefs[i]));
    expect(input).toEqual(snapshot);
  });

  it("returns an empty array for an all-callback input and a fresh array for empty input", () => {
    expect(excludeDialerCallbacks([cbExact, cbPrefixed, cbMarker])).toEqual([]);
    const empty: Array<{ title?: string | null; notes?: string | null }> = [];
    const result = excludeDialerCallbacks(empty);
    expect(result).toEqual([]);
    expect(result).not.toBe(empty);
  });
});
