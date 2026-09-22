// Operator-only. Never run against production without exact request/manifest approval.
// Deno --allow-env --allow-net=<approved host> --allow-read=<private files>
//      --allow-write=<private manifest and durable ledger directory>
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";

const requestSchema = z.object({
  project_ref: z.string().regex(/^[a-z0-9]{20}$/), id: z.string().uuid(),
  organization_id: z.string().uuid(), user_id: z.string().uuid(),
  mailbox: z.string().email().refine(v => v === v.trim().toLowerCase()),
  received_at: z.string().datetime(), verified_at: z.string().datetime(), due_at: z.string().datetime(),
  authority_ref: z.string().trim().min(1).max(200), operator_ref: z.string().trim().min(1).max(200),
  ledger_ref: z.string().trim().min(1).max(500), holds_reviewed: z.literal(true),
}).strict().refine(r => Date.parse(r.received_at) <= Date.parse(r.verified_at)
  && Date.parse(r.verified_at) <= Date.now() && Date.parse(r.due_at) >= Date.parse(r.verified_at)
  && Date.parse(r.due_at) <= Date.parse(r.verified_at) + 30 * 86400000, "Invalid verified request dates");
type Manifest = { messages: string[]; notifications: string[]; activities: string[]; gaps: Record<string, number>; oversized: boolean };
export const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
const counts = (m: Manifest) => ({ messages: m.messages.length, notifications: m.notifications.length, activities: m.activities.length, gaps: m.gaps, oversized: m.oversized });

export async function runDeletion(args: string[]) {
  const values = new Map<string, string>(); let execute = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--execute") { if (execute) throw new Error("Duplicate flag"); execute = true; continue; }
    if (!["--request", "--manifest", "--approved-sha256", "--ledger-dir"].includes(args[i]) || values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Invalid arguments");
    values.set(args[i], args[++i]);
  }
  const requestPath = values.get("--request"); const manifestPath = values.get("--manifest");
  if (!requestPath || !manifestPath) throw new Error("Request and private manifest paths are required");
  const request = requestSchema.parse(JSON.parse(await Deno.readTextFile(requestPath)));
  const url = new URL(Deno.env.get("SUPABASE_URL") || "");
  if (url.origin !== `https://${request.project_ref}.supabase.co` || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("Project does not match the reviewed request");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!key) throw new Error("Service credentials unavailable");
  const admin = createClient(url.origin, key, { auth: { persistSession: false, autoRefreshToken: false } });
  async function rpc(name: string, parameters: Record<string, unknown>) {
    const result = await admin.rpc(name, parameters);
    if (result.error) throw new Error("Operation rejected; inspect the restricted operator record, not raw response logs");
    return result.data;
  }
  if (!execute) {
    if (values.has("--approved-sha256") || values.has("--ledger-dir")) throw new Error("Execution options require --execute");
    const manifest: Manifest = await rpc("google_mailbox_deletion_manifest", { p_org: request.organization_id, p_user: request.user_id, p_mailbox: request.mailbox });
    const review = JSON.stringify({ request, manifest }, null, 2) + "\n";
    await Deno.writeTextFile(manifestPath, review, { createNew: true, mode: 0o600 });
    return { mode: "dry_run", ...counts(manifest), sha256: await sha256(review), executable: !manifest.oversized && Object.values(manifest.gaps).every(n => n === 0) };
  }
  const review = await Deno.readTextFile(manifestPath);
  if (!/^[a-f0-9]{64}$/.test(values.get("--approved-sha256") || "") || await sha256(review) !== values.get("--approved-sha256")) throw new Error("Reviewed manifest hash does not match");
  const envelope = JSON.parse(review);
  if (JSON.stringify(requestSchema.parse(envelope.request)) !== JSON.stringify(request)) throw new Error("Request differs from reviewed manifest");
  const manifest: Manifest = envelope.manifest;
  if (manifest.oversized || Object.values(manifest.gaps).some(n => n !== 0)) throw new Error("Manual provenance review required");
  const ledgerDirectory = values.get("--ledger-dir");
  // Attestation is not proof of external durability: the runbook requires an actual
  // restricted off-database destination, tested before authorizing a real request.
  if (!ledgerDirectory || Deno.env.get("GOOGLE_DELETION_LEDGER_READY") !== "true" || !(await Deno.stat(ledgerDirectory)).isDirectory) throw new Error("Verified external deletion ledger required");
  const ledgerPath = `${ledgerDirectory}/${request.id}.jsonl`;
  const appendLedger = async (record: unknown) => {
    const file = await Deno.open(ledgerPath, { create: true, append: true, write: true, mode: 0o600 });
    try {
      const bytes = new TextEncoder().encode(JSON.stringify({ at: new Date().toISOString(), record }) + "\n");
      let offset = 0; while (offset < bytes.length) offset += await file.write(bytes.subarray(offset));
      await file.sync();
    } finally { file.close(); }
  };
  // Write-ahead record includes exact scope and reviewed identities, never message content.
  await appendLedger({ phase: "approved_before_mutation", ...envelope, manifest_sha256: await sha256(review) });
  await rpc("begin_google_mailbox_deletion", { p_request: request, p_manifest: manifest });
  for (let batch = 0; batch < 100; batch++) {
    const result = await rpc("erase_google_mailbox_batch", { p_request: request.id, p_manifest: manifest, p_limit: 500 });
    await appendLedger({ phase: "batch_checkpoint", result });
    if (result.status === "live_deleted") return result;
  }
  throw new Error("Batch limit reached; barrier remains active. Resume the same approved request.");
}

if (import.meta.main) {
  try { console.log(JSON.stringify(await runDeletion(Deno.args))); }
  catch { console.error("Gmail deletion stopped. Check the approved project, request, provenance, manifest hash and durable ledger. No credentials or content are printed; pending requests remain blocked until resolved."); Deno.exitCode = 1; }
}
