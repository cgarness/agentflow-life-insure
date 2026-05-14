import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AgencyGroupNoGroup from "./agency-group/AgencyGroupNoGroup";
import AgencyGroupLeaderView from "./agency-group/AgencyGroupLeaderView";
import AgencyGroupMemberView from "./agency-group/AgencyGroupMemberView";
import AgencyGroupPendingInvite from "./agency-group/AgencyGroupPendingInvite";
import type { AgencyGroup, AgencyGroupMember, AgencyGroupResource } from "./agency-group/types";

const AgencyGroupSettings: React.FC = () => {
  const { profile } = useAuth();
  const orgId = profile?.organization_id ?? null;
  const [loading, setLoading] = useState(true);
  const [ownMember, setOwnMember] = useState<AgencyGroupMember | null>(null);
  const [group, setGroup] = useState<AgencyGroup | null>(null);
  const [members, setMembers] = useState<AgencyGroupMember[]>([]);
  const [resources, setResources] = useState<AgencyGroupResource[]>([]);
  const [masterOrgName, setMasterOrgName] = useState<string>("");

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true);

    const { data: own } = await supabase
      .from("agency_group_members")
      .select("*")
      .eq("organization_id", orgId)
      .in("status", ["active", "invited"])
      .maybeSingle();

    if (!own) {
      setOwnMember(null); setGroup(null); setMembers([]); setResources([]);
      setLoading(false);
      return;
    }

    setOwnMember(own as AgencyGroupMember);

    const { data: g } = await supabase
      .from("agency_groups")
      .select("*")
      .eq("id", own.agency_group_id)
      .maybeSingle();

    setGroup((g as AgencyGroup) ?? null);

    if (g) {
      const { data: master } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", g.master_organization_id)
        .maybeSingle();
      setMasterOrgName(master?.name ?? "");
    }

    const { data: ms } = await supabase
      .from("agency_group_members")
      .select("*, organizations:organization_id(name)")
      .eq("agency_group_id", own.agency_group_id);
    setMembers((ms as AgencyGroupMember[]) ?? []);

    const { data: rs } = await supabase
      .from("agency_group_resources")
      .select("*, organizations:uploaded_by_org_id(name)")
      .eq("agency_group_id", own.agency_group_id)
      .order("created_at", { ascending: false });
    setResources((rs as AgencyGroupResource[]) ?? []);

    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!ownMember || !group) {
    return <AgencyGroupNoGroup onCreated={load} />;
  }

  if (ownMember.status === "invited") {
    return (
      <AgencyGroupPendingInvite
        member={ownMember}
        groupName={group.name}
        masterOrgName={masterOrgName}
        onChange={load}
      />
    );
  }

  const isLeader = group.master_organization_id === orgId;

  if (isLeader) {
    return <AgencyGroupLeaderView group={group} members={members} resources={resources} onChange={load} />;
  }

  return (
    <AgencyGroupMemberView
      group={group}
      masterOrgName={masterOrgName}
      members={members}
      resources={resources}
      ownMember={ownMember}
      onChange={load}
    />
  );
};

export default AgencyGroupSettings;
