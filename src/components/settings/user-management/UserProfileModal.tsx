import React, { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import { normalizeProfileCarriers } from "@/components/settings/ProfileCarriersSection";
import { OnboardingItem, User, UserProfile, UserRole } from "@/lib/types";
import TransferLeadsModal from "../TransferLeadsModal";
import AvatarUploadPreview from "./AvatarUploadPreview";
import UserProfileTab from "./UserProfileTab";
import UserGoalsTab from "./UserGoalsTab";
import UserOnboardingTab from "./UserOnboardingTab";
import UserPerformanceTab from "./UserPerformanceTab";
import UserTeamTab from "./UserTeamTab";
import { formatDate, ROLE_BADGE, STATUS_BADGE } from "./userManagementUtils";
import type { UserWithProfile } from "./userManagementTypes";

interface Props {
  user: UserWithProfile | null;
  open: boolean;
  onClose: () => void;
  onSaved: (patch?: Partial<UserWithProfile>) => void;
  onDeleted: (id: string) => void;
  currentUserId: string;
  currentUserRole: string;
  isCurrentUserSuperAdmin: boolean;
  allUsers: UserWithProfile[];
}

const UserProfileModal: React.FC<Props> = ({
  user, open, onClose, onSaved, onDeleted,
  currentUserId, currentUserRole, isCurrentUserSuperAdmin, allUsers,
}) => {
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("profile");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [form, setForm] = useState<Partial<User & UserProfile>>({});
  const [onboardingItems, setOnboardingItems] = useState<OnboardingItem[]>([]);
  const [performance, setPerformance] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [perfLoading, setPerfLoading] = useState(false);
  const [resetPwOpen, setResetPwOpen] = useState(false);

  const uplineCandidates = useMemo(() =>
    allUsers.filter(u => u.id !== user?.id && u.status === "Active" && (u.role === "Agent" || u.role === "Team Leader" || u.role === "Admin"))
  , [allUsers, user]);

  useEffect(() => {
    if (user) {
      setForm({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || "",
        role: user.role,
        status: user.status,
        licensedStates: user.profile.licensedStates,
        residentState: user.profile.residentState || "",
        commissionLevel: user.profile.commissionLevel,
        uplineId: user.profile.uplineId,
        monthlyCallGoal: user.profile.monthlyCallGoal,
        monthlyPoliciesGoal: user.profile.monthlyPoliciesGoal,
        monthlyAppointmentGoal: user.profile.monthlyAppointmentGoal,
        monthlyPremiumGoal: user.profile.monthlyPremiumGoal,
        npn: user.profile.npn || "",
        timezone: user.profile.timezone || "",
        carriers: normalizeProfileCarriers(user.profile.carriers),
      });
      setIsSuperAdmin(user.isSuperAdmin);
      setOnboardingItems([...user.profile.onboardingItems]);
      setAvatarUrl(user.avatar);
      setEditMode(true);
      setTab("profile");
      setPerformance(null);
    }
  }, [user]);

  useEffect(() => {
    if (user && (tab === "performance" || tab === "goals") && !performance) {
      setPerfLoading(true);
      usersApi.getPerformance(user.id).then(p => { setPerformance(p); setPerfLoading(false); });
    }
  }, [user, tab, performance]);

  if (!user) return null;

  const initials = `${user.firstName[0]}${user.lastName[0]}`;
  const isSelf = user.id === currentUserId;
  const goalActuals = {
    callsMonth: performance?.callsMonthly ?? 0,
    policiesMonth: performance?.policiesMonthly ?? 0,
    appointmentsMonth: performance?.appsMonth ?? 0,
    premiumMonth: performance?.premiumMonthly ?? 0,
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await usersApi.update(user.id, {
        firstName: form.firstName as string,
        lastName: form.lastName as string,
        email: form.email as string,
        phone: form.phone as string,
        role: form.role as UserRole,
        status: form.status as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        avatar: avatarUrl,
        isSuperAdmin,
      });
      await usersApi.updateProfile(user.id, {
        licensedStates: (form.licensedStates as any[]) || [], // eslint-disable-line @typescript-eslint/no-explicit-any
        residentState: (form.residentState as string) || "",
        commissionLevel: (form.commissionLevel as string) || "0%",
        uplineId: form.uplineId === "_none" ? null : form.uplineId,
        npn: (form.npn as string) || "",
        timezone: (form.timezone as string) || "Eastern Time (US & Canada)",
        carriers: normalizeProfileCarriers(form.carriers),
      });
      toast({ title: "Changes saved successfully" });
      setEditMode(false);
      const savedCarriers = normalizeProfileCarriers(form.carriers);
      onSaved({
        id: user.id,
        role: form.role as UserRole,
        status: form.status as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        firstName: form.firstName as string,
        lastName: form.lastName as string,
        isSuperAdmin,
        profile: {
          ...user.profile,
          licensedStates: (form.licensedStates as any[]) || [], // eslint-disable-line @typescript-eslint/no-explicit-any
          residentState: (form.residentState as string) || "",
          commissionLevel: (form.commissionLevel as string) || "0%",
          uplineId: form.uplineId === "_none" ? null : form.uplineId,
          npn: (form.npn as string) || "",
          timezone: (form.timezone as string) || "Eastern Time (US & Canada)",
          carriers: savedCarriers,
        },
      } as Partial<UserWithProfile>);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Failed to save changes", description: e.message || "An unknown error occurred", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveGoals = async () => {
    setSaving(true);
    try {
      await usersApi.updateGoals(user.id, {
        monthlyCallGoal: form.monthlyCallGoal as number,
        monthlyPoliciesGoal: form.monthlyPoliciesGoal as number,
        monthlyAppointmentGoal: form.monthlyAppointmentGoal as number,
        monthlyPremiumGoal: form.monthlyPremiumGoal as number,
      });
      toast({ title: "Saved", description: "Goals updated successfully." });
      onSaved();
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleOnboarding = async (key: string, checked: boolean) => {
    const updated = onboardingItems.map(i =>
      i.key === key ? { ...i, completed: checked, completedAt: checked ? new Date().toISOString() : null } : i
    );
    setOnboardingItems(updated);
    const allDone = updated.every(i => i.completed);
    try {
      await usersApi.updateProfile(user.id, { onboardingItems: updated, onboardingComplete: allDone });
      toast({ title: "Saved", description: `Onboarding item ${checked ? "completed" : "unchecked"}.` });
      onSaved();
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleResetOnboarding = async () => {
    const reset = onboardingItems.map(i => ({ ...i, completed: false, completedAt: null }));
    setOnboardingItems(reset);
    try {
      await usersApi.updateProfile(user.id, { onboardingItems: reset, onboardingComplete: false });
      toast({ title: "Saved", description: "Onboarding checklist reset." });
      onSaved();
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleResetPassword = async () => {
    try {
      await usersApi.resetPassword(user.email);
      toast({ title: "Password reset email sent", description: `Password reset email sent to ${user.email}` });
      setResetPwOpen(false);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleTransferAndConfirm = async (transferToUserId?: string) => {
    setSaving(true);
    try {
      await usersApi.deleteUser(user.id, transferToUserId);
      toast({
        title: "User deleted successfully",
        description: transferToUserId ? "All contacts have been reassigned." : "Contacts remain unassigned.",
      });
      setTransferModalOpen(false);
      onClose();
      onDeleted(user.id);
    } catch (e) {
      console.error(e);
      toast({ title: "Failed to delete user. Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = () => {
    setDeleteConfirmOpen(false);
    setTransferModalOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent className="w-[850px] max-w-[95vw] h-[720px] max-h-[92vh] flex flex-col overflow-hidden p-0">
          <div className="p-6 pb-0 flex items-start justify-between flex-shrink-0">
            <div className="flex items-center gap-4">
              <AvatarUploadPreview
                currentAvatar={avatarUrl}
                initials={initials}
                onAvatarChange={setAvatarUrl}
                disabled={!editMode}
              />
              <div>
                <h2 className="text-xl font-bold text-foreground">{user.firstName} {user.lastName}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={ROLE_BADGE[user.role]}>{user.role}</Badge>
                  <Badge className={STATUS_BADGE[user.status]}>{user.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Last login: {formatDate(user.lastLoginAt)}</p>
              </div>
            </div>
          </div>

          <div className="px-6 mt-4 flex-shrink-0">
            <Tabs value={tab} onValueChange={setTab} className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="profile" className="flex-1">Profile</TabsTrigger>
                <TabsTrigger value="goals" className="flex-1">Goals</TabsTrigger>
                <TabsTrigger value="onboarding" className="flex-1">Onboarding</TabsTrigger>
                <TabsTrigger value="performance" className="flex-1">Performance</TabsTrigger>
                {user.role === "Team Leader" && (
                  <TabsTrigger value="myteam" className="flex-1">My Team</TabsTrigger>
                )}
              </TabsList>
            </Tabs>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 p-6 pt-0 mt-4">
            <Tabs value={tab} className="mt-0 border-none shadow-none">
              <TabsContent value="profile">
                <UserProfileTab
                  form={form}
                  setForm={setForm}
                  editMode={editMode}
                  isSuperAdmin={isSuperAdmin}
                  setIsSuperAdmin={setIsSuperAdmin}
                  isCurrentUserSuperAdmin={isCurrentUserSuperAdmin}
                  isSelf={isSelf}
                  uplineCandidates={uplineCandidates}
                  saving={saving}
                  onResetPasswordClick={() => setResetPwOpen(true)}
                  onDeleteClick={() => setDeleteConfirmOpen(true)}
                  onCancel={onClose}
                  onSave={handleSaveProfile}
                />
              </TabsContent>
              <TabsContent value="goals">
                <UserGoalsTab
                  form={form}
                  setForm={setForm}
                  goalActuals={goalActuals}
                  perfLoading={perfLoading}
                  saving={saving}
                  onSave={handleSaveGoals}
                />
              </TabsContent>
              <TabsContent value="onboarding">
                <UserOnboardingTab
                  items={onboardingItems}
                  onToggle={handleToggleOnboarding}
                  onReset={handleResetOnboarding}
                />
              </TabsContent>
              <TabsContent value="performance">
                <UserPerformanceTab performance={performance} perfLoading={perfLoading} form={form} />
              </TabsContent>
              {user.role === "Team Leader" && (
                <TabsContent value="myteam">
                  <UserTeamTab userId={user.id} currentUserRole={currentUserRole} />
                </TabsContent>
              )}
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

      <TransferLeadsModal
        open={transferModalOpen}
        onClose={() => setTransferModalOpen(false)}
        onConfirm={handleTransferAndConfirm}
        userToDelete={user}
        activeAgents={allUsers}
      />

      <Dialog open={resetPwOpen} onOpenChange={setResetPwOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Send password reset email to {user.email}? This will send them a link to create a new password.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPwOpen(false)}>Cancel</Button>
            <Button onClick={handleResetPassword}>Send Reset Email</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {user.firstName} {user.lastName}? You'll be prompted to transfer their contacts on the next step.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteUser} disabled={saving}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default UserProfileModal;
