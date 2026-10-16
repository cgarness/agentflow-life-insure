import React, { useState } from "react";
import { FolderLock, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { GRID_ROW, StatePanel, StatusPill, SurfaceSection } from "@/components/commission/ui/CommissionSurface";
import { useCommissionGridMutations } from "@/hooks/useCommissionGridsAdmin";
import type { AdminGridSummary } from "@/lib/commission/adminTypes";
import ConfirmActionDialog, { type PendingConfirmation } from "./ConfirmActionDialog";
import { effective, errorMessage, lastEdited } from "./gridFormat";

interface PrivateGridsCardProps {
  grids: AdminGridSummary[];
  calculatorGridId: string | null;
  onCreate: () => void;
  onEdit: (gridId: string) => void;
}

const ORIGIN_LABEL: Record<string, string> = {
  blank: "Started blank",
  structure_copy: "Carrier list copy",
  full_copy: "Duplicate with rates",
};

/** The agency's own grids: create, edit, delete (confirmed; deleting the calculator grid turns it off). */
const PrivateGridsCard: React.FC<PrivateGridsCardProps> = ({ grids, calculatorGridId, onCreate, onEdit }) => {
  const { remove } = useCommissionGridMutations();
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);

  const askDelete = (grid: AdminGridSummary) =>
    setConfirmation({
      title: `Delete ${grid.name}?`,
      description:
        (grid.id === calculatorGridId
          ? "Your calculator uses this grid, so agents won't see the Commission Calculator until you choose another grid. "
          : "") + `Its ${grid.productCount} product${grid.productCount === 1 ? "" : "s"} and every rate are deleted. This can't be undone.`,
      confirmLabel: "Delete grid",
      destructive: true,
      onConfirm: () =>
        remove.mutate(
          { gridId: grid.id, revision: grid.revision },
          {
            onSuccess: () => toast({ title: `${grid.name} deleted` }),
            onError: (error) => toast({ title: "Not deleted", description: errorMessage(error), variant: "destructive" }),
          },
        ),
    });

  return (
    <SurfaceSection
      icon={FolderLock}
      title="Your agency's grids"
      count={grids.length}
      action={
        <Button size="sm" className="h-8" onClick={onCreate}>
          <Plus className="mr-1 h-4 w-4" aria-hidden /> New grid
        </Button>
      }
      bodyClassName="py-1.5"
    >
      {grids.length === 0 ? (
        <StatePanel
          icon={FolderLock}
          compact
          body="No private grids yet. Start blank, copy an AgentFlow grid's carrier list, or duplicate one with its rates."
        />
      ) : (
        <ul className="-mx-2 divide-y divide-border/40">
          {grids.map((grid) => (
            <li key={grid.id} className={GRID_ROW}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                  {grid.name}
                  {grid.id === calculatorGridId && <StatusPill tone="primary">Calculator</StatusPill>}
                  {!grid.isActive && <StatusPill tone="muted">Inactive</StatusPill>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {effective(grid.effectiveDate)} · {grid.productCount} product{grid.productCount === 1 ? "" : "s"} ·{" "}
                  {ORIGIN_LABEL[grid.origin] ?? grid.origin}
                </p>
                <p className="text-xs text-muted-foreground/80">{lastEdited(grid.updatedAt, grid.updatedByName)}</p>
              </div>
              <div className="-ml-2.5 flex items-center gap-1 sm:ml-0">
                <Button size="sm" variant="ghost" className="h-8" onClick={() => onEdit(grid.id)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  disabled={remove.isPending}
                  onClick={() => askDelete(grid)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmActionDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
    </SurfaceSection>
  );
};

export default PrivateGridsCard;
