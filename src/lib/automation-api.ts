import { useQuery } from "@tanstack/react-query";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import type { AutomationGraph } from "../../supabase/functions/_shared/automations/graph";
import { readReleaseControls, type ReleaseControls } from "./automation-release";
import type { WorkflowStatus } from "./workflow-types";

type AutomationRpc = Extract<keyof Database["public"]["Functions"], `automation_${string}` | "publish_automation" | "save_automation_draft" | "validate_automation_draft">;
async function rpc<T>(name: AutomationRpc, args: Record<string, unknown> = {}): Promise<T> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.rpc(name, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface Summary {
  id: string;
  name: string;
  status: WorkflowStatus;
  trigger_type: string | null;
  folder_id: string | null;
  last_activity_at: string | null;
  is_legacy: boolean;
  release_controls: ReleaseControls;
}

export interface DraftRecord {
  id: string;
  name: string;
  automation_draft_name: string | null;
  status: WorkflowStatus;
  automation_graph: AutomationGraph | null;
  automation_revision: number;
  automation_version_id: string | null;
}

export interface Issue { node_id?: string; message: string }
export interface Option { id: string; name: string }
export interface DispositionOption { id: string; name: string; color: string }
export interface SavedMessage {
  id: string;
  name: string;
  type: "sms" | "email";
  subject: string | null;
  content: string;
  scope: "agency" | "personal";
  sms_purpose: "informational" | "marketing" | null;
}
/** Consent requirement the server will pin for an SMS step when this draft is published. */
export interface SmsRequirement {
  node_id: string;
  purpose: "informational" | "marketing";
  basis: "saved_message" | "custom" | "author";
}

export interface WorkflowSnapshot {
  id: string;
  status: WorkflowStatus;
  revision: number;
  trigger_type: string | null;
}
interface Access {
  visible: boolean;
  can_author: boolean;
  release_controls?: ReleaseControls;
  workflow?: WorkflowSnapshot;
}

export const automationApi = {
  async status(id: string) {
    const result = await rpc<Access | null>("automation_access", {p_workflow_id:id});
    const workflow = result?.workflow;
    if (!result?.can_author || !workflow || workflow.id !== id ||
      !["active","draft","paused","archived"].includes(workflow.status)) throw new Error("Workflow status unavailable.");
    return {...workflow, controls:readReleaseControls(result.release_controls)};
  },
  list: (offset: number, campaign: string | null) =>
    rpc<Summary[]>("automation_list", { p_offset: offset, p_campaign_id: campaign }),
  async load(id: string, organizationId: string): Promise<DraftRecord> {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.from("workflows")
      .select("id,name,status,automation_graph,automation_draft_name,automation_revision,automation_version_id")
      .eq("id", id).eq("organization_id", organizationId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Automation is unavailable.");
    return data as unknown as DraftRecord;
  },
  save: (id: string, name: string, graph: AutomationGraph, revision: number, session: number) =>
    rpc<{id: string; revision: number}>("save_automation_draft", {
      p_workflow_id: id, p_name: name, p_graph: graph, p_expected_revision: revision, p_session_revision: session,
    }),
  validate: (id: string) => rpc<Issue[]>("validate_automation_draft", { p_workflow_id: id }),
  overlap: (id: string) => rpc<Option[]>("automation_overlap", { p_workflow_id: id }),
  publish: (id: string, revision: number, session: number, expected: ReleaseControls) =>
    rpc<WorkflowSnapshot & {version_id: string; release_controls?: ReleaseControls}>("publish_automation", {
      p_workflow_id: id, p_expected_revision: revision, p_session_revision: session, p_expected_controls:expected,
    }),
  lifecycle: (id: string, op: "pause" | "resume" | "archive", session: number) =>
    rpc("automation_lifecycle", { p_workflow_id: id, p_operation: op, p_session_revision: session }),
  campaigns: (after: string, selected?: string) =>
    rpc<{items: Option[]; selected: Option | null; next_cursor: string | null}>("automation_campaign_options",
      {p_after: after, p_selected: selected || null}),
  sources: (after: string) => rpc<{name: string}[]>("automation_sources", {p_after: after}),
  dispositions: () => rpc<DispositionOption[]>("automation_disposition_options"),
  savedMessages: (type: "sms" | "email", search: string, offset: number) =>
    rpc<{items: SavedMessage[]; more: boolean}>("automation_saved_messages", {p_type: type, p_search: search, p_offset: offset}),
  smsRequirements: (id: string) => rpc<SmsRequirement[]>("automation_sms_requirements", {p_workflow_id: id}),
  folder: (op: string, id: string | null, values: Record<string, unknown>, session: number) =>
    rpc("automation_folder", { p_operation: op, p_folder_id: id, p_values: values, p_session_revision: session }),
};

export function useAutomationAccess() {
  const { user, profile, automationSessionRevision, isImpersonating } = useAuth();
  return useQuery({
    queryKey: ["automation-access", user?.id, profile?.id, profile?.organization_id, automationSessionRevision, isImpersonating],
    queryFn: () => rpc<Access>("automation_access"),
    enabled: Boolean(user && profile?.organization_id && automationSessionRevision != null),
    retry: false,
  });
}
