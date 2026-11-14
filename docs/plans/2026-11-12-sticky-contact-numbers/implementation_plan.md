## November 14, 2026 Pacific — approved review publication

Chris approved the three exact preview pauses and one draft PR. Saved and reloaded: Preview Branch Tracking OFF on both agentflow Vercel projects; Supabase Automatic branching OFF, Deploy to production remains OFF, Supabase changes-only ON and branch limit3 retained. No credentials, production mappings, existing branches or protection settings changed. Main remains2129fa8; all78 frozen source files match. Publish only prereq/sticky-numbers-baseline-20261113, open one draft PR, inspect isolated CI. Production installation/merge/deployment, preview restoration, activation and real communication remain held. Documentation changes only: root/focused plans, WORK_LOG and focused release approval/publication record; source and migrations remain frozen.

## November 14, 2026 UTC — release preflight (read-only production)

Authorization: Chris said Proceed to the read-only release checks. No publication, production mutation, configuration change, pilot or communication is authorized.

Exact editable paths: root implementation_plan.md; WORK_LOG.md; docs/plans/2026-11-12-sticky-contact-numbers/implementation_plan.md; release-approval.md and new release-preflight.md in that same folder; evidence/release-preflight/*; the existing delivered approval Markdown replacement and a separate recoverable preflight evidence archive. Executable source, migrations, frozen package and source candidate remain unchanged.

Commands/actions: git status --short; git fetch origin main; git rev-parse HEAD origin/main; read current docs/workflows; GitHub GET open PRs/files/check-runs/workflows; Supabase SELECT-only captured catalog queries, migration history, relation sizes/activity/cron metadata; retrieve six live Edge packages; Vercel GET project/deployment/environment metadata; permitted read-only authenticated browser fallback if connector lacks fields. Compare complete normalized captures and all frozen source hashes locally; git diff --check; local doc-only checkpoint and archive checksum/CRC checks. Do not rerun feature tests absent code changes.

Complete:85/45/381 catalog/history matches; six complete Edge matches;78 source hashes; dashboard publication settings identified. Exact results and proposed three-switch/draft-PR authorization are in release-preflight.md. No settings/publication or production execution occurred. Secondary runtime configuration, quiet window/security review and production/pilot approvals remain gates.

# Sticky Contact Numbers — authorized isolated implementation

November 13, 2026 Pacific. Owner: Chris Garness. Integration owner: ChatGPT.

## Authority and exact base

The current user explicitly authorizes bounded prerequisite recovery and isolated Phases 1–5 under the complete attached takeover prompt. No repeated approval is required for this unchanged scope. Production is SELECT-only; publication is HELD. No push, PR, preview, deployment, main merge, provider operation, live history repair/backfill/activation, or real call/text.

Base: `2129fa8b195cee77ad75f614abe655facfad2725` (current origin/main). Accessible checkout searches and remote sticky branch search did not recover reported Claude commit `d070707`; do not claim recovery. Reconstruct only the two exact missing applied migration sources and scoped documentation. The supplied 9-entry manifest was verified locally. All six deployed function packages (75 returned source files) were captured independently, retaining version, verify_jwt, entrypoint, provider bundle digest and per-file SHA-256.

Read AGENT_RULES.md, VISION.md, current WORK_LOG head and the complete takeover/reference/acceptance requirements. Existing plans/logs are preserved by prepending. Open conflicting PRs: #429 (START), #444 (ClearPath), and documentation #530/#514 overlap shared docs; none will be merged/cherry-picked. Other open work is recorded in the external evidence capture.

## Prerequisite exact edit manifest

- `implementation_plan.md` — prepend this task and link here; preserve prior tasks.
- `WORK_LOG.md` — newest-first factual checkpoints.
- `docs/plans/2026-11-12-sticky-contact-numbers/implementation_plan.md` — this controlling execution record.
- `docs/plans/2026-11-12-sticky-contact-numbers/ACCEPTANCE_TRACKER.md` — preserve all 88 IDs, add correction assertions/evidence.
- `docs/plans/2026-11-12-sticky-contact-numbers/prerequisites.md` — source provenance, package drift, isolation, command evidence.
- `docs/plans/2026-11-12-sticky-contact-numbers/prerequisite-manifest.json` — exact hashes and metadata.
- `supabase/migrations/20261002203426_inbound_recent_outbound_routing.sql` — restore exact already-applied supplied bytes only if absent.
- `supabase/migrations/20261113152433_dialer_nonretryable_conflicts.sql` — restore exact applied statements read-only if absent.

Separate captures and disposable harness preparation remain outside the repository in `../evidence`, `../runtime`, and `../reference`. Downloads never overwrite repository function source. No applied migration is edited, reformatted or newly timestamped.

## Exact prerequisite commands / backend classification

Read-only production: Supabase get_project, list_edge_functions, get_edge_function for the five changed packages plus unchanged ClearPath, list_branches, list_migrations; SELECT migration version/name/statement counts/digests and the two missing statement arrays; SELECT scoped pg_proc definitions/owner/security/search_path/ACL plus dependency tables, columns, indexes, policies and trigger definitions. No SELECT invokes a mutating application helper. Store every executed query with its result. Vercel list_projects/get_project and environment metadata only (never decrypted secrets); GitHub branch/PR/file reads only.

Local: `git status --short`, `git log`, `git cat-file -t d070707`, `git switch -c prereq/sticky-numbers-baseline-20261113`; Python SHA-256/MD5/count verification and source comparison; `npm ci --ignore-scripts --no-audit --no-fund` after lifecycle inspection; existing pinned Supabase CLI `--version`, `--help`, and `migration new --help` only before generating new migrations. Local git commits disable hooks and have no remote side effects. No push.

Isolated database: native PostgreSQL 17 bound only to 127.0.0.1, a fresh task-owned data directory and synthetic credentials. Inspect repository migration chain/cron/net/Vault/hooks first. External dispatch extensions must be absent or replaced only by fail-closed test transports; real dial evidence, authorization, grants and core objects may not be stubbed. Preserve an explicit platform-only bootstrap/adaptation list; compare relevant replay definitions/security metadata with the production catalog. Do not claim a faithful baseline until this passes. No shared old test database is reused.

## Implementation and verification sequence

Prerequisites close before feature edits. Refine and enumerate exact feature/test filenames and CLI-generated migration identities here before editing them. Then implement the agreed persistent endpoint foundation, existing-ledger SMS binding/readiness/legacy compatibility, outbound and separate inbound voice evidence/bindings/recovery, shared UI including actual Dialer SMS, and bounded history/performance/rollback tooling. TAKEOVER.md corrections control over the historical plan; automatic SMS enrollment is excluded.

Run root `npx tsc --noEmit` AND `npx tsc --noEmit -p tsconfig.app.json`, scoped lint/tests, native SQL actual-role/HTTP/concurrency tests, downloaded old Edge package compatibility/serialized-From tests, browser/mobile/a11y workflows, 50,000 endpoints/100 concurrent distinct resolutions with same-base warm p95 added <=150 ms, cold measurements, production Vite build, migration/backfill/guard-only rollback rehearsals and isolated advisors where available. Record exact-base inherited failures rather than masking them. No live load test.

Export binary-safe local patch/bundle + hashes at milestones and verify recovery in a fresh checkout. One exact release approval packet will identify candidate/source/package hashes, current live preimages, all deployment targets, reconciliation/number-readiness/recipient/activation gates and protective rollback. Release remains held pending separate approval.

## Progress

| Milestone | Implemented | Verified locally | Published | Deployed | Production verified |
|---|---|---|---|---|---|
| Prerequisite recovery/isolation | Complete; reconstructed commit 6d62e773 | 9 hashes; six packages; 85 functions/45 tables match | No | No | Read-only capture only |
| 1 Foundation | Complete | Native role/RLS/scope/readiness and deletion proofs | No | No | No |
| 2 SMS continuity | Complete | Native CAS/races, actual Edge payloads, old packages, paused receipt replay | No | No | No |
| 3 Voice continuity | Complete | Actual admission/ingest/claim, inbound/outbound evidence, late recovery, existing SDK regressions | No | No | No |
| 4 UI/lifecycle | Complete | Real three-screen sends, mobile/focus/session/View As, regression suites | No | No | No |
| 5 Candidate/reconciliation | Complete | 52 SQL cases, scale with 55k assignments, replay/rollback/history transaction, build and source packages | No | No | No |

## Final context snapshot

Changes: source candidate `a57ea11168fff51156b8d624b4966c10869d8dcd`, complete isolated implementation and recoverable artifacts. Decisions: preserve stable identity/old consumers/call architecture; no automatic enrollment or merge feature. Migrations/deployments: native only, production unchanged. Verification: see verification.md, candidate-manifest.json and the 88-row tracker; inherited app type/global test limitations are retained. Blockers: publication isolation and exact production/pilot gates in release-approval.md. Next: deliver reviewed source/recovery artifact; await explicit authorization before any external publication or production action.

## Exact isolated implementation edit manifest — authorized November 13

New SQL identities are created locally with pinned CLI `node_modules/.bin/supabase migration new sticky_contact_numbers_foundation`, `sticky_contact_numbers_sms`, `sticky_contact_numbers_voice`, and `sticky_contact_numbers_reconciliation`; record each returned path below before editing content. No remote CLI command is authorized.

Exact source/test paths:
- `supabase/functions/_shared/sms/readiness.ts`, `affinity.ts`, `affinity.test.ts`, `dispatch.ts`, `manual.ts`, `scope.ts`
- `supabase/functions/twilio-sms/index.ts`, `workflow-executor/index.ts`, `sms-consent-worker/index.ts`, `twilio-sms-webhook/index.ts`, `twilio-voice-inbound/index.ts`
- `src/lib/number-affinity.ts`, `src/lib/__tests__/number-affinity.test.ts`, `src/hooks/useContactNumberAffinity.ts`
- `src/components/contacts/ContactNumberControl.tsx`, `ChangeNumberModal.tsx`, `src/components/dialer/DialerSmsComposer.tsx`
- `src/components/conversations/ConversationThread.tsx`, `src/components/contacts/FullScreenContactView.tsx`, `src/components/dialer/ConversationHistory.tsx`, `src/pages/Conversations.tsx`, `src/pages/DialerPage.tsx`
- `src/contexts/TwilioContext.tsx`, `src/lib/caller-id-selection.ts`, `src/lib/quick-call.ts`, `src/components/layout/FloatingDialer.tsx`
- `src/lib/sms-send/sendManualSms.ts`, `pendingSmsStore.ts`, `smsSendResult.ts`, `src/lib/sms-send/__tests__/stickyIntent.test.ts`
- `src/components/settings/DispositionsManager.tsx`, `src/integrations/supabase/types.ts`
- `scripts/sticky-numbers/run.mjs`, `baseline.mjs`, `database-tests.mjs`, `edge-tests.mjs`, `browser-tests.mjs`, `performance.mjs`, `fixtures.sql`, `platform-bootstrap.sql`, `run-local.sh`, `block-network.cjs`
- `supabase/ops/sticky_numbers_guard_only.sql`, `sticky_numbers_release_readback.sql`
- `docs/plans/2026-11-12-sticky-contact-numbers/verification.md`, `release-approval.md`, `candidate-manifest.json`, plus previously listed plans/tracker/log.

Only paths actually needed will change; this list does not require incidental refactoring. An exact new path will be recorded before adding it. No AGENT_RULES edit is planned; propose the invariant in the release packet.

Commands: local CLI migration generation; apply only new SQL to a cloned disposable `sticky_candidate` database using native PostgreSQL; actual SET ROLE/JWT claim tests, PostgREST loopback and Deno transport tests with no external network; Playwright through localhost with all nonlocal routes aborted; root/app tsc, scoped ESLint/Vitest and Vite build; synthetic 50k endpoint/100 concurrent measurements; local git diff/add/commit/bundle with hooks disabled. Local runner contains mandatory loopback/database-name assertions. Run same-base checks and preserve all outputs. No live provider transport.

Prerequisite checkpoint: `6d62e7733a103aa2fb43aae16a28a8248555ba21`, bundle verified. All 85 function and 45 table catalog comparisons have zero differences. UI/sender authorization will use current contact scope and freshly checked actual actor, never arbitrary raw-phone lookup. Database integration retains old SMS signatures and admission signature.

Generated foundation path: `supabase/migrations/20261114003115_sticky_contact_numbers_foundation.sql`.

Generated SMS path: `supabase/migrations/20261114003337_sticky_contact_numbers_sms.sql`.

Generated voice path: `supabase/migrations/20261114003652_sticky_contact_numbers_voice.sql`.

Generated reconciliation path: `supabase/migrations/20261114004102_sticky_contact_numbers_reconciliation.sql`.

Disposition integration requires these additional exact existing files: `src/lib/types.ts`, `src/lib/supabase-dispositions.ts`, `src/components/settings/dispositions/dispositionSchema.ts`. They will carry only the reviewed affinity classification through the existing Zod form/API; no labels, contacted counts or default outcomes are redefined. Native function additions remain within the four generated new migration files. Offline Edge checking uses the already-installed exact Supabase 2.98.0 npm package because esm.sh connection attempts were refused; that substitution is recorded, not described as a provider deployment check.

Test fixture compatibility path: `supabase/functions/_shared/sms/sms_test.ts` will add only an off-mode guard response to its existing boundary double; new enforcement assertions live in the new affinity.test.ts/native tests. This preserves baseline consent tests while requiring the newly installed guard RPC. Candidate application tsc currently matches all 78 exact-base diagnostics after normalizing line numbers; zero new diagnostics at this checkpoint. Five changed Edge entrypoint packages pass Deno check with the recorded exact npm import substitution.

Verification manifest refinement (isolated only): add `scripts/sticky-numbers/browser.html`, `browser-entry.tsx`, `browser-auth.ts`, `browser-vite.mjs`, `extended-database-tests.mjs`, and `supabase/functions/_shared/sms/legacy-affinity.test.ts`. These exercise actual components, actual database roles and the separately downloaded immutable legacy packages; synthetic auth/provider transports exist only in the test harness. Correctness fixes remain in the four new, never-applied migrations and listed UI files. Commands: native candidate rebuild, loopback PostgREST/Deno/Chromium tests, 50k fixture benchmark and same-base regression commands already listed.

Browser transport harness also requires `scripts/sticky-numbers/browser-edge.ts`: it starts the real manual Edge entrypoint against local PostgREST, replaces provider transport with deterministic synthetic receipts and refuses every unexpected external request. No production module imports test files. Chromium executes the actual Dialer SMS, Conversations and Full Contact View components with synthetic session context.

The actual Dialer composer exposed a nonfunctional Email toggle. Add one optional SMS-only presentation prop in `src/components/messaging/MessageComposePanel.tsx`, defaulting to the existing two-channel behavior everywhere else. This removes an inert control from the new Dialer SMS integration without changing email workflows.

Implementation checkpoint: Phases 1–5 source is present locally; final verification and packaging continue. Native role/Edge/Chromium/scale suites are running against the exact verified baseline. Full regression with synthetic Vite environment hung on both base and candidate and was interrupted with exit 130; rerun the repository's default environment with a bounded worker pool, retaining both attempt logs. This is not a clean global-test claim. Mobile screenshot inspection caught content overflowing inside a correctly sized modal; controls now have bounded grid widths and the browser test checks every visible control, not just the outer dialog.

Full-suite compatibility edit manifest: the existing component suites mock the consent hook and omit a QueryClient. Add the equivalent explicit off-mode affinity dependency to preserve their existing unrelated assertions; do not suppress enforcement tests (native/Edge/browser use real RPCs). Voice lifecycle doubles must return the documented off-mode authorization result rather than null. The old Reports-only whole-file hash is superseded by this explicitly authorized telephony change and will pin the reviewed candidate; the call-type fragment will assert the same value is used in authorization and the call row. Exact additional test files:
- `src/pages/__tests__/contactDeepLinkDuplicateParity.test.tsx`
- `src/pages/__tests__/contactDeepLinkQuickCall.test.tsx`
- `src/pages/__tests__/contactDeepLinkSaveIntegrity.test.tsx`
- `src/pages/__tests__/contactsFullScreenDuplicateParity.test.tsx`
- `src/pages/__tests__/conversationsSendContract.test.tsx`
- `src/pages/__tests__/conversationsViewAs.test.tsx`
- `src/components/conversations/__tests__/conversationThreadPendingSms.test.tsx`
- `src/components/contacts/__tests__/conversationDispositionColors.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewAdditionalPolicies.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewAssignee.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewClientLeadFields.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewConversation.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewFieldVisibility.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewQuickCall.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewSaveFailure.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewSchedule.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewScore.test.tsx`
- `src/components/contacts/__tests__/fullScreenContactViewStatusSave.test.tsx`
- `src/components/contacts/__tests__/redundantDialogDescriptions.test.tsx`
- `src/contexts/__tests__/teamOpenRevealIntegration.test.tsx`
- `src/contexts/__tests__/twilioProviderLifecycle.test.tsx`
- `src/pages/__tests__/dialerPageReportsV2Exceptions.test.ts`
- `src/lib/__tests__/outboundPathPinned.test.ts`

Final replay correction: `_shared/sms/dispatch.ts` now checks an existing immutable ledger intent before mutable send readiness/consent. It validates current manual scope and the exact intent through the existing bound-prepare contract, returns accepted receipts, and keeps attempted/uncertain sends held. It never prepares new work before consent. Add paused-replay and changed-explicit-override assertions in the existing Edge/native suites; rerun those and five-entrypoint typechecking. No additional database API or production action.

Release artifact generation (no publication): write `../deliverables/AgentFlow_Sticky_Numbers_Candidate/release/install.sql` from the four exact new sources, including one transaction and their exact migration-history identities; `release/guard_only.sql`, `release/readback.sql`, `release/expected-postimages.json`; five complete source closures under `edge-packages/<slug>/`; `manifest.json`, an offline Git bundle, a binary patch, changed files, evidence and README. Rehearse the generated install transaction against a fresh native clone, with only the platform migration-history table supplied by the local harness; assert all four recorded source bytes and native postimages. This generated install file is held and never sent to production.
