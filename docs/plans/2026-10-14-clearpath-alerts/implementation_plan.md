# ClearPath saved-lead SMS alerts

Chris approved proceeding with the AgentFlow backend integration on October 14, 2026. Sender: existing agency 916-299-8778; recipient: Chris's 909-775-6963. Existing informational SMS enrollment is confirmed. No new A2P registration, credentials export, voice changes, or campaign changes.

## Implementation
1. Add `supabase/functions/clearpath-lead-alert/index.ts` and isolated `handler.ts`: accept only signed, short-lived requests from the ClearPath server. Ed25519 public key is pinned; private key lives only in Sites secrets. Fixed organization, sender, recipient and message template; callers supply only a request UUID and send/status operation.
2. Use existing `dispatch` with informational purpose, current UV eligibility, selected registered sender, local STOP/DNC, confirmation, atomic dispatch reservation and provider receipts. Do not classify automated messages as manual. No changes to shared SMS functions or database schema.
3. Keep one request key per saved lead. Status checks read only that bridge's receipt. A signed replay can never send twice. Reject unknown fields, wrong signatures, expired timestamps and paths before database access.
4. Sites `lib/lead-alert.ts` signs server-side requests; retains its durable per-lead claim and post-response execution. Verification credentials remain unchanged. Test route uses a separate temporary admin secret and a fixed test UUID; remove that secret after testing.
5. Unit-test signature/body/path expiry, input scope, duplicate calls, failed saves, and callback exclusion. Run root TypeScript, relevant SMS checks and Sites build. Publish the backend and existing Site, test one clearly labeled notification and provider delivery, then enable future-only alerts.

## Files
AgentFlow: new function directory, `supabase/config.toml`, focused tests, this plan, `WORK_LOG.md`.
Sites: `lib/lead-alert.ts`, `cloudflare-env.d.ts`, protected alert-test route, tests and operational docs.

## Release and rollback
Deploy only the new function (existing entry points unchanged). Keep alerts disabled until a delivered test receipt. Rollback is `LEAD_ALERT_ENABLED=false` and redeploy Sites; no registration, credential rotation or schema rollback. No old lead backfill. Ambiguous sends require receipt review, never automatic resend. No successful delivery claim until provider evidence.
