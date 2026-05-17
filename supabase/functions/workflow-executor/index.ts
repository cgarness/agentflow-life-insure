// workflow-executor
// ---------------------------------------------------------------------------
// Internal-only Edge Function. Drives a single workflow_executions row from
// its current_node_id forward, step by step, until the chain ends, a wait
// node pauses it, or an action fails.
//
// Auth: X-Workflow-Secret matches WORKFLOW_INTERNAL_SECRET env. No user JWT.
//
// Payload: { execution_id: uuid }
//
// Per-node behavior:
//   action  → execute side-effect, log step, advance to outgoing edge target
//   condition → evaluate operator, follow the matching 'yes'/'no' edge
//   wait    → record resume_at on the step, set execution status='paused'
//
// On any action failure: step.status='failed', execution.status='failed',
// execution.error_message set; execution stops. The function never throws to
// the caller — failures live in the audit log.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkWorkflowSecret, corsHeaders, jsonResponse } from "../_shared/workflowAuth.ts";
import { loadSubaccountCreds } from "../_shared/twilioSubaccountCreds.ts";
import { renderMergeFields } from "../_shared/workflowMergeFields.ts";

const FN = "[workflow-executor]";
const MAX_STEPS_PER_INVOCATION = 50; // hard guard against accidental loops

type ExecutionRow = {
  id: string;
  workflow_id: string;
  organization_id: string;
  contact_id: string;
  contact_type: "lead" | "client" | "recruit";
  status: string;
  current_node_id: string | null;
};

