import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { WorkflowRow } from "@/lib/workflow-types";

interface Props {
  workflow: WorkflowRow | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string) => Promise<void>;
}

const DeleteWorkflowDialog: React.FC<Props> = ({ workflow, onOpenChange, onConfirm }) => {
  const [working, setWorking] = useState(false);

  const handleDelete = async () => {
    if (!workflow) return;
    setWorking(true);
    try {
      await onConfirm(workflow.id);
      onOpenChange(false);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to delete workflow", variant: "destructive" });
    } finally { setWorking(false); }
  };

  return (
    <Dialog open={!!workflow} onOpenChange={(v) => { if (!working) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{workflow?.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            This cannot be undone. All execution history will also be deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>Cancel</Button>
          <Button onClick={handleDelete} disabled={working} variant="destructive">
            {working ? "Deleting…" : "Delete workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteWorkflowDialog;
