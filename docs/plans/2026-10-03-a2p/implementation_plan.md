# A2P registration — implementation plan

Chris authorized implementation and completion on October 3, 2026 after reviewing the complete feature proposal. Branch: `codex/a2p-registration-20261003`; original base: `40e0deaed008dafb3674235930bf7bb941546989`. Updated to main `c6681d66cf1e25ef2b36b8d6abce54ecaf661f3d` before publishing, preserving PRs #404–405. The initial approval covered branch implementation and isolated verification. Chris separately approved applying the migration, deploying all five backend functions and merging PR #406 at 10:37 PDT. Registration submissions remain disabled pending Twilio account verification; fees and customer messages remain excluded.

## Decisions

- Add A2P Registration to the existing Phone System and deep-link routing. No voice changes. Preserve PR #402.
- Use Twilio Compliance Embeddable 2.1.3 for current business/identity/campaign fields, hosted drafts, validation, OTP, final review and eligible rejection correction. Do not retain EIN, identity documents or embedded session tokens in AgentFlow. The optional preparation form only stores non-sensitive business name, brand route, campaign description and URLs.
- Twilio access is gated: ISV approval AND Embeddable API enrollment are required. Live access cannot be established using available connectors. Service-only agency configuration must record the verified account, primary profile, enrollment, fee schedule, and existing-resource reconciliation before paid actions are enabled. Fail closed when missing; never invent approval.
- Pin each organization to its verified owning account. Verify each number's ownership and SMS capability before linking. No automatic master/subaccount migration or unknown-brand adoption. Existing resources require an explicit operator-owned mapping; public clients cannot assign resource IDs.
- Separate brand, campaign, number statuses. Provider-hosted review owns sensitive field corrections; AgentFlow displays provider rejection details, safe next actions, event history and last successful sync.
- Signed Event Streams callbacks persist an inbox before processing. Scheduled reconciliation retries pending inbox/notification work and fetches brand/campaign status. Number readiness requires a signed matching number-registration event plus current sender-pool membership, never an inferred success.
- Durable serialization prevents simultaneous creates. Unknown outcomes retain a reconciliation-required operation rather than retrying and creating duplicate paid objects. Session tokens are memory-only and expire with the page/session.
- New schema is service-written and admin-readable only. Provider account/configuration tables have no client grants. JWT validation plus trusted profiles authorizes Edge actions; expected actor/org rejects stale/view-as requests. View-As remains blocked by the existing route guard and the new component.
- SMS readiness enforcement is staged behind a server configuration flag until existing registrations are reconciled. Manual and workflow paths share one gate and use verified registered account credentials when enabled. No queued-message replay.
- Notifications reuse existing system notification rows and system email renderer; exact per-change keys, active agency administrators only, email preferences, no PII in previews. No SMS alerts.

## Exact intended files

Existing: `src/components/settings/PhoneSystem.tsx`, `src/components/settings/SettingsRenderer.tsx`, `src/config/settingsConfig.ts`, `package.json`, `package-lock.json`, `deno.lock`, `supabase/config.toml`, `supabase/functions/twilio-sms/index.ts`, `supabase/functions/workflow-executor/index.ts`, `implementation_plan.md` (new section only), `WORK_LOG.md` (newest-first entry only), `AGENT_RULES.md` (new A2P invariant).

New frontend: `src/components/settings/phone/a2p/A2pRegistration.tsx`, `A2pPreparation.tsx`, `A2pStatus.tsx`, `A2pSession.tsx`, `useA2pRegistration.ts`, `types.ts`, `schema.ts` within the same directory.

New backend: `supabase/functions/a2p-registration/index.ts`, `supabase/functions/a2p-events/index.ts`, `supabase/functions/a2p-reconcile/index.ts`; shared `supabase/functions/_shared/a2p/{types,provider,auth,store,registration,sync,events,notifications,sending}.ts`.

New migration: CLI-generated `*_a2p_registration_workflow.sql` (actual filename recorded after generation). New verification: `supabase/functions/_shared/a2p/workflow_test.ts`, `src/components/settings/phone/a2p/A2pRegistration.test.tsx`, `supabase/tests/a2p_registration.sql`, `scripts/test-a2p-db.mjs`, `scripts/verify-a2p-types.mjs`, `.github/workflows/a2p-registration.yml`. New documentation: this plan and `docs/plans/2026-10-03-a2p/release.md`.

## Verification and release

Run root and real app TypeScript checks; compare app diagnostics to the exact base. Focused provider/security/status/UI tests, build, isolated PostgreSQL migration/RLS tests, browser visual check. Re-check touched file scope and concurrent main before publishing a draft PR. No production test submissions or messages.

Release requires separately approved migration and complete Edge bundles, verified ISV/Embeddable enrollment, agency account/resource mappings, current itemized fees (including enabling the agency SMS gate before onboarding), per-owning-account Event Streams subscriptions, reconciliation scheduling, and a controlled registered-number validation. Do not declare the feature live or approved until those external prerequisites and deployments are verified.

## Verification closeout

Implemented all planned source paths; added `scripts/verify-a2p-types.mjs` for exact-base app diagnostic comparison and refreshed `deno.lock` for pinned Edge/test imports. 22 backend tests, 12 UI tests, isolated SQL assertions, Edge checks, root tsc, app diagnostic comparison and browser fixture checks pass. The full activation checklist and remaining live-provider boundary are recorded in `release.md`. The implementation does not create production registrations or deploy itself.

## CI follow-up scope

PR #406 initial broad frontend gate stopped before testing because its runner rejects any package-lock change. Add exactly `scripts/verify_reports_frontend.py` to the intended files: independently install the exact base dependencies when locks differ, retaining all existing comparisons/assertions. Pin the hosted SDK’s transitive Persona dependency to its published React 18-compatible 6.3.0 release through a scoped npm override. Re-run all gates; do not skip or weaken them.

## Approved release bookkeeping

Production backend is deployed as documented in `release.md`. Reconcile the generated migration filename to applied version `20261003174429` without changing SQL bytes, update `scripts/test-a2p-db.mjs`, and record the authorization, permissions, full-bundle readback and endpoint checks in existing documentation. No additional runtime files change. Merge PR #406 after the updated CI passes, then verify both normal Vercel production deployments.
