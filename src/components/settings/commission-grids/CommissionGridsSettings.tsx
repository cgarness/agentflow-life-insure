import React, { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { useCommissionGridsAdminAccess, useCommissionGridsData } from "@/hooks/useCommissionGridsAdmin";
import CalculatorGridCard from "./CalculatorGridCard";
import CreateGridDialog from "./CreateGridDialog";
import GridEditor from "./GridEditor";
import GridViewer from "./GridViewer";
import LoadErrorNotice from "./LoadErrorNotice";
import PrivateGridsCard from "./PrivateGridsCard";
import SharedGridsCard from "./SharedGridsCard";
import { errorMessage } from "./gridFormat";

type OpenGrid = { id: string; mode: "edit" | "view" } | null;

/**
 * Settings › Commission Grids — agency admins only, whether or not a calculator is configured yet.
 * Manages THIS agency only: AgentFlow grids (enable / disable / view / duplicate), the calculator grid,
 * and private grids (create / edit / delete). No agency list, no platform-admin surface.
 * What is open here (an editor and its unsaved, in-memory draft) belongs to one user in one agency with
 * access: another user or agency, logout or lost access starts over from the list.
 */
const CommissionGridsSettings: React.FC = () => {
  const { userId, organizationId, enabled } = useCommissionGridsAdminAccess();
  return <CommissionGridsSection key={`${userId ?? "-"}:${organizationId ?? "-"}:${enabled}`} />;
};

const CommissionGridsSection: React.FC = () => {
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
  const retry = () => {
    if (overview.isError) void overview.refetch();
    if (catalog.isError) void catalog.refetch();
  };
  const retrying = overview.isFetching || catalog.isFetching;
  if (!overview.data || !catalog.data) {
    // Only a failed INITIAL load (nothing to show yet) replaces the page.
    const initialError = (!overview.data && overview.isError ? overview.error : null) ?? (!catalog.data && catalog.isError ? catalog.error : null);
    if (initialError) return <LoadErrorNotice message={errorMessage(initialError)} onRetry={retry} retrying={retrying} />;
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading commission grids…
      </div>
    );
  }
  // A failed BACKGROUND refresh keeps the last good data and any open editor (always the same element
  // position, so React keeps its unsaved draft), with a compact error and Retry.
  const refreshNotice = overview.isError || catalog.isError
    ? <LoadErrorNotice message="Couldn't refresh commission grids. Showing what was last loaded." onRetry={retry} retrying={retrying} />
    : null;

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
    return (
      <div className="space-y-4">
        {refreshNotice}
        <GridEditor key={open.id} gridId={open.id} calculatorGridId={calculatorGridId} onClose={() => setOpen(null)} />
      </div>
    );
  }
  if (open?.mode === "view") {
    return (
      <div className="space-y-4">
        {refreshNotice}
        <GridViewer gridId={open.id} onBack={() => setOpen(null)} onDuplicate={(sourceId) => setCreating({ sourceId })} />
        {createDialog}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {refreshNotice}
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
