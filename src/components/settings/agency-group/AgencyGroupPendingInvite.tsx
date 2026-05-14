import React from "react";
import { Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { agencyGroupApi } from "./api";
import type { AgencyGroupMember } from "./types";

interface Props {
  member: AgencyGroupMember;
  groupName: string | null;
  masterOrgName: string | null;
  onChange: () => void;
}

const AgencyGroupPendingInvite: React.FC<Props> = ({ member, groupName, masterOrgName, onChange }) => {
  const { toast } = useToast();

  const accept = async () => {
    const { data: row } = await import("@/integrations/supabase/client").then(({ supabase }) =>
      supabase.from("agency_group_members").select("invite_token").eq("id", member.id).maybeSingle()
    );
    const token = (row as any)?.invite_token;
    if (!token) {
      toast({ title: "Token missing", variant: "destructive" });
      return;
    }
    const res = await agencyGroupApi.accept(token);
    if (!res.ok) {
      toast({ title: "Accept failed", description: res.data?.error, variant: "destructive" });
      return;
    }
    toast({ title: "Joined the group" });
    onChange();
  };

  const decline = async () => {
    const res = await agencyGroupApi.remove(member.agency_group_id, member.id);
    if (!res.ok) {
      toast({ title: "Decline failed", description: res.data?.error, variant: "destructive" });
      return;
    }
    toast({ title: "Invitation declined" });
    onChange();
  };

  return (
    <div className="rounded-2xl bg-card border border-primary/30 p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Mail className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold">Pending Invitation</h3>
          <p className="text-xs text-muted-foreground">
            {masterOrgName ?? "An agency"} invited you to join {groupName ? `"${groupName}"` : "their Agency Group"}.
          </p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        As a member, your agency will appear on the shared leaderboard and get access to shared training resources. Your contacts, phone numbers, billing, and settings remain 100% independent.
      </p>
      <div className="flex gap-2">
        <button onClick={accept} className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90">Accept</button>
        <button onClick={decline} className="h-9 px-4 rounded-lg text-sm font-semibold bg-accent hover:bg-accent/70">Decline</button>
      </div>
    </div>
  );
};

export default AgencyGroupPendingInvite;
