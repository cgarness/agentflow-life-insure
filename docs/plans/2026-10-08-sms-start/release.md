# Informational START re-enrollment — review candidate

October 8, 2026. Implementation/testing and subsequent draft PR publication/CI approved by Chris. **Production deployment and activation are not approved. No production SQL, provider mutation, form submission or SMS was performed for this change.** Final publication/CI outcomes are recorded on the paired PRs.

## Scope and source

Both repositories use branch `codex/sms-start-20261008`:

- AgentFlow base: `7e5caef24f6352c202f75f40d2b738433c01f516`.
- Underwriter Verified base: `fe5c9a6beff1027349cea422f8b5b20b68a733c5`.
- UV draft [PR #15](https://github.com/cgarness/underwriter-verified/pull/15): `84ab6fcb232d398a7f076ef4d69977ccc2fa2151`, pinned in the AF workflow. Its tree `9c9805257c3e1778c5f084f0d336410192bf45aa` exactly matches the reviewed local source plus publication-approval documentation.
- The paired UV review commit must be published and the AF workflow pinned to its exact published SHA before running CI. Never substitute an unreviewed `main` checkout.

This is returning-subscriber informational re-enrollment, not new keyword signup. Exact trimmed, case-insensitive START is accepted only from the authenticated existing provider account/service and a selected active agency sender. The worker independently GETs the Message resource and checks its SID, account, service, direction, status, both phones, body and provider timestamp. Browser/caller timestamps are not evidence. Every keyword STOP must have verified provenance, START must be strictly newer, and prior confirmed informational enrollment must exist. UV separately checks the original informational grant precedes the earliest STOP.

The immutable AF keyword event and UV lifecycle receipt refer to the original grant. STOP evidence is retained. A revision-bound signed relay and matching current acknowledgment, including UV's effective informational permission, are required before local restoration. A newer STOP, missing proof, same-second ambiguity, stale acknowledgment, remote denial or failed relay stays blocked. Independent agency DNC, operator revocation, unrelated provider blocks and independent UV revocations cannot be cleared by START. Marketing remains blocked even if it was authorized before STOP. HELP has no permission effect; YES/UNSTOP are not application re-enrollment commands in this release.

Prepared dispatches capture the consent revision. A pre-STOP prepared send cannot resume after START. Workflow executions created before the latest re-enrollment are rejected at the database send boundary. Existing confirmation jobs are not replayed. There is no atomic transaction spanning AF, UV and Twilio: a provider-accepted message cannot be recalled by a later STOP. Existing last-moment remote/local checks and provider suppression remain in place.

## New migrations (not applied)

| Project | Forward migration | Default |
| --- | --- | --- |
| AF `jncvvsvckxhqgqvkppmj` | `supabase/migrations/20261008044755_sms_start_reenrollment.sql` | START disabled |
| UV `jzdzeevjpootbeuniygx` | `supabase/migrations/20261008044801_sms_start_reenrollment.sql` | START disabled |

Both were generated with `supabase migration new`. Five new tables have RLS and server-only grants. New RPCs are SECURITY INVOKER and deny anon/authenticated execution. Existing SECURITY DEFINER functions retain their ownership/ACL boundary; the private DNC implementation and grants are unchanged. Foreign-key lookup indexes are included. No prior migration, checkbox/legal wording, disclosure version, secret, number assignment or voice routing is modified.

Migration SHA-256: AF `b506413fc5d4455461c3b7938bbf35106d7ec6f788fd9a34beaf2f437a010c8c`; UV `9429fdbb9daa9ee2625922baaa11f220b3b7db4b17b50b4b51d1211c64e6efb2`.

AF adds bounded provider-verification jobs (five per pass, sixteen attempts with one-minute retry), immutable keyword evidence, recipient lifecycle checkpoints and dispatch revision guards. Failed lifecycle delivery retries durably; an independent UV denial requires operator review and cannot be "fixed" by deleting history. The status endpoint counts pending lifecycle checkpoints. Exhausted provider-proof jobs must be reviewed explicitly; there is no separate new admin UI for them.

All currently recorded `provider_block` entries are conservatively treated as independent. The code does not infer that a historical 21610 error is safe to clear merely because a later START exists.

UV adds immutable lifecycle receipts and independent revocations. Its legacy generic suppression endpoint remains available and now records independent revocations, including repeats. The new AF worker uses the lifecycle endpoint exclusively. This is why worker transition order matters.

## Verification completed locally

- Paired disposable PGlite: **103 assertions**, using real UV anon intake and both migrations, original grants, STOP/START order, repeated and out-of-order receipts, five selected senders, purpose matrix, DNC/operator/provider/independent UV blocks, old prepared messages/workflows, feature pause, evidence immutability and RLS/function ACLs.
- Deno: **46 tests**, including authenticated bridge binding, provider proof, signed relay outage/recovery, denied/mismatched/stale acknowledgment, current sender/account guards and uncertainty/no-retry behavior.
- All eight existing paired Edge entry points type-check. The direct esm.sh loader was unavailable; local checks mapped only the existing Supabase **2.98.0** and Zod **3.25.76** URLs to the same installed npm versions, with remote loading disabled. Production imports and lockfiles are unchanged. CI must rerun the original remote-import commands.
- AF root TypeScript passes. Meaningful app comparison against the exact base: **85 baseline diagnostics, 85 candidate, zero new**. This is not a claim that the existing app type-check is clean.
- AF SMS/A2P frontend: **17 tests**. Existing A2P PGlite migration/RLS/ordering/notification suite passes.
- UV: **59 tests**, root and app TypeScript, and production build pass.
- AF production build passes. Existing Browserslist, bundle-size and mixed static/dynamic import warnings remain; no dependency changes are included.
- Changed runtime/new-test ESLint, new lifecycle Deno lint, JavaScript syntax and diff checks pass. No UI layout was changed and no live browser or handset validation is claimed.

## Remaining gates

1. Publication/CI approved October 7 at 22:21 PDT. Publish the two review branches/draft PRs and pin the actual UV published commit (or verify an identical reviewed tree if the publication tool assigns different commit metadata).
2. Pass exact-head native PostgreSQL SMS/STOP-START-send contention tests, the existing native Dialer DNC regression, original Deno import checks and the existing browser fixture. Native PostgreSQL was not available here; the normal package installer failed with environment permission errors. Do not describe the new native contention branch as executed. The test holds a STOP transaction and requires two independent backends (START verification and final dispatch) to wait on the same recipient advisory lock.
3. Reconcile the actual approved Campaign message-flow/keyword description and provider response configuration with the returning-subscriber behavior below. Recheck the five active senders and current deployed preimages. Do not change or replace the approved Brand/Campaign silently.
4. Obtain separate, concrete production release and owned-recipient test approval. Then perform the coordinated rollout and live readbacks. Security/performance advisors and deployed function/ACL comparisons are release-time checks, not claimed as completed by local PGlite.

## Program wording review

The current source Terms says a checked website box does not erase an opt-out; that remains true. No website legal text or disclosure effective date has been changed. Twilio documents case-insensitive keywords and provider-managed opt-in confirmation; the provider remains the only automatic keyword responder ([Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out), reviewed October 8). This does not establish approval of a changed Campaign description. Public live Terms extraction was unavailable during this turn; compare the live page to source during release review.

Proposed packet addendum for review, **not submitted**:

> Initial enrollment remains through the disclosed website forms with separate optional informational and marketing SMS choices. A previously enrolled informational subscriber who opted out may reply START to the same CG Financial messaging program to request informational re-enrollment. The application verifies that request against provider evidence and the prior informational grant. START does not enroll new recipients, restore marketing permission, or override independent do-not-contact restrictions. Twilio sends the keyword confirmation; AgentFlow does not send a second automatic keyword reply.

Before activation, verify whether this returning-subscriber clarification needs a Campaign update or revised published help/Terms wording, and ensure any provider confirmation is not misleading about the application's narrower permission. If a provider update, new disclosure version or resubmission is required, present the exact change for approval. Do not imply that START is a new general-purpose signup channel or that marketing resumes.

## Coordinated rollout — requires separate approval

1. Reconfirm reviewed heads, exact migration hashes, deployed Edge preimages, CG Financial mapping, evidence totals and independent revocations. Scope is the existing five selected senders only. Record advisor baselines. Pause AF sends briefly; keep enforcement and inbound STOP handling active.
2. Replace AF `sms-consent-worker` with the new complete bundle **before** enabling UV's new independent-revocation behavior, and verify old worker invocations have drained. Before the new tables exist this worker fails closed; durable rows remain. Do not let the old generic-suppression loop run against the upgraded UV schema, because it would create an independent block that START intentionally cannot remove.
3. Apply only the reviewed UV migration; deploy/read back `agentflow-consent`. START remains disabled. Apply only the AF migration; it initializes blocked lifecycle delivery checkpoints from existing STOP rows, not historical START or new grants. Deploy/read back AF `twilio-sms-webhook` and `sms-consent-status`, and rebuild/read back the existing `sms-consent-events`, `twilio-sms` and `workflow-executor` bundles that share changed consent helpers. Reuse current scoped secrets and recovery schedules; do not rotate or expose them unnecessarily.
4. Verify live RLS/ACLs/advisors, authenticated worker recovery, canonical HMAC/nonce checks, blocked eligibility and genuine post-commit wake. Resolve any actual drift before proceeding. Keep both `start_enabled` flags false until all publication, provider-wording and deployment checks pass.
5. Use a separately reviewed guarded activation migration to set the same fresh `start_active_from` and enable START only for the existing CG Financial org/profile on both projects. No activation migration is included in this candidate because its timestamp and live preconditions must be chosen at release. An old START, including Chris's pre-release message, is not backfilled. Restore the approved ordinary send configuration after readback.
6. Ask Chris to send a **new START after activation** from his own confirmed phone to the existing sender. Verify provider SID/time, immutable evidence, matching AF/UV revision, informational allowed, marketing denied and independent DNC unchanged. Then send at most one separately authorized informational message through the normal signed-in AgentFlow composer and independently confirm delivery. No customer campaign, lead creation or backlog replay.

Recovery: set `start_enabled=false` on both sides (and pause sends if needed), leaving enforcement, original grants, STOPs, keyword events and receipts intact. Re-enablement with a new watermark requires fresh proof. Never delete an opt-out, weaken DNC, mark a failed acknowledgment successful, replay an uncertain dispatch, or fabricate a historical START to recover delivery.
