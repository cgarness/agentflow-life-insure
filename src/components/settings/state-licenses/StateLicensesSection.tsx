import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { StateLicenseTable } from "./StateLicenseTable";
import { StateLicenseFormModal } from "./StateLicenseFormModal";
import type { AgentRow, LicenseRow } from "./stateLicenseSchema";

export const StateLicensesSection: React.FC = () => {
  const { profile } = useAuth();
  const { organizationId } = useOrganization();
  const canManage =
    profile?.role === "Admin" ||
    profile?.role === "Team Leader" ||
    profile?.is_super_admin === true;

  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [presetAgentId, setPresetAgentId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const [agentRes, licenseRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, first_name, last_name, role, status")
        .eq("organization_id", organizationId)
        .eq("status", "Active")
        .order("first_name"),
      supabase
        .from("agent_state_licenses")
        .select("id, agent_id, state, license_number, expiration_date, created_at")
        .eq("organization_id", organizationId)
        .order("state"),
    ]);

    if (agentRes.error) {
      toast.error(`Failed to load agents: ${agentRes.error.message}`);
    } else {
      setAgents((agentRes.data as AgentRow[]) ?? []);
    }
    if (licenseRes.error) {
      toast.error(`Failed to load licenses: ${licenseRes.error.message}`);
    } else {
      setLicenses((licenseRes.data as LicenseRow[]) ?? []);
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleOpenAdd = (agentId?: string) => {
    setPresetAgentId(agentId ?? null);
    setFormOpen(true);
  };

  if (!organizationId) return null;

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="border-b border-border/40 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-4 w-4 text-primary" />
            State Licenses
          </CardTitle>
          {canManage && (
            <Button size="sm" onClick={() => handleOpenAdd()}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add License
            </Button>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Track which states each agent is licensed in. Used by state-based inbound call routing.
        </p>
      </CardHeader>
      <CardContent className="pt-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 rounded-md" />
            <Skeleton className="h-12 rounded-md" />
            <Skeleton className="h-12 rounded-md" />
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <ShieldCheck className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="mb-1 text-sm font-medium text-foreground">No active agents</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Add agents to your organization first, then assign state licenses.
            </p>
          </div>
        ) : licenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <ShieldCheck className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="mb-1 text-sm font-medium text-foreground">
              No state licenses have been added yet
            </p>
            <p className="mb-4 max-w-sm text-xs text-muted-foreground">
              Add licenses to enable state-based inbound call routing.
            </p>
            {canManage && (
              <Button size="sm" onClick={() => handleOpenAdd()}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add License
              </Button>
            )}
          </div>
        ) : (
          <StateLicenseTable
            agents={agents}
            licenses={licenses}
            canManage={canManage}
            organizationId={organizationId}
            onAddForAgent={(id) => handleOpenAdd(id)}
            onChanged={() => void fetchData()}
          />
        )}
      </CardContent>

      <StateLicenseFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        organizationId={organizationId}
        agents={agents}
        presetAgentId={presetAgentId}
        onSaved={() => void fetchData()}
      />
    </Card>
  );
};

export default StateLicensesSection;
