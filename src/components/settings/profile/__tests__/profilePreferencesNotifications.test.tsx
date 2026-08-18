import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const updateProfile = vi.fn(async () => {});
// profile must be referentially stable across renders (as the real AuthContext provides) —
// a fresh object identity per render would loop the card's [profile] sync effect.
const stableProfile = {
  email_notifications_enabled: true,
  sms_notifications_enabled: false,
  push_notifications_enabled: false,
  timezone: "Eastern Time (US & Canada)",
  theme_preference: "light",
};
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: stableProfile, updateProfile }),
}));
vi.mock("@/contexts/UnsavedChangesContext", () => ({
  useUnsavedChanges: () => ({ registerDirty: vi.fn() }),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

const requestPushPermission = vi.fn(async () => "granted" as const);
vi.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ({ requestPushPermission }),
}));

import { ProfilePreferencesCard } from "../ProfilePreferencesCard";

class NotificationMock {
  static permission: string = "default";
  static requestPermission = vi.fn(async () => NotificationMock.permission);
}

const openCard = () => {
  render(<ProfilePreferencesCard />);
  fireEvent.click(screen.getByRole("button", { name: /preferences/i }));
};

beforeEach(() => {
  vi.clearAllMocks();
  NotificationMock.permission = "default";
   
  (window as any).Notification = NotificationMock;
});

describe("Email/SMS toggles — honest, not yet wired (ruling D1)", () => {
  it("renders both toggles disabled with a 'Not yet connected' caption", () => {
    openCard();
    const captions = screen.getAllByText(/not yet connected/i);
    expect(captions).toHaveLength(2);
    const switches = screen.getAllByRole("switch");
    // email + sms are the two disabled switches
    const disabled = switches.filter((s) => (s as HTMLButtonElement).disabled);
    expect(disabled.length).toBeGreaterThanOrEqual(2);
  });
});

describe("browser push preference — truthful states", () => {
  it("requests browser permission when the user ENABLES the toggle (a gesture), not on render", async () => {
    openCard();
    expect(requestPushPermission).not.toHaveBeenCalled();
    const pushSwitch = screen.getByRole("switch", { name: /browser notifications/i });
    fireEvent.click(pushSwitch);
    expect(requestPushPermission).toHaveBeenCalledTimes(1);
  });

  it("shows the Off state while the preference is off", () => {
    openCard();
    expect(screen.getByTestId("push-status")).toHaveTextContent(/off/i);
  });

  it("shows the Blocked state with recovery guidance when the browser permission is denied", () => {
    NotificationMock.permission = "denied";
    openCard();
    fireEvent.click(screen.getByRole("switch", { name: /browser notifications/i }));
    expect(screen.getByTestId("push-status")).toHaveTextContent(/blocked in browser/i);
    expect(screen.getByTestId("push-status")).toHaveTextContent(/site settings/i);
  });

  it("shows the Enabled state when the preference is on and permission granted", async () => {
    NotificationMock.permission = "granted";
    openCard();
    fireEvent.click(screen.getByRole("switch", { name: /browser notifications/i }));
    expect(await screen.findByTestId("push-status")).toHaveTextContent(/enabled/i);
  });

  it("shows the unsupported state and disables the toggle when the browser has no Notification API", () => {
     
    delete (window as any).Notification;
    openCard();
    expect(screen.getByTestId("push-status")).toHaveTextContent(/not supported in this browser/i);
    const pushSwitch = screen.getByRole("switch", { name: /browser notifications/i });
    expect((pushSwitch as HTMLButtonElement).disabled).toBe(true);
  });
});
