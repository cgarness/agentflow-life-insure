import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/useOrganization";
import { workflowApi } from "@/lib/supabase-workflows";
import { workflowFolderApi } from "@/lib/supabase-workflow-folders";
import type {
  WorkflowRow as WorkflowRowType, WorkflowStatus, WorkflowFolderRow,
} from "@/lib/workflow-types";
import WorkflowRow from "./WorkflowRow";
import NewWorkflowModal from "./NewWorkflowModal";
import WorkflowFolderTabs, { ALL_TAB, UNFILED_TAB } from "./WorkflowFolderTabs";
import DeleteWorkflowDialog from "./DeleteWorkflowDialog";

interface Props {
  onOpenWorkflow: (id: string) => void;
}

const WorkflowList: React.FC<Props> = ({ onOpenWorkflow }) => {
  const { organizationId } = useOrganization();
  const [workflows, setWorkflows] = useState<WorkflowRowType[]>([]);
  const [folders, setFolders] = useState<WorkflowFolderRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState<string>(ALL_TAB);
  const [toDelete, setToDelete] = useState<WorkflowRowType | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [ws, fs] = await Promise.all([
        workflowApi.list(organizationId),
        workflowFolderApi.list(organizationId),
      ]);
      setWorkflows(ws);
      setFolders(fs);
      const c = await workflowApi.executionCounts(organizationId, ws.map((w) => w.id));
      setCounts(c);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to load workflows", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { load(); }, [load]);

  const visibleWorkflows = useMemo(() => {
    if (activeFolderId === ALL_TAB) return workflows;
    if (activeFolderId === UNFILED_TAB) return workflows.filter((w) => !w.folder_id);
    return workflows.filter((w) => w.folder_id === activeFolderId);
  }, [workflows, activeFolderId]);

  const handleCycleStatus = async (id: string, next: WorkflowStatus) => {
    setWorkflows((prev) => prev.map((w) => (w.id === id ? { ...w, status: next } : w)));
    try {
      await workflowApi.setStatus(id, next);
      toast({ title: `Workflow ${next}` });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to update status", variant: "destructive" });
      load();
    }
  };

  const handleMoveToFolder = async (id: string, folderId: string | null) => {
    setWorkflows((prev) => prev.map((w) => (w.id === id ? { ...w, folder_id: folderId } : w)));
    try {
      await workflowApi.setFolder(id, folderId);
      const dest = folderId ? folders.find((f) => f.id === folderId)?.name ?? "folder" : "Unfiled";
      toast({ title: `Moved to ${dest}` });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to move workflow", variant: "destructive" });
      load();
    }
  };

  const handleDelete = async (id: string) => {
    await workflowApi.delete(id);
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
    toast({ title: "Workflow deleted" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Workflow Builder</h3>
          <p className="text-sm text-muted-foreground">
            Visual automations triggered by lead activity, dispositions, and more.
          </p>
        </div>
        <Button onClick={() => setShowModal(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Workflow
        </Button>
      </div>

      {organizationId && (
        <WorkflowFolderTabs
          folders={folders}
          workflows={workflows}
          organizationId={organizationId}
          activeFolderId={activeFolderId}
          onActiveChange={setActiveFolderId}
          onFoldersChanged={load}
        />
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-accent/40" />
          ))}
        </div>
      ) : visibleWorkflows.length === 0 ? (
        <EmptyState onCreate={() => setShowModal(true)} hasWorkflows={workflows.length > 0} />
      ) : (
        <div className="space-y-2">
          {visibleWorkflows.map((w) => (
            <WorkflowRow
              key={w.id}
              workflow={w}
              folders={folders}
              executionCount={counts[w.id] ?? 0}
              onOpen={onOpenWorkflow}
              onCycleStatus={handleCycleStatus}
              onMoveToFolder={handleMoveToFolder}
              onDelete={setToDelete}
            />
          ))}
        </div>
      )}

      <NewWorkflowModal
        open={showModal}
        onOpenChange={setShowModal}
        onCreated={(id) => { load(); onOpenWorkflow(id); }}
      />
      <DeleteWorkflowDialog
        workflow={toDelete}
        onOpenChange={(open) => { if (!open) setToDelete(null); }}
        onConfirm={handleDelete}
      />
    </div>
  );
};

const EmptyState: React.FC<{ onCreate: () => void; hasWorkflows: boolean }> = ({ onCreate, hasWorkflows }) => (
  <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/60 bg-card/30 px-6 py-16 text-center">
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
      <Workflow className="h-7 w-7" />
    </div>
    <h4 className="text-base font-semibold text-foreground">
      {hasWorkflows ? "No workflows in this folder" : "Create your first automation"}
    </h4>
    <p className="max-w-sm text-sm text-muted-foreground">
      {hasWorkflows
        ? "Move workflows here from the All tab — or create a new one."
        : "Workflows let you automate follow-ups, tag leads, send messages, and more — without writing code."}
    </p>
    <Button onClick={onCreate} className="mt-2">
      <Plus className="mr-2 h-4 w-4" /> New Workflow
    </Button>
  </div>
);

export default WorkflowList;
