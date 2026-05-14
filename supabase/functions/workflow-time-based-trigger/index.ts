// workflow-time-based-trigger
// ---------------------------------------------------------------------------
// Cron-triggered Edge Function (every 15 min). For every active workflow
// whose trigger_type is 'time_based', evaluates the condition and dispatches
// matching contacts through workflow-trigger-evaluator.
//
// Supported condition (v1):
//   { "condition": "no_contact", "days": N, "applies_to": "leads" }
//     → leads in the org with no activity (calls, messages, contact_emails)
//       in the last N days. Skips contacts that already have a
//       running/paused execution for the workflow.
//
// Limit: 100 contacts per workflow per run.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkWorkflowSecret, corsHeaders, jsonResponse } from "../_shared/workflowAuth.ts";

const FN = "[workflow-time-based-trigger]";
const PER_WORKFLOW_LIMIT = 100;

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

  const { data: workflows, error } = await supabase
    .from("workflows")
    .select("id, organization_id, trigger_config")
    .eq("status", "active")
    .eq("trigger_type", "time_based");
  if (error) {
    console.error(`${FN} fetch workflows:`, error.message);
    return jsonResponse({ success: false, error: error.message }, 500);
  }

  const evaluatorUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/workflow-trigger-evaluator`;
  let dispatched = 0;

  for (const wf of workflows ?? []) {
    try {
      const cfg = (wf.trigger_config ?? {}) as Record<string, unknown>;
      const condition = String(cfg.condition ?? "");
      const days = Math.max(1, Number(cfg.days ?? 0) || 0);
      const appliesTo = String(cfg.applies_to ?? "leads").toLowerCase();
      if (condition !== "no_contact" || days === 0 || appliesTo !== "leads") {
        continue;
      }
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
      const matched = await findNoContactLeads(supabase, wf.organization_id as string, cutoff);
      if (matched.length === 0) continue;

      // Filter out contacts with an active execution for this workflow.
      const { data: alreadyRunning } = await supabase
        .from("workflow_executions")
        .select("contact_id")
        .eq("workflow_id", wf.id)
        .in("status", ["running", "paused"])
        .in("contact_id", matched);
      const skipSet = new Set((alreadyRunning ?? []).map((r) => r.contact_id as string));
      const eligible = matched.filter((id) => !skipSet.has(id)).slice(0, PER_WORKFLOW_LIMIT);

      for (const contactId of eligible) {
        try {
          await fetch(evaluatorUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Workflow-Secret": workflowSecret,
            },
            body: JSON.stringify({
              organization_id: wf.organization_id,
              trigger_type: "time_based",
              trigger_key: null,
              contact_id: contactId,
              contact_type: "lead",
              metadata: { condition, days, workflow_id: wf.id },
            }),
          });
          dispatched += 1;
        } catch (err) {
          console.error(`${FN} dispatch failed for contact ${contactId}:`, err);
        }
      }
    } catch (err) {
      console.error(`${FN} workflow ${wf.id} error:`, err);
    }
  }

  return jsonResponse({ success: true, dispatched });
});

async function findNoContactLeads(
  supabase: SupabaseClient,
  orgId: string,
  cutoffIso: string,
): Promise<string[]> {
  // Pull the org's leads (capped) and check recent activity per contact.
  // We deliberately keep this simple in v1: a tighter SQL view can replace it.
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, created_at")
    .eq("organization_id", orgId)
    .lte("created_at", cutoffIso)
    .limit(500);
  if (error) {
    console.error(`${FN} leads fetch:`, error.message);
    return [];
  }
  const candidates = (leads ?? []).map((l) => l.id as string);
  if (candidates.length === 0) return [];

  // Activity sources: calls, messages, contact_emails.
  const recentSet = new Set<string>();

  const { data: recentCalls } = await supabase
    .from("calls")
    .select("contact_id")
    .eq("organization_id", orgId)
    .gte("created_at", cutoffIso)
    .in("contact_id", candidates);
  for (const r of recentCalls ?? []) {
    if (r.contact_id) recentSet.add(r.contact_id as string);
  }

  const { data: recentSms } = await supabase
    .from("messages")
    .select("lead_id")
    .eq("organization_id", orgId)
    .gte("created_at", cutoffIso)
    .in("lead_id", candidates);
  for (const r of recentSms ?? []) {
    if (r.lead_id) recentSet.add(r.lead_id as string);
  }

  const { data: recentEmails } = await supabase
    .from("contact_emails")
    .select("contact_id")
    .eq("organization_id", orgId)
    .gte("created_at", cutoffIso)
    .in("contact_id", candidates);
  for (const r of recentEmails ?? []) {
    if (r.contact_id) recentSet.add(r.contact_id as string);
  }

  return candidates.filter((id) => !recentSet.has(id));
}
