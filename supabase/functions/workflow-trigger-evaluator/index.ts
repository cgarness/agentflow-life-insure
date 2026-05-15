// workflow-trigger-evaluator
// ---------------------------------------------------------------------------
// Internal-only Edge Function. Called via pg_net from Postgres triggers, from
// the time-based cron, and possibly from app code that wants to dispatch
// 'manual' workflow runs.
//
// Auth: X-Workflow-Secret matches WORKFLOW_INTERNAL_SECRET env. No user JWT.
//
// Payload:
//   {
//     organization_id, trigger_type, trigger_key,
//     contact_id, contact_type, metadata
//   }
//
// Behavior:
//   1. Find every active workflow matching (org, trigger_type, trigger_key).
//   2. For each, skip if an execution for (workflow_id, contact_id) is
//      already running.
//   3. Locate the trigger node + its first outgoing edge → first action/
//      condition/wait node.
//   4. INSERT a workflow_executions row with status='running' and
//      current_node_id pointing at that first downstream node.
//   5. Fire-and-forget POST to workflow-executor.
//   6. Return { success, executions_started }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkWorkflowSecret, corsHeaders, jsonResponse } from "../_shared/workflowAuth.ts";

const FN = "[workflow-trigger-evaluator]";

type TriggerPayload = {
  organization_id?: string;
  trigger_type?: string;
  trigger_key?: string | null;
  contact_id?: string;
  contact_type?: "lead" | "client" | "recruit";
  metadata?: Record<string, unknown>;
};

const VALID_TRIGGERS = new Set([
  "disposition",
  "stage_change",
  "lead_created",
  "time_based",
  "manual",
  "tag_added",
  "tag_removed",
  // Trigger expansion (2026-05-15)
  "call_completed",
  "call_missed",
  "appointment_booked",
  "appointment_cancelled",
  "appointment_no_show",
  "sms_received",
  "email_replied",
  "lead_converted",
  "contact_field_changed",
  "contact_dnc",
  "birthday_approaching",
  "custom_date_approaching",
  "stale_lead",
  "task_completed",
  "task_overdue",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  const auth = checkWorkflowSecret(req);
  if (!auth.ok) return jsonResponse({ success: false, error: auth.error }, auth.status);

  let payload: TriggerPayload;
  try {
    payload = (await req.json()) as TriggerPayload;
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }

  const organizationId = (payload.organization_id ?? "").trim();
  const triggerType = (payload.trigger_type ?? "").trim();
  const triggerKey = payload.trigger_key ? String(payload.trigger_key).trim() : null;
  const contactId = (payload.contact_id ?? "").trim();
  const contactType = (payload.contact_type ?? "lead") as "lead" | "client" | "recruit";
  const metadata = payload.metadata ?? {};

  if (!organizationId || !triggerType || !contactId) {
    return jsonResponse(
      { success: false, error: "Missing required fields: organization_id, trigger_type, contact_id" },
      400,
    );
  }
  if (!VALID_TRIGGERS.has(triggerType)) {
    return jsonResponse({ success: false, error: `Unsupported trigger_type: ${triggerType}` }, 400);
  }
  if (!["lead", "client", "recruit"].includes(contactType)) {
    return jsonResponse({ success: false, error: `Unsupported contact_type: ${contactType}` }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const workflowSecret = Deno.env.get("WORKFLOW_INTERNAL_SECRET") ?? "";
  if (!supabaseUrl || !serviceKey) {
    console.error(`${FN} Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    return jsonResponse({ success: false, error: "Server misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // 1. Match active workflows
  const { data: matched, error: rpcError } = await supabase.rpc("get_active_workflows_for_trigger", {
    p_org_id: organizationId,
    p_trigger_type: triggerType,
    p_trigger_key: triggerKey,
  });

  if (rpcError) {
    console.error(`${FN} get_active_workflows_for_trigger:`, rpcError.message);
    return jsonResponse({ success: false, error: rpcError.message }, 500);
  }

  const workflows = (matched ?? []) as Array<{ id: string }>;
  if (workflows.length === 0) {
    return jsonResponse({ success: true, executions_started: 0 });
  }

  let startedCount = 0;
  const executorUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/workflow-executor`;

  for (const wf of workflows) {
    try {
      // 2. Duplicate-prevention: skip if running execution already exists
      const { data: existing, error: existingErr } = await supabase
        .from("workflow_executions")
        .select("id")
        .eq("workflow_id", wf.id)
        .eq("contact_id", contactId)
        .eq("status", "running")
        .limit(1)
        .maybeSingle();
      if (existingErr) {
        console.error(`${FN} dedupe lookup for workflow ${wf.id}:`, existingErr.message);
        continue;
      }
      if (existing?.id) continue;

      // 3. Locate the trigger node
      const { data: triggerNode, error: triggerErr } = await supabase
        .from("workflow_nodes")
        .select("id")
        .eq("workflow_id", wf.id)
        .eq("type", "trigger")
        .limit(1)
        .maybeSingle();
      if (triggerErr || !triggerNode?.id) {
        console.error(`${FN} no trigger node for workflow ${wf.id}:`, triggerErr?.message);
        continue;
      }

      // First outgoing edge from trigger → next node
      const { data: firstEdge, error: edgeErr } = await supabase
        .from("workflow_edges")
        .select("target_node_id")
        .eq("workflow_id", wf.id)
        .eq("source_node_id", triggerNode.id)
        .limit(1)
        .maybeSingle();
      if (edgeErr) {
        console.error(`${FN} first edge for workflow ${wf.id}:`, edgeErr.message);
        continue;
      }
      const firstNodeId: string | null = firstEdge?.target_node_id ?? null;

      // 4. INSERT execution
      const { data: execRow, error: execErr } = await supabase
        .from("workflow_executions")
        .insert({
          workflow_id: wf.id,
          organization_id: organizationId,
          contact_id: contactId,
          contact_type: contactType,
          status: firstNodeId ? "running" : "completed",
          current_node_id: firstNodeId,
          trigger_event: {
            trigger_type: triggerType,
            trigger_key: triggerKey,
            metadata,
          },
          completed_at: firstNodeId ? null : new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();

      if (execErr || !execRow?.id) {
        console.error(`${FN} insert execution for workflow ${wf.id}:`, execErr?.message);
        continue;
      }
      startedCount += 1;

      // 5. Fire-and-forget executor (only if there's somewhere to go)
      if (firstNodeId) {
        // Don't await; let it run in the background.
        fetch(executorUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Workflow-Secret": workflowSecret,
          },
          body: JSON.stringify({ execution_id: execRow.id }),
        }).catch((err) => {
          console.error(`${FN} executor invocation failed for exec ${execRow.id}:`, err);
        });
      }
    } catch (err) {
      console.error(`${FN} workflow ${wf.id} loop error:`, err);
    }
  }

  return jsonResponse({ success: true, executions_started: startedCount });
});
