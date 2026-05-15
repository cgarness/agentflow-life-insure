import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { MERGE_FIELDS } from "@/lib/workflow-types";
import type { PipelineStage } from "@/lib/types";

export interface Template { id: string; name: string; type: string | null; subject: string | null; content: string }
export interface AgentRow { id: string; first_name: string; last_name: string }

type Cfg = Record<string, unknown>;
type Setter = (patch: Cfg) => void;

export const Field: React.FC<React.PropsWithChildren<{ label: string; hint?: string }>> = ({ label, hint, children }) => (
  <div className="mb-4">
    <label className="mb-1.5 block text-sm font-medium text-foreground">{label}</label>
    {children}
    {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
  </div>
);

export const MergeFieldHint: React.FC = () => (
  <p className="mt-1 text-[11px] text-muted-foreground">
    Merge fields: {MERGE_FIELDS.join(" ")}
  </p>
);

const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => (
  <select
    {...props}
    className="h-9 w-full rounded-lg border-0 bg-accent px-3 text-sm text-foreground focus:ring-2 focus:ring-primary/50"
  />
);

export const SmsForm: React.FC<{ config: Cfg; set: Setter; templates: Template[] }> = ({ config, set, templates }) => (
  <>
    <Field label="Template (optional)">
      <Select
        value={(config.template_id as string) || ""}
        onChange={(e) => {
          const t = templates.find((x) => x.id === e.target.value);
          set({ template_id: e.target.value || null, body: t?.content ?? config.body ?? "" });
        }}
      >
        <option value="">Custom message</option>
        {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </Select>
    </Field>
    <Field label="Message *" hint="Up to 1600 characters">
      <Textarea rows={6} value={(config.body as string) || ""} onChange={(e) => set({ body: e.target.value })} maxLength={1600} />
    </Field>
    <MergeFieldHint />
  </>
);

export const EmailForm: React.FC<{ config: Cfg; set: Setter; templates: Template[] }> = ({ config, set, templates }) => (
  <>
    <Field label="Template (optional)">
      <Select
        value={(config.template_id as string) || ""}
        onChange={(e) => {
          const t = templates.find((x) => x.id === e.target.value);
          set({
            template_id: e.target.value || null,
            subject: t?.subject ?? config.subject ?? "",
            body: t?.content ?? config.body ?? "",
          });
        }}
      >
        <option value="">Custom message</option>
        {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </Select>
    </Field>
    <Field label="Subject *">
      <Input value={(config.subject as string) || ""} onChange={(e) => set({ subject: e.target.value })} maxLength={200} />
    </Field>
    <Field label="Body *">
      <Textarea rows={8} value={(config.body as string) || ""} onChange={(e) => set({ body: e.target.value })} maxLength={20000} />
    </Field>
    <MergeFieldHint />
  </>
);

export const StageForm: React.FC<{ config: Cfg; set: Setter; stages: PipelineStage[] }> = ({ config, set, stages }) => (
  <>
    <Field label="Pipeline">
      <Select
        value={(config.pipeline_type as string) || "lead"}
        onChange={(e) => set({ pipeline_type: e.target.value, stage_id: "" })}
      >
        <option value="lead">Lead Pipeline</option>
        <option value="recruit">Recruit Pipeline</option>
      </Select>
    </Field>
    <Field label="New stage *">
      <Select value={(config.stage_id as string) || ""} onChange={(e) => set({ stage_id: e.target.value })}>
        <option value="">Select stage…</option>
        {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
    </Field>
  </>
);

export const TagForm: React.FC<{ config: Cfg; set: Setter }> = ({ config, set }) => (
  <Field label="Tag name *">
    <Input value={(config.tag as string) || ""} onChange={(e) => set({ tag: e.target.value })} maxLength={50} />
  </Field>
);

export const AssignAgentForm: React.FC<{ config: Cfg; set: Setter; agents: AgentRow[] }> = ({ config, set, agents }) => {
  const rr = !!config.round_robin;
  return (
    <>
      <Field label="Round robin" hint="Cycle through all agents in the org instead of picking one.">
        <Switch checked={rr} onCheckedChange={(v) => set({ round_robin: v, agent_id: v ? null : config.agent_id })} />
      </Field>
      {!rr && (
        <Field label="Agent *">
          <Select value={(config.agent_id as string) || ""} onChange={(e) => set({ agent_id: e.target.value })}>
            <option value="">Select agent…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>
            ))}
          </Select>
        </Field>
      )}
    </>
  );
};

export const WebhookForm: React.FC<{ config: Cfg; set: Setter }> = ({ config, set }) => (
  <>
    <Field label="URL *">
      <Input value={(config.url as string) || ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/hook" />
    </Field>
    <Field label="Method">
      <Select value={(config.method as string) || "POST"} onChange={(e) => set({ method: e.target.value })}>
        <option value="POST">POST</option>
        <option value="PUT">PUT</option>
      </Select>
    </Field>
    <Field label="Headers (JSON, optional)">
      <Textarea rows={3} value={(config.headers as string) || ""} onChange={(e) => set({ headers: e.target.value })} placeholder={"{\n  \"X-Custom\": \"value\"\n}"} />
    </Field>
  </>
);
