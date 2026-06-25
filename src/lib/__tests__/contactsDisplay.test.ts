import { describe, it, expect } from "vitest";
import { normalizeStatusDisplay } from "@/lib/contactsDisplay";

describe("normalizeStatusDisplay", () => {
  it("returns empty string for blank input", () => {
    expect(normalizeStatusDisplay("")).toBe("");
  });

  it("passes through normal status labels unchanged", () => {
    expect(normalizeStatusDisplay("New")).toBe("New");
    expect(normalizeStatusDisplay("Follow Up")).toBe("Follow Up");
    expect(normalizeStatusDisplay("Appointment Set")).toBe("Appointment Set");
  });

  it("repairs the legacy misspelled 'APPPINTMENT' recruit stage", () => {
    expect(normalizeStatusDisplay("APPPINTMENT SET")).toBe("Appointment SET");
  });

  it("repairs a single-P misspelling and is case-insensitive on the match", () => {
    expect(normalizeStatusDisplay("APPINTMENT")).toBe("Appointment");
    expect(normalizeStatusDisplay("appPINTMENT set")).toBe("Appointment set");
  });

  it("only rewrites the misspelled token, leaving the rest of the label intact", () => {
    expect(normalizeStatusDisplay("Pre APPPINTMENT review")).toBe("Pre Appointment review");
  });
});
