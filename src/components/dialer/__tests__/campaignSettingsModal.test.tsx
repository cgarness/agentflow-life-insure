/**
 * CampaignSettingsModal ("Calling Settings") viewport layout.
 *
 * Pins: the dialog frame is bounded to the viewport (100dvh / 100vw minus margins) and only
 * the settings body scrolls; the title, Close X, Save, Cancel and any save/validation error
 * live outside that scroll region so they stay visible at every screen size. Every settings
 * section is still rendered, and loading/saving/error/cancel/save/Escape and the
 * licensed-state and Settings Access gating behave as before.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CampaignSettingsModal, { type CampaignSettingsModalProps } from "../CampaignSettingsModal";
import { CAMPAIGN_SETTINGS_COPY } from "../campaignSettingsSchema";

const SECTION_LABELS = [
  "Max Call Attempts",
  CAMPAIGN_SETTINGS_COPY.callingWindowLabel,
  "Retry Interval",
  "Ring Timeout (seconds)",
  "Auto-Dial",
  "Local Presence",
  CAMPAIGN_SETTINGS_COPY.requireLicensedStateLabel,
  CAMPAIGN_SETTINGS_COPY.accessLabel,
];

function props(overrides: Partial<CampaignSettingsModalProps> = {}): CampaignSettingsModalProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    campaignName: "Final Expense Q4",
    isUnlimited: false,
    setIsUnlimited: vi.fn(),
    maxAttemptsValue: 3,
    setMaxAttemptsValue: vi.fn(),
    callingHoursStart: "09:00",
    setCallingHoursStart: vi.fn(),
    callingHoursEnd: "21:00",
    setCallingHoursEnd: vi.fn(),
    retryIntervalMinutes: 1440,
    setRetryIntervalMinutes: vi.fn(),
    ringTimeoutValue: 30,
    setRingTimeoutValue: vi.fn(),
    settingsAutoDialEnabled: true,
    setSettingsAutoDialEnabled: vi.fn(),
    localPresenceEnabled: true,
    setLocalPresenceEnabled: vi.fn(),
    requireLicensedStateAccess: false,
    setRequireLicensedStateAccess: vi.fn(),
    settingsEditPolicy: "creator_and_admins",
    setSettingsEditPolicy: vi.fn(),
    settingsGrantUserIds: [],
    onToggleGrantUser: vi.fn(),
    orgProfiles: [],
    isAdminOrSuper: true,
    loading: false,
    saving: false,
    onSave: vi.fn(),
    ...overrides,
  };
}

function frame() {
  const dialog = screen.getByRole("dialog");
  const body = dialog.querySelector<HTMLElement>(".overflow-y-auto");
  if (!body) throw new Error("scroll body not found");
  return { dialog, body };
}

afterEach(cleanup);

describe("CampaignSettingsModal viewport layout", () => {
  it("bounds the frame to the viewport and scrolls only the settings body", () => {
    render(<CampaignSettingsModal {...props()} />);
    const { dialog, body } = frame();
    for (const cls of ["flex", "flex-col", "overflow-hidden", "max-h-[calc(100dvh-2rem)]", "w-[calc(100vw-1.5rem)]", "max-w-md", "p-0"]) {
      expect(dialog).toHaveClass(cls);
    }
    expect(dialog).not.toHaveClass("grid");
    expect(body).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
  });

  it("keeps the title, Close, Save and Cancel outside the scroll region", () => {
    render(<CampaignSettingsModal {...props()} />);
    const { body } = frame();
    const outside = [
      screen.getByRole("heading", { name: "Calling Settings" }),
      screen.getByRole("button", { name: "Close" }),
      screen.getByRole("button", { name: "Save" }),
      screen.getByRole("button", { name: "Cancel" }),
    ];
    for (const el of outside) expect(body.contains(el)).toBe(false);
  });

  it("renders every settings section inside the scroll region", () => {
    render(<CampaignSettingsModal {...props()} />);
    const { body } = frame();
    for (const label of SECTION_LABELS) expect(within(body).getByText(label)).toBeInTheDocument();
    expect(within(body).getAllByRole("switch")).toHaveLength(3);
  });

  it("scrolls a focused field into view (Radix wraps Tab focus with preventScroll)", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<CampaignSettingsModal {...props()} />);
      const { body } = frame();
      const field = body.querySelector<HTMLInputElement>('input[type="time"]')!;
      field.focus();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(field);
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("wraps a long campaign name instead of widening the dialog", () => {
    const longName = "Mortgage Protection Aged Leads ".repeat(6) + "X".repeat(80);
    render(<CampaignSettingsModal {...props({ campaignName: longName })} />);
    const name = screen.getByTitle(longName);
    expect(name).toHaveTextContent(longName);
    expect(name.closest("p")).toHaveClass("break-words");
  });
});

describe("CampaignSettingsModal states and actions", () => {
  it("loading: spinner in the body, no fields, Save disabled", () => {
    render(<CampaignSettingsModal {...props({ loading: true, errorMessage: "stale" })} />);
    const { body } = frame();
    expect(within(body).getByRole("status", { name: "Loading calling settings" })).toBeInTheDocument();
    expect(screen.queryByText("Max Call Attempts")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("saving: Save shows Saving… and is disabled", () => {
    render(<CampaignSettingsModal {...props({ saving: true })} />);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("pins a save/validation error above the footer, outside the scroll region", () => {
    const msg = "Max attempts must be between 1 and 99.";
    render(<CampaignSettingsModal {...props({ errorMessage: msg })} />);
    const { body } = frame();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(msg);
    expect(body.contains(alert)).toBe(false);
    expect(alert.parentElement?.contains(screen.getByRole("button", { name: "Save" }))).toBe(true);
  });

  it("Cancel, Escape and Save call the existing handlers", () => {
    const p = props();
    render(<CampaignSettingsModal {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(p.onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(p.onOpenChange).toHaveBeenLastCalledWith(false);
    (p.onOpenChange as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps a blank Max Attempts blank and wires the calling window setters", () => {
    const p = props();
    const { container } = render(<CampaignSettingsModal {...p} />);
    const doc = container.ownerDocument;
    fireEvent.change(doc.querySelector('input[type="number"][placeholder="3"]')!, { target: { value: "" } });
    expect(p.setMaxAttemptsValue).toHaveBeenCalledWith("");
    const [start, end] = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="time"]'));
    fireEvent.change(start, { target: { value: "08:30" } });
    fireEvent.change(end, { target: { value: "20:00" } });
    expect(p.setCallingHoursStart).toHaveBeenCalledWith("08:30");
    expect(p.setCallingHoursEnd).toHaveBeenCalledWith("20:00");
  });

  it("Unlimited disables the Max Attempts input", () => {
    const { container } = render(<CampaignSettingsModal {...props({ isUnlimited: true })} />);
    expect(container.ownerDocument.querySelector('input[type="number"][placeholder="3"]')).toBeDisabled();
  });

  it("licensed-state toggle stays gated by permission and campaign type", () => {
    const { unmount } = render(<CampaignSettingsModal {...props({ canEditSettings: false })} />);
    const toggle = () => screen.getAllByRole("switch")[2];
    expect(toggle()).toBeDisabled();
    unmount();
    render(<CampaignSettingsModal {...props({ licensedStateApplicable: false, requireLicensedStateAccess: true })} />);
    expect(toggle()).toBeDisabled();
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(CAMPAIGN_SETTINGS_COPY.requireLicensedStateNotApplicable)).toBeInTheDocument();
  });

  it("Specific teammates shows the picker and removable chips inside the scroll region", () => {
    const p = props({
      settingsEditPolicy: "specific_users",
      settingsGrantUserIds: ["u1"],
      orgProfiles: [{ id: "u1", name: "Jordan Agent", email: "jordan@example.com", role: "Agent" }],
    });
    render(<CampaignSettingsModal {...p} />);
    const { body } = frame();
    expect(within(body).getByText("1 selected").closest("button")).toHaveAttribute("role", "combobox");
    fireEvent.click(within(body).getByRole("button", { name: "Remove Jordan Agent" }));
    expect(p.onToggleGrantUser).toHaveBeenCalledWith("u1");
  });
});
