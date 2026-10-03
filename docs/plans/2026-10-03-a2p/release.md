# A2P registration release and activation

Status: implemented on `codex/a2p-registration-20261003`, **not deployed or activated**. Chris authorized completion of the branch build. Production deployment, paid registrations, credential changes, customer messages and merging remain separate actions. Initial base `40e0deae`; refreshed to `c6681d66cf1e25ef2b36b8d6abce54ecaf661f3d` to preserve PRs #404–405.

## What is implemented

Phone System → A2P Registration (`/settings?section=a2p-registration`) contains saved preparation, a requirements checklist, explicit current-fee acceptance, secure business/brand and campaign submission, eligible draft/rejection resume, separate brand/identity/campaign/number status, rejection details, refresh, number linking and history. While open, the tab checks persisted decisions every 60 seconds. Active agency administrators receive in-app decisions and preference-respecting system emails.

Twilio's hosted form collects the complete business identity and campaign application, including tax ID, address, representative, verification/OTP, messaging use cases, samples, consent evidence, disclosures and final review. AgentFlow's preparation fields are a worksheet; campaign description/policy/terms fields are **not** silently represented as having been submitted to Twilio. Enter/review them in the hosted application. Standard versus low-volume messaging is selected there. Browser sessions exist only in memory; no tax IDs, identity documents or session tokens are intentionally persisted in AgentFlow. The hosted provider retains the full application; AgentFlow retains its preparation, fee-authorization and status history.

The schema is service-written, with own-agency active-admin reads only. Expected actor/organization checks supplement verified JWT/profile authorization; View As cannot operate the tab. Account configuration, events and email work have no browser grants. Unknown provider mutation outcomes retain a durable operation lock for reconciliation; no automatic paid create retry occurs. Events are signature/body-hash verified, account/resource scoped, stored before acknowledgement, deduplicated, then reconciled by the worker. Brand/campaign decisions come from current provider resources; signed number events and sender-pool membership are independently required.

Manual and workflow SMS share the A2P gate for enabled agencies. Automated messages select active registered shared numbers; personal senders are owner-only for manual messages. Before sending, the gate checks approved real registration, identity, sync health/freshness, number registration, actual account ownership and current sender-pool membership. Configuration without SMS enforcement cannot enable registration submission. Organizations not yet onboarded keep their existing SMS behavior. No queued-message replay, voice/dialer changes, or global consent-policy rewrite is included.

## Verification evidence

- 22 Deno backend tests: signature/body tampering, scope/auth/View As, validation/concurrent editing, simultaneous creates, uncertain outcomes, token non-persistence, rejected-campaign resume, country/ownership, shared-sender selection, live-membership gate, body limits and email eligibility/idempotency.
- 12 React tests: access guards, StrictMode, fee and setup gates, retry/error, rejection details, independent readiness, pending-number retry, unsaved edit preservation, hosted completion/expiration, stale account responses and open-tab updates.
- Isolated PostgreSQL (PGlite 0.3.14): apply the real migration; verify RLS/ACLs, cross-agency restrictions, stale snapshot rejection, atomic status/membership, ordered/deduplicated number transitions and notification preferences/deduplication. The dependency fixture is deliberately minimal; this is not a full remote Supabase integration run.
- All five affected Edge entry points pass Deno 2.5.2 type-check. Root `npx tsc --noEmit` passes. Actual app check has the same 88 existing errors as the inspected base, with no new diagnostic fingerprints; the new CI compares against the exact PR base without modifying existing gates.
- Focused frontend lint: zero errors; one existing PhoneSystem fast-refresh warning. Production build passes with the existing bundle-size warning. Registration and the hosted SDK are lazy-loaded.
- Browser: actual new components rendered against an isolated synthetic fixture at desktop and 390px width. Draft save, rejection details and approved readiness were inspected; no horizontal overflow, page errors or framework overlay. This is not an authenticated production walkthrough or a live hosted-provider session.
- Read-only deployed-source comparison: `twilio-sms` v33 and `workflow-executor` v23 main source match the original git base (ignoring surrounding newlines). Re-check complete bundles immediately before a future deployment.

Reproduce from the repository root:

```bash
npm ci
npm install --prefix /tmp/a2p-tools --no-package-lock deno@2.5.2 @electric-sql/pglite@0.3.14
/tmp/a2p-tools/node_modules/.bin/deno test --allow-env supabase/functions/_shared/a2p/workflow_test.ts
A2P_PGLITE_MODULE=/tmp/a2p-tools/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-a2p-db.mjs
npx vitest run src/components/settings/phone/a2p/A2pRegistration.test.tsx
npx eslint src/components/settings/phone/a2p src/components/settings/PhoneSystem.tsx
npx tsc --noEmit
A2P_BASE_SHA=c6681d66cf1e25ef2b36b8d6abce54ecaf661f3d node scripts/verify-a2p-types.mjs
npm run build
```

