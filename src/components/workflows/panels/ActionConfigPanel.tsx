import React, { useEffect, useMemo, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;
import { useOrganization } from "@/hooks/useOrganization";
import { pipelineSupabaseApi } from "@/lib/supabase-settings";
import {
  ACTION_METAS, sendSmsSchema, sendEmailSchema, updateStageSchema,
  tagSchema, assignAgentSchema, webhookSchema,
  type ActionType, type WorkflowNodeRow,
} from "@/lib/workflow-types";
import type { PipelineStage } from "@/lib/types";
import PanelShell from "./PanelShell";
import {
  SmsForm, EmailForm, StageForm, TagForm, AssignAgentForm, WebhookForm,
  type Template, type AgentRow,
} from "./actionForms";

interface Props {
  node: WorkflowNodeRow;
  onClose: () => void;
  onSave: (patch: { config: Record<string, unknown>; label?: string | null }) => Promise<void>;
  onDelete?: () => void;
}

const SCHEMAS: Partial<Record<ActionType, { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: { message: string }[] } } }>> = {
  send_sms: sendSmsSchema,
  send_email: sendEmailSchema,
  update_stage: updateStageSchema,
  add_tag: tagSchema,
  remove_tag: tagSchema,
  assign_agent: assignAgentSchema,
  webhook: webhookSchema,
};

const ActionConfigPanel: React.FC<Props> = ({ node, onClose, onSave, onDelete }) => {
  const { organizationId } = useOrganization();
  const [config, setConfig] = useState<Record<string, unknown>>(node.config ?? {});
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const action = node.action_type as ActionType;
  const meta = useMemo(() => ACTION_METAS.find((a) => a.type === action), [action]);

  useEffect(() => { setConfig(node.config ?? {}); }, [node.id, node.config]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (action === "send_sms" || action === "send_email") {
          const { data } = await sb
            .from("message_templates").select("id,name,type,subject,content").order("name", { ascending: true });
          if (alive) setTemplates((data ?? []) as Template[]);
        }
        if (action === "assign_agent" && organizationId) {
          const { data } = await sb
            .from("profiles").select("id,first_name,last_name")
            .eq("organization_id", organizationId).order("first_name", { ascending: true });
          if (alive) setAgents((data ?? []) as AgentRow[]);
        }
        if (action === "update_stage") {
          const pType = ((node.config as { pipeline_type?: string })?.pipeline_type as "lead" | "recruit") || "lead";
          const list = pType === "recruit"
            ? await pipelineSupabaseApi.getRecruitStages()
            : await pipelineSupabaseApi.getLeadStages();
          if (alive) setStages(list);
        }
      } catch {
        // soft-fail
      }
    })();
    return () => { alive = false; };
  }, [action, organizationId, node.config, node.id]);

  const set = (patch: Record<string, unknown>) => setConfig((c) => ({ ...c, ...patch }));

  const handleSave = async () => {
    const schema = SCHEMAS[action];
    if (schema) {
      const r = schema.safeParse(config);
      if (!r.success) {
        toast({ title: r.error?.issues?.[0]?.message ?? "Invalid configuration", variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    try {
      await onSave({ config, label: meta?.label ?? node.label });
      toast({ title: "Action saved" });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast({ title: msg, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <PanelShell open title={meta?.label ?? "Action"} subtitle="Configure this step" onClose={onClose} onSave={handleSave} onDelete={onDelete} saving={saving}>
      {action === "send_sms" && (
        <SmsForm config={config} set={set} templates={templates.filter((t) => (t.type ?? "").toLowerCase().includes("sms"))} />
      )}
      {action === "send_email" && (
        <EmailForm config={config} set={set} templates={templates.filter((t) => (t.type ?? "").toLowerCase().includes("email"))} />
      )}
      {action === "update_stage" && <StageForm config={config} set={set} stages={stages} />}
      {(action === "add_tag" || action === "remove_tag") && <TagForm config={config} set={set} />}
      {action === "assign_agent" && <AssignAgentForm config={config} set={set} agents={agents} />}
      {action === "webhook" && <WebhookForm config={config} set={set} />}
    </PanelShell>
  );
};

export default ActionConfigPanel;
