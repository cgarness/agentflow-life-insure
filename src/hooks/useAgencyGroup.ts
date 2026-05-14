import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AgencyGroupInfo = {
  groupId: string;
  groupName: string;
  role: "leader" | "member";
};

export function useAgencyGroup(): { agencyGroup: AgencyGroupInfo | null; isLoading: boolean } {
  const { profile } = useAuth();
  const orgId = profile?.organization_id ?? null;
  const [agencyGroup, setAgencyGroup] = useState<AgencyGroupInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!orgId) {
      setAgencyGroup(null);
      setIsLoading(false);
      return;
    }
    (async () => {
      setIsLoading(true);
      const { data: member } = await supabase
        .from("agency_group_members")
        .select("agency_group_id, role")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .maybeSingle();

      if (!member) {
        if (!cancelled) {
          setAgencyGroup(null);
          setIsLoading(false);
        }
        return;
      }

      const { data: group } = await supabase
        .from("agency_groups")
        .select("id, name")
        .eq("id", member.agency_group_id)
        .maybeSingle();

      if (cancelled) return;
      if (group) {
        setAgencyGroup({
          groupId: group.id,
          groupName: group.name,
          role: (member.role as "leader" | "member") ?? "member",
        });
      } else {
        setAgencyGroup(null);
      }
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  return { agencyGroup, isLoading };
}
