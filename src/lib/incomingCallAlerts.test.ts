import { describe, it, expect, beforeEach } from "vitest";
import {
  loadIncomingCallAlertsPrefs,
  saveIncomingCallAlertsPrefs,
} from "./incomingCallAlerts";

describe("incomingCallAlerts prefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults when empty", () => {
    const p = loadIncomingCallAlertsPrefs();
    expect(p.optIn).toBe(false);
    expect(p.ringtone).toBe(true);
    expect(p.desktop).toBe(true);
  });

  it("persists opt-in", () => {
    saveIncomingCallAlertsPrefs({ optIn: true });
    expect(loadIncomingCallAlertsPrefs().optIn).toBe(true);
  });
});
