import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import { logActivity } from "@/lib/activityLogger";
import HierarchyTree from "./HierarchyTree";
import UserManagementHeader from "./user-management/UserManagementHeader";
import UserManagementTabs from "./user-management/UserManagementTabs";
import TeamMembersTable from "./user-management/TeamMembersTable";
import PendingInvitesTable from "./user-management/PendingInvitesTable";
import InviteUserModal from "./user-management/InviteUserModal";
import UserProfileModal from "./user-management/UserProfileModal";
import UserManagementConfirmDialogs from "./user-management/UserManagementConfirmDialogs";
import type { ConfirmDialogState, UserWithProfile } from "./user-management/userManagementTypes";

const UserManagement: React.FC = () => {
  const { toast } = useToast();
  const { user: currentUser, profile: currentProfile } = useAuth();
  const { organizationId, isSuperAdmin: isCurrentUserSuperAdmin } = useOrganization();

  const [allUsers, setAllUsers] = useState<UserWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("users");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({ open: false, user: null, action: "deactivate" });

  const fetchUsers = useCallback(async () => {
    // Wait until org context is resolved. Without an org id, the API skips the
    // organization_id filter and RLS may return cross-org rows (especially for
    // super admins), causing a brief flash of other orgs' users on refresh.
    if (!organizationId) {
      setAllUsers([]);
      setLoading(true);
      return;
    }
    setLoading(true);
    try {
      const data = await usersApi.getAll({ search, role: roleFilter, status: statusFilter, organizationId });
      setAllUsers(data);
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter, organizationId, toast]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const users = useMemo(() => {
    if (!currentProfile) return [];
    if (isCurrentUserSuperAdmin) return allUsers;

    return allUsers.filter(u => {
      const role = currentProfile.role?.toLowerCase();
      if (role === "admin") return true;
      // Team Leader: self is always visible; only show users whose direct upline is this leader.
      // RLS enforces the deep ltree hierarchy — this is a shallow frontend defense-in-depth layer.
      if (role === "team leader") return u.id === currentProfile.id || u.profile.uplineId === currentProfile.id;
      if (role === "agent") return u.id === currentProfile.id;
      return false;
    });
  }, [allUsers, currentProfile, isCurrentUserSuperAdmin]);

  const handleDeactivateReactivate = async () => {
    const u = confirmDialog.user;
    if (!u) return;
    const targetId = u.id;
    try {
      if (confirmDialog.action === "deactivate") {
        await usersApi.deactivate(targetId);
        toast({ title: "Deactivated", description: `${u.firstName} ${u.lastName} has been deactivated.` });
        setAllUsers(prev => prev.map(usr => usr.id === targetId ? { ...usr, status: "Inactive" as any } : usr)); // eslint-disable-line @typescript-eslint/no-explicit-any
      } else {
        await usersApi.reactivate(targetId);
        toast({ title: "Reactivated", description: `${u.firstName} ${u.lastName} has been reactivated.` });
        setAllUsers(prev => prev.map(usr => usr.id === targetId ? { ...usr, status: "Active" as any } : usr)); // eslint-disable-line @typescript-eslint/no-explicit-any
      }
      if (organizationId) {
        void logActivity({
          action: `${confirmDialog.action === "deactivate" ? "Deactivated" : "Reactivated"} user ${u.firstName} ${u.lastName}`,
          category: "user_management",
          organizationId,
          userId: currentUser?.id,
          userName: currentProfile ? `${currentProfile.first_name} ${currentProfile.last_name}` : undefined,
          metadata: { targetUserId: targetId, action: confirmDialog.action },
        });
      }
      setConfirmDialog({ open: false, user: null, action: "deactivate" });
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <UserManagementHeader onInvite={() => setInviteOpen(true)} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <UserManagementTabs />

        <TabsContent value="users">
          <TeamMembersTable
            users={users}
            allUsers={allUsers}
            loading={loading}
            search={search}
            setSearch={setSearch}
            roleFilter={roleFilter}
            setRoleFilter={setRoleFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            isCurrentUserSuperAdmin={isCurrentUserSuperAdmin}
            onSelectUser={(u) => { setSelectedUser(u); setProfileOpen(true); }}
            onConfirm={setConfirmDialog}
            onBillingChange={(userId, newVal) => {
              setAllUsers(prev => prev.map(x => x.id === userId ? { ...x, profile: { ...x.profile, billingType: newVal } } : x));
            }}
          />
        </TabsContent>

        <TabsContent value="invites">
          <PendingInvitesTable organizationId={organizationId} active={activeTab === "invites"} />
        </TabsContent>

        <TabsContent value="hierarchy" className="space-y-4 mt-6 animate-in fade-in-50 duration-500">
          <HierarchyTree />
        </TabsContent>
      </Tabs>

      <UserProfileModal
        user={selectedUser}
        open={profileOpen}
        onClose={() => { setProfileOpen(false); setSelectedUser(null); }}
        onSaved={(patch) => {
          if (!patch?.id) return;
          setAllUsers((prev) =>
            prev.map((u) => {
              if (u.id !== patch.id) return u;
              const { profile: patchProfile, ...userPatch } = patch as Partial<UserWithProfile> & { profile?: Partial<UserWithProfile["profile"]> };
              const merged = { ...u, ...userPatch } as UserWithProfile;
              if (patchProfile) merged.profile = { ...u.profile, ...patchProfile };
              return merged;
            })
          );
        }}
        onDeleted={(id) => {
          setAllUsers(prev => prev.filter(u => u.id !== id));
          setProfileOpen(false);
          setSelectedUser(null);
        }}
        currentUserId={currentUser?.id || ""}
        currentUserRole={currentProfile?.role || ""}
        isCurrentUserSuperAdmin={isCurrentUserSuperAdmin}
        allUsers={users}
      />

      <InviteUserModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSuccess={() => { fetchUsers(); }}
        managers={allUsers.filter(u => u.role === "Admin" || u.role === "Team Leader")}
      />

      <UserManagementConfirmDialogs
        state={confirmDialog}
        onClose={() => setConfirmDialog({ open: false, user: null, action: "deactivate" })}
        onConfirm={handleDeactivateReactivate}
      />
    </div>
  );
};

export default UserManagement;
