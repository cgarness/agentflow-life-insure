# Verified START re-enrollment

Status: Chris approved the informational-only implementation on October 8 UTC (October 7 PDT), then approved publishing both draft PRs and running CI at 22:21 PDT. Implemented and locally verified on the paired `codex/sms-start-20261008` branches. Production release/live testing remain separately gated; no production mutation or SMS send was made. See [release.md](release.md).

## Requested behavior

Chris requested on October 7 PDT that START restore the ability to text after STOP. This intentionally supersedes the current START-never-clears-SMS-suppression rule, but not agency DNC or purpose-specific consent protections.

Recommended initial scope: a new, authenticated inbound START may restore previously documented informational permission for the same phone, CG Financial profile and agency. It never grants or restores marketing permission. A recipient without valid prior informational enrollment must use the website opt-in flow. HELP remains read-only. No historical START backfill or automatic customer campaign replay.

## Implementation

1. Reconfirm current main, concurrent changes and deployed function/schema preimages in both repositories. Read their current project instructions and relevant consent tests completely before implementation. Verify current Supabase documentation and Twilio keyword behavior.
2. Accept only an exact trimmed, case-insensitive START from a signature-verified provider request bound to the approved account, Messaging Service, selected sender and recipient. Persist its unique Message SID and independently verified provider occurrence time; webhook arrival order must not determine consent order. Conflicting or unverifiable evidence fails closed.
3. Add immutable re-enrollment events referencing the applicable STOP generation and prior informational evidence. Preserve all original STOP and grant records. Derive effective SMS suppression from this audited lifecycle; never delete an opt-out to make eligibility pass. Separate informational restoration from continuing marketing denial, including for a previously dual-purpose subscriber.
4. Synchronize the event through the authenticated AF-to-UV bridge and durable recovery worker. A pending/failed synchronization remains blocked. Only after both sides acknowledge the same current event may the shared manual/workflow/confirmation gate permit new informational sends. No independent agency DNC or unrelated provider block is lifted.
5. Serialize STOP, START and final dispatch decisions for each agency/recipient. Newer STOP wins. Duplicate START is idempotent; delayed or replayed old START cannot undo a newer STOP. A delayed historical STOP cannot incorrectly supersede a verified later event, while ambiguous ordering stays blocked.
6. Keep Twilio-managed keyword confirmations as the single response path; do not add duplicate replies or replay old enrollment confirmations/workflows. Review published program wording and the approved Campaign's website-only source description: distinguish returning-subscriber informational re-enrollment from new keyword signup. If an update to registration is required, prepare the exact change for review rather than silently altering the approved Campaign.
7. Update the project invariant, work logs and current completion record. Explain that START restores eligible informational texting only and does not change marketing or DNC status.

## Expected files

AgentFlow: `supabase/functions/_shared/sms/webhook.ts`, consent/worker/dispatch modules as needed, `twilio-sms-webhook/index.ts`, SMS tests and paired SQL harness, a new forward migration generated with the Supabase CLI, `AGENT_RULES.md`, `WORK_LOG.md`, and scoped release documentation.

Underwriter Verified: `supabase/functions/agentflow-consent/index.ts`, bridge and eligibility tests, a new forward migration for the audited re-enrollment lifecycle and purpose-aware eligibility, plus relevant project rules/work log. Policy or Campaign text changes only where the reviewed flow requires them; preserve historical disclosure versions.

Exact additional files are to be established from current source before coding. No voice, caller-ID, number assignments, broad RLS changes, new numbers, or new Brand/Campaign resources.

## Verification and release

- Tests: valid informational re-enrollment; never-consented recipient; marketing-only and dual-purpose history; independent DNC; unrelated provider block; forged/wrong-account/wrong-service callbacks; malformed keyword; duplicates; STOP-START-STOP; out-of-order delivery; concurrent STOP/START/send; bridge outage/recovery; and all-five sender consistency.
- Run paired native PostgreSQL and Deno tests, meaningful TypeScript checks against the current baseline, scoped lint, diff checks, production builds and existing DNC/A2P regression gates. Review database advisors and preserve server-only ACLs.
- Review exact migrations and complete deployed Edge bundles. Use a coordinated backend-first rollout with re-enrollment disabled until both systems are verified. Recovery disables re-enrollment while retaining STOP enforcement, all evidence and existing send guards.
- After release, ask Chris for a fresh START from his own phone. Verify the new event, both systems' informational eligibility, marketing denial and unchanged DNC. Send at most one explicitly authorized informational test through the ordinary AgentFlow dispatch and independently verify delivery. Do not reuse the older START as an unannounced backfill or send to customers.

## Approval boundary

The informational-only restoration design and publication of the two review branches/draft PRs with remaining CI are approved. Production release and the controlled test must remain explicitly authorized after those checks and the registration-wording review. Current SMS production remains unchanged until the reviewed release.
