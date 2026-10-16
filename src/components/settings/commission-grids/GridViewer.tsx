import React, { useMemo } from "react";
import { AlertTriangle, ArrowLeft, Copy, FileText, Grid3x3, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingBlock, StatePanel, SurfaceSection } from "@/components/commission/ui/CommissionSurface";
import { useGridSnapshot } from "@/hooks/useCommissionGridsAdmin";
import EditorHeader from "./EditorHeader";
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

  if (snapshot.isPending || snapshot.isError || !data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2 h-8 text-muted-foreground hover:text-foreground" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Commission grids
        </Button>
        {snapshot.isPending ? (
          <LoadingBlock label="Loading grid…" rows={4} />
        ) : (
          <StatePanel role="alert" icon={AlertTriangle} tone="destructive" body={errorMessage(snapshot.error)} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <EditorHeader
        title={data.grid.name}
        meta={`${effective(data.grid.effectiveDate)} · ${levelRange(data.grid.contractLevels)}`}
        backLabel="Commission grids"
        onBack={onBack}
        active={data.grid.isActive}
        action={
          <Button size="sm" onClick={() => onDuplicate(data.grid.id)}>
            <Copy className="mr-1.5 h-4 w-4" aria-hidden /> Duplicate
          </Button>
        }
      />
      <p className="flex items-center gap-2 rounded-lg bg-primary/[0.05] px-3 py-2 text-sm text-muted-foreground ring-1 ring-inset ring-primary/15">
        <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        This grid is managed by AgentFlow. Duplicate it to customize.
      </p>
      <SurfaceSection icon={Grid3x3} title="Rates (% of annual premium)" as="h3" bodyClassName="p-0 sm:p-0">
        <RateMatrix levels={data.grid.contractLevels} rows={rows} value={(ref, level) => rates.get(`${ref}:${level}`) ?? ""} readOnly framed={false} />
      </SurfaceSection>
      {data.references.length > 0 && (
        <SurfaceSection icon={FileText} title="Source notes (admins only)" count={data.references.length} as="h3">
          <dl className="space-y-2 text-xs">
            {data.references.map((reference) => (
              <div key={reference.variantId} className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
                <dt className="font-medium text-foreground">{labelOf.get(reference.variantId)}</dt>
                <dd className="whitespace-pre-line text-muted-foreground">{[reference.source, reference.notes].filter(Boolean).join(" — ")}</dd>
              </div>
            ))}
          </dl>
        </SurfaceSection>
      )}
    </div>
  );
};

export default GridViewer;
