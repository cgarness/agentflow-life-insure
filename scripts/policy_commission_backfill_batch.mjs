#!/usr/bin/env node
/**
 * One-time historical commission backfill operator (never scheduled, never browser code).
 * The operator reviews a PRIVATE manifest and its SHA-256 before --apply. Only an authenticated
 * agency Admin's JWT is accepted, and every write uses the existing RLS-enforced record-later RPC.
 *
 * Usage: node scripts/policy_commission_backfill_batch.mjs --manifest /secure/five.json
 *        AGENTFLOW_BACKFILL_ALLOW_APPLY=yes node ... --manifest /secure/five.json --apply --approve-hash <sha256>
 * Required env: AGENTFLOW_SUPABASE_URL, AGENTFLOW_SUPABASE_ANON_KEY, AGENTFLOW_BACKFILL_ACCESS_TOKEN.
 * NO service_role keys, postgres impersonation, or hard-coded private policy identifiers.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const HOME_ORG_ID = "a0000000-0000-0000-0000-000000000001";
const uuid = z.string().uuid();
const positiveCents = z.number().int().nonnegative().safe();
const decimal = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/);
const percent = decimal.refine((v) => Number(v) <= 300, "Commission rate must be 0–300%");
const rowSchema = z.object({
  policyId: uuid,
  winId: uuid,
  creditedAgentId: uuid,
  soldDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  carrier: z.string().min(1),
  policyType: z.enum(["Final Expense", "Whole Life", "Term", "IUL"]),
  productId: uuid,
  variantId: uuid,
  monthlyPremium: decimal,
  contractLevel: z.number().int().min(1).max(999),
  ratePercent: percent,
  firstYearCents: positiveCents,
  advanceCents: positiveCents,
  requestId: uuid,
}).strict();
const manifestSchema = z.object({
  version: z.literal("historical-commission-backfill-v1"),
  organizationId: uuid,
  gridId: uuid,
  gridRevision: z.number().int().positive(),
  gridEffectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Deliberate signed-off projection against the CURRENT grid for sales made before its effective date.
  currentRateProjectionReviewed: z.literal(true),
  rows: z.array(rowSchema).length(5),
}).strict();

const must = (condition, message) => { if (!condition) throw new Error(message); };
const normalize = (value) => String(value ?? "").trim().toLowerCase();
const moneyCents = (value) => {
  const result = decimal.safeParse(String(value ?? ""));
  must(result.success && /[1-9]/.test(result.data), "Missing or malformed premium");
  const [whole, fractional = ""] = result.data.split(".");
  return BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0"));
};
const rateHundredths = (text) => {
  const [whole, fraction = ""] = decimal.parse(String(text)).split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
};
const halfUp = (numerator, denominator) => (numerator + denominator / 2n) / denominator;
export const calculateCents = (premium, rate) => {
  const n = moneyCents(premium) * 12n * rateHundredths(rate);
  const firstYear = halfUp(n, 10000n);
  const advance = halfUp(n * 3n, 40000n);
  const result = { firstYearCents: Number(firstYear), advanceCents: Number(advance) };
  must(Number.isSafeInteger(result.firstYearCents) && Number.isSafeInteger(result.advanceCents), "Amount out of bounds");
  return result;
};

async function allRows(query, what) {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data ?? [];
}
async function oneRow(query, what) {
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new Error(`${what}: ${error?.message ?? "not found"}`);
  return data;
}

export async function audit(client, actorId, manifest) {
  const org = manifest.organizationId;
  must(org === HOME_ORG_ID, "Only the approved AgentFlow home organization is in scope");
  const me = await oneRow(client.from("profiles").select("id,role,status,organization_id,is_super_admin").eq("id", actorId), "admin profile");
  must(me.organization_id === org && me.status === "Active" &&
    (me.role === "Admin" || me.role === "Super Admin" || me.is_super_admin === true),
    "Only a signed-in, active Admin of the specified organization may review and apply this batch");

  const settings = await oneRow(client.from("organization_comp_settings")
    .select("organization_id,calculator_grid_id").eq("organization_id", org), "compensation settings");
  must(settings.calculator_grid_id === manifest.gridId, "Selected compensation grid changed");
  const grid = await oneRow(client.from("comp_grids")
    .select("id,revision,effective_date,is_active,contract_levels").eq("id", manifest.gridId), "compensation grid");
  must(grid.is_active && grid.revision === manifest.gridRevision &&
    grid.effective_date === manifest.gridEffectiveDate, "Compensation grid changed since approval");

  const policyIds = manifest.rows.map((r) => r.policyId);
  const winIds = manifest.rows.map((r) => r.winId);
  must(new Set(policyIds).size === 5 && new Set(winIds).size === 5 &&
    new Set(manifest.rows.map((r) => r.requestId)).size === 5,
    "Duplicate policy, win or request IDs are forbidden");
  const wins = await allRows(client.from("wins")
    .select("id,organization_id,policy_id,agent_id,contact_id,sold_date,policy_type,premium_amount,premium_snapshot")
    .eq("organization_id", org).in("policy_id", policyIds), "sales");
  must(wins.length === 5, "Exactly five sale rows must be visible");
  const clients = await allRows(client.from("clients")
    .select("id,organization_id,primary_policy_id,carrier,policy_type,premium")
    .eq("organization_id", org).in("id", wins.map((w) => w.contact_id)), "clients");
  const agents = await allRows(client.from("profiles").select("id,organization_id,commission_level")
    .eq("organization_id", org).in("id", manifest.rows.map((r) => r.creditedAgentId)), "credited agents");
  const products = await allRows(client.from("comp_products")
    .select("id,grid_id,category,carrier,product_name,is_active")
    .eq("grid_id",manifest.gridId).in("id",manifest.rows.map((r) => r.productId)), "grid products");
  // All variants of a selected product, not just the supplied matching variant, control age optionality.
  const variants = await allRows(client.from("comp_product_variants")
    .select("id,grid_id,product_id,min_age,max_age,term_years")
    .eq("grid_id",manifest.gridId).in("product_id",manifest.rows.map((r) => r.productId)), "grid variants");
  const rates = await allRows(client.from("comp_rates")
    .select("grid_id,variant_id,contract_level,rate_percent")
    .eq("grid_id",manifest.gridId).in("variant_id",manifest.rows.map((r) => r.variantId)), "grid rates");
  const estimates = await allRows(client.from("policy_commission_estimates")
    .select("policy_id,win_id,credited_agent_id,status,first_year_cents,advance_cents")
    .eq("organization_id",org).in("policy_id",policyIds).in("status",["active","on_hold"]), "saved estimates");
  const events = await allRows(client.from("policy_commission_events")
    .select("policy_id,request_id,event_type").eq("organization_id",org)
    .in("request_id",manifest.rows.map((r) => r.requestId)), "existing request audit");
  const counts = new Map();
  for (const row of manifest.rows) counts.set(normalize(row.carrier), (counts.get(normalize(row.carrier)) ?? 0) + 1);
  must(counts.get("americo") === 4 && counts.get("mutual of omaha") === 1 && counts.size === 2,
    "Batch must contain precisely the approved four Americo and one Mutual of Omaha sales");

  const contexts = [];
  for (const row of manifest.rows) {
    const w = wins.find((v) => v.id === row.winId && v.policy_id === row.policyId);
    must(w && w.organization_id === org && w.agent_id === row.creditedAgentId && w.sold_date === row.soldDate &&
      row.soldDate < "2026-10-20", "Sale identity, credited seller or historical cutoff changed");
    const c = clients.find((v) => v.id === w.contact_id);
    must(c && c.organization_id === org && c.primary_policy_id === row.policyId, "Not the approved primary policy");
    must(normalize(c.carrier) === normalize(row.carrier) &&
      (w.policy_type || c.policy_type) === row.policyType, "Carrier or sale type changed");
    const agent = agents.find((p) => p.id === row.creditedAgentId);
    const levelMatch = /^\s*\d{1,9}%?\s*$/.test(agent?.commission_level ?? "");
    must(agent && levelMatch && Number(agent.commission_level.match(/\d+/)[0]) === row.contractLevel &&
      grid.contract_levels.includes(row.contractLevel), "Credited agent's contract level changed");
    const sourcePremium = w.premium_snapshot && Number(w.premium_amount) > 0 ? w.premium_amount : c.premium;
    must(moneyCents(String(sourcePremium)) === moneyCents(row.monthlyPremium), "Sale/policy premium changed");
    const p = products.find((v) => v.id === row.productId);
    const category = row.policyType === "IUL" ? "iul" : row.policyType === "Term" ? "term" : "whole_life";
    must(p && p.grid_id === grid.id && p.is_active && p.category === category &&
      normalize(p.carrier) === normalize(c.carrier), "Selected product does not match this sale");
    const productVariants = variants.filter((v) => v.product_id === p.id);
    must(productVariants.length > 0 && productVariants.every((v) =>
      v.min_age === null && v.max_age === null), "An insured age is required for this product");
    const variant = productVariants.find((v) => v.id === row.variantId);
    must(variant && variant.term_years === null && productVariants.length === 1,
      "Unapproved/ambiguous product variant; check age and term rules");
    const rate = rates.find((v) => v.variant_id === variant.id && v.contract_level === row.contractLevel);
    must(rate && Number(rate.rate_percent) === Number(row.ratePercent), "Current-grid commission rate changed");
    const cents = calculateCents(row.monthlyPremium, row.ratePercent);
    must(cents.firstYearCents === row.firstYearCents && cents.advanceCents === row.advanceCents,
      "Commission amount differs from canonical exact arithmetic");
    const existing = estimates.find((v) => v.policy_id === row.policyId);
    const history = events.filter((v) => v.policy_id === row.policyId && v.request_id === row.requestId);
    if (existing) {
      must(existing.win_id === row.winId && existing.credited_agent_id === row.creditedAgentId &&
        existing.first_year_cents === row.firstYearCents && existing.advance_cents === row.advanceCents &&
        history.some((v) => v.event_type === "estimate_recorded"),
        "An unrelated commission estimate already exists for this policy; no overwrite");
    } else {
      must(history.length === 0, "Audit event exists without a current estimate; manual review required");
    }
    contexts.push({ row, product: p.product_name, existing: !!existing });
  }
  return contexts;
}

async function main() {
  const args = process.argv.slice(2);
  const manifestIndex = args.indexOf("--manifest");
  must(manifestIndex >= 0 && args[manifestIndex+1], "Provide --manifest path to a private reviewed JSON file");
  const applying = args.includes("--apply");
  const hashIndex = args.indexOf("--approve-hash");
  const raw = await readFile(args[manifestIndex+1]);
  const manifest = manifestSchema.parse(JSON.parse(raw.toString("utf8")));
  const digest = createHash("sha256").update(raw).digest("hex");
  const url = process.env.AGENTFLOW_SUPABASE_URL;
  const anon = process.env.AGENTFLOW_SUPABASE_ANON_KEY;
  const token = process.env.AGENTFLOW_BACKFILL_ACCESS_TOKEN;
  must(url && anon && token, "Authenticated Admin URL, anon key and access token required (never a service role key)");
  const client = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity, error } = await client.auth.getUser(token);
  must(!error && identity?.user?.id, "Admin access token is not valid");
  const contexts = await audit(client, identity.user.id, manifest);
  // Log no client details, access tokens, private IDs, or policy numbers.
  console.log(JSON.stringify({ status: applying ? "apply_requested" : "dry_run_only",
    manifestSha256: digest, total: contexts.length,
    alreadyRecorded: contexts.filter((x) => x.existing).length,
    candidates: contexts.map(({row,product,existing})=>({
      saleDate: row.soldDate, carrier: row.carrier, product, alreadyRecorded: existing,
      estimatedFirstYearCents: row.firstYearCents, estimatedAdvanceCents: row.advanceCents,
    })) }, null, 2));
  if (!applying) return;
  must(process.env.AGENTFLOW_BACKFILL_ALLOW_APPLY === "yes" &&
    hashIndex >= 0 && args[hashIndex+1] === digest,
    "Apply refused: exact reviewed manifest hash and explicit allow-apply flag required");
  // Serial, not atomic; unresolved results must be retried with the SAME request IDs in the immutable manifest.
  for (const { row, existing } of contexts) {
    if (existing) { console.log("Already recorded with this request; skipping."); continue; }
    const inputs = {
      credited_agent_id: row.creditedAgentId, grid_id: manifest.gridId,
      grid_revision: manifest.gridRevision, product_id: row.productId, variant_id: row.variantId,
      insured_age: null, term_years: null, contract_level: row.contractLevel, rate_percent: row.ratePercent,
      monthly_premium: row.monthlyPremium, first_year_cents: row.firstYearCents, advance_cents: row.advanceCents,
    };
    const { data, error } = await client.rpc("record_policy_commission_estimate_later", {
      p_request_id: row.requestId, p_policy_id: row.policyId, p_inputs: inputs,
      p_replace_estimate_id: null, p_expected_revision: null, p_reason: null,
    });
    // Transport errors may be UNKNOWN commits: stop, retain manifest/request IDs; never generate new IDs.
    must(!error && data?.status === "recorded", "Unresolved/refused commission write; stop and recover using the SAME request ID");
    console.log("Recorded a reviewed commission estimate through the authenticated RPC.");
  }
  console.log("Batch completed through canonical commission writers. No receipts were recorded.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Backfill stopped: ${error.message}`); process.exitCode=1; });
}
