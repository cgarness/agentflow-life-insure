import React, { useEffect, useState } from "react";
import { ArrowLeft, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { workflowApi } from "@/lib/supabase-workflows";
import { STATUS_BADGE, type WorkflowRow, type WorkflowStatus } from "@/lib/workflow-types";

interface Props {
  workflow: WorkflowRow;
  onBack: () => void;
  onShowExecutionLog: () => void;
  onUpdated: (updated: WorkflowRow) => void;
}

function nextStatus(current: WorkflowStatus): WorkflowStatus {
  switch (current) {
    case "draft": return "active";
    case "active": return "paused";
    case "paused": return "active";
    case "archived": return "draft";
  }
}

const WorkflowToolbar: React.FC<Props> = ({ workflow, onBack, onShowExecutionLog, onUpdated }) => {
  const [name, setName] = useState(workflow.name);

  useEffect(() => { setName(workflow.name); }, [workflow.id, workflow.name]);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === workflow.name) {
      setName(workflow.name);
      return;
    }
    try {
      await workflowApi.update(workflow.id, { name: trimmed });
      onUpdated({ ...workflow, name: trimmed });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to rename";
      toast({ title: msg, variant: "destructive" });
      setName(workflow.name);
    }
  };

  const cycle = async () => {
    const ns = nextStatus(workflow.status);
    try {
      await workflowApi.setStatus(workflow.id, ns);
      onUpdated({ ...workflow, status: ns });
      toast({ title: `Workflow ${ns}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to update status";
      toast({ title: msg, variant: "destructive" });
    }
  };

  const badge = STATUS_BADGE[workflow.status];

  return (
    <div className="flex items-center gap-3 border-b border-border/50 bg-card/40 px-4 py-2 backdrop-blur-sm">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Workflows
      </button>

      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 100))}
        onBlur={saveName}
        onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
        className="flex-1 min-w-0 rounded-lg bg-transparent px-2 py-1 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-accent/30 focus:bg-accent/40"
      />

      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${badge.className}`}>
        {badge.label}
      </span>
      <Button size="sm" variant="outline" onClick={cycle}>
        {workflow.status === "active" ? "Pause" : workflow.status === "paused" ? "Resume" : workflow.status === "archived" ? "Restore" : "Activate"}
      </Button>

      <Button size="sm" variant="outline" onClick={onShowExecutionLog}>
        <History className="mr-1.5 h-4 w-4" /> Execution Log
      </Button>
    </div>
  );
};

export default WorkflowToolbar;
