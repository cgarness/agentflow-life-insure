import React, { useState } from "react";
import { Copy, Eye, Library } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useCommissionGridMutations } from "@/hooks/useCommissionGridsAdmin";
import type { SharedGridCatalogEntry } from "@/lib/commission/adminTypes";
import ConfirmActionDialog, { type PendingConfirmation } from "./ConfirmActionDialog";
import { effective, errorMessage, levelRange } from "./gridFormat";

interface SharedGridsCardProps {
  catalog: SharedGridCatalogEntry[];
  calculatorGridId: string | null;
  onView: (gridId: string) => void;
  onDuplicate: (gridId: string) => void;
}

/**
 * AgentFlow shared grids available to this agency: metadata only until enabled. Enabling is retry-safe and
 * selects the grid for the calculator only when nothing is selected; disabling clears the selection only
 * when it was this grid (confirmed first) and never touches private copies.
 */
const SharedGridsCard: React.FC<SharedGridsCardProps> = ({ catalog, calculatorGridId, onView, onDuplicate }) => {
  const { enable, disable } = useCommissionGridMutations();
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const busy = enable.isPending || disable.isPending;

  const runEnable = (entry: SharedGridCatalogEntry) =>
    enable.mutate(entry.id, {
      onSuccess: (result) =>
        toast({
          title: `${entry.name} enabled`,
          description: result.selected
            ? "It's now your calculator grid."
            : result.keptExistingSelection
              ? "Your calculator keeps using the grid it already had."
              : undefined,
        }),
      onError: (error) => toast({ title: "Not enabled", description: errorMessage(error), variant: "destructive" }),
    });

  const runDisable = (entry: SharedGridCatalogEntry) =>
    disable.mutate(entry.id, {
      onSuccess: (result) =>
        toast({
          title: `${entry.name} disabled`,
          description: result.clearedSelection ? "The calculator is off until you choose another grid." : undefined,
        }),
      onError: (error) => toast({ title: "Not disabled", description: errorMessage(error), variant: "destructive" }),
    });

  const askDisable = (entry: SharedGridCatalogEntry) =>
    setConfirmation({
      title: `Disable ${entry.name}?`,
      description:
        entry.id === calculatorGridId
          ? "Your calculator uses this grid. Agents won't see the Commission Calculator until you choose another grid. Your private copies are not affected."
          : "Your agency stops seeing this grid's contents. Your private copies are not affected.",
      confirmLabel: "Disable",
      destructive: true,
      onConfirm: () => runDisable(entry),
    });

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Library className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold text-foreground">AgentFlow grids</h2>
      </div>
      {catalog.length === 0 ? (
        <p className="text-sm text-muted-foreground">No AgentFlow grids are available yet.</p>
      ) : (
        <ul className="divide-y">
          {catalog.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {entry.name}
                  {entry.isEnabled && <Badge variant="secondary">Enabled</Badge>}
                  {entry.id === calculatorGridId && <Badge>Calculator</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {effective(entry.effectiveDate)} · {levelRange(entry.contractLevels)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {entry.isEnabled ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => onView(entry.id)}>
                      <Eye className="mr-1 h-4 w-4" aria-hidden /> View
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDuplicate(entry.id)}>
                      <Copy className="mr-1 h-4 w-4" aria-hidden /> Duplicate
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => askDisable(entry)}>
                      Disable
                    </Button>
                  </>
                ) : (
                  <Button size="sm" disabled={busy} onClick={() => runEnable(entry)}>
                    Enable
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmActionDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
    </section>
  );
};

export default SharedGridsCard;
