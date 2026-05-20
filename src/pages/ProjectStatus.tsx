import React, { useCallback, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useProjectStatusOverlay } from "@/hooks/useProjectStatusOverlay";
import { getProjectInventory } from "@/lib/project-status/inventory";
import LiveHealthStrip from "@/components/project-status/LiveHealthStrip";
import InventorySearch from "@/components/project-status/InventorySearch";
import ModuleHealthGrid from "@/components/project-status/ModuleHealthGrid";
import PagesFeaturesPanel from "@/components/project-status/PagesFeaturesPanel";
import SettingsInventory from "@/components/project-status/SettingsInventory";
import GapsPanel from "@/components/project-status/GapsPanel";
import TechDebtSection from "@/components/project-status/TechDebtSection";
import BuildQueueSection from "@/components/project-status/BuildQueueSection";
import WorkLogTimeline from "@/components/project-status/WorkLogTimeline";
import MigrationHistoryTable from "@/components/project-status/MigrationHistoryTable";
import EdgeFunctionsGrid from "@/components/project-status/EdgeFunctionsGrid";
import OverlayEditSheet, { type OverlayEditTarget } from "@/components/project-status/OverlayEditSheet";
import { SectionNav, SectionBlock, type SectionId } from "@/components/project-status/ProjectStatusSections";
import type { SortableRow } from "@/components/project-status/SortableOverlayList";

const inventory = getProjectInventory();

const ProjectStatus: React.FC = () => {
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState<SectionId>("health");
  const [editTarget, setEditTarget] = useState<OverlayEditTarget | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { overlayMap, loading, error, upsertOverlay, batchUpdateSortOrder } = useProjectStatusOverlay();

  const openEdit = useCallback((target: OverlayEditTarget) => {
    setEditTarget(target);
    setSheetOpen(true);
  }, []);

  const handleSave = useCallback(
    async (payload: { item_key: string; section: string; status: string | null; note: string | null }) => {
      try {
        await upsertOverlay(payload);
        toast.success("Overlay saved");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save");
      }
    },
    [upsertOverlay]
  );

  const makeReorderHandler = useCallback(
    (section: string) => async (ordered: SortableRow[]) => {
      try {
        await batchUpdateSortOrder(
          ordered.map((row, index) => ({
            item_key: row.itemKey,
            section,
            sort_order: index,
          }))
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to reorder");
      }
    },
    [batchUpdateSortOrder]
  );

  const overlayForEdit = useMemo(
    () => (editTarget ? overlayMap.get(editTarget.itemKey) : undefined),
    [editTarget, overlayMap]
  );

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Project Status</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Platform inventory from repo docs and code. Canonical records live in{" "}
          <code className="text-xs">VISION.md</code> and <code className="text-xs">WORK_LOG.md</code>;
          status and notes here are your working overlay.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200/90">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Edits on this page do not write back to markdown files. Update VISION / WORK_LOG in git for permanent records.
        </span>
      </div>

      <InventorySearch value={search} onChange={setSearch} />

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading overlays…
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive">
          Overlay load failed (migration may not be applied yet): {error}
        </p>
      )}

      <div className="flex gap-8">
        <SectionNav active={activeSection} onSelect={setActiveSection} />

        <div className="flex-1 min-w-0 space-y-2">
          <SectionBlock id="health" title="Live platform health">
            <LiveHealthStrip />
          </SectionBlock>

          <SectionBlock id="modules" title="Module health (VISION §8)">
            <ModuleHealthGrid
              modules={inventory.modules}
              overlayMap={overlayMap}
              search={search}
              onEdit={openEdit}
            />
          </SectionBlock>

          <SectionBlock id="build-queue" title="Build queue">
            <BuildQueueSection
              items={inventory.buildQueue}
              overlayMap={overlayMap}
              search={search}
              onEdit={openEdit}
              onReorder={makeReorderHandler("build_queue")}
            />
          </SectionBlock>

          <SectionBlock id="tech-debt" title="Tech debt (AGENT_RULES)">
            <TechDebtSection
              items={inventory.techDebtItems}
              overlayMap={overlayMap}
              search={search}
              onEdit={openEdit}
              onReorder={makeReorderHandler("tech_debt")}
            />
          </SectionBlock>

          <SectionBlock id="gaps" title="Feature gaps">
            <GapsPanel
              featureGaps={inventory.featureGaps}
              overlayMap={overlayMap}
              search={search}
              onEdit={openEdit}
              onReorder={makeReorderHandler("feature_gap")}
            />
          </SectionBlock>

          <SectionBlock id="pages" title="Pages & permission features">
            <PagesFeaturesPanel search={search} />
          </SectionBlock>

          <SectionBlock id="settings" title="Settings sections">
            <SettingsInventory search={search} />
          </SectionBlock>

          <SectionBlock id="work-log" title="Recent work log">
            <WorkLogTimeline entries={inventory.workLog} search={search} />
          </SectionBlock>

          <SectionBlock id="migrations" title="Migration history">
            <MigrationHistoryTable rows={inventory.migrations} search={search} />
          </SectionBlock>

          <SectionBlock id="edge-functions" title="Edge functions">
            <EdgeFunctionsGrid functions={inventory.edgeFunctions} search={search} />
          </SectionBlock>
        </div>
      </div>

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
