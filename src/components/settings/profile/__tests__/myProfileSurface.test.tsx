/**
 * My Profile surface (implementation_plan.md §19) — what an agent may see. Ring-output selection and
 * phone connection diagnostics are gone from the page, call forwarding lives inside Preferences, and
 * none of it touched the inbound routing system: the diagnostics infrastructure, the Twilio ring
 * call sites and everything under supabase/ are asserted unchanged.
 */
import React from "react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const stableProfile = {
  email_notifications_enabled: true,
  sms_notifications_enabled: false,
  push_notifications_enabled: false,
  timezone: "Eastern Time (US & Canada)",
  theme_preference: "light",
  organization_id: "org-1",
};

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    profile: stableProfile,
    realProfile: { id: "u1", organization_id: "org-1" },
    isImpersonating: false,
    updateProfile: vi.fn(async () => {}),
  }),
}));
vi.mock("@/contexts/AgentStatusContext", () => ({ useAgentStatus: () => ({ activationPending: false, engine: "v2" }) }));
vi.mock("@/contexts/UnsavedChangesContext", () => ({ useUnsavedChanges: () => ({ registerDirty: vi.fn() }) }));
vi.mock("@/contexts/NotificationContext", () => ({ useNotifications: () => ({ requestPushPermission: vi.fn(async () => "granted" as const) }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = async () => ({ data: { mobile_forward_number: "+15551234567", mobile_forward_enabled: true, voicemail_greeting_text: "", voicemail_greeting_url: null }, error: null });
  builder.upsert = async () => ({ error: null });
  return { supabase: { from: () => builder } };
});

// The unrelated cards are stubbed: this suite is about what My Profile itself composes.
vi.mock("@/components/settings/profile/ProfileInfoCard", () => ({ ProfileInfoCard: () => <div data-testid="stub-info" /> }));
vi.mock("@/components/settings/profile/ProfileStateLicensesCard", () => ({ ProfileStateLicensesCard: () => <div data-testid="stub-licenses" /> }));
vi.mock("@/components/settings/profile/ProfileCarriersCard", () => ({ ProfileCarriersCard: () => <div data-testid="stub-carriers" /> }));
vi.mock("@/components/settings/profile/ProfileGoalsCard", () => ({ ProfileGoalsCard: () => <div data-testid="stub-goals" /> }));
vi.mock("@/components/settings/profile/ProfilePasswordCard", () => ({ ProfilePasswordCard: () => <div data-testid="stub-password" /> }));

import MyProfile from "@/components/settings/MyProfile";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const openPreferences = () => fireEvent.click(screen.getByRole("button", { name: /preferences/i }));

afterEach(cleanup);

describe("removed surfaces", () => {
  it("no 'Incoming ring outputs' anywhere on the page", async () => {
    render(<MyProfile />);
    openPreferences();
    await waitFor(() => expect(screen.getByLabelText(/mobile number/i)).toBeTruthy());
    expect(screen.queryByTestId("profile-ringtone-card")).toBeNull();
    expect(screen.queryByText(/incoming ring outputs/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /test ring|ring on all outputs/i })).toBeNull();
  });

  it("no 'Phone connection diagnostics'", async () => {
    render(<MyProfile />);
    openPreferences();
    await waitFor(() => expect(screen.getByLabelText(/mobile number/i)).toBeTruthy());
    expect(screen.queryByTestId("connection-diagnostics")).toBeNull();
    expect(screen.queryByText(/phone connection diagnostics/i)).toBeNull();
    expect(screen.queryByText(/device state|registration generation|identity/i)).toBeNull();
  });

  it("no standalone 'Inbound calls to your mobile' card", async () => {
    render(<MyProfile />);
    openPreferences();
    await waitFor(() => expect(screen.getByLabelText(/mobile number/i)).toBeTruthy());
    expect(screen.queryByTestId("profile-inbound-card")).toBeNull();
    expect(screen.queryByText(/inbound calls to your mobile/i)).toBeNull();
  });
});

describe("Preferences is the home for Call Forwarding", () => {
  it("shows Appearance, Notifications, Call Forwarding and Timezone", async () => {
    render(<MyProfile />);
    openPreferences();
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(screen.getByText("Call Forwarding")).toBeTruthy();
    expect(screen.getByText("Timezone")).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText(/mobile number/i)).toBeTruthy());
    expect(screen.getByText(/send unanswered calls to your mobile/i)).toBeTruthy();
    expect(screen.getByRole("switch", { name: /forward unanswered calls/i })).toBeTruthy();
    expect(screen.getByLabelText(/voicemail greeting/i)).toBeTruthy();
  });
});

describe("source contracts", () => {
  it("MyProfile mounts none of the three removed surfaces, and the deleted components are gone", () => {
    const src = read("../../MyProfile.tsx");
    for (const gone of ["ProfileInboundCard", "ProfileRingtoneOutputCard", "ConnectionDiagnostics"]) {
      expect(src.includes(gone)).toBe(false);
    }
    expect(existsSync(resolve(__dirname, "../ProfileInboundCard.tsx"))).toBe(false);
    expect(existsSync(resolve(__dirname, "../ProfileRingtoneOutputCard.tsx"))).toBe(false);
  });

  it("the diagnostics component and its telemetry are RETAINED, just unmounted", () => {
    expect(existsSync(resolve(__dirname, "../ConnectionDiagnostics.tsx"))).toBe(true);
    const diag = read("../ConnectionDiagnostics.tsx");
    expect(diag.includes("getPhonePresence")).toBe(true);
    expect(diag).toMatch(/INTERNAL \/ DEBUG ONLY/);
    for (const kept of ["../../../../lib/phonePresence.ts", "../../../../lib/phonePresenceClient.ts"]) {
      expect(existsSync(resolve(__dirname, kept))).toBe(true);
    }
    const ctx = read("../../../../contexts/TwilioContext.tsx");
    expect(ctx.includes("incomingRingStartedAtRef.current = Date.now()")).toBe(true);
    expect(ctx.includes("void getPhonePresence().onRegistered();")).toBe(true);
  });

  it("the Twilio ring call sites are untouched and take no preference", () => {
    const ctx = read("../../../../contexts/TwilioContext.tsx");
    expect(ctx.includes("void applyRingtoneOutputs(device);")).toBe(true);
    expect(ctx.includes("onDeviceChange: (device) => { void applyRingtoneOutputs(device); }")).toBe(true);
    expect(ctx.includes("applyRingtoneOutputs(getTwilioDevice())")).toBe(false);
    expect(/applyRingtoneOutputs\([^)]*,/.test(ctx)).toBe(false);
    const ring = read("../../../../lib/ringtoneOutputs.ts");
    expect(ring.includes("loadRingtoneOutputPref")).toBe(false);
    expect(ring.includes('mode: "selected"')).toBe(false);
  });

  it("call forwarding still writes agent_inbound_settings and nothing else", () => {
    const section = read("../ProfileCallForwardingSection.tsx");
    expect(section.includes('from("agent_inbound_settings")')).toBe(true);
    expect(section.includes('onConflict: "agent_id"')).toBe(true);
    expect(section.includes("maybeSingle()")).toBe(true);
    expect(section.includes("user_preferences")).toBe(false);
    expect(section.includes("realProfile?.organization_id")).toBe(true);
    // routing, availability and voicemail delivery are never touched from this surface
    for (const forbidden of ["inbound_routing_settings", "inbound_route_attempts", "routing_engine", "availability_status", "twilio-voice-inbound"]) {
      expect(section.includes(forbidden)).toBe(false);
    }
  });
});
