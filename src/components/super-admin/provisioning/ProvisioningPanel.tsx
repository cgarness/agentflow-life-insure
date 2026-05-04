import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import ProvisioningRow, { ProvisioningOrgRow } from "./ProvisioningRow";

const ProvisioningPanel: React.FC = () => {
  const [rows, setRows] = useState<ProvisioningOrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, twilio_subaccount_sid, twilio_subaccount_status, twilio_provisioned_at")
      .order("twilio_provisioned_at", { ascending: false, nullsFirst: true })
      .order("name", { ascending: true });

    if (error) {
      toast({
        title: "Failed to load organizations",
        description: error.message,
        variant: "destructive",
      });
      setRows([]);
    } else {
      setRows((data ?? []) as ProvisioningOrgRow[]);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void fetchOrgs();
  }, [fetchOrgs]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Twilio Provisioning</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Subaccount status per organization. Retry failed or stuck provisioning.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchOrgs()}
            disabled={loading}
            className="gap-1.5"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left font-medium text-muted-foreground px-6 py-2.5">Organization</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-2.5">Status</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-2.5">Subaccount SID</th>
                  <th className="text-left font-medium text-muted-foreground px-4 py-2.5">Provisioned</th>
                  <th className="text-right font-medium text-muted-foreground px-6 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((org) => (
                  <ProvisioningRow key={org.id} org={org} onRefresh={() => void fetchOrgs()} />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-muted-foreground">
                      No organizations found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ProvisioningPanel;
