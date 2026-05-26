import React, { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { expirationStatus, type AgentRow, type ExpirationStatus, type LicenseRow } from "./stateLicenseSchema";

type Props = {
  agents: AgentRow[];
  licenses: LicenseRow[];
  canManage: boolean;
  organizationId: string;
  onAddForAgent: (agentId: string) => void;
  onChanged: () => void;
};

const STATE_ABBRS: Record<string, string> = {
  "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
  "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
  "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
  "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
  "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
  "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
  "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
  "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT",
  "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
  "Wisconsin": "WI", "Wyoming": "WY", "District of Columbia": "DC"
};

function getStateAbbr(name: string): string {
  return STATE_ABBRS[name] ?? name.substring(0, 2).toUpperCase();
}

const statusChipClass: Record<ExpirationStatus, string> = {
  none: "bg-primary/8 border-primary/20 text-primary hover:bg-primary/15",
  ok:   "bg-emerald-500/8 border-emerald-500/25 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15",
  soon: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15",
  expired: "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400 hover:bg-rose-500/15",
};

const statusDotClass: Record<ExpirationStatus, string> = {
  none:    "bg-primary",
  ok:      "bg-emerald-500",
  soon:    "bg-amber-500",
  expired: "bg-rose-500",
};


export const StateLicenseTable: React.FC<Props> = ({
  agents,
  licenses,
  canManage,
  organizationId,
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
      .eq("id", deleting.id)
      .eq("organization_id", organizationId);
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
                <div className="flex flex-wrap gap-2">
                  {list.length === 0 ? (
                    <span className="text-xs text-muted-foreground italic">No licenses</span>
                  ) : (
                    list.map((lic) => {
                      const status = expirationStatus(lic.expiration_date);
                      const abbr = getStateAbbr(lic.state);
                      const expLabel = lic.expiration_date
                        ? (status === "expired" ? "Expired " : "Exp. ") +
                          new Date(lic.expiration_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                        : "No expiration";
                      return (
                        <Tooltip key={lic.id}>
                          <TooltipTrigger asChild>
                            <div
                              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs font-semibold cursor-default transition-colors duration-150 ${statusChipClass[status]}`}
                            >
                              {/* Status dot */}
                              <div className="relative flex h-1.5 w-1.5 shrink-0">
                                {status === "expired" && (
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                )}
                                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${statusDotClass[status]}`} />
                              </div>
                              {abbr}
                              {canManage && (
                                <button
                                  type="button"
                                  aria-label={`Remove ${lic.state} license`}
                                  className="ml-0.5 rounded-full p-0.5 opacity-50 hover:opacity-100 hover:bg-foreground/10 transition-opacity"
                                  onClick={() => setDeleting(lic)}
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <div className="text-xs space-y-0.5">
                              <p className="font-semibold">{lic.state}</p>
                              {lic.license_number && <p>License #: {lic.license_number}</p>}
                              <p>{expLabel}</p>
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
