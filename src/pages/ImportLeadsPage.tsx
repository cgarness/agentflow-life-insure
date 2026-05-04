import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import ImportLeadsModal from "@/components/contacts/ImportLeadsModal";
import type { ImportHistoryEntry } from "@/components/contacts/ImportLeadsModal";
import { toast } from "sonner";

type CampaignRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  user_id?: string | null;
  assigned_agent_ids?: unknown;
};

const ImportLeadsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get("campaignId") ?? undefined;

  const { user, profile } = useAuth();
  const { organizationId, role, isSuperAdmin } = useOrganization();

  const [existingLeads, setExistingLeads] = useState<{ id: string; phone: string; email: string }[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
  const [downlineIds, setDownlineIds] = useState<string[]>([]);

  useEffect(() => {
    if (!organizationId) return;

    supabase
      .from("profiles")
      .select("id, first_name, last_name, status")
      .eq("status", "Active")
      .then(({ data }) => {
        if (data)
          setAgentProfiles(
            data.map((p: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
              id: p.id,
              firstName: p.first_name ?? "",
              lastName: p.last_name ?? "",
            })),
          );
      });

    supabase
      .from("campaigns")
      .select("id, name, type, status, user_id, assigned_agent_ids")
      .then(({ data }) => {
        if (data) setCampaigns(data as CampaignRow[]);
      });

    supabase
      .from("leads")
      .select("id, phone, email")
      .then(({ data }) => {
        if (data) setExistingLeads(data as { id: string; phone: string; email: string }[]);
      });
  }, [organizationId]);

  useEffect(() => {
    if (!user?.id || (role !== "Team Leader" && role !== "Team Lead")) return;
    usersApi
      .getDownlineAgents(user.id)
      .then((agents: any[]) => setDownlineIds(agents.map((a) => a.id))) // eslint-disable-line @typescript-eslint/no-explicit-any
      .catch(console.error);
  }, [user?.id, role]);

  const assignableAgentIds = useMemo(() => {
    if (!user?.id) return [] as string[];
    if (role === "Agent" && !isSuperAdmin) return [user.id];
    if (role === "Team Leader" || role === "Team Lead")
      return [user.id, ...downlineIds];
    return agentProfiles.map((a) => a.id);
  }, [user?.id, role, isSuperAdmin, downlineIds, agentProfiles]);

  const handleImportComplete = async (_: unknown, historyEntry: ImportHistoryEntry) => {
    await supabase.from("import_history").insert({
      file_name: historyEntry.fileName,
      total_records: historyEntry.totalRecords,
      imported: historyEntry.imported,
      duplicates: historyEntry.duplicates,
      errors: historyEntry.errors,
      agent_id: user?.id ?? null,
      imported_lead_ids: historyEntry.importedLeadIds,
      organization_id: organizationId,
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  const handleCampaignCreated = async (campaign: {
    name: string;
    type: string;
    description: string;
  }) => {
    const { data, error } = await supabase
      .from("campaigns")
      .insert({
        name: campaign.name,
        type: campaign.type,
        description: campaign.description,
        status: "Active",
        total_leads: 0,
        organization_id: organizationId,
        created_by: user?.id,
      } as Record<string, unknown>)
      .select("id")
      .maybeSingle();

    if (error || !data?.id) {
      toast.error(error?.message ?? "Failed to create campaign");
      return null;
    }

    const { data: list } = await supabase
      .from("campaigns")
      .select("id, name, type, status, user_id, assigned_agent_ids");
    if (list) setCampaigns(list as CampaignRow[]);

    return { id: data.id as string };
  };

  const currentUserDisplayName = [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return (
    <div className="min-h-screen bg-background">
      <ImportLeadsModal
        renderAsPage
        open={true}
        onClose={() => navigate(-1)}
        onViewLeads={() =>
          navigate("/contacts?tab=Leads", { state: { importCompleted: true } })
        }
        existingLeads={existingLeads as any} // eslint-disable-line @typescript-eslint/no-explicit-any
        campaigns={campaigns}
        organizationId={organizationId}
        currentUserId={user?.id}
        currentUserDisplayName={currentUserDisplayName}
        agentProfiles={agentProfiles}
        viewerRole={role}
        viewerIsSuperAdmin={isSuperAdmin}
        assignableAgentIds={assignableAgentIds}
        defaultCampaignId={campaignId}
        onCampaignCreated={handleCampaignCreated}
        onImportComplete={handleImportComplete}
      />
    </div>
  );
};

export default ImportLeadsPage;
