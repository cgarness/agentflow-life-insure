import React, { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import ProvisioningStatusBadge, { ProvisioningStatus } from "./ProvisioningStatusBadge";

export interface ProvisioningOrgRow {
  id: string;
  name: string;
  twilio_subaccount_sid: string | null;
  twilio_subaccount_status: ProvisioningStatus | null;
  twilio_provisioned_at: string | null;
}

interface Props {
  org: ProvisioningOrgRow;
  onRefresh: () => void;
}

const RETRYABLE = new Set(["pending", "pending_manual"]);

const ProvisioningRow: React.FC<Props> = ({ org, onRefresh }) => {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const canRetry = !org.twilio_subaccount_sid && RETRYABLE.has(String(org.twilio_subaccount_status ?? ""));

  const handleRetry = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke<Record<string, unknown>>(
        "retry-twilio-provisioning",
        { body: { organization_id: org.id } },
      );
      if (error) {
        toast({
          title: "Retry failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        const status = String((data as { status?: string } | null)?.status ?? "");
        toast({
          title: status === "active" ? "Provisioned" : status === "already_provisioned" ? "Already provisioned" : "Retry submitted",
          description:
            status === "active"
              ? "Twilio subaccount created successfully."
              : status === "already_provisioned"
                ? "Subaccount SID already exists; no Twilio call made."
                : `Status: ${status || "unknown"}`,
        });
      }
    } catch (e) {
      toast({
        title: "Retry failed",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
      onRefresh();
    }
  };

  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/20 transition-colors">
      <td className="px-6 py-3 font-medium">{org.name}</td>
      <td className="px-4 py-3">
        <ProvisioningStatusBadge status={org.twilio_subaccount_status} />
      </td>
      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
        {org.twilio_subaccount_sid ?? "—"}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {org.twilio_provisioned_at
          ? new Date(org.twilio_provisioned_at).toLocaleString()
          : "—"}
      </td>
      <td className="px-6 py-3 text-right">
        {canRetry ? (
          <Button
            size="sm"
            variant="outline"
            onClick={handleRetry}
            disabled={busy}
            className="gap-1.5"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Retry
          </Button>
        ) : null}
      </td>
    </tr>
  );
};

export default ProvisioningRow;
