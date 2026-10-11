/**
 * Part B, Area 6a (B6-01, B6-02, B6-42) — Settings shell heading and the default renderer.
 *
 * - The page h1 is the section's sidebar label (ALL_SETTINGS_SECTIONS, resolved through
 *   resolveSettingsPermissionSlug), so legacy phone slugs read "Phone System" and an unknown slug reads
 *   "Settings". It is never the generated "{slug} Settings" ("Email Settings Settings", "Dnc Settings").
 * - The default renderer says the section is not active yet instead of "Ready for configuration.".
 * - Phone System no longer repeats its own name as an inner h3 (loading or loaded).
 *
 * The real SettingsPage, SettingsSectionGate, SettingsRenderer and PhoneSystem render; only the section bodies
 * and the phone controller are stubbed.
 */
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  phoneLoading: false,
  permissions: {
    hasSettingsSectionAccess: (_slug: string) => true,
    isLoading: false,
    permissions: null as null,
  },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isLoading: false }) }));
vi.mock("@/hooks/useOrganization", () => ({ useOrganization: () => ({ isSuperAdmin: false }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => h.permissions }));

// Section bodies (not under test).
vi.mock("@/components/settings/MyProfile", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/CompanyBranding", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/UserManagement", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/CallScripts", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/DispositionsManager", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/ContactManagement", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/CalendarSettings", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/Permissions", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/EmailSetup", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/EmailSMSTemplates", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/Carriers", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/DNCSettings", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/CustomMenuLinks", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/ActivityLog", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/AgencyGroupSettings", () => ({ default: () => <div data-testid="section-body" /> }));
vi.mock("@/components/settings/WorkflowBuilder", () => ({ default: () => <div data-testid="section-body" /> }));

// Phone System tab bodies and controller (PhoneSystem itself is real).
vi.mock("@/components/settings/phone/usePhoneSettingsController", () => ({
  usePhoneSettingsController: () => ({
    loading: h.phoneLoading,
    organizationId: "org-1",
    numbers: [],
    setNumbers: () => {},
    agents: [],
    groups: [],
    groupMembers: [],
    campaignGroupCounts: {},
    fetchData: () => {},
    secretBundle: {},
    handleLocalPresenceToggle: () => Promise.resolve(),
    uniqueAreaCodes: [],
  }),
}));
vi.mock("@/components/settings/phone/a2p/A2pRegistration", () => ({ default: () => <div data-testid="tab-body" /> }));
vi.mock("@/components/settings/PhoneSettings", () => ({ default: () => <div data-testid="tab-body" /> }));
vi.mock("@/components/settings/phone/NumberManagementSection", () => ({ NumberManagementSection: () => <div data-testid="tab-body" /> }));
vi.mock("@/components/settings/phone/LocalPresenceSection", () => ({ LocalPresenceSection: () => <div data-testid="tab-body" /> }));
vi.mock("@/components/settings/phone/NumberGroupsSection", () => ({ NumberGroupsSection: () => <div data-testid="tab-body" /> }));
vi.mock("@/components/settings/NumberReputation", () => ({ default: () => <div data-testid="tab-body" /> }));
vi.mock("@/components/settings/InboundRoutingManager", () => ({ default: () => <div data-testid="tab-body" /> }));
vi.mock("@/components/settings/state-licenses/StateLicensesSection", () => ({ StateLicensesSection: () => <div data-testid="tab-body" /> }));
vi.mock("@/components/settings/CallRecordingSettings", () => ({ default: () => <div data-testid="tab-body" /> }));
vi.mock("@/components/settings/CallRecordingLibrary", () => ({ default: () => <div data-testid="tab-body" /> }));
vi.mock("@/components/settings/CallMonitoring", () => ({ default: () => <div data-testid="tab-body" /> }));

import SettingsPage from "@/pages/SettingsPage";
import SettingsRenderer from "@/components/settings/SettingsRenderer";
import PhoneSystem from "@/components/settings/PhoneSystem";
import { ALL_SETTINGS_SECTIONS, PHONE_SYSTEM_LEGACY_SECTION_SLUGS } from "@/config/settingsConfig";

const COMING_SOON = "Coming soon — this section is not active yet.";

const renderAt = (slug: string) =>
  render(
    <MemoryRouter initialEntries={[`/settings?section=${slug}`]}>
      <SettingsPage />
    </MemoryRouter>,
  );

const h1Text = () => screen.getByRole("heading", { level: 1 }).textContent?.trim();
/** Phone System tab bodies (A2P is lazy) settle before assertions, so no Suspense update lands after a test. */
const settle = async (slug: string) => {
  if (PHONE_SYSTEM_LEGACY_SECTION_SLUGS.includes(slug)) await screen.findAllByTestId("tab-body");
};

beforeEach(() => {
  h.phoneLoading = false;
});
afterEach(cleanup);

describe("Settings page heading is the sidebar label (B6-01)", () => {
  it.each([
    ["my-profile", "My Profile"],
    ["email-settings", "Email Setup"],
    ["calendar-settings", "Calendar"],
    ["dnc", "DNC List"],
    ["automation", "Workflow Builder"],
    ["contact-management", "Contact Flow"],
    ["webhooks", "Zapier & Webhooks"],
    ["phone-system", "Phone System"],
    ["a2p-registration", "Phone System"],
    ["inbound-routing", "Phone System"],
    ["monitoring", "Phone System"],
  ])("?section=%s → h1 %j", async (slug, label) => {
    renderAt(slug);
    await settle(slug);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(h1Text()).toBe(label);
  });

  it("an unknown slug falls back to \"Settings\" and the default renderer", () => {
    renderAt("not-a-real-section");
    expect(h1Text()).toBe("Settings");
    expect(screen.getByText(COMING_SOON)).toBeInTheDocument();
  });

  it("every sidebar slug and every legacy phone slug resolves to an authored label, never \"… Settings\"", async () => {
    const labels = new Set(ALL_SETTINGS_SECTIONS.map((s) => s.label));
    for (const { slug, label } of ALL_SETTINGS_SECTIONS) {
      renderAt(slug);
      await settle(slug);
      expect(h1Text()).toBe(label);
      cleanup();
    }
    for (const slug of PHONE_SYSTEM_LEGACY_SECTION_SLUGS) {
      renderAt(slug);
      await settle(slug);
      const text = h1Text();
      expect(text).toBe("Phone System");
      expect(labels.has(text as string)).toBe(true);
      cleanup();
    }
    for (const slug of [...ALL_SETTINGS_SECTIONS.map((s) => s.slug), ...PHONE_SYSTEM_LEGACY_SECTION_SLUGS]) {
      renderAt(slug);
      await settle(slug);
      expect(h1Text()).not.toMatch(/ Settings$/);
      expect(h1Text()).not.toBe(slug.replace(/-/g, " "));
      cleanup();
    }
  });
});

describe("Default renderer (B6-02)", () => {
  it("states the section is not active yet, under the sidebar label", () => {
    render(<SettingsRenderer activeSlug="webhooks" isSuperAdmin={false} />);
    expect(screen.getByRole("heading", { level: 3, name: "Zapier & Webhooks" })).toBeInTheDocument();
    expect(screen.getByText(COMING_SOON)).toBeInTheDocument();
    expect(screen.queryByText("Ready for configuration.")).toBeNull();
  });
});

describe("Phone System has no duplicate inner heading (B6-42)", () => {
  it("loaded: the page h1 is the only \"Phone System\" heading and the tabs still render", async () => {
    renderAt("phone-system");
    await settle("phone-system");
    const headings = screen.getAllByRole("heading", { name: "Phone System" });
    expect(headings).toHaveLength(1);
    expect(headings[0].tagName).toBe("H1");
    expect(screen.queryByRole("heading", { level: 3, name: "Phone System" })).toBeNull();
    for (const name of ["Trust Hub", "A2P Registration", "Phone Numbers", "Number Reputation", "Inbound Routing", "State Licenses", "Recording Settings", "Recording Library", "Call Monitoring"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  it("a legacy phone slug opens its tab under the single \"Phone System\" h1", async () => {
    renderAt("monitoring");
    await settle("monitoring");
    const headings = screen.getAllByRole("heading", { name: "Phone System" });
    expect(headings).toHaveLength(1);
    expect(headings[0].tagName).toBe("H1");
    expect(screen.getByRole("tab", { name: "Call Monitoring" })).toHaveAttribute("aria-selected", "true");
  });

  it("loading: no inner \"Phone System\" heading", () => {
    h.phoneLoading = true;
    render(<PhoneSystem />);
    expect(screen.queryByRole("heading", { name: "Phone System" })).toBeNull();
    expect(screen.queryByText("Phone System")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
