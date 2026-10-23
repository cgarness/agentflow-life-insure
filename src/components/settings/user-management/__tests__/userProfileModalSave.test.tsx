/**
 * F1 / F2 / F6 — Settings → User Management → member profile save.
 *
 * Renders the REAL UserProfileModal → UserProfileTab → UplinePicker, with the real
 * `buildProfileSavePayload` and `saveMemberProfile`. Only the data edges are doubles: the
 * two profile PATCHes (`usersSupabaseApi.update` / `updateProfile`), `deleteUser`, the
 * candidate loaders (`loadUplineCandidates` / `managerNamesById`), the toast and the
 * permission gate. Radix Select is replaced by a native <select> (see nativeSelectMock).
 *
 * Pins:
 *  - an untouched save sends NO `uplineId` / `commissionLevel` key (no `UPDATE OF upline_id`
 *    trigger, no hierarchy lock) and no unchanged role / status / Super Admin flag;
 *  - a changed upline is re-validated with a fresh candidate read BEFORE step 1, so a refused
 *    upline (or a failed read) writes nothing;
 *  - the remaining partial-save case: step 1 committed, step 2 refused → "Some changes were
 *    not saved" with the database message, a list reload, and no optimistic patch;
 *  - database guard messages reach the toast (step 1, step 2, delete);
 *  - Team Leader viewer on a downline member: role, status, upline and commission disabled,
 *    no Delete User; Admin on self: commission editable, role / status not; Agent on self:
 *    commission editable, upline read-only (UI mirrors only — the database decides).
 * All ids are synthetic.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserWithProfile } from "../userManagementTypes";
import type { UserManagementViewer } from "@/hooks/useUserManagementMembers";

const h = vi.hoisted(() => ({
  calls: [] as string[],
  update: vi.fn(),
  updateProfile: vi.fn(),
  deleteUser: vi.fn(),
  loadUplineCandidates: vi.fn(),
  managerNamesById: vi.fn(),
  toasts: [] as { title?: string; description?: string; variant?: string }[],
}));

vi.mock("@/components/ui/select", () => import("./nativeSelectMock"));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t: { title?: string; description?: string; variant?: string }) => { h.toasts.push(t); } }),
}));
vi.mock("@/components/PermissionGate", () => ({
  CommissionGate: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/settings/ProfileCarriersSection", () => ({
  default: () => null,
  normalizeProfileCarriers: (raw: unknown) => (Array.isArray(raw) ? raw : []),
}));
// No network: every data edge the modal uses is doubled above or below.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/supabase-users", () => ({
  usersSupabaseApi: {
    update: (...a: unknown[]) => { h.calls.push("update"); return h.update(...a); },
    updateProfile: (...a: unknown[]) => { h.calls.push("updateProfile"); return h.updateProfile(...a); },
    deleteUser: (...a: unknown[]) => h.deleteUser(...a),
    getPerformance: () => new Promise(() => {}),
    updateGoals: vi.fn(),
    resetPassword: vi.fn(),
  },
}));
vi.mock("@/lib/hierarchy/uplineCandidates", () => ({
  loadUplineCandidates: (...a: unknown[]) => { h.calls.push("loadUplineCandidates"); return h.loadUplineCandidates(...a); },
  managerNamesById: (...a: unknown[]) => h.managerNamesById(...a),
}));

import UserProfileModal from "../UserProfileModal";
import { UPLINE_NOT_AVAILABLE } from "../saveMemberProfile";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = "11111111-1111-4111-8111-111111111111";
const ADMIN = uid(1);
const TL = uid(2);
const AGENT = uid(3);
const OTHER_TL = uid(4);
const INACTIVE_TL = uid(5);

const option = (id: string, firstName: string, role = "Team Leader", status = "Active") =>
  ({ id, firstName, lastName: "Test", role, status });

function member(id: string, role: string, uplineId: string | null, extra: Partial<UserWithProfile["profile"]> = {}): UserWithProfile {
  return {
    id, email: `${id.slice(-4)}@example.test`, firstName: "Mem", lastName: "Ber", role: role as never, status: "Active",
    availabilityStatus: "Offline", themePreference: "light", isSuperAdmin: false, lastLoginAt: null, createdAt: "2026-01-01",
    phone: "", avatar: undefined,
    profile: {
      userId: id, licensedStates: [], carriers: [], residentState: "", commissionLevel: "50%", uplineId,
      onboardingComplete: false, monthlyCallGoal: 0, monthlyPoliciesGoal: 0, weeklyAppointmentGoal: 0,
      monthlyAppointmentGoal: 0, monthlyPremiumGoal: 0, onboardingItems: [], npn: "", timezone: "Eastern Time (US & Canada)",
      winSoundEnabled: true, emailNotificationsEnabled: true, smsNotificationsEnabled: false, pushNotificationsEnabled: true,
      organizationId: ORG, teamId: null, isSuperAdmin: false, ...extra,
    },
  };
}

const viewerOf = (id: string, role: string, isSuperAdmin = false): UserManagementViewer =>
  ({ id, role, isSuperAdmin, organizationId: ORG });

/** Render the modal and let the upline picker's initial load settle. */
async function show(user: UserWithProfile, viewer: UserManagementViewer) {
  const onSaved = vi.fn(), onReload = vi.fn(), onDeleted = vi.fn(), onClose = vi.fn();
  render(
    <UserProfileModal user={user} open onClose={onClose} onSaved={onSaved} onDeleted={onDeleted}
      onReload={onReload} viewer={viewer} organizationId={ORG} allUsers={[user]} />,
  );
  await act(async () => {});
  return { onSaved, onReload, onDeleted, onClose };
}