The workflow `.github/workflows/a2p-registration.yml` also checks the five complete Edge entry points. No test uses live Twilio credentials, sends a customer message, or writes to production.

## Required account setup

Access to the live Twilio account was not available in this session. Confirm these facts before enabling any agency:

1. Platform primary ISV/reseller Customer Profile is approved; Twilio has separately enabled **Compliance Embeddable A2P** for the actual owning account, including subaccounts as applicable. A general Trust Hub profile alone does not establish this entitlement. Verify iframe origins/CSP and any configured theme with Twilio in staging. Trials are not sufficient.
2. Inventory existing brand bundle/BN, campaign/QE, Messaging Service/MG and phone/PN resources in their actual account. Do not create duplicates. Current application numbers are on the master account unless an explicitly verified migration says otherwise. Do not move numbers, change voice applications or adopt another agency's resources.
3. Record an approved per-agency configuration migration with verified `organization_id`, `account_sid`, `account_scope`, platform `primary_profile_sid`, `enrollment_verified_at`, `resources_reconciled_at`, optional `theme_id`, and a versioned current `fees` array (`label` and `amount` strings), `fee_version`, `fees_valid_until`. Include registration/vetting, monthly, resubmission and relevant carrier/usage charges; do not use synthetic test prices. Initially keep `enabled=false`, `sms_enforced=false` until the deployment/mapping checks are complete.
4. Existing resources must be explicitly mapped through a reviewed migration to `a2p_registrations` and `a2p_numbers`. Set all six preparation fields, and preserve each provider SID/account relationship. Brand inquiry IDs use `tri1.us1.account.AC….registration.BU…`. Rejected submitted campaigns resume via MG, not their removed inquiry bundle. Refresh brand/campaign from Twilio after mapping.
5. Existing numbers without a retained signed registration event stay unready. Do not turn pool membership or campaign approval into a fabricated number approval. Obtain/replay the authentic provider event or complete a separately approved provider-supported reconciliation before activation. The current public API does not provide a replacement number-registration proof in this implementation.

## Deployment order and callbacks

After exact release approval:

1. Recheck main/PR status, deployed code drift and production migration history. Apply `20261003160224_a2p_registration_workflow.sql` once, before either SMS endpoint imports the new gate. If the deployment tool assigns a different migration version, reconcile the filename and test runner reference while preserving applied SQL bytes. Inspect resulting policies/grants/advisors. This migration creates only new A2P tables/functions and does not populate live agencies.
2. Deploy complete dependency bundles for `a2p-registration`, `a2p-events`, `a2p-reconcile`, `twilio-sms`, and `workflow-executor`; preserve all existing shared imports. `verify_jwt=false` is intentional: the registration function verifies JWT itself, events verify Twilio signatures, and the worker checks its separate secret. Check these flags in deployed metadata, not only config.toml.
3. Set the existing platform/subaccount credentials via their established secret/Vault paths. Add a high-entropy `A2P_RECONCILE_SECRET`. Keep `RESEND_API_KEY` and the existing approved system-email sender/site URL configuration valid. Never expose service role, Twilio tokens or the reconciliation secret to the browser.
4. Under **each owning Twilio account**, create/test an Event Streams webhook sink with exact URL `https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/a2p-events?account=AC…` and method POST. Preserve that public URL and query order for signature validation. The signature also covers Twilio's `bodySHA256` query parameter; do not proxy/rewrite the URL without updating the validation contract.
5. Subscribe the sink to the current schemas for the types below. Verify delivery of an authentic signed event, an invalid signature being rejected, persistence before acknowledgement, replay deduplication, and worker processing. Twilio sink test events may not match an agency registration; HTTP success alone is not proof of a mapped status transition.
6. Schedule POST to `/functions/v1/a2p-reconcile` **every minute**, with `Authorization: Bearer <A2P_RECONCILE_SECRET>` and JSON `{}`. Use the established secret store/scheduler and an approved configuration migration, not a browser or public service-role key. If using pg_cron/pg_net, keep both the function URL and worker secret in Vault and allow at least a 100-second request timeout. Verify a real scheduled run and response; merely deploying the endpoint does not schedule it.
7. Worker passes process up to 25 events, refresh up to two oldest-attempted agencies, and attempt up to three emails; provider work has a 45-second deadline. Confirm this capacity against agency count/backlog before rollout. Increase cadence/capacity with measured evidence if needed. No automatic provider subscriptions or cron job are created by the schema migration because credentials/account choices require explicit configuration.
8. Deploy frontend after the backend is present. For the explicitly selected agency, enable `sms_enforced=true` before or together with `enabled=true` through the reviewed configuration change. Unready senders then fail closed. This intentionally blocks that agency's SMS until registration completes; voice remains unaffected.
9. In staging first, exercise draft → hosted submission → pending → approved/rejected → correction/resubmission, representative verification, number registration and deregistration, notifications and email preference changes, session expiry, account switch, provider outage and uncertain-create recovery. Then perform a separately authorized controlled production check with an owned consenting test recipient. No live customer traffic is needed to verify the form.

