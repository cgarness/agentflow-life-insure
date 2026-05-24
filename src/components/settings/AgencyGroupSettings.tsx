import React, { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, RotateCw } from "lucide-react";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ownMember, setOwnMember] = useState<AgencyGroupMember | null>(null);
  const [group, setGroup] = useState<AgencyGroup | null>(null);
  const [members, setMembers] = useState<AgencyGroupMember[]>([]);
  const [resources, setResources] = useState<AgencyGroupResource[]>([]);
  const [masterOrgName, setMasterOrgName] = useState<string>("");

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);

    const { data: own, error: ownErr } = await supabase
      .from("agency_group_members")
      .select("*")
      .eq("organization_id", orgId)
      .in("status", ["active", "invited"])
      .maybeSingle();

    if (ownErr) {
      setLoadError(ownErr.message);
      setLoading(false);
      return;
    }

    if (!own) {
      setOwnMember(null); setGroup(null); setMembers([]); setResources([]);
      setLoading(false);
      return;
    }

    setOwnMember(own as AgencyGroupMember);

    const { data: g, error: gErr } = await supabase
      .from("agency_groups")
      .select("*")
      .eq("id", own.agency_group_id)
      .maybeSingle();

    if (gErr) {
      setLoadError(gErr.message);
      setLoading(false);
      return;
    }

    setGroup((g as AgencyGroup) ?? null);

    if (g) {
      const { data: master, error: masterErr } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", g.master_organization_id)
        .maybeSingle();
      if (masterErr) {
        setLoadError(masterErr.message);
        setLoading(false);
        return;
      }
      setMasterOrgName(master?.name ?? "");
    }

    const { data: ms, error: msErr } = await supabase
      .from("agency_group_members")
      .select("*, organizations:organization_id(name)")
      .eq("agency_group_id", own.agency_group_id);
    if (msErr) {
      setLoadError(msErr.message);
      setLoading(false);
      return;
    }
    setMembers((ms as AgencyGroupMember[]) ?? []);

    const { data: rs, error: rsErr } = await supabase
      .from("agency_group_resources")
      .select("*, organizations:uploaded_by_org_id(name)")
      .eq("agency_group_id", own.agency_group_id)
      .order("created_at", { ascending: false });
    if (rsErr) {
      setLoadError(rsErr.message);
      setLoading(false);
      return;
    }
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

  if (loadError) {
    return (
      <div className="rounded-2xl bg-card border border-destructive/30 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="font-semibold text-foreground mb-1">Couldn't load Agency Group</h3>
            <p className="text-sm text-muted-foreground mb-3">{loadError}</p>
            <button
              onClick={load}
              className="h-9 px-3 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-2"
            >
              <RotateCw className="w-4 h-4" /> Retry
            </button>
          </div>
        </div>
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
