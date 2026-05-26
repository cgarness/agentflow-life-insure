import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { NumberGroupCard } from "./NumberGroupCard";
import { NumberGroupFormModal } from "./NumberGroupFormModal";
import { NumberGroupMembersModal } from "./NumberGroupMembersModal";
import type { PhoneNumberRow } from "./NumberManagementSection";
import type { NumberGroupRow, NumberGroupMemberRow } from "./usePhoneSettingsController";

type Props = {
  organizationId: string | null;
  groups: NumberGroupRow[];
  groupMembers: NumberGroupMemberRow[];
  campaignGroupCounts: Record<string, number>;
  numbers: PhoneNumberRow[];
  onRefresh: () => Promise<void>;
};

export const NumberGroupsSection: React.FC<Props> = ({
  organizationId,
  groups,
  groupMembers,
  campaignGroupCounts,
  numbers,
  onRefresh,
}) => {
  const { profile } = useAuth();
  const canManage =
    profile?.role === "Admin" ||
    profile?.role === "Team Leader" ||
    profile?.is_super_admin === true;

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<NumberGroupRow | null>(null);
  const [deleting, setDeleting] = useState<NumberGroupRow | null>(null);
  const [managingMembersOf, setManagingMembersOf] = useState<NumberGroupRow | null>(null);

  const handleDelete = async () => {
    if (!deleting || !organizationId) return;
    const { error } = await supabase.from("number_groups").delete().eq("id", deleting.id).eq("organization_id", organizationId);
    if (error) {
      toast.error(`Could not delete: ${error.message}`);
      return;
    }
    toast.success("Group deleted");
    setDeleting(null);
    await onRefresh();
  };

  if (!organizationId) return null;

  const deletingCampaignCount = deleting ? campaignGroupCounts[deleting.id] ?? 0 : 0;

  return (
    <>
      <Card className="border-border/80 shadow-sm">
        <CardHeader className="border-b border-border/40 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-4 w-4 text-primary" />
              Number groups
            </CardTitle>
            {canManage && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Create group
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Assign campaigns to a subset of org numbers. Direct-line numbers are excluded from groups.
          </p>
        </CardHeader>
        <CardContent className="pt-4">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Users className="mb-3 h-10 w-10 text-muted-foreground" />
              <p className="mb-1 text-sm font-medium text-foreground">No number groups yet</p>
              <p className="mb-4 max-w-sm text-xs text-muted-foreground">
                Group numbers by geography, team, or purpose to keep campaign caller IDs focused.
              </p>
              {canManage && (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Create group
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <NumberGroupCard
                  key={g.id}
                  group={g}
                  members={groupMembers}
                  campaignCount={campaignGroupCounts[g.id] ?? 0}
                  canManage={canManage}
                  onEdit={() => setEditing(g)}
                  onDelete={() => setDeleting(g)}
                  onAddNumbers={() => setManagingMembersOf(g)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <NumberGroupFormModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
        mode="create"
        onSaved={onRefresh}
      />

      <NumberGroupFormModal
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        organizationId={organizationId}
        mode="edit"
        group={editing}
        onSaved={onRefresh}
      />

      {managingMembersOf && (
        <NumberGroupMembersModal
          open={!!managingMembersOf}
          onOpenChange={(o) => !o && setManagingMembersOf(null)}
          group={managingMembersOf}
          allNumbers={numbers}
          groupMembers={groupMembers}
          onSaved={onRefresh}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingCampaignCount > 0
                ? `This group is used by ${deletingCampaignCount} ${
                    deletingCampaignCount === 1 ? "campaign" : "campaigns"
                  }. Those campaigns will fall back to using all org numbers.`
                : "No campaigns use this group. Membership rows will be removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
