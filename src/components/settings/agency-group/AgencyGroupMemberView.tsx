import React from "react";
import { LogOut, Building2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { agencyGroupApi } from "./api";
import AgencyGroupResourceList from "./AgencyGroupResourceList";
import type { AgencyGroup, AgencyGroupMember, AgencyGroupResource } from "./types";

interface Props {
  group: AgencyGroup;
  masterOrgName: string;
  members: AgencyGroupMember[];
  resources: AgencyGroupResource[];
  ownMember: AgencyGroupMember;
  onChange: () => void;
}

const AgencyGroupMemberView: React.FC<Props> = ({ group, masterOrgName, members, resources, ownMember, onChange }) => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const activeMembers = members.filter((m) => m.status === "active").length;

  const handleLeave = async () => {
    if (!confirm(`Are you sure you want to leave "${group.name}"? You'll lose access to the shared leaderboard and training resources. Your contacts, phone numbers, and billing are not affected.`)) return;
    const res = await agencyGroupApi.leave(group.id);
    if (!res.ok) {
      toast({ title: "Leave failed", description: res.data?.error, variant: "destructive" });
      return;
    }
    toast({ title: "You've left the group" });
    onChange();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-card border border-border p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">{group.name}</h3>
              <p className="text-xs text-muted-foreground">Master agency: {masterOrgName}</p>
            </div>
          </div>
          <button onClick={handleLeave} className="h-9 px-3 rounded-lg text-sm font-semibold bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/20 inline-flex items-center gap-2">
            <LogOut className="w-4 h-4" /> Leave Group
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {activeMembers} active member{activeMembers === 1 ? "" : "s"} · Joined {ownMember.joined_at ? new Date(ownMember.joined_at).toLocaleDateString() : "—"}
        </p>
      </div>

      <AgencyGroupResourceList
        groupId={group.id}
        resources={resources}
        ownOrgId={profile?.organization_id ?? ""}
        canManageResources={false}
        onChange={onChange}
      />
    </div>
  );
};

export default AgencyGroupMemberView;
