import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useProjectStatusOverlay } from "@/hooks/useProjectStatusOverlay";
import { buildProjectStatusTree } from "@/config/projectStatusTree";
import { getProjectReferenceInventory } from "@/lib/project-status/inventory";
import InventorySearch from "@/components/project-status/InventorySearch";
import StatusFilterSelect from "@/components/project-status/StatusFilterSelect";
import UiSurfaceTabContent from "@/components/project-status/UiSurfaceTabContent";
import { tabMatchesFilters, type StatusFilterValue } from "@/lib/project-status/treeUtils";
import ProjectStatusTabNav, { type ProjectStatusTabId, type ProjectStatusTabItem } from "@/components/project-status/ProjectStatusTabNav";
import TechDebtSection from "@/components/project-status/TechDebtSection";
import WorkLogTimeline from "@/components/project-status/WorkLogTimeline";
import MigrationHistoryTable from "@/components/project-status/MigrationHistoryTable";
import EdgeFunctionsGrid from "@/components/project-status/EdgeFunctionsGrid";
import OverlayEditSheet, { type OverlayEditTarget } from "@/components/project-status/OverlayEditSheet";

const uiTree = buildProjectStatusTree();
const reference = getProjectReferenceInventory();

const ProjectStatus: React.FC = () => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [activeTabId, setActiveTabId] = useState<ProjectStatusTabId>(uiTree[0]?.id ?? "dashboard");
  const [editTarget, setEditTarget] = useState<OverlayEditTarget | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { overlayMap, loading, error, upsertOverlay, batchUpdateSortOrder } = useProjectStatusOverlay();

  const navTabs: ProjectStatusTabItem[] = useMemo(() => {
    const q = search.trim();
    const showReference = !q || /reference|work|log|migration|edge|tech|debt|function/i.test(q);
    const items: ProjectStatusTabItem[] = uiTree
      .filter((t) => tabMatchesFilters(t, overlayMap, search, statusFilter))
      .map((t) => ({ id: t.id, label: t.label }));
    if (showReference) items.push({ id: "reference", label: "Reference" });
    return items.length > 0 ? items : uiTree.map((t) => ({ id: t.id, label: t.label }));
  }, [search, statusFilter, overlayMap]);

  useEffect(() => {
    if (!navTabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(navTabs[0]?.id ?? uiTree[0]?.id ?? "dashboard");
    }
  }, [navTabs, activeTabId]);

  const activeSurfaceTab = useMemo(
    () => uiTree.find((t) => t.id === activeTabId),
    [activeTabId]
  );

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
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-start min-h-0">
        <ProjectStatusTabNav
          tabs={navTabs}
          activeId={activeTabId}
          onSelect={setActiveTabId}
        />

        <main className="flex-1 min-w-0 w-full lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <InventorySearch value={search} onChange={setSearch} />
            </div>
            {activeTabId !== "reference" && (
              <StatusFilterSelect value={statusFilter} onChange={setStatusFilter} />
            )}
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading notes…
            </div>
          )}
          {error && <p className="text-sm text-destructive">Overlay load failed: {error}</p>}

          {activeSurfaceTab && (
            <UiSurfaceTabContent
              tab={activeSurfaceTab}
              overlayMap={overlayMap}
              search={search}
              statusFilter={statusFilter}
              onEdit={openEdit}
            />
          )}

          {activeTabId === "reference" && (
            <div className="space-y-8">
              <div>
                <h2 className="text-lg font-semibold mb-2">Tech debt (AGENT_RULES)</h2>
                <TechDebtSection
                  items={reference.techDebtItems}
                  overlayMap={overlayMap}
                  search={search}
                  onEdit={openEdit}
                  onReorder={handleTechDebtReorder}
                />
              </div>
              <div>
                <h2 className="text-lg font-semibold mb-2">Recent work log</h2>
                <WorkLogTimeline entries={reference.workLog} search={search} />
              </div>
              <div>
                <h2 className="text-lg font-semibold mb-2">Migration history</h2>
                <MigrationHistoryTable rows={reference.migrations} search={search} />
              </div>
              <div>
                <h2 className="text-lg font-semibold mb-2">Edge functions</h2>
                <EdgeFunctionsGrid functions={reference.edgeFunctions} search={search} />
              </div>
            </div>
          )}
        </main>
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
