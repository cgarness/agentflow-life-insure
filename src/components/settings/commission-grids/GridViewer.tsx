import React, { useMemo } from "react";
import { ArrowLeft, Copy, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGridSnapshot } from "@/hooks/useCommissionGridsAdmin";
import RateMatrix from "./RateMatrix";
import { effective, errorMessage, levelRange } from "./gridFormat";
import { snapshotRows } from "./matrixRows";

interface GridViewerProps {
  gridId: string;
  onBack: () => void;
  onDuplicate: (gridId: string) => void;
}

/** Read-only view of an enabled AgentFlow grid (shared content is never editable by an agency). */
const GridViewer: React.FC<GridViewerProps> = ({ gridId, onBack, onDuplicate }) => {
  const snapshot = useGridSnapshot(gridId);
  const data = snapshot.data;
  const rows = useMemo(() => (data ? snapshotRows(data) : []), [data]);
  const rates = useMemo(() => {
    const map = new Map<string, string>();
    data?.rates.forEach((rate) => map.set(`${rate.variantId}:${rate.contractLevel}`, rate.ratePercent));
    return map;
  }, [data]);
  const labelOf = useMemo(() => new Map(data?.variants.map((v) => [v.id, v.label || "All ages"]) ?? []), [data]);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Commission grids
      </Button>
      {snapshot.isPending ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading grid…
        </div>
      ) : snapshot.isError || !data ? (
        <p role="alert" className="text-sm text-destructive">{errorMessage(snapshot.error)}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{data.grid.name}</h2>
              <p className="text-xs text-muted-foreground">
                {effective(data.grid.effectiveDate)} · {levelRange(data.grid.contractLevels)}
                {data.grid.isActive ? "" : " · Inactive"}
              </p>
            </div>
            <Button size="sm" onClick={() => onDuplicate(data.grid.id)}>
              <Copy className="mr-1 h-4 w-4" aria-hidden /> Duplicate
            </Button>
          </div>
          <p className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
            This grid is managed by AgentFlow. Duplicate it to customize.
          </p>
          <RateMatrix levels={data.grid.contractLevels} rows={rows} value={(ref, level) => rates.get(`${ref}:${level}`) ?? ""} readOnly />
          {data.references.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Source notes (admins only)</h3>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {data.references.map((reference) => (
                  <li key={reference.variantId} className="whitespace-pre-line">
                    <span className="font-medium text-foreground">{labelOf.get(reference.variantId)}:</span>{" "}
                    {[reference.source, reference.notes].filter(Boolean).join(" — ")}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default GridViewer;
