import React, { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { useCommissionGridsData } from "@/hooks/useCommissionGridsAdmin";
import CalculatorGridCard from "./CalculatorGridCard";
import CreateGridDialog from "./CreateGridDialog";
import GridEditor from "./GridEditor";
import GridViewer from "./GridViewer";
import PrivateGridsCard from "./PrivateGridsCard";
import SharedGridsCard from "./SharedGridsCard";
import { errorMessage } from "./gridFormat";

type OpenGrid = { id: string; mode: "edit" | "view" } | null;

/**
 * Settings › Commission Grids — agency admins only, whether or not a calculator is configured yet.
 * Manages THIS agency only: AgentFlow grids (enable / disable / view / duplicate), the calculator grid,
 * and private grids (create / edit / delete). No agency list, no platform-admin surface.
 */
const CommissionGridsSettings: React.FC = () => {
  const { access, overview, catalog } = useCommissionGridsData();
  const [open, setOpen] = useState<OpenGrid>(null);
  const [creating, setCreating] = useState<{ sourceId: string | null } | null>(null);

  if (access.loading) {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
      </div>
    );
  }
  if (!access.enabled) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-center">
        <Lock className="h-9 w-9 text-muted-foreground" aria-hidden />
        <p className="max-w-sm text-sm text-muted-foreground">Only agency admins can manage commission grids.</p>
      </div>
    );
  }
  if (overview.isError || catalog.isError) {
    return <p role="alert" className="text-sm text-destructive">{errorMessage(overview.error ?? catalog.error)}</p>;
  }
  if (!overview.data || !catalog.data) {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading commission grids…
      </div>
    );
  }

  const calculatorGridId = overview.data.calculatorGridId;
  const createDialog = (
    <CreateGridDialog
      open={creating !== null}
      onOpenChange={(next) => !next && setCreating(null)}
      sources={catalog.data.filter((entry) => entry.isEnabled)}
      initialSourceId={creating?.sourceId ?? null}
      onCreated={(gridId) => setOpen({ id: gridId, mode: "edit" })}
    />
  );

  if (open?.mode === "edit") {
    return <GridEditor key={open.id} gridId={open.id} calculatorGridId={calculatorGridId} onClose={() => setOpen(null)} />;
  }
  if (open?.mode === "view") {
    return (
      <>
        <GridViewer gridId={open.id} onBack={() => setOpen(null)} onDuplicate={(sourceId) => setCreating({ sourceId })} />
        {createDialog}
      </>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Choose the grid your agents&apos; Commission Calculator uses, enable AgentFlow grids, and keep your agency&apos;s own grids.
        Estimates only: these grids never change payroll, booked commission or reports.
      </p>
      <CalculatorGridCard overview={overview.data} />
      <SharedGridsCard
        catalog={catalog.data}
        calculatorGridId={calculatorGridId}
        onView={(id) => setOpen({ id, mode: "view" })}
        onDuplicate={(sourceId) => setCreating({ sourceId })}
      />
      <PrivateGridsCard
        grids={overview.data.grids.filter((grid) => !grid.shared)}
        calculatorGridId={calculatorGridId}
        onCreate={() => setCreating({ sourceId: null })}
        onEdit={(id) => setOpen({ id, mode: "edit" })}
      />
      {createDialog}
    </div>
  );
};

export default CommissionGridsSettings;
