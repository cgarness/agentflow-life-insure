import React, { useCallback, useEffect, useState } from "react";
import { Plus, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/useOrganization";
import { workflowApi } from "@/lib/supabase-workflows";
import type { WorkflowRow as WorkflowRowType, WorkflowStatus } from "@/lib/workflow-types";
import WorkflowRow from "./WorkflowRow";
import NewWorkflowModal from "./NewWorkflowModal";

interface Props {
  onOpenWorkflow: (id: string) => void;
}

const WorkflowList: React.FC<Props> = ({ onOpenWorkflow }) => {
  const { organizationId } = useOrganization();
  const [workflows, setWorkflows] = useState<WorkflowRowType[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) { setLoading(false); return; }
    setLoading(true);
    try {
      const ws = await workflowApi.list(organizationId);
      setWorkflows(ws);
      const c = await workflowApi.executionCounts(organizationId, ws.map((w) => w.id));
      setCounts(c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load workflows";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { load(); }, [load]);

  const handleCycleStatus = async (id: string, next: WorkflowStatus) => {
    setWorkflows((prev) => prev.map((w) => (w.id === id ? { ...w, status: next } : w)));
    try {
      await workflowApi.setStatus(id, next);
      toast({ title: `Workflow ${next}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update status";
      toast({ title: msg, variant: "destructive" });
      load();
    }
  };

  return (
    <div className="space-y-6">
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

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-accent/40" />
          ))}
        </div>
      ) : workflows.length === 0 ? (
        <EmptyState onCreate={() => setShowModal(true)} />
      ) : (
        <div className="space-y-2">
          {workflows.map((w) => (
            <WorkflowRow
              key={w.id}
              workflow={w}
              executionCount={counts[w.id] ?? 0}
              onOpen={onOpenWorkflow}
              onCycleStatus={handleCycleStatus}
            />
          ))}
        </div>
      )}

      <NewWorkflowModal
        open={showModal}
        onOpenChange={setShowModal}
        onCreated={(id) => { load(); onOpenWorkflow(id); }}
      />
    </div>
  );
};

const EmptyState: React.FC<{ onCreate: () => void }> = ({ onCreate }) => (
  <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/60 bg-card/30 px-6 py-16 text-center">
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
      <Workflow className="h-7 w-7" />
    </div>
    <h4 className="text-base font-semibold text-foreground">Create your first automation</h4>
    <p className="max-w-sm text-sm text-muted-foreground">
      Workflows let you automate follow-ups, tag leads, send messages, and more — without writing code.
    </p>
    <Button onClick={onCreate} className="mt-2">
      <Plus className="mr-2 h-4 w-4" /> New Workflow
    </Button>
  </div>
);

export default WorkflowList;
