// Emits a strict TypeScript equality check (stdout) between the generated types and the repository's
// hand-maintained src/integrations/supabase/types.ts for every schema object M4–M9 create or alter.
// Scope: schema `public` only — the generator is run with included_schemas=public.
// Run by scripts/verify_inbound_generated_types.sh; the two files sit next to the emitted check.ts.
const newTables = ["agent_inbound_settings", "agent_phone_registrations", "inbound_route_attempts", "voicemails"];
const alteredTables = {
  inbound_routing_settings: ["routing_engine", "inbound_group_agent_ids", "browser_ring_seconds", "mobile_ring_seconds", "voicemail_retention_days"],
  calls: ["answered_by_agent_id", "missed_reason", "missed_for_agent_id", "missed_recipient_ids", "missed_notified_at", "missed_notify_attempts", "missed_notify_next_at", "missed_notify_error", "voicemail_id", "routing_engine"],
};
const functions = [
  "heartbeat_phone_registration", "is_phone_connected",
  "set_inbound_group", "set_inbound_routing_engine",
  "advance_inbound_route_stage", "advance_to_owner_mobile", "append_inbound_provider_outcome", "finalize_inbound_call_terminal",
  "is_agent_busy", "mark_inbound_missed", "plan_inbound_route", "record_inbound_mobile_accept", "record_inbound_mobile_bridge",
  "record_inbound_mobile_leg_end", "abandon_inbound_routing", "sweep_inbound_route_attempts",
  "record_inbound_engine_decision",
  "can_access_voicemail", "converge_inbound_notifications", "mark_voicemail_source_deleted", "mark_voicemails_purged",
  "record_voicemail_cleanup_failure", "sweep_inbound_notifications", "upsert_voicemail_from_recording", "voicemails_cleanup_batch",
  "voicemails_expired_batch",
  // M8 (corrective pass 13). M9 adds only a TRIGGER function, which postgres-meta does not emit as a
  // client-callable Function; the shell script asserts that absence rather than listing it here.
  "voicemails_cleanup_actionable_batch", "voicemails_cleanup_blocked_summary",
];
let out = `import type { Database as G } from "./generated-types";
import type { Database as R } from "./repo-types";
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Check<N extends string, A, B> = Eq<A, B> extends true ? N : { MISMATCH: N; generated: A; repo: B };
type GT = G["public"]["Tables"]; type RT = R["public"]["Tables"];
type GF = G["public"]["Functions"]; type RF = R["public"]["Functions"];
`;
let i = 0;
const emit = (name, a, b) => { out += `const c${i++}: Check<"${name}", ${a}, ${b}> = "${name}";\n`; };
for (const t of newTables) for (const k of ["Row", "Insert", "Update", "Relationships"]) emit(`${t}.${k}`, `GT["${t}"]["${k}"]`, `RT["${t}"]["${k}"]`);
for (const [t, cols] of Object.entries(alteredTables)) {
  const keys = cols.map((c) => `"${c}"`).join(" | ");
  for (const k of ["Row", "Insert", "Update"]) emit(`${t}.${k}.added`, `Pick<GT["${t}"]["${k}"], ${keys}>`, `Pick<RT["${t}"]["${k}"], ${keys}>`);
}
for (const f of functions) for (const k of ["Args", "Returns"]) emit(`${f}.${k}`, `GF["${f}"]["${k}"]`, `RF["${f}"]["${k}"]`);
out += "export {};\n";
process.stdout.write(out);
