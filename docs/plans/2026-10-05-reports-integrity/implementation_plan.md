# Reports Phase 1 integrity — approved implementation

Chris approved the six-group audit plan on October 5, 2026. Base: b90e12d3bdcfb188ca0fbc6f25e971aaf77ddbf1. Isolated branch: codex/reports-integrity-phase1-20261005.

Full VISION.md, AGENT_RULES.md and WORK_LOG.md were read before application changes. Current main and open PR overlap checked. No production writes, migration application, historical repair, deployment, merge or main push are authorized. Phase 2 tabs/redesign are deferred.

## Contracts

1. Cap stale active sessions at the last server heartbeat using the existing three-minute threshold; clip at period boundaries and as-of. Report overlaps/missing evidence. Rates use only outbound calls created inside the same agent/campaign session intervals; unmatched calls remain Calls Made.
2. Exclude only exact reviewed organization/kind/duplicate-ID mappings. Do not populate mappings or edit source rows. Retain canonical duration; disclose estimates, legacy unknowns and conflicts.
3. Bookings created (all types) uses created_at and COALESCE(created_by,user_id), no status filter. Callback dispositions is explicitly a call disposition count; no invented historical callback creation count.
4. Stored-policy count and premium share evidence/date/current-owner scope. Monthly current-book amounts ×12; never payment-frequency scaling. Unknown stays null; empty cohort is zero, all-unknown cohort unavailable. Primary legacy zero requires explicit same-policy zero evidence; explicit additional zero is known. Campaign premium shares the same unambiguous visible lineage subset.
5. Versioned RPCs accept requested personal/team/agency scope; actual database profile and Reports permissions authorize it. Agent filters only narrow. Preserve default maximum scope and existing agent selector; no new tabs. Reject stale starts/results/exports and View As.
6. Exact seconds/cents; Monday week; required per-response as_of/basis version; non-identifying campaign/source reconciliation and quality notes in UI/CSV. Independent responses are not a transactional cross-panel snapshot.

## Planned exact files

- src/pages/Reports.tsx
- src/hooks/useReportsData.ts
- src/lib/reports-{queries,schemas,format,policy-text,export}.ts
- src/lib/stat-computations.ts
- src/lib/reports-integrity-text.ts (new shared quality/export wording)
- src/components/reports/{AgentEfficiency,AgentPerformanceCards,CommunicationsStats,CallDurationAnalysis,CampaignPerformance,LeadSourceTable,reportSectionMap,ReportDataQuality}.tsx (ReportDataQuality new)
- Two CLI-created supabase/migrations/*_reports_integrity_readers.sql and *_reports_scopes_and_policy_premium.sql (exact generated names recorded below)
- supabase/tests/reports_integrity.sql and reports_integrity_dependencies.sql (new)
- scripts/tests/reports-integrity-embedded.mjs and scripts/run_reports_integrity_tests.sh (new isolated runners)
- supabase/ops/reports_disable.sql and reports_integrity_enable.sql (new version-aware enable; old enable retains old-body guards)
- Existing Reports frontend tests: src/lib/__tests__/{reportsContracts,reportsPolicySource,reportsQueries,reportsExportFormat,reportStatComputations}.test.ts, src/hooks/__tests__/useReportsData.test.tsx, src/pages/__tests__/reportsPage.test.tsx
- New src/lib/__tests__/reportsIntegrity.test.ts and shared fixtures if required by the strict v2 contract
- .github/workflows/reports-backend.yml (add new isolated gate without weakening existing suites)
- implementation_plan.md, WORK_LOG.md, AGENT_RULES.md and this directory's implementation_plan.md / verification.md

## Verification and recovery

Run old Reports SQL regression suite unchanged where native PostgreSQL is permitted; add synthetic authenticated-role v2 scope/security, duplicate, session, premium and boundary cases, source immutability, negative controls, drift/replay and disable/re-enable. Prove existing index plans at larger synthetic volume. Embedded PostgreSQL is useful for SQL semantics but does not prove independent-session concurrency. Run focused frontend and relevant policy tests, actual app TypeScript baseline comparison, root tsc, lint, build and broad-suite comparison. Document runtime/browser restrictions honestly.

Recovery is disable-only while retaining additive helpers and all raw records; never unseal legacy RPCs or restore win-based policy readers while enabled. Production approval will be requested only with a concrete reviewed candidate and exact migration checksums/order.

Necessary verification files: scripts/reports_integrity_fixture.py (shared verbatim dependency loader); src/lib/__tests__/reportsFixtures.ts (strict v2 synthetic payloads). Migration names: 20261005183955_reports_integrity_readers.sql, 20261005184012_reports_scopes_and_policy_premium.sql.

Review-driven verification additions: supabase/tests/reports_integrity_controls.sql, reports_integrity_negative.sql and reports_integrity_performance.sql; payload identity export guards, explicit returned-scope check, unavailable premium on screen, effective recovery ACL assertions and inherited-grant negative control. Task-local release_packet.md, verification.json and source_manifest.json record the final review and exact files. reportSectionMap.tsx needed no edit. No release or historical mutation added.

## Publication / browser gate continuation — October 5

Chris approved publishing the reviewed candidate to the public repository and opening a draft PR for native CI and browser verification. Production activation remains unapproved. Preserve the exact candidate tree when publishing through the GitHub app if shell credentials are absent. Add an isolated Reports browser fixture under scripts/tests/reports-visual/ (entry.tsx, stubs.ts, vite.config.ts, index.html, verify.mjs, README.md) and wire it into .github/workflows/reports-backend.yml using only synthetic native SQL payloads. Record CI corrections/results in this task's verification/release records and WORK_LOG; refresh the source manifest. No production data, writer, RLS or Edge changes.

## October 6 production closeout

The owner approved the production rollout October 5 at 20:33:16 PDT, superseding the earlier release hold. Closeout work on `codex/reports-release-closeout-20261006`, based on production merge `960accd1`, reconciles the two migration filenames to their actual hosted versions with identical SQL bytes, copy the exact CLI-created disable/enable sources under their recorded hosted versions, update the active fixture/schema references, amend invariant #41 and prepend the work log, and add `production-release.md`. Historical approval records retain their original authored filenames. Final role/reconciliation/exporter evidence is recorded in production-release.md and the source manifest is refreshed. No migration replay or application behavior change is part of this bookkeeping.

The deployed implementation is live. Actual authenticated administrator browser evidence covers all six v2 panels and the default Last 30 Days view. Download/filter/refresh browser verification is limited by native credential protection and the later browser binding block. Production CSV downloads, every-role HTTP verification and a completed manual filter/refresh walkthrough must not be claimed. Record database-role simulations and deployed-exporter checks as separate evidence.

Browser review correction: keep Call Summary premium tiles across two existing grid columns and the Agent Performance premium across its card width; allow labels/values to wrap so monetary cents are never hidden. Add actual DOM clipping checks and settled screenshots at desktop/mobile widths. This is a verification-driven readability fix within the existing Reports sections, not the deferred Phase 2 redesign.
