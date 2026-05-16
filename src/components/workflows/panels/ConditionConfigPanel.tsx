import React, { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { useOrganization } from "@/hooks/useOrganization";
import { pipelineSupabaseApi, leadSourcesSupabaseApi } from "@/lib/supabase-settings";
import { supabase } from "@/integrations/supabase/client";
import { conditionSchema, type WorkflowNodeRow } from "@/lib/workflow-types";
import type { PipelineStage, LeadSource } from "@/lib/types";
import PanelShell from "./PanelShell";

interface Props {
  node: WorkflowNodeRow;
  onClose: () => void;
  onSave: (patch: { config: Record<string, unknown>; label?: string | null }) => Promise<void>;
  onDelete?: () => void;
}

const FIELDS: { value: string; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "tag", label: "Tag" },
  { value: "state", label: "State" },
  { value: "pipeline_stage", label: "Pipeline Stage" },
  { value: "lead_source", label: "Lead Source" },
  { value: "assigned_agent", label: "Assigned Agent" },
  { value: "custom_field", label: "Custom Field" },
];

const OPS: { value: string; label: string; needsValue: boolean }[] = [
  { value: "is_empty", label: "is empty", needsValue: false },
  { value: "is_not_empty", label: "is not empty", needsValue: false },
  { value: "equals", label: "equals", needsValue: true },
  { value: "not_equals", label: "does not equal", needsValue: true },
  { value: "contains", label: "contains", needsValue: true },
  { value: "greater_than", label: "greater than", needsValue: true },
  { value: "less_than", label: "less than", needsValue: true },
];

const ConditionConfigPanel: React.FC<Props> = ({ node, onClose, onSave, onDelete }) => {
  const { organizationId } = useOrganization();
  const [config, setConfig] = useState<Record<string, unknown>>(node.config ?? {});
  const [saving, setSaving] = useState(false);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; first_name: string; last_name: string }>>([]);

  useEffect(() => { setConfig(node.config ?? {}); }, [node.id, node.config]);

  const field = (config.field as string) || "";
  const operator = (config.operator as string) || "";
  const opMeta = OPS.find((o) => o.value === operator);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (field === "pipeline_stage") {
          const list = await pipelineSupabaseApi.getLeadStages();
          if (alive) setStages(list);
        }
        if (field === "lead_source") {
          const list = await leadSourcesSupabaseApi.getAll();
          if (alive) setSources(list);
        }
        if (field === "assigned_agent" && organizationId) {
          const sb = supabase as any;
          const { data } = await sb
            .from("profiles").select("id,first_name,last_name")
            .eq("organization_id", organizationId).order("first_name", { ascending: true });
          if (alive) setAgents((data ?? []) as Array<{ id: string; first_name: string; last_name: string }>);
        }
      } catch {
        // soft-fail
      }
    })();
    return () => { alive = false; };
  }, [field, organizationId]);

  const set = (patch: Record<string, unknown>) => setConfig((c) => ({ ...c, ...patch }));

  const renderValueField = () => {
    if (!opMeta?.needsValue) return null;
    if (field === "pipeline_stage") {
      return (
        <SelectInput value={(config.value as string) || ""} onChange={(v) => set({ value: v })}>
          <option value="">Select stage…</option>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </SelectInput>
      );
    }
    if (field === "lead_source") {
      return (
        <SelectInput value={(config.value as string) || ""} onChange={(v) => set({ value: v })}>
          <option value="">Select source…</option>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </SelectInput>
      );
    }
    if (field === "assigned_agent") {
      return (
        <SelectInput value={(config.value as string) || ""} onChange={(v) => set({ value: v })}>
          <option value="">Select agent…</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>)}
        </SelectInput>
      );
    }
    return (
      <Input value={(config.value as string) || ""} onChange={(e) => set({ value: e.target.value })} />
    );
  };

  const handleSave = async () => {
    const r = conditionSchema.safeParse(config);
    if (!r.success) { toast({ title: r.error.issues[0].message, variant: "destructive" }); return; }
    setSaving(true);
    try {
      await onSave({ config, label: null });
      toast({ title: "Condition saved" });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast({ title: msg, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <PanelShell open title="Condition" subtitle="Branch the flow based on a contact field" onClose={onClose} onSave={handleSave} onDelete={onDelete} saving={saving}>
      <Field label="Field *">
        <SelectInput value={field} onChange={(v) => set({ field: v, value: "", operator: "" })}>
          <option value="">Select field…</option>
          {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </SelectInput>
      </Field>
      {field === "custom_field" && (
        <Field label="Custom field key *">
          <Input value={(config.custom_field_key as string) || ""} onChange={(e) => set({ custom_field_key: e.target.value })} />
        </Field>
      )}
      <Field label="Operator *">
        <SelectInput value={operator} onChange={(v) => set({ operator: v, value: "" })}>
          <option value="">Select operator…</option>
          {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </SelectInput>
      </Field>
      {opMeta?.needsValue && <Field label="Value *">{renderValueField()}</Field>}
    </PanelShell>
  );
};

const Field: React.FC<React.PropsWithChildren<{ label: string }>> = ({ label, children }) => (
  <div className="mb-4">
    <label className="mb-1.5 block text-sm font-medium text-foreground">{label}</label>
    {children}
  </div>
);

const SelectInput: React.FC<React.PropsWithChildren<{ value: string; onChange: (v: string) => void }>> = ({ value, onChange, children }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="h-9 w-full rounded-lg border-0 bg-accent px-3 text-sm text-foreground focus:ring-2 focus:ring-primary/50"
  >
    {children}
  </select>
);

export default ConditionConfigPanel;