const uplineSelect = () => screen.getByLabelText("Upline Agent") as HTMLSelectElement;
const optionTexts = (select: HTMLSelectElement) => Array.from(select.options).map((o) => `${o.textContent}${o.disabled ? " [disabled]" : ""}`);
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
const lastToast = () => h.toasts[h.toasts.length - 1];

beforeEach(() => {
  h.calls = [];
  h.toasts = [];
  h.update.mockReset().mockResolvedValue(undefined);
  h.updateProfile.mockReset().mockResolvedValue({});
  h.deleteUser.mockReset().mockResolvedValue(undefined);
  h.loadUplineCandidates.mockReset().mockResolvedValue({
    candidates: [option(ADMIN, "Ada", "Admin"), option(OTHER_TL, "Ola")], currentOutsideSet: null,
  });
  h.managerNamesById.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

describe("untouched save (F1)", () => {
  it("sends no uplineId or commissionLevel key and no unchanged account-control field", async () => {
    const { onSaved } = await show(member(TL, "Team Leader", ADMIN), viewerOf(ADMIN, "Admin"));
    await waitFor(() => expect(uplineSelect()).not.toBeDisabled());
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    const [, userUpdates] = h.update.mock.calls[0];
    expect(userUpdates).not.toHaveProperty("role");
    expect(userUpdates).not.toHaveProperty("status");
    expect(userUpdates).not.toHaveProperty("isSuperAdmin");
    const [, profileUpdates] = h.updateProfile.mock.calls[0];
    expect(profileUpdates).not.toHaveProperty("uplineId");
    expect(profileUpdates).not.toHaveProperty("commissionLevel");
    // Only the picker's own read: no save-time candidate validation without an upline change.
    expect(h.calls.filter((c) => c === "loadUplineCandidates")).toHaveLength(1);
    expect(lastToast()).toMatchObject({ title: "Changes saved successfully" });
  });

  it("validates form fields with Zod before writing anything", async () => {
    await show(member(AGENT, "Agent", TL), viewerOf(ADMIN, "Admin"));
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "   " } });
    save();
    await waitFor(() => expect(lastToast()).toMatchObject({ title: "Failed to save changes", description: "First name is required" }));
    expect(h.update).not.toHaveBeenCalled();
    expect(h.updateProfile).not.toHaveBeenCalled();
  });
});

