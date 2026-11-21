// workflow-resume-paused
// ---------------------------------------------------------------------------
// Internal worker entry point; production caller and cadence require independent verification.
// The legacy path resumes workflow executions
// whose latest wait-node step has reached its resume_at time.
//
// Strategy:
//   1. Pull up to 50 executions with status='paused'.
//   2. For each, find the latest pending step on the current wait node.
//   3. If output_data.resume_at <= now(), advance current_node_id to the
//      wait node's outgoing edge target, flip execution back to 'running',
//      mark the wait step 'completed', then call workflow-executor.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sweepAutomationWork } from "../_shared/automations/runtime.ts";
import { dispatchChannel } from "../_shared/automations/channel.ts";
import { checkWorkflowSecret, corsHeaders, jsonResponse } from "../_shared/workflowAuth.ts";

const FN = "[workflow-resume-paused]";
const BATCH_SIZE = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  const auth = checkWorkflowSecret(req);
  if (!auth.ok) return jsonResponse({ success: false, error: auth.error }, auth.status);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const workflowSecret = Deno.env.get("WORKFLOW_INTERNAL_SECRET") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ success: false, error: "Server misconfigured" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // The existing internal scheduler entry point services version-pinned work and legacy waits.
  // Failure in either path leaves the other available.
  let automation;
  try {
    automation = await sweepAutomationWork(supabase, dispatchChannel);
  } catch {
    console.error(FN, "Automation sweep failed");
    automation = { error: "Automation sweep failed" };
  }

  const { data: paused, error } = await supabase
    .from("workflow_executions")
    .select("id, workflow_id, organization_id, current_node_id")
    .eq("status", "paused")
    .limit(BATCH_SIZE);
  if (error) {
    console.error(`${FN} fetch paused:`, error.message);
    return jsonResponse({ success: false, error: error.message }, 500);
  }

  let resumed = 0;
  const nowMs = Date.now();
  const executorUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/workflow-executor`;

  for (const exec of paused ?? []) {
    if (!exec.current_node_id) continue;
    try {
      const { data: step, error: stepError } = await supabase
        .from("workflow_execution_steps")
        .select("id, output_data")
        .eq("organization_id", exec.organization_id)
        .eq("execution_id", exec.id)
        .eq("node_id", exec.current_node_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (stepError) throw stepError;
      const resumeAtStr = (step?.output_data as Record<string, unknown> | null | undefined)?.resume_at;
      if (!resumeAtStr || typeof resumeAtStr !== "string") continue;
      const resumeAtMs = Date.parse(resumeAtStr);
      if (Number.isNaN(resumeAtMs) || resumeAtMs > nowMs) continue;

      // Find the wait node's outgoing edge (single, no condition_branch).
      const { data: nextEdge, error: edgeError } = await supabase
        .from("workflow_edges")
        .select("target_node_id")
        .eq("organization_id", exec.organization_id)
        .eq("workflow_id", exec.workflow_id)
        .eq("source_node_id", exec.current_node_id)
        .is("condition_branch", null)
        .limit(1)
        .maybeSingle();
      if (edgeError) throw edgeError;
      const nextNodeId = nextEdge?.target_node_id ?? null;

      // Only the winner of the legacy paused -> next transition may invoke the legacy executor.
      const completedAt = new Date().toISOString();
      const transition = nextNodeId
        ? { status: "running", current_node_id: nextNodeId }
        : { status: "completed", current_node_id: null, completed_at: completedAt };
      const { data: advanced, error: transitionError } = await supabase.from("workflow_executions")
        .update(transition)
        .eq("organization_id", exec.organization_id).eq("id", exec.id)
        .eq("status", "paused").eq("current_node_id", exec.current_node_id)
        .select("id").maybeSingle();
      if (transitionError) throw transitionError;
      if (!advanced) continue;

      const { error: historyError } = await supabase.from("workflow_execution_steps")
        .update({ status: "completed", completed_at: completedAt })
        .eq("organization_id", exec.organization_id).eq("id", step!.id);
      if (historyError) console.error(FN, "Legacy wait history update needs repair", exec.id);
      if (!nextNodeId) {
        resumed++;
        continue;
      }

      // Fire-and-forget executor.
      fetch(executorUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workflow-Secret": workflowSecret,
        },
        body: JSON.stringify({ execution_id: exec.id }),
      }).catch((err) => {
        console.error(`${FN} executor invoke failed for exec ${exec.id}:`, err);
      });

      resumed += 1;
    } catch (err) {
      console.error(`${FN} loop error for exec ${exec.id}:`, err);
    }
  }

  const ok = !("error" in automation) && automation.failed_claims === 0 && automation.failed_stages.length === 0;
  return jsonResponse({ success: ok, resumed, automation }, ok ? 200 : 503);
});
