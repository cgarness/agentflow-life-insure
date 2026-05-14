import React, { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const AgencyGroupInviteBanner: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [masterOrgName, setMasterOrgName] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (profile?.role !== "Admin" || !profile.organization_id) return;
    let cancelled = false;
    (async () => {
      const { data: invite } = await supabase
        .from("agency_group_members")
        .select("agency_group_id")
        .eq("organization_id", profile.organization_id)
        .eq("status", "invited")
        .maybeSingle();
      if (!invite || cancelled) return;
      const { data: group } = await supabase
        .from("agency_groups")
        .select("master_organization_id")
        .eq("id", invite.agency_group_id)
        .maybeSingle();
      if (!group || cancelled) return;
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", group.master_organization_id)
        .maybeSingle();
      if (!cancelled) setMasterOrgName(org?.name ?? "An agency");
    })();
    return () => { cancelled = true; };
  }, [profile?.role, profile?.organization_id]);

  if (!masterOrgName || dismissed) return null;

  return (
    <div className="rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
        <UserPlus className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">
          <span className="text-primary">{masterOrgName}</span> has invited your agency to join their Agency Group.
        </p>
        <p className="text-xs text-muted-foreground">Accept to share leaderboard visibility and training resources. Your data stays independent.</p>
      </div>
      <button
        onClick={() => navigate("/settings?section=agency-group")}
        className="h-9 px-3 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 shrink-0"
      >
        View Invitation
      </button>
      <button onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Dismiss">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default AgencyGroupInviteBanner;
