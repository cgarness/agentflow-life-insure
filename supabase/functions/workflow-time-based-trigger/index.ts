// workflow-time-based-trigger
// ---------------------------------------------------------------------------
// Cron-triggered Edge Function (every 15 min). For every active workflow
// whose trigger_type is time-based, evaluates the condition and dispatches
// matching contacts through workflow-trigger-evaluator.
//
// Supported trigger_types (and their config shape):
//   * time_based               → { condition: 'no_contact', days: N, applies_to: 'leads' }
//   * birthday_approaching     → { days_before: N, applies_to: 'leads' | 'clients' }
//   * stale_lead               → { days: N }
//   * custom_date_approaching  → { field_name: '<custom_field_key>', days_before: N }
//
// Limit: 100 contacts per workflow per run.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkWorkflowSecret, corsHeaders, jsonResponse } from "../_shared/workflowAuth.ts";

const FN = "[workflow-time-based-trigger]";
const PER_WORKFLOW_LIMIT = 100;
const TIME_TRIGGER_TYPES = [
  "time_based",
  "birthday_approaching",
  "stale_lead",
  "custom_date_approaching",
];

interface WorkflowRow {
  id: string;
  organization_id: string;
  trigger_type: string;
  trigger_config: Record<string, unknown> | null;
}

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
    .select("id, organization_id, trigger_type, trigger_config")
    .eq("status", "active")
    .in("trigger_type", TIME_TRIGGER_TYPES);
  if (error) {
    console.error(`${FN} fetch workflows:`, error.message);
    return jsonResponse({ success: false, error: error.message }, 500);
  }

  const evaluatorUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/workflow-trigger-evaluator`;
  let dispatched = 0;

  for (const wf of (workflows ?? []) as WorkflowRow[]) {
    try {
      const matched = await evaluateWorkflow(supabase, wf);
      if (matched.length === 0) continue;

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
              trigger_type: wf.trigger_type,
              trigger_key: null,
              contact_id: contactId,
              contact_type: "lead",
              metadata: { trigger_type: wf.trigger_type, workflow_id: wf.id, config: wf.trigger_config },
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

async function evaluateWorkflow(supabase: SupabaseClient, wf: WorkflowRow): Promise<string[]> {
  const cfg = (wf.trigger_config ?? {}) as Record<string, unknown>;
  if (wf.trigger_type === "time_based") {
    const condition = String(cfg.condition ?? "");
    const days = Math.max(1, Number(cfg.days ?? 0) || 0);
    const appliesTo = String(cfg.applies_to ?? "leads").toLowerCase();
    if (condition !== "no_contact" || days === 0 || appliesTo !== "leads") return [];
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
    return await findNoContactLeads(supabase, wf.organization_id, cutoff);
  }

  if (wf.trigger_type === "birthday_approaching") {
    const daysBefore = Math.max(0, Number(cfg.days_before ?? 7) || 7);
    const appliesTo = String(cfg.applies_to ?? "leads").toLowerCase();
    return await findUpcomingBirthdays(supabase, wf.organization_id, appliesTo, daysBefore);
  }

  if (wf.trigger_type === "stale_lead") {
    const days = Math.max(1, Number(cfg.days ?? 14) || 14);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
    return await findStaleLeads(supabase, wf.organization_id, cutoff);
  }

  if (wf.trigger_type === "custom_date_approaching") {
    const fieldName = String(cfg.field_name ?? "").trim();
    const daysBefore = Math.max(0, Number(cfg.days_before ?? 30) || 30);
    if (!fieldName) return [];
    return await findCustomDateApproaching(supabase, wf.organization_id, fieldName, daysBefore);
  }

  return [];
}

async function findNoContactLeads(
  supabase: SupabaseClient,
  orgId: string,
  cutoffIso: string,
): Promise<string[]> {
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

  const recentSet = new Set<string>();
  const { data: recentCalls } = await supabase
    .from("calls").select("contact_id, lead_id")
    .eq("organization_id", orgId).gte("created_at", cutoffIso)
    .or(`contact_id.in.(${candidates.join(",")}),lead_id.in.(${candidates.join(",")})`);
  for (const r of recentCalls ?? []) {
    if (r.contact_id) recentSet.add(r.contact_id as string);
    if (r.lead_id) recentSet.add(r.lead_id as string);
  }
  const { data: recentSms } = await supabase
    .from("messages").select("lead_id")
    .eq("organization_id", orgId).gte("created_at", cutoffIso)
    .in("lead_id", candidates);
  for (const r of recentSms ?? []) {
    if (r.lead_id) recentSet.add(r.lead_id as string);
  }
  const { data: recentEmails } = await supabase
    .from("contact_emails").select("contact_id")
    .eq("organization_id", orgId).gte("created_at", cutoffIso)
    .in("contact_id", candidates);
  for (const r of recentEmails ?? []) {
    if (r.contact_id) recentSet.add(r.contact_id as string);
  }
  return candidates.filter((id) => !recentSet.has(id));
}

async function findUpcomingBirthdays(
  supabase: SupabaseClient,
  orgId: string,
  appliesTo: string,
  daysBefore: number,
): Promise<string[]> {
  const table = appliesTo === "clients" ? "clients" : "leads";
  const { data, error } = await supabase
    .from(table)
    .select("id, date_of_birth")
    .eq("organization_id", orgId)
    .not("date_of_birth", "is", null)
    .limit(2000);
  if (error) {
    console.error(`${FN} ${table} fetch:`, error.message);
    return [];
  }
  const today = new Date();
  const tYear = today.getUTCFullYear();
  const startMs = Date.UTC(tYear, today.getUTCMonth(), today.getUTCDate());
  const endMs = startMs + daysBefore * 24 * 60 * 60_000;
  const matched: string[] = [];
  for (const row of (data ?? []) as Array<{ id: string; date_of_birth: string }>) {
    const dob = new Date(row.date_of_birth);
    if (Number.isNaN(dob.getTime())) continue;
    const m = dob.getUTCMonth();
    const d = dob.getUTCDate();
    const thisYear = Date.UTC(tYear, m, d);
    const nextYear = Date.UTC(tYear + 1, m, d);
    const next = thisYear >= startMs ? thisYear : nextYear;
    if (next >= startMs && next <= endMs) matched.push(row.id);
  }
  return matched;
}

async function findStaleLeads(
  supabase: SupabaseClient,
  orgId: string,
  cutoffIso: string,
): Promise<string[]> {
  // Approximation: no stage-history table exists. We treat a lead as stale
  // when last_contacted_at AND updated_at are both older than the cutoff.
  const { data, error } = await supabase
    .from("leads")
    .select("id, last_contacted_at, updated_at")
    .eq("organization_id", orgId)
    .lte("updated_at", cutoffIso)
    .limit(500);
  if (error) {
    console.error(`${FN} stale leads fetch:`, error.message);
    return [];
  }
  return ((data ?? []) as Array<{ id: string; last_contacted_at: string | null; updated_at: string }>)
    .filter((r) => !r.last_contacted_at || r.last_contacted_at <= cutoffIso)
    .map((r) => r.id);
}

async function findCustomDateApproaching(
  supabase: SupabaseClient,
  orgId: string,
  fieldName: string,
  daysBefore: number,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, custom_fields")
    .eq("organization_id", orgId)
    .not("custom_fields", "is", null)
    .limit(2000);
  if (error) {
    console.error(`${FN} custom field fetch:`, error.message);
    return [];
  }
  const today = new Date();
  const startMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const endMs = startMs + daysBefore * 24 * 60 * 60_000;
  const matched: string[] = [];
  for (const row of (data ?? []) as Array<{ id: string; custom_fields: Record<string, unknown> }>) {
    const raw = row.custom_fields?.[fieldName];
    if (typeof raw !== "string" || !raw) continue;
    const ts = Date.parse(raw);
    if (Number.isNaN(ts)) continue;
    if (ts >= startMs && ts <= endMs) matched.push(row.id);
  }
  return matched;
}
