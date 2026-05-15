import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import { workflowApi, workflowNodeApi } from "@/lib/supabase-workflows";
import {
  newWorkflowSchema, triggerConfigSchemas, formatTriggerLabelSync, type TriggerType,
} from "@/lib/workflow-types";
import TriggerConfigForm from "./TriggerConfigForm";
import TriggerTypeSelector from "./TriggerTypeSelector";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (workflowId: string) => void;
}

const NewWorkflowModal: React.FC<Props> = ({ open, onOpenChange, onCreated }) => {
  const { organizationId } = useOrganization();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("manual");
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName(""); setDescription(""); setTriggerType("manual"); setTriggerConfig({});
  };

  const handleSave = async () => {
    if (!organizationId) {
      toast({ title: "No organization context", variant: "destructive" });
      return;
    }
    const baseParse = newWorkflowSchema.safeParse({
      name, description, trigger_type: triggerType, trigger_config: triggerConfig,
    });
    if (!baseParse.success) {
      toast({ title: baseParse.error.issues[0].message, variant: "destructive" });
      return;
    }
    const cfgParse = triggerConfigSchemas[triggerType].safeParse(triggerConfig);
    if (!cfgParse.success) {
      toast({ title: cfgParse.error.issues[0].message, variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const wf = await workflowApi.create({
        organization_id: organizationId,
        name: baseParse.data.name,
        description: baseParse.data.description || null,
        trigger_type: triggerType,
        trigger_config: cfgParse.data as Record<string, unknown>,
        created_by: user?.id ?? null,
      });

      const triggerCfg = { ...(cfgParse.data as Record<string, unknown>), trigger_type: triggerType };
      // Auto-create the trigger node so the canvas opens with a starting point.
      await workflowNodeApi.create({
        workflow_id: wf.id,
        organization_id: organizationId,
        type: "trigger",
        action_type: null,
        config: triggerCfg,
        label: formatTriggerLabelSync(triggerType, triggerCfg),
        position_x: 0,
        position_y: 0,
      });

      toast({ title: "Workflow created" });
      onCreated(wf.id);
      reset();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create workflow";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Workflow</DialogTitle>
          <DialogDescription>Choose a trigger and we'll set up a starting node for you.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 100))} maxLength={100} placeholder="e.g., Hot lead follow-up" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              maxLength={500}
              placeholder="What does this workflow do?"
              rows={2}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Trigger Type *</label>
            <TriggerTypeSelector
              value={triggerType}
              onChange={(t) => { setTriggerType(t); setTriggerConfig({}); }}
            />
          </div>
          <div className="rounded-lg border border-border/50 p-3">
            <TriggerConfigForm
              triggerType={triggerType}
              config={triggerConfig}
              onChange={setTriggerConfig}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Creating…" : "Create Workflow"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NewWorkflowModal;
