// Shared internal-secret auth for Workflow Builder Edge Functions.
// All workflow functions are server-internal (called via pg_net from triggers,
// from pg_cron, or from another workflow function). They never accept user
// JWTs. Authentication is a single X-Workflow-Secret header that must match
// the Edge Function env var WORKFLOW_INTERNAL_SECRET.

export type WorkflowAuthResult = { ok: true } | { ok: false; status: number; error: string };

export function checkWorkflowSecret(req: Request): WorkflowAuthResult {
  const expected = Deno.env.get("WORKFLOW_INTERNAL_SECRET") ?? "";
  if (!expected) {
    return { ok: false, status: 500, error: "WORKFLOW_INTERNAL_SECRET not configured" };
  }
  const provided = req.headers.get("X-Workflow-Secret") ?? "";
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: "Invalid workflow secret" };
  }
  return { ok: true };
}

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-workflow-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
