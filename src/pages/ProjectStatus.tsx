import React, { useCallback, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useProjectStatusOverlay } from "@/hooks/useProjectStatusOverlay";
import { buildProjectStatusTree } from "@/config/projectStatusTree";
import { getProjectReferenceInventory } from "@/lib/project-status/inventory";
import LiveHealthStrip from "@/components/project-status/LiveHealthStrip";
import InventorySearch from "@/components/project-status/InventorySearch";
import UiSurfaceTree from "@/components/project-status/UiSurfaceTree";
import TechDebtSection from "@/components/project-status/TechDebtSection";
import WorkLogTimeline from "@/components/project-status/WorkLogTimeline";
import MigrationHistoryTable from "@/components/project-status/MigrationHistoryTable";
import EdgeFunctionsGrid from "@/components/project-status/EdgeFunctionsGrid";
import OverlayEditSheet, { type OverlayEditTarget } from "@/components/project-status/OverlayEditSheet";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

const uiTree = buildProjectStatusTree();
const reference = getProjectReferenceInventory();

const ProjectStatus: React.FC = () => {
  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState<OverlayEditTarget | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);

  const { overlayMap, loading, error, upsertOverlay, batchUpdateSortOrder } = useProjectStatusOverlay();

  const handleTechDebtReorder = useCallback(
    async (ordered: { itemKey: string }[]) => {
      try {
        await batchUpdateSortOrder(
          ordered.map((row, index) => ({
            item_key: row.itemKey,
            section: "tech_debt",
            sort_order: index,
          }))
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to reorder");
      }
    },
    [batchUpdateSortOrder]
  );

  const openEdit = useCallback((target: OverlayEditTarget) => {
    setEditTarget(target);
    setSheetOpen(true);
  }, []);

  const handleSave = useCallback(
    async (payload: { item_key: string; section: string; status: string | null; note: string | null }) => {
      try {
        await upsertOverlay(payload);
        toast.success("Saved");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save");
      }
    },
    [upsertOverlay]
  );

  const overlayForEdit = useMemo(
    () => (editTarget ? overlayMap.get(editTarget.itemKey) : undefined),
    [editTarget, overlayMap]
  );

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Project Status</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every main tab broken down into what&apos;s inside it, what&apos;s working, and the code behind it.
          Click the pencil on any row to set a status label and note.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200/90">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Status badges: <strong>LIVE</strong> = working in prod · <strong>NEEDS_WORK</strong> = partial or debt ·{" "}
          <strong>PLACEHOLDER</strong> = mock/coming soon · <strong>BROKEN</strong> = known broken ·{" "}
          <strong>NOT_STARTED</strong> = not built. Your overlay wins over the default inferred label.
        </span>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Platform pulse</h2>
        <LiveHealthStrip />
      </section>

      <InventorySearch value={search} onChange={setSearch} />

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading your notes…
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive">Overlay load failed: {error}</p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">App surfaces</h2>
        <p className="text-xs text-muted-foreground -mt-1">
          Expand each tab to see UI pieces, inferred health, files/hooks/RPCs, and your notes.
        </p>
        <UiSurfaceTree tree={uiTree} overlayMap={overlayMap} search={search} onEdit={openEdit} />
      </section>

      <Collapsible open={refOpen} onOpenChange={setRefOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground w-full py-2">
          <ChevronDown className={refOpen ? "w-4 h-4" : "w-4 h-4 -rotate-90"} />
          Platform reference (work log, migrations, edge functions, doc tech debt)
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-8 pt-4">
          <div>
            <h3 className="text-base font-semibold mb-2">Tech debt (AGENT_RULES)</h3>
            <TechDebtSection
              items={reference.techDebtItems}
              overlayMap={overlayMap}
              search={search}
              onEdit={openEdit}
              onReorder={handleTechDebtReorder}
            />
          </div>
          <div>
            <h3 className="text-base font-semibold mb-2">Recent work log</h3>
            <WorkLogTimeline entries={reference.workLog} search={search} />
          </div>
          <div>
            <h3 className="text-base font-semibold mb-2">Migration history</h3>
            <MigrationHistoryTable rows={reference.migrations} search={search} />
          </div>
          <div>
            <h3 className="text-base font-semibold mb-2">Edge functions</h3>
            <EdgeFunctionsGrid functions={reference.edgeFunctions} search={search} />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <OverlayEditSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        target={editTarget}
        overlay={overlayForEdit}
        onSave={handleSave}
      />
    </div>
  );
};

export default ProjectStatus;