describe("upline change (F1 / F2)", () => {
  it("re-validates a changed upline before step 1 and then sends it", async () => {
    await show(member(AGENT, "Agent", ADMIN), viewerOf(ADMIN, "Admin"));
    await waitFor(() => expect(uplineSelect()).not.toBeDisabled());
    fireEvent.change(uplineSelect(), { target: { value: OTHER_TL } });
    save();
    await waitFor(() => expect(h.updateProfile).toHaveBeenCalledTimes(1));
    expect(h.calls).toEqual(["loadUplineCandidates", "loadUplineCandidates", "update", "updateProfile"]);
    expect(h.loadUplineCandidates).toHaveBeenLastCalledWith({ targetId: AGENT, organizationId: ORG, currentUplineId: ADMIN });
    expect(h.updateProfile.mock.calls[0][1]).toMatchObject({ uplineId: OTHER_TL });
  });

  it("an upline no longer offered at save time writes nothing (no committed role/status change)", async () => {
    await show(member(AGENT, "Agent", ADMIN), viewerOf(ADMIN, "Admin"));
    await waitFor(() => expect(uplineSelect()).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Team Leader" } });
    fireEvent.change(uplineSelect(), { target: { value: OTHER_TL } });
    // Between opening and saving, OTHER_TL moved beneath the member: the fresh read excludes it.
    h.loadUplineCandidates.mockResolvedValueOnce({ candidates: [option(ADMIN, "Ada", "Admin")], currentOutsideSet: null });
    save();
    await waitFor(() => expect(lastToast()).toMatchObject({ title: "Failed to save changes", description: UPLINE_NOT_AVAILABLE }));
    expect(h.update).not.toHaveBeenCalled();
    expect(h.updateProfile).not.toHaveBeenCalled();
  });

  it("a failed candidate read at save time fails closed", async () => {
    await show(member(AGENT, "Agent", ADMIN), viewerOf(ADMIN, "Admin"));
    await waitFor(() => expect(uplineSelect()).not.toBeDisabled());
    fireEvent.change(uplineSelect(), { target: { value: OTHER_TL } });
    h.loadUplineCandidates.mockRejectedValueOnce(new Error("scope read failed"));
    save();
    await waitFor(() => expect(lastToast()).toMatchObject({ title: "Failed to save changes", description: "scope read failed" }));
    expect(h.update).not.toHaveBeenCalled();
  });

  it("choosing None needs no candidate check and sends null", async () => {
    await show(member(AGENT, "Agent", ADMIN), viewerOf(ADMIN, "Admin"));
    await waitFor(() => expect(uplineSelect()).not.toBeDisabled());
    fireEvent.change(uplineSelect(), { target: { value: "_none" } });
    save();
    await waitFor(() => expect(h.updateProfile).toHaveBeenCalledTimes(1));
    expect(h.updateProfile.mock.calls[0][1]).toMatchObject({ uplineId: null });
    expect(h.calls.filter((c) => c === "loadUplineCandidates")).toHaveLength(1);
  });

  it("shows a current upline outside the offered set as a disabled current option", async () => {
    h.loadUplineCandidates.mockResolvedValue({
      candidates: [option(ADMIN, "Ada", "Admin")], currentOutsideSet: option(INACTIVE_TL, "Ivy", "Team Leader", "Inactive"),
    });
    await show(member(AGENT, "Agent", INACTIVE_TL), viewerOf(ADMIN, "Admin"));
    await waitFor(() => expect(uplineSelect()).not.toBeDisabled());
    expect(uplineSelect().value).toBe(INACTIVE_TL);
    expect(optionTexts(uplineSelect())).toEqual(["None", "Ivy Test (current, Inactive) [disabled]", "Ada TestAdmin"]);
  });

  it("a candidate load failure keeps the picker disabled and says so", async () => {
    h.loadUplineCandidates.mockRejectedValue(new Error("boom"));
    await show(member(AGENT, "Agent", ADMIN), viewerOf(ADMIN, "Admin"));
    await screen.findByText(/Could not load upline choices/);
    expect(uplineSelect()).toBeDisabled();
    expect(uplineSelect().value).toBe(ADMIN);
  });
});

describe("database messages reach the toast", () => {
  it("step 1 refused: nothing committed, guard message shown, step 2 never runs", async () => {
    h.update.mockRejectedValueOnce({ message: "Only an Admin of this organization may change a member role" });
    await show(member(AGENT, "Agent", ADMIN), viewerOf(ADMIN, "Admin"));
    save();
    await waitFor(() => expect(lastToast()).toMatchObject({
      title: "Failed to save changes", description: "Only an Admin of this organization may change a member role",
    }));
    expect(h.updateProfile).not.toHaveBeenCalled();
  });

  it("partial save: step 1 committed, step 2 refused → explicit partial toast and a reload, no optimistic patch", async () => {
    const guard = "Hierarchy: this upline would create a reporting cycle (a member cannot report to their own downline)";
    h.updateProfile.mockRejectedValueOnce({ message: guard });
    const { onSaved, onReload } = await show(member(AGENT, "Agent", ADMIN), viewerOf(ADMIN, "Admin"));
    await waitFor(() => expect(uplineSelect()).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Team Leader" } });
    fireEvent.change(uplineSelect(), { target: { value: OTHER_TL } });
    save();
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(h.update.mock.calls[0][1]).toMatchObject({ role: "Team Leader" });
    expect(lastToast().title).toBe("Some changes were not saved");
    expect(lastToast().description).toContain(guard);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a refused delete shows the guard message", async () => {
    h.deleteUser.mockRejectedValueOnce(new Error("Delete failed: user profile not found or permission denied."));
    await show(member(AGENT, "Agent", ADMIN), viewerOf(ADMIN, "Admin"));
    fireEvent.click(screen.getByRole("button", { name: "Delete User" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Delete User" })).getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Agent" }));
    await waitFor(() => expect(lastToast()).toMatchObject({
      description: "Delete failed: user profile not found or permission denied.", variant: "destructive",
    }));
  });
});

describe("account-control mirror (F6, UI only)", () => {
  it("Team Leader editing a downline member: role, status, upline, commission disabled; no Delete; payload carries none", async () => {
    await show(member(AGENT, "Agent", TL), viewerOf(TL, "Team Leader"));
    await waitFor(() => expect(h.managerNamesById).toHaveBeenCalledWith([TL], ORG));
    expect(screen.getByLabelText("Role")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Active status" })).toBeDisabled();
    expect(uplineSelect()).toBeDisabled();
    expect(screen.getByLabelText("Commission Level")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Delete User" })).toBeNull();
    // Read-only viewers never load the candidate set.
    expect(h.loadUplineCandidates).not.toHaveBeenCalled();

    save();
    await waitFor(() => expect(h.updateProfile).toHaveBeenCalledTimes(1));
    expect(h.update.mock.calls[0][1]).not.toHaveProperty("role");
    expect(h.update.mock.calls[0][1]).not.toHaveProperty("status");
    expect(h.updateProfile.mock.calls[0][1]).not.toHaveProperty("uplineId");
    expect(h.updateProfile.mock.calls[0][1]).not.toHaveProperty("commissionLevel");
  });

  it("a Team Leader cannot change commission even by typing (the field is read-only and never sent)", async () => {
    await show(member(AGENT, "Agent", TL), viewerOf(TL, "Team Leader"));
    fireEvent.change(screen.getByLabelText("Commission Level"), { target: { value: "99%" } });
    save();
    await waitFor(() => expect(h.updateProfile).toHaveBeenCalledTimes(1));
    expect(h.updateProfile.mock.calls[0][1]).not.toHaveProperty("commissionLevel");
  });

  it("Admin on self: commission editable and sent when changed; role and status disabled; no Delete", async () => {
    await show(member(ADMIN, "Admin", null), viewerOf(ADMIN, "Admin"));
    expect(screen.getByLabelText("Commission Level")).not.toBeDisabled();
    expect(screen.getByLabelText("Role")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Active status" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Delete User" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Commission Level"), { target: { value: "80%" } });
    save();
    await waitFor(() => expect(h.updateProfile).toHaveBeenCalledTimes(1));
    expect(h.updateProfile.mock.calls[0][1]).toMatchObject({ commissionLevel: "80%" });
  });

  it("Agent on self: commission editable, upline read-only with the manager's name", async () => {
    h.managerNamesById.mockResolvedValue({ [TL]: { firstName: "Tess", lastName: "Test", status: "Active" } });
    await show(member(AGENT, "Agent", TL), viewerOf(AGENT, "Agent"));
    await waitFor(() => expect(optionTexts(uplineSelect())).toContain("Tess Test [disabled]"));
    expect(uplineSelect()).toBeDisabled();
    expect(screen.getByLabelText("Commission Level")).not.toBeDisabled();
  });

  it("an Admin of another organization gets no account-control inputs", async () => {
    await show(member(AGENT, "Agent", ADMIN), { ...viewerOf(uid(9), "Admin"), organizationId: "22222222-2222-4222-8222-222222222222" });
    expect(screen.getByLabelText("Role")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Delete User" })).toBeNull();
  });

  it("Admin on another member: role, status, upline and Delete available", async () => {
    await show(member(AGENT, "Agent", ADMIN), viewerOf(ADMIN, "Admin"));
    await waitFor(() => expect(uplineSelect()).not.toBeDisabled());
    expect(screen.getByLabelText("Role")).not.toBeDisabled();
    expect(screen.getByRole("switch", { name: "Active status" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete User" })).toBeInTheDocument();
  });
});
