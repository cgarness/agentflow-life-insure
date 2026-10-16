import React, { useState } from "react";
import { FolderLock, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
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
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FolderLock className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold text-foreground">Your agency&apos;s grids</h2>
        </div>
        <Button size="sm" onClick={onCreate}>
          <Plus className="mr-1 h-4 w-4" aria-hidden /> New grid
        </Button>
      </div>
      {grids.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No private grids yet. Start blank, copy an AgentFlow grid&apos;s carrier list, or duplicate one with its rates.
        </p>
      ) : (
        <ul className="divide-y">
          {grids.map((grid) => (
            <li key={grid.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                  {grid.name}
                  {!grid.isActive && <Badge variant="outline">Inactive</Badge>}
                  {grid.id === calculatorGridId && <Badge>Calculator</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {effective(grid.effectiveDate)} · {grid.productCount} product{grid.productCount === 1 ? "" : "s"} ·{" "}
                  {ORIGIN_LABEL[grid.origin] ?? grid.origin}
                </p>
                <p className="text-xs text-muted-foreground">{lastEdited(grid.updatedAt, grid.updatedByName)}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => onEdit(grid.id)}>
                  <Pencil className="mr-1 h-4 w-4" aria-hidden /> Edit
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => askDelete(grid)}>
                  <Trash2 className="mr-1 h-4 w-4" aria-hidden /> Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmActionDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
    </section>
  );
};

export default PrivateGridsCard;