type NodeRow = {
  id: string;
  workflow_id: string;
  organization_id: string;
  type: "trigger" | "condition" | "action" | "wait";
  action_type: string | null;
  config: Record<string, unknown>;
  label: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  const auth = checkWorkflowSecret(req);
  if (!auth.ok) return jsonResponse({ success: false, error: auth.error }, auth.status);

  let body: { execution_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }
  const executionId = (body.execution_id ?? "").trim();
  if (!executionId) {
    return jsonResponse({ success: false, error: "execution_id required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ success: false, error: "Server misconfigured" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: execution, error: execErr } = await supabase
    .from("workflow_executions")
    .select("id, workflow_id, organization_id, contact_id, contact_type, status, current_node_id")
    .eq("id", executionId)
    .maybeSingle<ExecutionRow>();

  if (execErr || !execution) {
    return jsonResponse({ success: false, error: execErr?.message ?? "Execution not found" }, 404);
  }

  if (execution.status !== "running" && execution.status !== "paused") {
    return jsonResponse({ success: true, message: `Execution is ${execution.status}; nothing to do.` });
  }
  if (!execution.current_node_id) {
    await completeExecution(supabase, execution.id);
    return jsonResponse({ success: true, message: "No current node; execution marked complete." });
  }

  let currentNodeId: string | null = execution.current_node_id;
  let stepsRun = 0;

  while (currentNodeId && stepsRun < MAX_STEPS_PER_INVOCATION) {
    stepsRun += 1;

    const node = await loadNode(supabase, currentNodeId);
    if (!node) {
      await failExecution(supabase, execution.id, `Node ${currentNodeId} not found.`);
      return jsonResponse({ success: false, error: "Node not found" }, 500);
    }

    // Process the node and discover the next node id (or null to stop).
    let nextNodeId: string | null = null;
    let processingError: string | null = null;
    let paused = false;

    if (node.type === "wait") {
      // Wait nodes: record step as pending, set execution to paused, exit.
      const durationMinutes = Math.max(1, Number(node.config?.duration_minutes ?? 0) || 0);
      const resumeAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();
      await insertStep(supabase, {
        execution_id: execution.id,
        organization_id: execution.organization_id,
        node_id: node.id,
        status: "pending",
        input_data: { duration_minutes: durationMinutes },
        output_data: { resume_at: resumeAt },
        started_at: new Date().toISOString(),
      });
      await supabase
        .from("workflow_executions")
        .update({ status: "paused", current_node_id: node.id })
        .eq("id", execution.id);
      paused = true;
    } else if (node.type === "condition") {
      const stepId = await insertStep(supabase, {
        execution_id: execution.id,
        organization_id: execution.organization_id,
        node_id: node.id,
        status: "running",
        started_at: new Date().toISOString(),
      });

      const contact = await loadContact(supabase, execution.contact_type, execution.contact_id);
      const evalResult = evaluateCondition(node.config, contact);

      await supabase
        .from("workflow_execution_steps")
        .update({
          status: "completed",
          output_data: evalResult,
          completed_at: new Date().toISOString(),
        })
        .eq("id", stepId);

      // Follow the matching branch
      nextNodeId = await edgeTarget(supabase, node, evalResult.result ? "yes" : "no");
    } else if (node.type === "action") {
      const stepId = await insertStep(supabase, {
        execution_id: execution.id,
        organization_id: execution.organization_id,
        node_id: node.id,
        status: "running",
        input_data: { action_type: node.action_type, config: node.config },
        started_at: new Date().toISOString(),
      });

      const contact = await loadContact(supabase, execution.contact_type, execution.contact_id);
      const actionResult = await executeAction({
        supabase,
        execution,
        node,
        contact,
      });

      await supabase
        .from("workflow_execution_steps")
        .update({
          status: actionResult.status,
          output_data: actionResult.output,
          completed_at: new Date().toISOString(),
        })
        .eq("id", stepId);

      if (actionResult.status === "failed") {
        processingError = actionResult.error ?? "Action failed";
      } else {
        nextNodeId = await edgeTarget(supabase, node, null);
      }
    } else {
      // Trigger nodes shouldn't appear here, but if so, just advance.
      nextNodeId = await edgeTarget(supabase, node, null);
    }

    if (paused) {
      return jsonResponse({ success: true, paused: true, node_id: node.id });
    }

    if (processingError) {
      await failExecution(supabase, execution.id, processingError);
      return jsonResponse({ success: false, failed: true, error: processingError });
    }

    if (nextNodeId) {
      await supabase
        .from("workflow_executions")
        .update({ current_node_id: nextNodeId })
        .eq("id", execution.id);
      currentNodeId = nextNodeId;
    } else {
      await completeExecution(supabase, execution.id);
      currentNodeId = null;
    }
  }

  if (stepsRun >= MAX_STEPS_PER_INVOCATION && currentNodeId) {
    // Safety: don't run forever in one invocation. Mark failed.
    await failExecution(
      supabase,
      execution.id,
      `Execution exceeded ${MAX_STEPS_PER_INVOCATION} steps in a single invocation.`,
    );
    return jsonResponse({ success: false, error: "Step cap reached" });
  }

  return jsonResponse({ success: true, completed: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadNode(supabase: SupabaseClient, nodeId: string): Promise<NodeRow | null> {
  const { data, error } = await supabase
    .from("workflow_nodes")
    .select("id, workflow_id, organization_id, type, action_type, config, label")
    .eq("id", nodeId)
    .maybeSingle<NodeRow>();
  if (error) {
    console.error(`${FN} loadNode error:`, error.message);
    return null;
  }
  return data;
}

async function edgeTarget(
  supabase: SupabaseClient,
  node: NodeRow,
  branch: "yes" | "no" | null,
): Promise<string | null> {
  let q = supabase
    .from("workflow_edges")
    .select("target_node_id, condition_branch")
    .eq("workflow_id", node.workflow_id)
    .eq("source_node_id", node.id);
  if (branch === null) {
    q = q.is("condition_branch", null);
  } else {
    q = q.eq("condition_branch", branch);
  }
  const { data, error } = await q.limit(1).maybeSingle<{ target_node_id: string }>();
  if (error) {
    console.error(`${FN} edgeTarget error:`, error.message);
    return null;
  }
  return data?.target_node_id ?? null;
}

type StepInsert = {
  execution_id: string;
  organization_id: string;
  node_id: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  input_data?: Record<string, unknown>;
  output_data?: Record<string, unknown>;
  started_at?: string;
};

async function insertStep(supabase: SupabaseClient, row: StepInsert): Promise<string> {
  const { data, error } = await supabase
    .from("workflow_execution_steps")
    .insert(row)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error || !data?.id) {
    console.error(`${FN} insertStep error:`, error?.message);
    return "";
  }
  return data.id;
}

async function completeExecution(supabase: SupabaseClient, executionId: string): Promise<void> {
  await supabase
    .from("workflow_executions")
    .update({
      status: "completed",
      current_node_id: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", executionId);
}

async function failExecution(
  supabase: SupabaseClient,
  executionId: string,
  errorMessage: string,
): Promise<void> {
  await supabase
    .from("workflow_executions")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
    })
    .eq("id", executionId);
}

async function loadContact(
  supabase: SupabaseClient,
  contactType: "lead" | "client" | "recruit",
  contactId: string,
): Promise<Record<string, unknown> | null> {
  const table = contactType === "lead" ? "leads" : contactType === "client" ? "clients" : "recruits";
  const { data, error } = await supabase.from(table).select("*").eq("id", contactId).maybeSingle();
  if (error) {
    console.error(`${FN} loadContact error:`, error.message);
    return null;
  }
  return (data ?? null) as Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------
type ConditionResult = {
  result: boolean;
  field: string;
  operator: string;
  evaluated_value: unknown;
  expected: unknown;
};

function evaluateCondition(
  config: Record<string, unknown>,
  contact: Record<string, unknown> | null,
): ConditionResult {
  const field = String((config?.field as string) ?? "");
  const operator = String((config?.operator as string) ?? "");
  const expected = config?.value ?? null;

  let evaluated: unknown = null;
  if (field === "tag") {
    const tags = Array.isArray(contact?.tags) ? (contact!.tags as unknown[]) : [];
    evaluated = tags;
  } else if (contact && field in contact) {
    evaluated = contact[field];
  }

  let result = false;
  switch (operator) {
    case "is_empty":
      result = evaluated === null || evaluated === undefined || evaluated === "" ||
        (Array.isArray(evaluated) && evaluated.length === 0);
      break;
    case "is_not_empty":
      result = !(evaluated === null || evaluated === undefined || evaluated === "" ||
        (Array.isArray(evaluated) && evaluated.length === 0));
      break;
    case "equals":
      result = String(evaluated ?? "") === String(expected ?? "");
      break;
    case "not_equals":
      result = String(evaluated ?? "") !== String(expected ?? "");
      break;
    case "contains":
      if (Array.isArray(evaluated)) {
        result = evaluated.map((v) => String(v)).includes(String(expected ?? ""));
      } else {
        result = String(evaluated ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
      }
      break;
    case "greater_than":
      result = Number(evaluated) > Number(expected);
      break;
    case "less_than":
      result = Number(evaluated) < Number(expected);
      break;
    default:
      result = false;
  }

  return { result, field, operator, evaluated_value: evaluated, expected };
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------
type ActionOutcome = {
  status: "completed" | "failed" | "skipped";
  output: Record<string, unknown>;
  error?: string;
};

async function executeAction(args: {
  supabase: SupabaseClient;
  execution: ExecutionRow;
  node: NodeRow;
  contact: Record<string, unknown> | null;
}): Promise<ActionOutcome> {
  const { supabase, execution, node, contact } = args;
  const cfg = (node.config ?? {}) as Record<string, unknown>;

  try {
    switch (node.action_type) {
      case "send_sms":
        return await actionSendSms({ supabase, execution, cfg, contact });
      case "send_email":
        return await actionSendEmail({ supabase, execution, cfg, contact });
      case "update_stage":
        return await actionUpdateStage({ supabase, execution, cfg });
      case "add_tag":
        return await actionTagMutation({ supabase, execution, cfg, mode: "add" });
      case "remove_tag":
        return await actionTagMutation({ supabase, execution, cfg, mode: "remove" });
      case "assign_agent":
        return await actionAssignAgent({ supabase, execution, cfg });
      case "webhook":
        return await actionWebhook({ cfg, contact });
      case "create_task":
        return await actionCreateTask({ supabase, execution, cfg, contact });
      case "assign_ai_agent":
        return {
          status: "skipped",
          output: { reason: "AI agents not yet available" },
        };
      default:
        return {
          status: "failed",
          output: { reason: `Unknown action_type: ${node.action_type}` },
          error: `Unknown action_type: ${node.action_type}`,
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${FN} action ${node.action_type} threw:`, msg);
    return { status: "failed", output: { error: msg }, error: msg };
  }
}

// --- SMS -------------------------------------------------------------------
async function actionSendSms(args: {
  supabase: SupabaseClient;
  execution: ExecutionRow;
  cfg: Record<string, unknown>;
  contact: Record<string, unknown> | null;
}): Promise<ActionOutcome> {
  const { supabase, execution, cfg, contact } = args;

  const phone = (contact?.phone ?? contact?.phone_number ?? contact?.contact_phone ?? "") as string;
  if (!phone) {
    return { status: "failed", output: { reason: "Contact has no phone" }, error: "Contact has no phone" };
  }

  const bodyOverride = typeof cfg.body_override === "string" ? cfg.body_override : "";
  const templateId = typeof cfg.template_id === "string" ? cfg.template_id : "";
  let body = bodyOverride;
  if (!body && templateId) {
    const { data: tpl } = await supabase
      .from("message_templates")
      .select("content")
      .eq("id", templateId)
      .maybeSingle();
    body = (tpl?.content as string) ?? "";
  }
  body = renderMergeFields(body, contact);
  if (!body) {
    return { status: "failed", output: { reason: "Empty SMS body" }, error: "Empty SMS body" };
  }

  // Choose a sender number — first active number on the org.
  const { data: phoneRow } = await supabase
    .from("phone_numbers")
    .select("phone_number")
    .eq("organization_id", execution.organization_id)
    .in("status", ["active", "Active"])
    .limit(1)
    .maybeSingle();
  const from = (phoneRow?.phone_number as string) ?? "";
  if (!from) {
    return { status: "failed", output: { reason: "No active phone number for org" }, error: "No active sender" };
  }

  const creds = await loadSubaccountCreds(supabase, execution.organization_id);
  if (!creds.ok) {
    return { status: "failed", output: { reason: creds.error, code: creds.code }, error: creds.error };
  }

  const to = toE164(phone);
  const params = new URLSearchParams();
  params.set("To", to);
  params.set("From", toE164(from));
  params.set("Body", body);

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.creds.accountSid)}/Messages.json`;
  const res = await fetch(twilioUrl, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${creds.creds.accountSid}:${creds.creds.authToken}`),
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: params.toString(),
  });
  const payload = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string };

  if (!res.ok) {
    return {
      status: "failed",
      output: { twilio: payload, http_status: res.status },
      error: payload.message ?? `Twilio ${res.status}`,
    };
  }

  // Persist message row.
  await supabase.from("messages").insert({
    organization_id: execution.organization_id,
    direction: "outbound",
    body,
    from_number: toE164(from),
    to_number: to,
    status: payload.status ?? "queued",
    provider_message_id: payload.sid ?? null,
    lead_id: execution.contact_type === "lead" ? execution.contact_id : null,
    sent_at: new Date().toISOString(),
  });

  return { status: "completed", output: { sid: payload.sid, status: payload.status } };
}

// --- Email -----------------------------------------------------------------
async function actionSendEmail(args: {
  supabase: SupabaseClient;
  execution: ExecutionRow;
  cfg: Record<string, unknown>;
  contact: Record<string, unknown> | null;
}): Promise<ActionOutcome> {
  const { supabase, execution, cfg, contact } = args;
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!resendKey) {
    return { status: "failed", output: { reason: "RESEND_API_KEY not set" }, error: "Email not configured" };
  }

  const to = (contact?.email ?? "") as string;
  if (!to) {
    return { status: "failed", output: { reason: "Contact has no email" }, error: "Contact has no email" };
  }

  const templateId = typeof cfg.template_id === "string" ? cfg.template_id : "";
  const subjectOverride = typeof cfg.subject_override === "string" ? cfg.subject_override : "";
  const bodyOverride = typeof cfg.body_override === "string" ? cfg.body_override : "";

  let subject = subjectOverride;
  let body = bodyOverride;
  if (templateId && (!subject || !body)) {
    const { data: tpl } = await supabase
      .from("message_templates")
      .select("subject, content")
      .eq("id", templateId)
      .maybeSingle();
    if (!subject) subject = (tpl?.subject as string) ?? "";
    if (!body) body = (tpl?.content as string) ?? "";
  }
  subject = renderMergeFields(subject || "(no subject)", contact);
  body = renderMergeFields(body, contact);

  if (!body) {
    return { status: "failed", output: { reason: "Empty email body" }, error: "Empty email body" };
  }

  const fromAddress = Deno.env.get("WORKFLOW_EMAIL_FROM") || "AgentFlow <noreply@fflagent.com>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [to],
      subject,
      html: body,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) {
    return {
      status: "failed",
      output: { resend: payload, http_status: res.status },
      error: payload.message ?? `Resend ${res.status}`,
    };
  }

  // Persist contact_emails row (best-effort).
  await supabase.from("contact_emails").insert({
    organization_id: execution.organization_id,
    contact_id: execution.contact_id,
    owner_user_id: null,
    provider: "resend",
    direction: "outbound",
    external_message_id: payload.id ?? `workflow-${Date.now()}`,
    from_email: fromAddress,
    to_emails: [to],
    subject,
    snippet: body.slice(0, 200),
  }).then(({ error }) => {
    if (error) console.error(`${FN} contact_emails insert (non-fatal):`, error.message);
  });

  return { status: "completed", output: { resend_id: payload.id } };
}

// --- Stage update ----------------------------------------------------------
async function actionUpdateStage(args: {
  supabase: SupabaseClient;
  execution: ExecutionRow;
  cfg: Record<string, unknown>;
}): Promise<ActionOutcome> {
  const { supabase, execution, cfg } = args;
  const stageId = typeof cfg.stage_id === "string" ? cfg.stage_id : "";
  if (!stageId) {
    return { status: "failed", output: { reason: "Missing stage_id in config" }, error: "Missing stage_id" };
  }
  const table = tableFor(execution.contact_type);
  const { error } = await supabase
    .from(table)
    .update({ pipeline_stage_id: stageId })
    .eq("id", execution.contact_id)
    .eq("organization_id", execution.organization_id);
  if (error) {
    return { status: "failed", output: { error: error.message }, error: error.message };
  }
  return { status: "completed", output: { stage_id: stageId } };
}

// --- Tag mutation ----------------------------------------------------------
async function actionTagMutation(args: {
  supabase: SupabaseClient;
  execution: ExecutionRow;
  cfg: Record<string, unknown>;
  mode: "add" | "remove";
}): Promise<ActionOutcome> {
  const { supabase, execution, cfg, mode } = args;
  const tag = typeof cfg.tag === "string" ? cfg.tag.trim() : "";
  if (!tag) {
    return { status: "failed", output: { reason: "Missing tag in config" }, error: "Missing tag" };
  }
  const table = tableFor(execution.contact_type);

  const { data: row, error: readErr } = await supabase
    .from(table)
    .select("tags")
    .eq("id", execution.contact_id)
    .maybeSingle();
  if (readErr) {
    return { status: "failed", output: { error: readErr.message }, error: readErr.message };
  }
  const current = Array.isArray(row?.tags) ? (row!.tags as string[]) : [];
  let next: string[];
  if (mode === "add") {
    next = current.includes(tag) ? current : [...current, tag];
  } else {
    next = current.filter((t) => t !== tag);
  }
  const { error: writeErr } = await supabase
    .from(table)
    .update({ tags: next })
    .eq("id", execution.contact_id)
    .eq("organization_id", execution.organization_id);
  if (writeErr) {
    return { status: "failed", output: { error: writeErr.message }, error: writeErr.message };
  }
  return { status: "completed", output: { tags: next, applied: tag, mode } };
}

// --- Assign agent ----------------------------------------------------------
async function actionAssignAgent(args: {
  supabase: SupabaseClient;
  execution: ExecutionRow;
  cfg: Record<string, unknown>;
}): Promise<ActionOutcome> {
  const { supabase, execution, cfg } = args;
  // assigned_agent_id only exists on leads/clients/recruits.
  if (!["lead", "client", "recruit"].includes(execution.contact_type)) {
    return {
      status: "failed",
      output: { reason: `assign_agent unsupported for contact_type ${execution.contact_type}` },
      error: "assign_agent unsupported",
    };
  }

  let agentId = typeof cfg.agent_id === "string" ? cfg.agent_id : "";
  const roundRobin = cfg.round_robin === true;

  if (!agentId && roundRobin) {
    // Naive round-robin: pick the org's least-recently-assigned active agent.
    const { data: candidates } = await supabase
      .from("profiles")
      .select("id")
      .eq("organization_id", execution.organization_id)
      .eq("role", "Agent")
      .limit(50);
    const ids = (candidates ?? []).map((c) => c.id as string);
    if (ids.length === 0) {
      return { status: "failed", output: { reason: "No agents available for round-robin" }, error: "No agents" };
    }
    agentId = ids[Math.floor(Math.random() * ids.length)];
  }

  if (!agentId) {
    return { status: "failed", output: { reason: "Missing agent_id and round_robin not set" }, error: "Missing agent_id" };
  }

  const table = tableFor(execution.contact_type);
  const { error } = await supabase
    .from(table)
    .update({ assigned_agent_id: agentId })
    .eq("id", execution.contact_id)
    .eq("organization_id", execution.organization_id);
  if (error) {
    return { status: "failed", output: { error: error.message }, error: error.message };
  }
  return { status: "completed", output: { assigned_agent_id: agentId, round_robin: roundRobin } };
}

// --- Create task -----------------------------------------------------------
const TASK_TYPES = ["Send Quote", "Follow Up", "Check Application", "Policy Review", "General"] as const;

async function actionCreateTask(args: {
  supabase: SupabaseClient;
  execution: ExecutionRow;
  cfg: Record<string, unknown>;
  contact: Record<string, unknown> | null;
}): Promise<ActionOutcome> {
  const { supabase, execution, cfg, contact } = args;

  const titleRaw = typeof cfg.title === "string"
    ? cfg.title
    : (typeof cfg.title_template === "string" ? cfg.title_template : "Follow up");
  const title = renderMergeFields(titleRaw, contact).trim();
  if (!title) {
    return { status: "failed", output: { reason: "Empty task title" }, error: "Empty task title" };
  }

  const taskType = typeof cfg.task_type === "string" ? cfg.task_type : "General";
  if (!TASK_TYPES.includes(taskType as (typeof TASK_TYPES)[number])) {
    return {
      status: "failed",
      output: { reason: `Invalid task_type: ${taskType}` },
      error: "Invalid task_type",
    };
  }

  const dueInDays = Math.max(0, Number(cfg.due_in_days ?? cfg.due_days ?? 1) || 1);
  const dueDate = new Date(Date.now() + dueInDays * 86_400_000).toISOString();

  let assignedTo = typeof cfg.assigned_to === "string" ? cfg.assigned_to.trim() : "";
  if (!assignedTo) {
    assignedTo = String(contact?.assigned_agent_id ?? contact?.user_id ?? "").trim();
  }
  if (!assignedTo) {
    return {
      status: "failed",
      output: { reason: "No assignee (set assigned_to or ensure contact has assigned_agent_id)" },
      error: "Missing assignee",
    };
  }

  const createdBy = typeof cfg.created_by === "string" && cfg.created_by.trim()
    ? cfg.created_by.trim()
    : assignedTo;

  const notesRaw = typeof cfg.notes === "string" ? cfg.notes : "";
  const notes = notesRaw ? renderMergeFields(notesRaw, contact) : null;

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      organization_id: execution.organization_id,
      contact_id: execution.contact_id,
      contact_type: execution.contact_type,
      assigned_to: assignedTo,
      created_by: createdBy,
      title,
      task_type: taskType,
      due_date: dueDate,
      notes,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    return { status: "failed", output: { error: error.message }, error: error.message };
  }
  if (!task?.id) {
    return { status: "failed", output: { reason: "Task insert returned no row" }, error: "Insert failed" };
  }

  return { status: "completed", output: { task_id: task.id, title, task_type: taskType, due_date: dueDate } };
}

// --- Webhook ---------------------------------------------------------------
async function actionWebhook(args: {
  cfg: Record<string, unknown>;
  contact: Record<string, unknown> | null;
}): Promise<ActionOutcome> {
  const url = typeof args.cfg.url === "string" ? args.cfg.url : "";
  const method = typeof args.cfg.method === "string" ? (args.cfg.method as string).toUpperCase() : "POST";
  if (!url) {
    return { status: "failed", output: { reason: "Missing webhook url" }, error: "Missing url" };
  }
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = JSON.stringify({ contact: args.contact ?? null });
  }
  try {
    const res = await fetch(url, init);
    const text = await res.text().catch(() => "");
    return {
      status: res.ok ? "completed" : "failed",
      output: { http_status: res.status, body_preview: text.slice(0, 500) },
      error: res.ok ? undefined : `Webhook returned ${res.status}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "failed", output: { error: msg }, error: msg };
  }
}

// ---------------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------------
function tableFor(contactType: "lead" | "client" | "recruit"): string {
  return contactType === "lead" ? "leads" : contactType === "client" ? "clients" : "recruits";
}

function toE164(input: string): string {
  const raw = (input ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d ? `+${d}` : "";
}
