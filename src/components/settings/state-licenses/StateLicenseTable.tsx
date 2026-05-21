import React, { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { expirationStatus, type AgentRow, type ExpirationStatus, type LicenseRow } from "./stateLicenseSchema";

type Props = {
  agents: AgentRow[];
  licenses: LicenseRow[];
  canManage: boolean;
  onAddForAgent: (agentId: string) => void;
  onChanged: () => void;
};

const statusBadgeClass: Record<Exclude<ExpirationStatus, "none">, string> = {
  expired: "bg-destructive/15 text-destructive border-destructive/40",
  soon: "bg-warning/15 text-warning border-warning/40",
  ok: "bg-muted text-foreground/70 border-border",
};

function formatDate(d: string | null): string {
  if (!d) return "No expiration";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const StateLicenseTable: React.FC<Props> = ({
  agents,
  licenses,
  canManage,
  onAddForAgent,
  onChanged,
}) => {
  const [deleting, setDeleting] = useState<LicenseRow | null>(null);

  const byAgent = useMemo(() => {
    const map = new Map<string, LicenseRow[]>();
    for (const l of licenses) {
      if (!map.has(l.agent_id)) map.set(l.agent_id, []);
      map.get(l.agent_id)!.push(l);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.state.localeCompare(b.state));
    }
    return map;
  }, [licenses]);

  const sortedAgents = useMemo(
    () =>
      [...agents].sort((a, b) =>
        `${a.first_name ?? ""} ${a.last_name ?? ""}`.localeCompare(
          `${b.first_name ?? ""} ${b.last_name ?? ""}`,
        ),
      ),
    [agents],
  );

  const deletingAgent = deleting
    ? agents.find((a) => a.id === deleting.agent_id)
    : null;

  const handleDelete = async () => {
    if (!deleting) return;
    const { error } = await supabase
      .from("agent_state_licenses")
      .delete()
      .eq("id", deleting.id);
    if (error) {
      toast.error(`Could not remove license: ${error.message}`);
      return;
    }
    toast.success("License removed");
    setDeleting(null);
    onChanged();
  };

  return (
    <TooltipProvider>
      <div className="rounded-lg border border-border/80 bg-card">
        <div className="grid grid-cols-[1fr_2fr_auto] gap-4 border-b border-border/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Agent</span>
          <span>Licensed States</span>
          <span className="sr-only">Actions</span>
        </div>
        <ul className="divide-y divide-border/60">
          {sortedAgents.map((agent) => {
            const list = byAgent.get(agent.id) ?? [];
            return (
              <li
                key={agent.id}
                className="grid grid-cols-[1fr_2fr_auto] items-center gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {agent.first_name} {agent.last_name}
                  </p>
                  <p className="text-xs text-muted-foreground">{agent.role}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {list.length === 0 ? (
                    <span className="text-xs text-muted-foreground italic">No licenses</span>
                  ) : (
                    list.map((lic) => {
                      const status = expirationStatus(lic.expiration_date);
                      const cls = status === "none" ? statusBadgeClass.ok : statusBadgeClass[status];
                      return (
                        <Tooltip key={lic.id}>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="outline"
                              className={`gap-1 border ${cls}`}
                            >
                              {(status === "expired" || status === "soon") && (
                                <AlertTriangle className="h-3 w-3" />
                              )}
                              {lic.state}
                              {canManage && (
                                <button
                                  type="button"
                                  aria-label={`Remove ${lic.state} license`}
                                  className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
                                  onClick={() => setDeleting(lic)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs">
                              <p>License #: {lic.license_number || "—"}</p>
                              <p>
                                {status === "expired" ? "Expired " : "Expires "}
                                {formatDate(lic.expiration_date)}
                              </p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })
                  )}
                </div>
                <div className="flex justify-end">
                  {canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAddForAgent(agent.id)}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove license?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {deletingAgent?.first_name} {deletingAgent?.last_name}'s {deleting?.state} license? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
};
