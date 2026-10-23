import React, { useEffect, useState } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useInviteManagerCandidates, useUserManagementMembers } from "@/hooks/useUserManagementMembers";
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

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitationVersion, setInvitationVersion] = useState(0);
  const [selectedUser, setSelectedUser] = useState<UserWithProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("users");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({ open: false, user: null, action: "deactivate" });

  // Rows are query-scoped per viewer (Admin: organization; Team Leader: downline traversal;
  // Agent: self) and fail closed — see useUserManagementMembers. Not an authorization boundary.
  const {
    members, loading, error, managerNames, reload, patchMember, removeMember, viewer, canAdminister, organizationId,
  } = useUserManagementMembers({ search, role: roleFilter, status: statusFilter });
  const inviteManagers = useInviteManagerCandidates(organizationId, inviteOpen);

  useEffect(() => {
    if (inviteManagers.error) toast({ title: "Managers unavailable", description: inviteManagers.error, variant: "destructive" });
  }, [inviteManagers.error, toast]);

  const handleDeactivateReactivate = async () => {
    const u = confirmDialog.user;
    if (!u) return;
    const targetId = u.id;
    try {
      if (confirmDialog.action === "deactivate") {
        await usersApi.deactivate(targetId);
        toast({ title: "Deactivated", description: `${u.firstName} ${u.lastName} has been deactivated.` });
        patchMember({ id: targetId, status: "Inactive" });
      } else {
        await usersApi.reactivate(targetId);
        toast({ title: "Reactivated", description: `${u.firstName} ${u.lastName} has been reactivated.` });
        patchMember({ id: targetId, status: "Active" });
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
    } catch (e: any) {
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
            users={members}
            managerNames={managerNames}
            loading={loading}
            error={error}
            search={search}
            setSearch={setSearch}
            roleFilter={roleFilter}
            setRoleFilter={setRoleFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            isCurrentUserSuperAdmin={viewer?.isSuperAdmin === true}
            canAdminister={canAdminister}
            onSelectUser={(u) => { setSelectedUser(u); setProfileOpen(true); }}
            onConfirm={setConfirmDialog}
            onBillingChange={(userId, newVal) => patchMember({ id: userId, profile: { billingType: newVal } })}
          />
        </TabsContent>

        <TabsContent value="invites">
          <PendingInvitesTable key={invitationVersion} organizationId={organizationId} active={activeTab === "invites"} />
        </TabsContent>

        <TabsContent value="hierarchy" className="space-y-4 mt-6 animate-in fade-in-50 duration-500">
          <HierarchyTree />
        </TabsContent>
      </Tabs>

      <UserProfileModal
        user={selectedUser}
        open={profileOpen}
        onClose={() => { setProfileOpen(false); setSelectedUser(null); }}
        onSaved={patchMember}
        onDeleted={(id) => {
          removeMember(id);
          setProfileOpen(false);
          setSelectedUser(null);
        }}
        onReload={reload}
        viewer={viewer}
        organizationId={organizationId}
        allUsers={members}
      />

      <InviteUserModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSuccess={() => { reload(); setInvitationVersion(v => v + 1); }}
        managers={inviteManagers.managers}
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