Event type IDs (use current published schema versions when configuring):

- `com.twilio.messaging.compliance.brand-registration.brand-registered`
- `com.twilio.messaging.compliance.brand-registration.brand-failure`
- `com.twilio.messaging.compliance.brand-registration.brand-verified`
- `com.twilio.messaging.compliance.brand-registration.brand-unverified`
- `com.twilio.messaging.compliance.brand-registration.brand-vetted-verified`
- `com.twilio.messaging.compliance.brand-registration.brand-secondary-vetting-failure`
- `com.twilio.messaging.compliance.campaign-registration.campaign-submitted`
- `com.twilio.messaging.compliance.campaign-registration.campaign-failure`
- `com.twilio.messaging.compliance.campaign-registration.campaign-approved`
- `com.twilio.messaging.compliance.number-registration.pending`
- `com.twilio.messaging.compliance.number-registration.successful`
- `com.twilio.messaging.compliance.number-registration.failed`
- `com.twilio.messaging.compliance.number-deregistration.pending`
- `com.twilio.messaging.compliance.number-deregistration.successful`
- `com.twilio.messaging.compliance.number-deregistration.failed`

## Operations and recovery

Monitor scheduled worker failures, oldest `sync_attempted_at`/`last_synced_at`, `sync_error`, event backlog/retry times, event `attempts>=8`, email `attempts>=6`, and old `operation_started_at`. Webhook payloads are sanitized before persistence; do not log raw session responses, documents, tokens or application PII.

For an uncertain operation, inspect the persisted operation kind/start time and provider resources in the pinned account. Use the deterministic friendly name, stored MG/BU/BN IDs and provider logs to determine whether creation succeeded. In a reviewed repair migration, attach the confirmed resource if necessary, refresh status, and clear the operation **only after** the provider outcome is known. Never unlock on a timer, blind-create another brand/campaign, or delete a paid resource to retry.

Event retries use exponential backoff and stop after eight attempts for operator review. Correct the verified mapping, then replay the retained inbox event with a reviewed reset of attempts/retry time; do not alter its signed-event meaning. Unknown/old number events cannot grant approval. Email delivery uses stable Resend idempotency keys, rechecks active-admin eligibility/preferences, and stops retries after 23 hours rather than risk a duplicate after provider idempotency expiry. Investigate stopped entries before any manual resend.

Number registration failure while still in the sender pool may require provider support. The UI only retries a missing pool link; it never removes/re-adds a number to force a registration, moves it from another service, or promises that every rejection is resubmittable. Unverified brand identity follows the provider's verification email/text; expired verification may require support.

If rollout fails, stop new registration actions with `enabled=false` while leaving `sms_enforced=true` for already-onboarded agencies. This blocks unsafe sending. Keep schema, resource mappings, inbox and history. Roll back frontend if needed, then fix forward on the gate/callbacks. Do not disable enforcement to make a failed sender appear usable, delete registrations, or revert the unrelated voice/DNC fixes.

## Provider references checked October 3, 2026

- [Compliance Embeddable](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/compliance-embeddable-onboarding) — current hosted request/session flow, entitlement and required-field collection.
- [Brand Registration](https://www.twilio.com/docs/messaging/api/brand-registration-resource) — bundle-scoped lookup, status and identity.
- [US A2P resource](https://www.twilio.com/docs/messaging/api/usapptoperson-resource) — campaign state/error readback.
- [A2P Event Streams](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/event-streams-setup) and [Webhook Quickstart](https://www.twilio.com/docs/events/webhook-quickstart).
- [Messaging Service phone numbers](https://www.twilio.com/docs/messaging/api/phonenumber-resource), [error 21712](https://www.twilio.com/docs/api/errors/21712) and [Basic Lookup](https://www.twilio.com/docs/lookup/v2-api).

## Initial PR CI follow-up

PR #406 at `11c80f46` passed A2P CI `37139197573` and Dialer DNC CI `37139197536`. The broader frontend runner stopped before testing because it intentionally refused a changed package lock with a shared baseline installation. Its follow-up now installs the exact base independently when dependencies differ and keeps every comparison/assertion. A scoped npm override pins Persona React 6.3.0 (published React peer `>=16`) instead of the SDK transitive 6.7.0 requirement for React 19; AgentFlow remains React 18. The dependency tree is verified without a peer conflict. Final checks rerun on the follow-up commit.
