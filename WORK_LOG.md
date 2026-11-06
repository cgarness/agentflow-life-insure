# AgentFlow Work Log

## November 6, 2026 — Remaining Havana test correction approved; PR #517 release gates OPEN

Chris approved `supabase/tests/reports_integrity.sql` and `supabase/tests/performance_sold_date.sql`, plus the existing root plan/work log/readiness updates, validation and publication with automatic CI/preview attempts. The T-1 integrity edge samples, windows and buckets now use November 2, 2025. The performance Sold Date samples now genuinely exercise both historical midnight occurrences. Existing T-2 session evidence, assertions/counts, application code and frozen release bytes are preserved. Total PR scope is 48 paths; this follow-up changes exactly those two tests, `implementation_plan.md`, `WORK_LOG.md` and `docs/plans/2026-10-31-reports-v2/evidence/release-readiness-2026-11-06.md`.

**Verification:** root TypeScript/build pass; configured Reports/dialer selection 974 pass/1 skip/no failures. App TypeScript 79 errors and lint 11 errors/142 warnings match main by identity. All 36 frozen files match candidate 38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c. Existing disposable counts/recovery harness verification is detailed in the readiness addendum. Final-head native CI results are recorded on PR #517 after publication; embedded success alone is not native acceptance.

**State:** base 9b673e06a7157e51066862e8b1079a1d17ccc929; main unchanged at 09ec29a4e6a22f9679d1cfa44b2f1cf57c874e2d. Prior head had five passing workflows and DNC failing at the now-corrected T-1 assertion; both Vercel previews passed and Supabase Preview was skipped (no associated branch after the initial branch-limit failure). No production migration/write, dispatch, settings change, merge or release stage. Independent reviewer/sign-off, owner visual/CSV/map acceptance, confirmed reporting zones and native assembled-v3 rehearsal remain open. Completed B6 result remains 2 distinct discrepancies; no classification/correction.

## November 6, 2026 — PR #517 Havana historical fixture correction; release gates OPEN

Chris approved two additional test files and updates to the existing plan, work log and readiness record, including publication with automatic CI/preview attempts. The inherited T9 assertion predicted a November 2026 Havana fall-back removed by IANA tzdb 2026f. Use the historical November 2, 2025 transition instead: k30 precedes the day; k31 and new k39 exercise both midnight-hour occurrences. Preserve 25-hour bounds, first-midnight selection, bucket/total parity, Los Angeles, spring-forward and calendar-day property checks. The fixture completeness guard now expects 39 calls.

**Files:** `supabase/tests/reports_fixtures.sql`, `supabase/tests/reports_rpc.sql`, `implementation_plan.md`, `WORK_LOG.md`, `docs/plans/2026-10-31-reports-v2/evidence/release-readiness-2026-11-06.md`. Total PR scope is now 46 files, including the original 44; all 36 frozen release files remain byte-identical to 38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c.

**Verification:** configured Reports/dialer Vitest selection passes 974 tests, 1 skipped, zero failed suites. Initial runs without the CI synthetic environment produced the same two missing-Supabase-URL suite failures on main and candidate; supplying the existing loopback-only CI values resolved them. Root TypeScript and build pass. App TypeScript has 79 baseline errors; lint has 11 errors/142 warnings; both match main by diagnostic identity. Embedded PostgreSQL counts/regression/recovery validation is recorded in the readiness addendum. Native final-head CI remains pending publication. No claim of fresh assembled v3 native release rehearsal.

**Migrations/deploys:** no production action, workflow dispatch, merge, settings change or release stage. Existing PR #517 is draft at 7400de623f96737f84dd638220dc1e564e173392 before this follow-up; five initial workflows and both Vercel checks passed, while DNC failed on the corrected fixture and Supabase preview hit the concurrent-branch limit. Main remains 09ec29a4e6a22f9679d1cfa44b2f1cf57c874e2d. Draft #486 and #514 remain open; their work was not incorporated.

**Gates:** independent reviewer unappointed/sign-off OPEN; owner visual/CSV/map acceptance OPEN; three organization zones require confirmation; native assembled-release rehearsal outstanding. B6 remains the completed approved read-only result: 2 distinct discrepancies with separate premium/Sold Date observations; no classification or correction. Observe automatic final-head checks after publication. No integration setting changes or production actions authorized.

## November 5, 2026 Pacific / November 6 UTC — Reports V2 review preparation COMPLETE; release gates OPEN

**Scope:** local `docs/reports-v2-review-20261105` from main `09ec29a4`; frozen candidate `38bd32dbddc21ec6c3d4adbcc8489f06cb64bb7c` preserved. Exactly 44 approved files: 34 pinned SQL, unchanged runner/workflow and eight docs, enumerated in the focused release-readiness record. Root AGENT_RULES stages only Package A clauses. Package B FullScreenContactView exception is limited to the existing single onPolicyRecordChanged prop; no extra mount/refactoring.

**Verification:** all 36 frozen files byte-equal; local 34-pin runner check passes. Root tsc and build pass. App typecheck 79 errors; lint 11 errors/142 warnings: identical to main by identity. Reports tests on both: 384 pass/1 skip. B6 approved hash passed 55 isolated checks, then unchanged read-only production execution returned 44 events and 2 distinct discrepancies, each with separate premium/Sold Date flags; redacted output only, classification pending. Contract-3.3.0 A+B+C+D synthetic evidence contains 44 screenshots/37 actual exports, 474/474 browser checks and 30/30 supplemental checks. Embedded visual DB uses a non-concurrent index and skips eight native index negative controls; not a new native release rehearsal. Prior frozen 17/17 native evidence retained.

**Migrations/deploys:** NONE in production; no schema/data/category/policy/zone write, impersonation, dispatch, push, PR, merge or deployment. Three one-active-user organizations have missing company_settings rows and need confirmed IANA reporting zones. Independent reviewer unappointed; security and owner visual/CSV/map acceptance remain open. Draft #486 premium overlap and shared docs work must be rechecked. Next approval is publication of the exact prepared commit and a draft PR, explicitly accepting Supabase preview, six matching Actions workflows and possible Vercel previews. See the release-readiness record and attached actual review files.

## 2026-11-04 Pacific / November 5 UTC — P0 Dialer frontend RELEASED AND VERIFIED

Chris approved PR #515 at `1e98c55ad8d10f88dbc5f62b6d9c4c4405b94cc5` after the database gate. Merged through the PR with expected-head protection as `c9713060949b431ca49b884869165f39e7065666`; the merged tree exactly matches the approved tree `0003afb4957ff3efd0c932d40ad829a06ec6eef4`. No direct main push. Both Vercel production builds are READY; agentflow deployment `dpl_BoEcDFmvef9oFmLBmJNwP6zTyPga` serves www.fflagent.com at that commit.

**Changes:** Skip commits one membership-ID transition and ignores stale queue/URL/async results. Navigation preserves unsaved outcomes and queue locks; calling-hours refusal pauses Auto Dial without persistent automatic skips. Call uses visible shared gates and one action owner, revalidates after async work, retains browser Voice.js re-entrancy guards and records truthful failed/unconfirmed dispatches. Signed admission controls new call totals; new session mode metadata matches the campaign/current runtime toggle. Single-leg Voice.js, DNC, cooldowns, callback/queue locks, disposition history, organization_id and RLS remain preserved.

**Verification:** All six workflows passed on exact head 1e98c55, including 606 dialer tests/47 files, native PostgreSQL 16.15 contention in both admission/failure orders, DNC/claim/save races, drift/replay/rollback and report-reader checks. Full repository comparison: 6,765 base / 6,801 candidate passing tests, zero new failures or unhandled runtime errors; existing one failed test/nine failed files and type/lint debt remain documented. Root tsc, scoped lint and build pass. Immediately before merge, all eight live backend postimages/authorization metadata still matched. Production bundle `/assets/index-BIiTv98T.js` is HTTP 200, SHA-256 `f0f32a6d5bf741173ae6a1a6c4ab5a6451ea6817090fb73acefa153e82f3e870`, with the new gating/mode/admission markers. Public/login browser smoke passes with no captured application errors; Vercel returned no error/fatal runtime groups in the scoped observation. These do not prove live Voice.js audio.

**Migrations/deploys:** Database versions 20261105051018 and 20261105051037 were already applied and verified; neither was replayed. No Edge/RLS change, historical repair, production fixture or real call. This release-record follow-up touches only WORK_LOG.md, root/focused implementation_plan.md, AGENT_RULES.md release status, focused verification.md/manifest.json and new frontend-release.json. Application, SQL, tests and workflow bytes are unchanged.

**Conflicts/next:** Reports head is bfa6ff9627b435a73c48b8c1572a2609b16a93e6; its newer unattributed-display fix adds no dialer/SQL overlap. Preserve the existing appointment type/sourceCallId/API forwarding mounts and coordinate the updated call-facts/recovery pin before Reports release. Live microphone/carrier/full disposition acceptance still needs an authorized synthetic endpoint; no prospect is to be used. Will's historic failed click remains uncorrelated. See focused verification.md and frontend-release.json for evidence and limits.

## 2026-11-04 Pacific / November 5 UTC — P0 Dialer backend RELEASED AND VERIFIED; frontend pending

Chris approved the exact database-only release from PR #515 at a7c8f74. Applied payloads once through Supabase migrations, in order: `20261105051018_dialer_reliability` and `20261105051037_dialer_admitted_call_counts`. These are the previously approved `20261104233202` and `20261104234307` payloads with identical SHA-256/SQL bytes; renamed repository files to the actual recorded versions to prevent replay. History has one exact SQL statement per migration, with matching payload MD5.

**Verification:** All eight function body postimages/owners/security/search paths/ACLs match. Two columns, admission projection trigger and three new functions match the reviewed source; authenticated-only RPC grants and actor refusal verified. All 605 unrelated functions, 371 policies, 170 table security/ACL configurations, seven original call/session triggers and original call columns are unchanged. All 3,537 existing signed-admission projections agree (3,534 admitted, three refused, zero mismatches). Read-only synthetic nil-ID checks proved both RPCs reject a missing actor before writes. Advisors 265→267: only the two intentional actor/org-scoped authenticated SECURITY DEFINER RPC warnings; existing app_config/webhook_debug_log issues remain in the separate security scope. No real call or production test row.

**Files/decisions:** SQL filenames and only their paths in the two synthetic runners; root/focused plans, this log, verification/manifest, new production-release.json and the existing dialer rule's release status. Application, Edge, RLS, test assertions and SQL bodies are unchanged. Main/production stays at 2b6f5ce; Reports overlap head remains f7ff977. No frontend merge/deploy, history repair, rollback or real media test. Prior a7c8f74 CI: all six workflows green; 606 dialer tests and native concurrency/rollback pass, full-repository comparison has no new failures. Final follow-up checks must complete after filename reconciliation.

**Next:** Finish final branch checks, obtain separate exact frontend merge/release approval, verify Vercel and an authorized synthetic-contact call/disposition lifecycle. Do not replay either migration. Backend rollback remains separately gated and retains all history/additive metadata. See focused production-release.json and verification.md for hashes, installed state and advisor delta.

## 2026-11-04 Pacific / November 5 UTC — P0 Dialer PR #515 published; native CI passed; PRODUCTION RELEASE NOT APPROVED

**Approval/publication:** Chris approved publishing the reviewed branch/PR, CI and possible previews. Draft [PR #515](https://github.com/cgarness/agentflow-life-insure/pull/515) publishes commit `2fc8dce8bbf2293d454c219d810e72fb184c6337`; its tree `52ee2f3b44a2289241ae21c8f45262ed40d19ac1` exactly matches reviewed local `87c1582a8cdf70d6bde5758842b1624f6e3f0d70`. Main/production remains `2b6f5ce`, Reports overlap head remains `f7ff977`. No main push, merge or production mutation.

**Verification:** Native PostgreSQL 16.15 CI run `41943152769` passed both actual migrations, eight existing function ACL/security/search-path checks, forged admission and cross-tenant refusals, new session-mode/failure-receipt/count semantics, exact rollback/drift/replay checks, report readers and recovery pin. Failure/admission row-lock contention passed in both orders; existing DNC/claim/stale-admission/duplicate-save/SKIP LOCKED concurrency passed. All 606 dialer tests in 47 files passed again. SMS, Reporting integrity, Reports backend and all three UV jobs passed; the full Reports frontend exact-base comparison was still running when this evidence update was prepared. Final-head checks remain required. Existing app type/lint debt and real-media limits are unchanged.

**Files/decisions:** Documentation-only follow-up: root implementation_plan.md and WORK_LOG.md; focused implementation_plan.md, verification.md, test-results.json, manifest.json and new publication.json. No application, migration, rollback, workflow or test bytes change. Workspace transport became unavailable during this follow-up; the original published documents were read back and checked against their recorded byte counts/SHA-256 before updating through GitHub. Exact implementation stays on the already-published review branch.

**Migrations/deploys:** Both automatic preview deployments are READY (`dpl_ArzDNSPo6fG9ZLGsXR73T75ijjX7`, `dpl_hQL5EbiDw94woubs51Pvtmz58ZWM`). They are previews, not production. The two SQL candidates `20261104233202_dialer_reliability.sql` and `20261104234307_dialer_admitted_call_counts.sql` remain unapplied, with unchanged hashes in the verification record. No Edge change, production fixture or real call.

**Next gates:** Finish final-head CI, separately approve those exact production migrations, recheck live preimages/ACLs and apply/verify in order, then obtain the separate frontend merge/release approval. Full signed-in acceptance requires the matching backend; real media/provider callbacks need an authorized synthetic-contact test. The specific failed-click cause remains unconfirmed. Production is unchanged.

## 2026-11-04 Pacific / November 5 UTC — P0 Dialer reliability implemented locally; RELEASE NOT APPROVED

**Approval/baseline:** Chris approved the reviewed isolated implementation and synthetic tests. Branch `hotfix/dialer-reliability-20261104` is based on production/main `2b6f5cefe4f4d7980ab670067a5634e320cd20fd`; Vercel production remains READY at that SHA. No publication, merge, deployment or production mutation. Reports V2 advanced to `f7ff977992a873f23ac9bbe27eeadd878a3f83be` with two Work Log-only commits; its appointment type/source-call mounts and live Reports reader/recovery pin remain explicit integration overlaps.

**Diagnosis/fixes:** Separate queue/index/URL writers, timer-owned unlocks and effect-driven hours Skip created confirmed transition risks. Added atomic membership-ID selection, unique scope/action ownership, stale-response rejection, navigation draft protection and a pause instead of automatic Skip. Call now shares visible readiness/lock gates, owns preflight before awaits, joins identical pending session starts and preserves all Voice.js re-entrancy/DNC/authorization/caller-ID guards. Mic errors explain denied/missing/busy recovery. Failed dispatch keeps one attempt UUID and a truthful not-sent/unconfirmed receipt; business call counts require signed admission rather than optimistic dispatch. Sessions initialize/synchronize current Auto Dial metadata without rewriting historical sessions. Read-only Will Harrison campaign evidence confirms campaign false/session true metadata; the 32 sampled calls had signed admission, and no particular failed click has a confirmed cause.

**Files:** DialerPage, DialerActions and new DialerPrimaryActions; useDialerNavigation/dialer-navigation, useDialerStateMachine, useDialerSession, dialerCallGate, TwilioContext, dialer-api and session API; focused page/hook/provider/control tests; synthetic browser/SQL/native-contention runners; existing DNC CI workflow; two candidate migrations and SQL suite; Reports recovery pin/historical fixture; focused plan/preimages/metadata/rollback/manifest/verification, root plan and proposed AGENT_RULES invariant. Full exact file list and hashes are in `docs/plans/2026-11-04-dialer-reliability/manifest.json`. `queue-manager.ts` and canonical claim/disposition/DNC functions were inspected and preserved.

**Verification:** 606/606 tests across 47 dialer-related Vitest files pass. Chromium actual-hook/control integration passes with external traffic blocked. Disposable PostgreSQL (PGlite) applies both exact migrations; existing DNC/disposition/security suites, new receipts/mode/tenancy/counting checks, five report readers, drift/replay guards and exact rollback pass. Reports V2 recovery accepts only the new reviewed pin. Required `npx tsc --noEmit` and build pass; meaningful application typecheck is baseline 79/candidate 79/new 0, full lint baseline 11 errors/candidate 11/new 0 (warnings 152→142). No unrelated fixes hidden. Native multi-connection tests are prepared but NOT run here; synthetic SDK tests do not establish real media/carrier delivery. See focused verification for commands and limits.

**Migrations/deploys:** `20261104233202_dialer_reliability.sql` and `20261104234307_dialer_admitted_call_counts.sql` are LOCAL CANDIDATES ONLY. Three-second lock/60-second statement limits, exact source/ACL/security drift guards, additive metadata projection and actor-scoped RPCs; existing permissions/policies/telephony functions preserved. Projection sizing was 3,487 matching admission rows (3,484 admitted, three refused). No Edge deployment, provider call, DNC/cooldown/queue change, historical session repair or production test row. Guarded rollback retains all audit data and pairs with the archived Reports recovery pin.

**Next gates:** approve branch/PR publication and CI (may create a preview); require native PostgreSQL contention green; separately approve the exact two migration hashes and then frontend release. Backend precedes the new frontend readers. Verify an authorized synthetic full call/disposition lifecycle and correlate any fresh failed click. No implementation blocker remains; production remains unchanged.

## 2026-11-03 Pacific — Toll-Free purchasing backend released and verified (frontend CI pending)

**Approval:** Chris approved the concrete release package from local candidate `393e7d199cbb3bfa961d080e5af2d80e5d742562`, including exact SQL, six full Edge payloads and frontend release. Published PR #513 through the connected GitHub account as `4e0a18ad`, with identical tree `64d67aed19339e49e3662388176f2700d7495de1`. Main and all six live baselines were rechecked before production changes; no direct code conflict was found.

**Database:** Applied once as `20261104041151_phone_number_purchase_operations`. One 19,224-byte statement; approved SQL SHA-256 `faa9910d421f86cd107f954b41586ceb9149ccaab09eaf8031172331db94e1e8` and recorded raw MD5 `abb94ea6f7df6b1b9fbb14c6fdcb548e` match. Renamed the pending file to its recorded migration path without changing bytes; updated the isolated runner/assembler path and workflow migration trigger. All 8 functions, 18 columns, 12 constraints and 5 indexes match; RLS/no-direct-access and service-only RPCs verified. Existing 605 function definitions/ACLs, 13 policies, Inbounds guards and phone ownership fingerprints remain unchanged. Ledger 0 rows; 21 existing phones, 0 toll-free, 0 Inbounds. Advisors 264→265 with only the expected private-ledger no-policy INFO; no new WARN/ERROR. Never replay the migration or erase attempted barriers.

**Edge:** Deployed the four SMS guards first, then search/buy: twilio-sms v61, workflow-executor v50, sms-consent-worker v26, clearpath-lead-alert v25, twilio-search-numbers v59, twilio-buy-number v65. Every one of 71 source files matches its approved payload; all 52 unrelated module copies and verify_jwt=false/no-import-map settings remain intact. All ACTIVE. Seven unsigned rejection requests passed with 401/403/409, including new-protocol search and buy status. No quote, number purchase, room assignment, call or SMS was executed.

**CI corrections and files:** First native job stopped before SQL because Docker's forwarded connection reported a bridge address. The workflow now executes the unchanged strict-loopback runner inside its disposable PostgreSQL 17.6 service; 131 assertions plus 12 concurrency scenarios and 11 observed lock waits passed. The browser checker now verifies the actual fixture over HTTP instead of matching ANSI-colored Vite output. The full browser suite passed with CI color settings and zero external requests; all interaction, permission and recovery assertions remain unchanged. Changes are limited to the verification workflow/checker, migration-path references, root/focused plans, focused verification/manifest/new production-release.json, this log and the toll-free rule. No application/deployed payload bytes changed.

**Next:** Finish final-head CI, merge PR #513 under the recorded frontend approval, verify the Vercel production commit/served bundle and append release evidence. Any real number purchase, Inbounds designation or media test remains separately authorized. Full installed-object and advisor evidence is in `docs/plans/2026-11-03-toll-free-number-purchasing/production-release.json`.

## 2026-11-04 — Toll-Free Number Purchasing implemented and verified (NOT released)

**Approval/status:** Chris approved the reviewed branch implementation plan and isolated verification. Built on `feat/toll-free-number-purchase-20261103` from `0e74428259275c9281518832747a627a4f635a80`; final read-only checks found main and the remote feature branch still at that baseline. The 15 reviewed open PRs had no direct purchase-file overlap. Related SMS/START work and already-live ClearPath differences were preserved. Candidate remains local; no push, main merge, frontend release or production operation was triggered.

**Changes:** Added Local/Toll-Free selection with 800 preferred and 888 support, exact selected-number/current-price review, expiring quotes, active database-backed Admin/Super Admin and original-org checks, and safe protocol/version handling. Local retains its subaccount inventory path; toll-free inventory, quotes and all provisioning use master. Purchase requests carry quote/request identities rather than legacy raw-number payloads. A private ledger atomically claims the paid attempt, stores a matching PN receipt, and finalizes the phone row and receipt together. Replays and ambiguous outcomes cannot create another paid attempt. Saves are explicitly agency-owned, unassigned, nondefault and non-Inbounds with pending Trust Hub status. Existing authenticated Inbounds assignment is reused; a narrow final caller-ID fallback correction closes the all-dedicated-input gap. Toll-free SMS is denied before the legacy A2P bypass in all four deployed sending consumers.

**Files:** `NumberManagementSection.tsx`, `numberSearchSchema.ts`, new `NumberPurchase{Dialog,Results,Review}.tsx` and `useNumberPurchase.ts`; `src/lib/{phone-number-purchase,caller-id-selection}.ts`; search/buy Edge entrypoints and five `_shared/phoneNumbers` modules; `_shared/a2p/sending.ts`; the pending migration below; focused frontend/caller-ID/Edge/SMS/SQL tests; isolated native concurrency and six-file actual-dialog browser fixtures; `scripts/prepare-phone-number-release.mjs`; `.github/workflows/phone-number-purchases.yml`; root/focused implementation plans, focused verification/release manifest, `AGENT_RULES.md`, one-line caller-ID ownership correction in `VISION.md`, and this log. The complete intended path manifest is in `docs/plans/2026-11-03-toll-free-number-purchasing/implementation_plan.md`. No package/lockfile, Voice.js, live routing/telemetry or existing migration edit.

**Migration/release package:** CLI-generated `supabase/migrations/pending/20261104005554_phone_number_purchase_operations.sql`, SHA-256 `faa9910d421f86cd107f954b41586ceb9149ccaab09eaf8031172331db94e1e8`, applied only to fresh synthetic databases. Six complete Edge packages assembled from live search v58, buy v64, SMS v60, workflow v49, consent worker v25 and ClearPath v24. Preserved all 52 unrelated bundled module copies byte-for-byte, including live callback/dispatch/signature/alert differences and `verify_jwt=false`. Every payload/file/frontend/migration hash matches the manifest; altered source, version or JWT flags are rejected before package writes. No production migration, deploy, purchase, assignment, call or SMS.

**Verification:** 68 frontend/caller-ID/Inbounds tests, 44 search/shared/purchase tests, 55 SMS/A2P/ClearPath regression tests, and 24 additional gate runs against four full live-derived SMS packages pass. All six assembled Edge packages compile under Deno 2.5.6 with the original frozen lock. Native PostgreSQL 18.6 passes 131 SQL assertions and 12 contention/independence scenarios with 11 proven lock waits; PGlite independently passes the 131 assertions. The real existing Inbounds RPC and outbound guards accept/deny the synthetic 800/888/local fixtures correctly. Desktop/mobile, exact pricing, keyboard, recovery, role/View As and old-protocol browser checks pass with zero external requests. `npx tsc --noEmit`, scoped lint, build and whitespace checks pass. Actual application diagnostics remain base 79/candidate 79/new 0; existing bundle warnings and two unchanged legacy sending lint annotations remain. A test-only lint issue was corrected. Independent review also corrected the v2 pricing field to `destination_number` and expired unattempted status recovery; final suites cover both. The nonpersistent test VM was explicitly stopped. GitHub CI is configured but not claimed as run.

**Decisions/remaining:** Current account rental and inbound voice usage prices must be available and valid; no retail estimate can authorize buying. An unknown provider result keeps a permanent attempted barrier and requires reviewed support recovery. No toll-free SMS verification/enablement was added. Existing paid receipts survive actor changes and rollback. No implementation blocker remains, but actual Twilio inventory/account pricing access and real provisioning/media are unverified. Refresh live baselines, review the exact migration and six packages, and obtain separate database/Edge/frontend release authorization. Any real purchase, Inbounds designation and controlled media test require their own transaction approval. See focused `verification.md` for commands, limits and release order.

## 2026-11-03 — Inbounds full-width metrics, hover color and motion

**Request/change:** Chris requested full-width metrics and disposition counts below the enter-room section, colored button hovers and livelier animation. Moved stats out of the script column; admin metrics use four columns, agents two, and outcome tiles automatically fill each row. Added metric accent borders, blue neutral/emerald primary/rose call-action hover feedback, gentle panel entrances, count-update emphasis, ready/incoming pulses and script-chevron transitions. All motion respects reduced-motion preferences; counts remain the exact server values.

**Files:** `src/components/inbounds/{RoomWorkspace,RoomStats,RoomStatus,RoomCallStation,RoomScripts,RoomRecords}.tsx`, `styles.ts`; `scripts/tests/inbounds/browser/check.mjs`; focused `implementation_plan.md`; this log.

**Verification:** Nine existing room/voice/disposition tests pass. Isolated actual-component browser flow passes enter/answer/hang-up/mandatory wrap-up/save, full-width ordering and outcome distribution, agent two-card width, real button hover color change, 390px no-overflow layout and reduced-motion checks. Desktop/mobile screenshots reviewed with synthetic data only. `npx tsc --noEmit`, scoped ESLint, production build and whitespace checks pass. Existing bundle-size warning remains. React review: no new fetches, timers, subscriptions or dependencies; handlers/keys/focus retained; presentation only.

**Delivery/boundaries:** Frontend-only PR and linked Vercel production delivery; exact commit/deployment evidence recorded in the PR. No backend migration/deploy, env/routing change, number assignment or real calls. A successful synthetic phone flow is not live media acceptance.

## 2026-11-03 — Inbounds navigation moved to the bottom

**Request/change:** Chris requested moving the Inbounds button to the bottom of navigation. Moved the existing item after the other main/admin links, immediately before the collapse footer; the shared sidebar covers desktop, collapsed and mobile navigation. Flag/permission/View As checks and new-tab behavior are unchanged.

**Files:** `src/components/layout/Sidebar.tsx`, `docs/plans/2026-11-03-inbounds-room/implementation_plan.md`, this log. One existing JSX item moved; no new production logic or tests introduced.

**Verification:** Existing sidebar and room suites pass (26 tests, flag enabled), `npx tsc --noEmit`, scoped ESLint and the production build pass. The existing large-bundle warning remains. Frontend-only delivery through a PR and the linked Vercel production build; release commit/deployment evidence belongs in the PR. No database migration, Edge deployment, environment-variable change, number assignment or real call.

## 2026-11-03 — Inbounds frontend released (PR #509; numbers not assigned)

**Approval:** Chris approved the frontend release and Vercel dashboard fallback. Created only `VITE_INBOUNDS_ROOM=true` in AgentFlow Production; dashboard confirmed the save. Merged reviewed head `01a30ba3b886df9472d1004ddc0d1e55572c0218` as `afe309723d8a50b1e58466cf7bbd3816c43cfb68`, with identical tree `a5840f3df3fd3a68cf956c362deaa396e054c01d`.

**Deployment:** `agentflow`, Vercel `dpl_FSuKKb5L3x98tKYFUbduCQRakKE7`, READY and aliased to `www.fflagent.com`/`fflagent.com`. Public `/inbounds` returns HTTP 200 and the browser reaches the expected authenticated sign-in boundary. Served entry `/assets/index-Ev2y2KNa.js` SHA-256 `070672d0d25e7031d441064fe0a012ea159e5ad4d12626f7e692374f207fd967` contains the room and enabled separate-document boundary; the flag-disabled message is compiled away.

**Verification:** All ten cloud workflows passed on the exact reviewed head. Reports frontend run `41703378175`: base 6,694 / branch 6,707 passing tests, one pre-existing failed test, zero new failures, 79 existing application type diagnostics with no new diagnostics, zero unhandled errors, lint/build pass. No CI rule relaxed. Root `npx tsc --noEmit` passes. Backend migration and Edge bundles were already verified; none were replayed.

**Documentation files:** `WORK_LOG.md`, `AGENT_RULES.md`, focused Inbounds `implementation_plan.md`, `verification.md`, and `frontend-release.json`. This release-record follow-up changes documentation only.

**Remaining:** No numbers designated, real calls placed, or media tested. Signed-in room walkthrough needs a secure AgentFlow sign-in; public route/authentication and enabled served bundle are verified. Select an eligible dedicated agency number and authorize controlled calling separately. Do not infer audio/ringing acceptance from a successful build.

## 2026-11-03 — Inbounds backend released and verified (frontend/number activation pending)

**Approval and scope:** Chris explicitly approved the backend-only package from PR #509 source `fddab04f8a57e340d8ec84a3588334469edc7cdf`: the exact SQL and four full Edge bundles. Executed only on AGENTFLOW CRM `jncvvsvckxhqgqvkppmj`. No main merge, Vercel flag/deployment, number designation or real call test.

**Database:** Applied once through the migration API as history `20261103191631 / inbounds_room_v1`. Approved SQL SHA-256 `cf5ad21d7f262309de451610de73be18b3d13428df9a4339cbd4e6a81c1ef8e1`; recorded full statement MD5 `a36745c9836f3e1f22e468659bf84eb5` matches. Renamed the authored pending file to `supabase/migrations/20261103191631_inbounds_room_v1.sql`, unchanged SQL bytes, and updated the isolated test reference. Its original NOT APPLIED comment is authoring history, not current state; never replay it.

**Edge:** Deployed and read back every source byte: `twilio-token` v58 (1 file), `inbound-call-claim` v63 (3), `twilio-voice-webhook` v61 (2), `twilio-voice-inbound` v72 (11). All ACTIVE, `verify_jwt=false`, no import map, matching the approved manifest.

**Verification:** All 15 installed function bodies, owners, search paths and execution grants match the expected package. Three tables have RLS and no anonymous/authenticated direct access; three triggers enabled, index ready/valid, dedicated-number constraint validated, new flag NOT NULL/default false. All 21 phone numbers remain non-Inbounds; zero room sessions/calls/targets. Unsigned HTTP checks return token 401 and three webhook 403 responses, with no real call. Advisors add only the expected three RPC-only/no-policy INFO findings and five intentional authenticated, organization-scoped DEFINER RPC warnings; pre-existing unrelated findings are unchanged. Details/remediation links: `docs/plans/2026-11-03-inbounds-room/backend-release.json`.

**Files:** Migration rename, `scripts/tests/inbounds/run.mjs`, focused plan/verification/manifest/release record, this log and the Inbounds invariant in `AGENT_RULES.md`. Runtime application/Edge bytes are unchanged by this reconciliation.

**Frontend gate follow-up:** Full Reports comparison on `fddab04f` passed its type/test/runtime-error baseline comparisons and build, then stopped on seven broad `Function` annotations in the room voice test fixture. Replaced them with an explicit `(...args: unknown[]) => void` test listener in `src/hooks/__tests__/useInboundsVoice.test.tsx`. No runtime or approved backend bytes changed; no CI rule was relaxed. Rerun the gate on the reconciled head before frontend merge.

**Next:** Complete frontend comparison/merge gate, obtain separate frontend activation approval, then designate an explicitly selected dedicated agency number and perform controlled real-call/media acceptance. Backend deployment is not evidence of real ringing/audio.

## 2026-11-03 — Inbounds release preparation and CI type correction (PR #509; NOT released)

**Status:** Chris said “proceed” after review-branch publication. Continued branch verification and read-only production preflight; no merge, migration, Edge deployment, flag change, number designation or real call.

**Remaining build check:** Added `.github/workflows/inbounds-room.yml` cloud compilation for all four full Edge handlers using pinned Deno 2.5.2 and the frozen dependency lock, because the local remote import was refused. Also covers token/outbound-handler path changes. This is a secret-free source check, not a deployment. Result required before backend release.

**Cloud follow-up:** Fixed two Deno nullable-type mismatches in `twilio-voice-inbound/request.ts` and refreshed its release-manifest hash; 39 request-deadline/stage tests pass. Audited both CDN versions of `tslib@2.8.1`: six redundant parentheses differ; parsed normalized output is identical. Because the CDN serves both versions, `deno.lock` remains identical to base. The A2P, SMS and Inbounds CI workflows use a narrowly scoped import map to the original ESM module of the existing npm-locked tslib 2.8.1, with an explicit version check. All 33 exports match the CDN module; no stub or production import-map change. Additional files: `request.ts`, `release-hashes.json`, `scripts/{deno-ci-import-map.json,verify-deno-ci-dependency.mjs}`, and three CI workflows. Final cloud results remain required.

**Dashboard test correction:** The broader dashboard gate exposed the same failure on clean base `e02342f`: October 29 fixture calls had expired from the widget's real-time lookback. `src/lib/__tests__/dashboardMissedCalls.test.ts` now freezes only Date to the fixture day and restores it after each test; an explicitly expired call still must be excluded. No dashboard production behavior changed. This test-only correction is part of completing the existing release checks.

**Correction:** Final broader CI exposed a pre-existing `NumberReputation` cast error whose diagnostic text changed when the generated phone row gained `inbounds_only`. Raw database rows do not yet contain calculated `calls_today` or `last_outbound_shaken_stir`. Removed the premature assertion and typed the final query result as `Promise<PhoneNumber[]>`; calculations, queries and UI are unchanged. Neither baseline comparison was relaxed. Files: `src/components/settings/NumberReputation.tsx`, `implementation_plan.md`, this log and the Inbounds verification record.

**Verification:** Root TypeScript and scoped ESLint pass. Exact-base application comparison: base 80, candidate 79, new 0. Inbounds PostgreSQL concurrency/build CI passed on `ba3150e` (run `41694451928`); cloud rerun on the correction is required. The separate SMS job hit an upstream `tslib@2.8.1` integrity mismatch; a fresh download again matches the unchanged tracked SHA-256 `c38da5dd6da6281964435002ce204cd586634fe3bdfb24a0ee116f48cf3292e9`. No dependency or lockfile edits.

**Production preflight:** All three guarded SQL definitions match their expected md5; no room schema exists. All 15 live Edge source files match the reviewed base (token v57, inbound v71, claim v62, outbound v60; `verify_jwt=false`). All 17 unique release-manifest files match their SHA-256. Vercel production is READY on main `e02342f`. Pending migration/Edge approval, full cloud results and controlled Twilio testing remain release gates. Do not infer activation from this record.

## 2026-11-03 — Inbounds room V1 (approved build; branch only)

**Status:** Chris approved the bright-font concept and requested the build. Implemented on `feat/inbounds-room-20261103` and published as PR #509 after explicit approval; production migration, Edge deployment, frontend activation and number designation remain separate exact release gates. Nothing was merged or applied live.

**Behavior:** The Inbounds sidebar entry opens a separate document with its own receive-only phone identity. Dedicated DIDs bypass CRM owner/group routing and ring all eligible room participants, first Twilio-confirmed answer wins. Shared database locks exclude agents occupied by an ordinary call or a room reservation. Canonical disposition receipts keep answered agents unavailable after hang-up, refresh or rejoin. Collapsible agency scripts, configured outcomes, required notes/callback/appointment behavior and existing conversion/policy flows are reused. Agents see their own counts/recipient records; admins see room totals, agent breakdown and missed/voicemail records. New phone-number settings designate active, nondefault agency DIDs. UI uses white text and green/blue/violet/amber accents.

**Integrity:** No browser ownership or call-duration writes; signed callbacks retain authority. Frozen per-call room targets survive reconnects. RPCs derive the organization/actor and deny cross-tenant access; new tables have RLS and no direct browser grants. Provider ingestion owns room tags. Outbound number selection and bridge-time checks exclude dedicated DIDs. New explicit caller-details RPC updates contact fields only. The pending SQL guards the three modified live-function preimages; full Edge baselines were compared read-only.

**Validation:** Production frontend build and 288 routing/UI/hook/disposition tests pass. The local SQL fixture passes; true PostgreSQL contention is separately checked in CI. Actual components passed an isolated synthetic browser flow and mobile-width check. Root TypeScript passes; application TypeScript retains the base's 80 known diagnostics. See `docs/plans/2026-11-03-inbounds-room/verification.md` for exact evidence, limits and release sequence. No real calls or customer data were used.

## 2026-11-03 — SMS/Email editable template preview and expanding composer (branch-only, CI pending)

**Status:** Implemented on `fix/editable-template-preview-composer-20261103`. Chris explicitly approved the revised template workflow and requested direct fixes. **No merge, production deployment, backend commands, migrations, schema/RLS change, outbound SMS/email or telephony modification.**

**What changed:** Manual template selection is now list → editable preview → explicit Use Template; includes personalized real contact/agent values, separate email subject editing, a missing-merge-field alert and existing-draft replacement notice. Back/Cancel never replace the compose draft. Templates themselves are unchanged. The shared SMS field is multiline; both SMS and email auto-grow with a bounded height, internal scroll and expand/collapse. SMS Enter still sends, Shift+Enter enters a newline, IME composition does not send. The formerly inactive Conversations Templates action now opens the scoped picker, with true first/last names passed through the existing authorized contact projection rather than a new cross-tenant query. View As read-only, contact-scope draft isolation, pending SMS protections, Gmail/Twilio dispatch and the Dialer's known coming-soon send behavior remain unchanged.

**Files touched:** `implementation_plan.md`, `WORK_LOG.md`; `src/components/messaging/{MessageTemplatesPickerModal,MessageTemplatePickerList,MessageTemplateEditPreview,MessageComposePanel}.tsx`; `src/lib/supabase-messages.ts`; `src/pages/{Conversations,DialerPage}.tsx`; `src/components/conversations/ConversationThread.tsx`; `src/components/contacts/FullScreenContactView.tsx`; `src/components/messaging/__tests__/messageTemplatesPickerModal.test.tsx`; `src/components/messaging/smsConsent.test.tsx`; `src/components/conversations/__tests__/conversationThreadPendingSms.test.tsx`; `src/pages/__tests__/{conversationsSendContract,conversationsViewAs}.test.tsx`; `scripts/tests/sms-responsiveness/measure.mjs`.

**Verification:** Added/updated tests for edit-before-apply, Back/Cancel, missing merge fields, channel switch, multiline email/SMS, Enter/Shift+Enter/IME handling, and Conversations template access. GitHub Actions **Starter SMS and Email Templates V1.1** run `41663776579` passed focused template tests, `npx tsc --noEmit`, scoped ESLint and Vite build. **SMS consent integration** run `41663776346` passed 12 frontend test files / **283 tests**, including the real Conversations/Contact View send and View As regression suites, plus its browser and synthetic native backend checks. Reporting integrity, Dialer DNC, UV, hierarchy and commission CI also passed. Both Vercel Git preview builds for commit `61aa8e2` are READY (project `agentflow`: `dpl_3urw2GJEreKPQgDmKnsMmQa8SdzC`; `agentflow-life-insure`: `dpl_E6EP6Yv16YcRYT2uhiUSg2QNnAGj`). Reports frontend parity check remains in progress at this entry. **No signed-in manual browser walkthrough is claimed.**

**Deployment/gates:** No database migration needed. Draft PR for review; merge and production release require separate approval. No real messages sent.


## 2026-10-30 — Prebuilt SMS and Email Templates V1.1 branch build (NOT merged, seeded or deployed)

**Status:** Branch-only implementation in `claude/sharp-johnson-2ojnub`, continuing Claude's plan using the source ZIP previously supplied in ChatGPT. **Production database seed is NOT approved or run.** No schema/RLS, Twilio/Edge Function, workflow-executor, dialing, Vercel or frontend production changes.

**What changed:** Committed reviewed V1.1 library (12 SMS + 6 email) and exactly matching insert-only home-organization SQL under docs/ and supabase/ops/, plus a read-only fingerprint/collision report. The existing manual template picker now issues one warning toast for absent or unrecognized merge fields while preserving the editable draft and existing manual send logic. Workflow action choices exclude incompatible manual-merge templates, and re-saving such a selected template is refused rather than sending blank automation text. Existing agency/personal template editing and permissions remain in place; no new data fields were needed.

**Files touched:** `implementation_plan.md`, `AGENT_RULES.md`, `WORK_LOG.md`; `docs/plans/2026-10-30-starter-templates/agentflow_starter_templates_v1_1.json`; `supabase/ops/starter_templates_v1_1_{seed_home_agency,report}.sql`; `src/lib/messageTemplateMerge.ts`; `src/components/messaging/MessageTemplatesPickerModal.tsx`; `src/components/workflows/panels/ActionConfigPanel.tsx`; focused tests in `src/lib/__tests__/`, `src/components/messaging/__tests__/`, and `src/components/workflows/panels/__tests__/`.

**Migrations/deploys:** None. All new SQL is review-only; no production writes, emails or SMS were sent.

**Verification:** Data integrity validation (12/6, five supported categories, valid merge fields, STOP on seven marketing SMS drafts, matching SQL) staged in focused Vitest. Browser, TypeScript, lint, build and PR checks will be verified before recommending the separate frontend release gate. The production pre-seed audit checks only counts/fingerprints without changing data.

**Remaining gates:** Review source/CI in draft PR; explicitly approve frontend merge/release separately; explicitly approve the exact home-org seed SQL separately. After an authorized seed, independently compare pre-existing row fingerprints and verify 18 new agency rows. Personal templates must be unchanged.


## 2026-10-30 — Calling Settings teammate picker fits short viewports (follow-up; branch `claude/zen-cerf-tjf1gq`; PR open, NOT merged, NOT released)

**Status:** Chris approved the follow-up from the entry below. Same branch and PR as the modal fix. No merge or deploy.

**What changed:** One class in `src/components/dialer/CampaignUserPicker.tsx`. The teammate list (`CommandGroup`) cap went from `max-h-60` to `max-h-[min(15rem,calc(var(--radix-popover-content-available-height)-3.5rem))]`: still 240px where there is room, otherwise the space Radix reports on the open side minus the search row. Tailwind compiles it to `max-height:min(15rem,calc(var(--radix-popover-content-available-height) - 3.5rem))` (checked in the build CSS). `CommandList`'s 300px cap stays as the fallback. Search, filtering, selection toggling, chips, same-org profile list, permissions and keyboard navigation are unchanged. The picker is only used by the Calling Settings modal.

**Files touched:** `src/components/dialer/CampaignUserPicker.tsx`, `implementation_plan.md`, `WORK_LOG.md`.

**Migrations/deploys:** None.

**Verification:**
- **Browser, picker:** real Chromium, the same harness and 12 combinations as the entry below (320×568, 390×844, 1366×768, 1440×900, 200% zoom at 683×384 and 720×450, light and dark). The popover and its search box are fully on screen at every size. At 683×384 the popover went from top −37px (search box off-screen) to 17px, 241px tall.
- **Browser, rest of the modal:** search and Enter select, ArrowDown+Enter selects, Enter again deselects with the menu staying open; arrow keys scroll the list; Escape closes only the picker. All earlier modal checks still pass.
- **TypeScript:** root `npx tsc --noEmit` passes. The app project has 80 errors, identical to base `245f4b3`.
- **Lint and build:** ESLint on touched dialer files is clean; `vite build` passes.
- **Tests:** dialer Vitest 135/135. The full suite has the same 10 pre-existing failing files as on base.

**Correction to the entry below:** its "wheel-scroll" result was a false pass. Playwright `hover()` scrolled the list itself. Measured correctly, mouse-wheel scrolling over the teammate list does not work in the **original production modal either** (scroll position stays 0); it is not caused by this branch. The Dialog's scroll lock blocks wheel events on this dropdown, which renders outside the dialog. Arrow keys and typing to filter still work (verified). Not changed here, to keep existing behaviour as approved. Fixing it is a separate decision.

## 2026-10-30 — Dialer Calling Settings modal fits the viewport (branch `claude/zen-cerf-tjf1gq`; NOT merged, NOT released)

**Status:** Approved by Chris and implemented. Frontend layout only. Pushed to `claude/zen-cerf-tjf1gq`; no PR, merge or production release. Plan: top entry of `implementation_plan.md`.

**Problem:** Dialer → Campaign Selection → Settings ("Calling Settings", `CampaignSettingsModal`) used `DialogContent` with only `max-w-md`. Measured before the fix, the dialog was 1,087–1,207px tall, so the title, Close X, Save and Cancel were off-screen at every tested size, including 1440×900.

**What changed:** The modal frame (local classes only; shared `ui/dialog.tsx` untouched) is now `max-h-[calc(100dvh-2rem)]` × `w-[calc(100vw-1.5rem)] max-w-md`, `flex-col`.
- **Fixed header:** the title is padded clear of the Close X; long campaign names wrap, with the full name in a `title` tooltip.
- **Scroll body:** only the settings scroll (`min-h-0 flex-1 overflow-y-auto overscroll-contain`).
- **Pinned error:** the save/validation error moved above the buttons as `role="alert"`, so it is never scrolled out of view.
- **Footer:** Cancel and Save always visible, side by side with a gap.
- **Keyboard:** a control that gets focus inside the scroll body is scrolled into view. Radix wraps Tab with `preventScroll`, which otherwise left the wrapped-to field hidden.
- **320px wrapping:** time inputs, Retry Interval and Ring Timeout rows wrap; toggle switches `shrink-0`.
- **Line limit:** Max Call Attempts and Calling Window moved verbatim into `campaignSettingsControls.tsx`, keeping both files under 200 lines (191 / 189).

Values, Zod validation, `handleSaveCallingSettings`, `canEditSettings` / licensed-state gating, Settings Access options, same-org teammate list, `update_campaign_settings` RPC, `organization_id` and RLS are all unchanged.

**Files touched:**
- `src/components/dialer/CampaignSettingsModal.tsx`
- `src/components/dialer/campaignSettingsControls.tsx`
- `src/components/dialer/__tests__/campaignSettingsModal.test.tsx` (new, 13 tests)
- `implementation_plan.md`
- `WORK_LOG.md`

No `DialerPage.tsx`, schema, permissions, Twilio, queue, Edge Function or Vercel changes.

**Migrations/deploys:** None.

**Verification:**
- **TypeScript:** root `npx tsc --noEmit` passes. The app project (`-p tsconfig.app.json`) has 80 errors, an identical set to base `245f4b3`.
- **Lint and build:** ESLint on touched files is clean; `vite build` passes.
- **Focused tests:** Vitest on `src/components/dialer/__tests__` passes, 135/135.
- **Full suite:** 10 files fail (1 test, plus 9 files that cannot load without `VITE_SUPABASE_URL` in this container). The same 10 fail identically on the unchanged base, so they are not regressions.
- **Browser QA:** real Chromium on a git-ignored `scratch/` harness rendering the real modal with app CSS and stub props (no Supabase or network). Sizes: 320×568, 390×844, 1366×768, 1440×900, and 200% zoom (683×384, 720×450), each in light and dark.
  - Every check passed at each size: dialog inside the viewport; header, X, Save and Cancel visible; all eight sections reachable by scrolling; no horizontal overflow.
  - Interactions checked: Settings Access Select, teammate picker (search, select, wheel-scroll, Escape closes only the picker), custom retry input, toggles.
  - Tab and Shift+Tab stay in the dialog and the focused control stays visible; Save, Cancel and Escape work.
  - Loading, saving and error states checked, with the error visible with the body scrolled to top and bottom; long campaign name and long teammate chips checked.

**Follow-up (needs separate approval):** At 683×384, `CampaignUserPicker`'s popover (~280px) opens upward with its search box just above the viewport; list, selection and typing still work. Before this fix the picker was not reachable at all at that size. Proposed one-class fix: on its `CommandGroup`, `max-h-60` → `max-h-[min(15rem,calc(var(--radix-popover-content-available-height)-3.5rem))]`. Validated in the browser by injecting the CSS: the popover fits at 683×384, 720×450, 320×568 and 1366×768.

## 2026-10-29 — Dashboard Polish V2 G3 production complete; G4 reconciliation staged on draft PR #504

**Status:** G3 BACKEND COMPLETE. Protected GitHub Actions runs `40967614726` (check), `40968145912` (apply-migration), and `40968675025` (record-history) succeeded for production `jncvvsvckxhqgqvkppmj`. Supabase independently confirms **352 migration-history entries**, version `20261029200000_dashboard_attention_clearances`, **24 statements**, recorded digest `43769e1677e2a218021e7f8bc146f92e86b1154ae00aa1d3c63e8d1515f07693`. The table, 3 RLS policies, 3 indexes, guard trigger and 2 SECURITY INVOKER RPCs are installed. Security advisor 256 findings (unchanged); performance 465 (+1 informational unused-index notice on the new empty table).

**G4 branch-only reconciliation:** Draft PR #504 `claude/upbeat-cannon-uy6fpg` moves the approved 16,396-byte SQL Git blob `4ab80696278eb8a0bf2b6731b0d8c64e708a52da` unchanged from `supabase/migrations/pending/20261029200000_dashboard_attention_clearances.sql` to `supabase/migrations/20261029200000_dashboard_attention_clearances.sql`. Approved SHA-256 remains `85ac2ff7dcd435bd48718311b05704e4e7d96293abf9b47fd062ce30610cb8e8`. Rollback Git blob `647e78d16ba39480da5e7ec754f1f43598f9c3d6` is unchanged. Protected release runner, rehearsal path guards and workflow comments follow the new path; recorded-state gates still refuse apply/history replay and rollback with existing clearance records. **No production SQL executed during reconciliation.**

**Live-generated TypeScript types:** `dashboard_attention_clearances`, `clear_dashboard_attention_item` and `undo_dashboard_attention_clear` declarations already on PR #504 match live Supabase-generated definitions byte-for-byte. No `types.ts` edit or wholesale regeneration required.

**Files touched:** migration path move (same Git blob), `scripts/dashboard_attention_release.py`, `scripts/tests/dashboard_attention_release_test.py`, `.github/workflows/dashboard-attention-release.yml` (comments), `AGENT_RULES.md`, `WORK_LOG.md`, Dashboard Polish V2 and G3 release plans. No frontend `src/`, Twilio, Dialer or Edge Function edits.

**Verification:** Production G3 history/advisors verified. New PR #504 CI (PostgreSQL 17.6 rehearsal, Dashboard regression/typecheck/lint/build, desktop/mobile dark/light browser and KPI parity) is pending after this reconciliation. The frontend is NOT released; `VITE_DASHBOARD_ATTENTION_CLEARANCES` remains unverified in production.

**Next:** Review all PR #504 checks and Vercel preview, resolve any new failures on draft branch only, then request Chris's separate **G5 production frontend release approval**. No merge, Vercel configuration or deployment until then.

## 2026-10-29 — Private homepage V2 production test-route release approved

Chris authorized merging PR #503 to production for testing before replacing the current homepage. Release only the existing Super Admin-gated `/homepage-v2`; keep `/` and `/homepagetest1` unchanged. Incorporate current main without changing its CRM/backend files. No migration dispatch, environment change, auth change or public-homepage replacement is authorized. Deployment and production-route verification are recorded in PR #503.

## 2026-10-29 — Private homepage V2 authentic demos and review candidate (PR #503)

**Status:** The earlier secure-login blocker is resolved. The test account signed
in through browserAuth; rendered UI confirms Super Admin access to private V2.
Branch-only review candidate; PR remains unmerged and production approval is
still required. Shared real agency names were excluded from every recording.

**What changed:** Replaced all four V2 concept/illustrative panels with actual
shipped dashboard, dialer, AP board and messaging component recordings. Each
approximately six-second loop uses synthetic fixtures in an isolated capture
workspace, with real numeric/rank/glow animations, local call/message simulation,
explicit demo disclosure, blocked backend access and no real calls or sends.
Authorized AgentFlow imagery consists of existing brand assets and genuine
product frames. Removed the illustrative component module and stale pending
labels. Optimized H.264 MP4/VP9 WebM/WebP set totals 656,701 bytes; every encoded
frame decodes, with no audio and stripped source metadata. Added reproducible capture/encoding
tools, provenance, budgets and hashes. No runtime dependency was added.

**Files touched:** V2 page, DemoShell/ProductSections/media and page tests;
`public/marketing-v2/*`; non-production `scripts/tests/homepage-v2/capture/*`;
private V2 plan, claims/capture evidence and media manifest; this work log.

**Verification:** 22 focused Vitest checks; scoped ESLint, including capture
tools with zero warnings (entry component exported for development hot refresh); root TypeScript;
meaningful app types versus exact base `7a03033492c55fd16ea1bacd049934102fe340e4`
(80 baseline, zero added errors); Vite production build. Actual footage checked
on desktop 1440/mobile 390 CSS viewports with no horizontal overflow, muted
viewport autoplay, deferred offscreen sources, offscreen pause, manual pause
retained on resize, mobile menu and FAQ. Capture fixtures remain outside dist.
Both Git-linked preview outcomes and the final signed-in walkthrough are
recorded in PR #503 after push, along with protection/production read-back.

**Migrations/deploys:** No backend/data write, schema/RLS/auth/telephony change,
Vercel configuration change, main update, merge or production release. Only
protected branch previews. Live homepage and CRM functionality are unchanged.

**Review:** See PR #503 and its protected `/homepage-v2` URL. Separate user
approval is required before merging or releasing the homepage.

## 2026-10-29 — Private homepage V2 playback/access polish (PR #503; capture BLOCKED)

**Status:** Explicitly requested by Chris on `feat/private-homepage-v2-20261029`.
Branch-only preparation; draft PR remains open, not merged or released.
**Not complete:** secure AgentFlow sign-in returned `Invalid login credentials`;
authentic dashboard/dialer/AP board/messaging clips and authenticated preview QA
remain pending. No footage is represented as real and no real prospect was
called or messaged.

**What changed:** Preserved the approved dark navy/sky layout; split V2 into
small components; lazy-loaded only V2 behind the unchanged SuperAdminRoute.
Player attaches sources near the viewport, plays only in view/active tab, honors
reduced motion, Save-Data and slow networks, preserves manual pause, handles
blocked autoplay and per-source format failure, and reserves media space.
Added accessible navigation, FAQ relationships and private metadata cleanup.
Removed V2 links to unsupported pricing/trial promises and the contact form
that only shows a local success toast. Get started uses the existing `/signup`
setup flow; no purchase, trial or immediate-access promise.

**Files touched:** `src/pages/LandingPageV2.tsx`; V2 lazy import/route wrapper in
`src/App.tsx`; `src/components/marketing-v2/*` and focused tests;
`scripts/tests/homepage-v2/*` (isolated, non-production visual/playback harness);
`docs/plans/2026-10-29-private-homepage-v2/{implementation_plan,claims-and-capture}.md`;
`WORK_LOG.md`.

**Migrations/deploys:** No backend commands, data writes, Edge deploys, RLS,
telephony changes, Vercel settings or production release. Only the existing
Git-linked protected branch previews may build from this update. `/`,
`/homepagetest1`, SuperAdminRoute, live pricing/contact and CRM functionality
remain byte-identical.

**Verification:** 21 focused Vitest checks; scoped ESLint; root TypeScript;
meaningful app TypeScript against exact base `7a03033492c55fd16ea1bacd049934102fe340e4`
(80 baseline errors, 0 added); Vite production build. Browser QA on isolated
1440/390px viewports: no horizontal overflow, mobile navigation/FAQ, real video
loading/autoplay/manual pause/offscreen pause with an explicitly technical
six-second color-pattern fixture. Fixture/harness excluded from dist. Both
Vercel projects retain SSO protection `all_except_custom_domains`. Final deployed
branch SHA/URL and Ready state are recorded in the PR, not assumed here.

**Blockers / next:** Secure sign-in via browser handoff; locate a safe synthetic
capture workspace; record/review/encode all four authentic loops, replace the
legacy concepts, complete signed-in protected-preview review. See the capture
document for exact boundaries and provenance requirements. Separate approval is
still required before merge or production release.

## 2026-10-29 — Dashboard attention G3 protected backend release PR prepared (NOT applied)

**Status:** Chris approved exact Gate 3 migration and RLS bytes with separately controlled protected workflow stages. This change is release-only, staged on `release/dashboard-attention-g3-20261029`, and **does not apply any database migration or merge Dashboard PR #504**. No Vercel flag, production frontend, CRM source row or Twilio/telephony change.

**Files:** New `.github/workflows/dashboard-attention-release.yml`, `scripts/dashboard_attention_release.py`, `scripts/tests/dashboard_attention_release_test.py`, `docs/plans/2026-10-29-dashboard-polish-v2/g3-release/implementation_plan.md`; extended `.github/workflows/dashboard-attention-backend.yml`; copied byte-identically from PR #504 the forward SQL, rollback, 2 SQL tests and `scripts/run_dashboard_attention_tests.sh`. This newest-first `WORK_LOG.md` entry. No `src/` changed.

**Pinned files:** forward 16,396 bytes SHA-256 `85ac2ff7dcd435bd48718311b05704e4e7d96293abf9b47fd062ce30610cb8e8`, rollback 2,338 bytes SHA-256 `9250e2e7cedc8d8e6476838d84e1bc924b869b79248a0e982f68dd267393db55`; Git blobs match approved PR #504.

**Read-only production preflight:** PostgreSQL 17.6, 351 migration history rows, latest `20261029120000`, all new objects absent, `get_org_id` MD5 `fb1d12f537aac3b3ed18c9e0628f2251`, advisors 256 security / 464 performance findings. The protected release workflow uses manual stage+confirm, main-only, existing `google-sheets-production` environment with reviewer, a protected stage, pinned CLI 2.121.0, and 2 existing database secrets. Never `db push` or automatically execute migrations.

**Verification/next:** Existing 69-test SQL suite passed in PR #504. The release-only PR must pass PostgreSQL 17.6 rehearsal, verify the pinned 24-statement CLI digest 43769e1677e2a218021e7f8bc146f92e86b1154ae00aa1d3c63e8d1515f07693, and check protected environment settings before a separate merge approval. Then read-only `check`, separately approved production `apply-migration`, read-back/advisors, separately approved `record-history`, and later distinct G5 frontend approval. No production work executed in this task.

## 2026-10-29 — Dashboard Polish V2: G2 built on the feature branch (Clear / Dismiss, visual polish, Team-mode context); migration PREPARED, NOT applied

**Status:**
- G1 plan approved by Chris (D1–D16 as recommended, including the narrow protected `dashboard-callbacks.ts` edit).
- G2 is implemented on `claude/upbeat-cannon-uy6fpg` only.
- **Not merged, not deployed. No production SQL. No Vercel variable changed.**
- `VITE_DASHBOARD_ATTENTION_CLEARANCES` is unset everywhere real.
- Plan and evidence: `docs/plans/2026-10-29-dashboard-polish-v2/implementation_plan.md`.

**Correction to the entry below (stale):**
- G3 is no longer branch-only: PR #502 was merged as `7a03033`, and Vercel production deployment
  `dpl_EDZ4obVUw3dgB8fwxPi7PnbgkoUq` is READY.
- Whether `VITE_DASHBOARD_MILESTONE_REVIEWS=true` is set in production could not be read from this session (Vercel env
  listing returned 403).

**What changed:**
- **Clear (Missed Calls, Callbacks):**
  - Per-viewer, occurrence-specific alert state in the new `dashboard_attention_clearances`, written only by two
    SECURITY INVOKER RPCs.
  - A visible Clear button on widget and modal rows; Undo (toast and history); the Cleared view; "N cleared" links.
  - Persists across refresh and login (database, not the browser).
  - A rescheduled callback has a new due time, so it returns on its own.
  - Source records are never written: calls, voicemails, notifications, campaign leads (due, owner, status, queue),
    appointments.
- **Exact counts:**
  - Cleared items are excluded inside the paging math: each branch reads `K` rows deeper, then the merge and slice.
  - Totals subtract only clearances that still match under the same branch filters.
  - Widget rows, modal pages, active totals and "View All N" agree, including when campaign and appointment callbacks
    interleave.
- **Dismiss (Client Milestones):** a visible Dismiss button (stored as the existing `reviewed`); Pending · Snoozed ·
  Dismissed history; a "View dismissed" link. No schema change.
- **Missed Calls:**
  - One shared contract (`dashboard-missed-calls.ts`) for the widget and the modal. The modal can now call back linked
    contacts.
  - An explicit organization filter closes a latent Agency-Group peer exposure (0 groups exist today).
- **Visual polish:**
  - Shared status badges with text labels, in the approved colors.
  - A primary Calls-blue call action; Clear / Dismiss as secondary actions.
  - Blocked actions stay focusable and state their reason (`aria-disabled`).
  - Focus moves to the next row after a removal.
  - Rows wrap on narrow screens (no horizontal scroll at 390 px).
  - Normal-case typography; exact or "N+" callback bucket counts.
- **Team-mode context** (an Admin's Team view; the Team Leader list scope is unchanged):
  - owner, campaign, assignee, client agent and writing-agent names, from batched organization-scoped reads;
  - missed-call recipients from routing metadata, never `calls.agent_id`, and never one agent for a call that rang
    several;
  - initials only.
- **Unchanged:** the four KPI cards (pixel-identical), telephony, Twilio, the Dialer, the scope rules, contact identity
  and RLS on existing tables.

**Files touched:**
- **Backend package (not applied):**
  - `supabase/migrations/pending/20261029200000_dashboard_attention_clearances.sql`;
  - `supabase/migrations/rollback/20261029200000_dashboard_attention_clearances.rollback.sql`;
  - `supabase/tests/dashboard_attention_clearances{,_harness}.sql`;
  - `scripts/run_dashboard_attention_tests.sh`;
  - `.github/workflows/dashboard-attention-backend.yml`.
- **New frontend:**
  - `src/lib/dashboard-attention{,-config,-sources}.ts`, `dashboard-missed-calls.ts`, `dashboard-people.ts`,
    `dashboard-widget-loads.ts`;
  - `src/hooks/useAttentionClearActions.ts`, `useAttentionDetailFeed.ts`, `useRowFocusRecovery.ts`;
  - `src/components/dashboard/DashboardAttentionModal.tsx`, `DashboardMissedCallsModal.tsx`,
    `attention/AttentionModalLayout.tsx`, `callbacks/CallbackRow.tsx`, `missed-calls/MissedCallRow.tsx`;
  - `ui/DashboardActionButton.tsx`, `ui/DashboardPersonChip.tsx`, `ui/DashboardAttentionSummary.tsx`.
- **Modified frontend:**
  - `src/lib/dashboard-callbacks.ts` (approved exception), `dashboard-milestones{,-data}.ts`;
  - `src/hooks/useDashboardDetailFeed.ts`, `useMilestoneActions.ts`;
  - `src/pages/Dashboard.tsx`;
  - `DashboardCallbacksModal.tsx`, `DashboardDetailModal.tsx`, `DashboardMilestonesModal.tsx`, `DashboardRecordRow.tsx`,
    `DashboardRecordsModal.tsx`, `dashboardRecordText.ts`;
  - `milestones/MilestoneRow.tsx`, `milestoneCopy.ts`;
  - `ui/dashboardTones.ts`, `DashboardListRow.tsx`, `DashboardRowActions.tsx`, `DashboardModalShell.tsx`,
    `DashboardFilterChips.tsx`, `DashboardWidgetFrame.tsx`;
  - all six widgets and `LeaderboardPreviewRow.tsx`;
  - `src/integrations/supabase/types.ts` (surgical: one table and two RPCs).
- **Tests:**
  - new: `dashboardCallbacksClearances`, `attentionClearActions`, `dashboardMissedCallsModal`, `dashboardTeamContext`,
    `dashboardStatusBadges`, `src/lib/__tests__/dashboardAttention`, `dashboardMissedCalls`, `dashboardPeople`, and
    `src/test/fakePostgrest.ts`;
  - updated: `dashboardCallbacks`, `dashboardCallbacksModal`, `dashboardDetailModalVoicemail`,
    `clientMilestonesWidget`, `dashboardMilestonesModal`;
  - `scripts/tests/dashboard-ui/verify.mjs`;
  - `.github/workflows/dashboard-g3-frontend.yml`.
- **Docs:** `AGENT_RULES.md` (new attention-clearance invariant, #22 amendment, milestone wording and status), the plan,
  root `implementation_plan.md`, this log.

**Migrations/deploys:**
- None applied or deployed.
- Read-only production catalog / aggregate reads during G1 only.
- Migration SHA-256 `85ac2ff7dcd435bd48718311b05704e4e7d96293abf9b47fd062ce30610cb8e8` (16,396 bytes).
- Rollback SHA-256 `9250e2e7cedc8d8e6476838d84e1bc924b869b79248a0e982f68dd267393db55`.

**Verification (local; CI not yet run):**
- **SQL** (disposable PostgreSQL 16.15, `plpgsql.variable_conflict = error`):
  - 69 behaviour checks, plus the replay guard, the concurrency check, three negative controls and the rollback proof;
  - all passed.
- **Vitest:** 492 passed and 12 skipped across the 33 Dashboard and milestone files (base: 440).
  - The new tests include an exclusion property test against a brute-force oracle, 40 seeded scenarios × 2 scopes ×
    4 page sizes.
  - The milestone engine passed under America/Los_Angeles, Pacific/Auckland and UTC.
- **Full Vitest:** 6,637 passed. The 10 failing files fail identically on untouched `main` `7a03033`: 9 need
  `VITE_SUPABASE_URL`, 1 is a recording-retention byte check. None is caused by this change.
- **Type checks:** `npx tsc --noEmit` clean. App typecheck against `7a03033`: base 80, candidate 80, new 0.
- **ESLint:** clean on all 59 touched TypeScript files.
- **Build:** `npm run build` passed (the existing chunk-size warning only).
- **Browser** (`verify.mjs`, mocked Supabase, 1440/390 px, light/dark, reduced motion): 80/80 checks.
  - Covered: Clear, Undo and the Cleared view on Callbacks; Clear on Missed Calls; keyboard Dismiss and the Dismissed
    history; focus after a removal; no horizontal overflow.
  - KPI cards are pixel-identical to `main` in all four captures (0 changed pixels).

**Blockers / next (each separately approved):**
1. Chris reviews the G2 package. A PR for CI (G4 checks) only on request.
2. **G3:** approval of the exact migration bytes and RLS. Then the apply through the approved route (recommended: a
   protected-workflow release-only PR), catalog read-back, advisors against the 256 / 466 baseline, the history record,
   a byte-identical move out of `pending/`, and a regenerated-types diff.
3. **G4:** CI and Vercel preview, plus visual verification.
4. **G5:** frontend merge, then Chris sets `VITE_DASHBOARD_ATTENTION_CLEARANCES=true`.
5. Confirm `VITE_DASHBOARD_MILESTONE_REVIEWS` in production (Dismiss needs it).
6. Follow-ups needing their own approval: `get_performance_details` agent / carrier fields; Team Leader downline lists.

**Context snapshot:** frontend and migration package on the branch only. Production database, Vercel and flags
unchanged.

## 2026-10-29 — G2 production closeout; G3 Dashboard release candidate prepared on current main

**Status:** G2 PRODUCTION COMPLETE. Protected PR #501 merged at `78d532b` (release workflow only). `check` [#40925336827], `apply-migration` [#40925926281], and `record-history` [#40926621789] succeeded; independently verified in production on project `jncvvsvckxhqgqvkppmj`. G3 visual release is **branch-only**, not merged, not activated or deployed.

**Production database and history:** `20261029120000_dashboard_milestone_reviews` recorded as history #351, 28 statements, approved digest `07cabc94f4a42c2c0d9a7c1265c9aa622eee65af14bb26dc9889b878d9765ec7`. Table, two SECURITY INVOKER RPCs and guard trigger exist; RLS enabled with four authenticated-only policies, 12 columns, five indexes, 3 cascading FKs, five checks. No client/policy/call data migration; review table initially empty. Security advisors remain 256 findings (no new milestone finding); performance 466 versus 464 baseline (two new unused-index INFO notices on the empty milestone table).

**G3 candidate changes (not production):** New branch `claude/dashboard-g3-finalize-20261029` based on production `main` `78d532b`; copied only approved G1 dashboard source, tests and `AGENT_RULES.md` from `claude/great-clarke-c1gpw6`. Four existing KPI cards remain untouched. Reconciled approved migration blob (SHA-256 `e673749357f7612991cccf7405aa0f5f0a9ac49c798bfbd13b006d34f78d8806`) from `pending/` to `supabase/migrations/20261029120000_dashboard_milestone_reviews.sql`, unchanged bytes. Re-pinned protected G2 runner/workflow/rehearsal to the new path. Generated live Supabase TS types, added **only** milestone table and two RPC signatures to `src/integrations/supabase/types.ts`, and switched milestone read/write queries to the typed client instead of `as any`. Existing unrelated live-schema type drift was deliberately not copied.

**Files touched:** Approved G1 `src/pages/Dashboard.tsx`, dashboard widgets, detail modals, UI components, hooks, milestone engine, tests, browser harness; `AGENT_RULES.md`; `src/integrations/supabase/types.ts`; `src/lib/dashboard-milestones-data.ts`; G2 migration path (move only); `scripts/dashboard_milestones_release.py`; `scripts/tests/dashboard_milestones_release_test.py`; `.github/workflows/dashboard-milestones-release.yml`; Dashboard plan and G2 release-design docs; `WORK_LOG.md`.

**Migrations/deploys:** G2 production applied/recorded through the previously approved protected workflow. **No additional production backend writes or G3 Vercel changes** during this preparation.

**Verification:** Prior G1 branch: 440 focused Dashboard tests, 44 browser checks, byte-identical KPI captures and no new app type errors; G2 protected runner/SQL suite passed on PostgreSQL 17.6. Current G3 branch CI / typecheck / browser verification still needs fresh runs and PR review. Do not describe G3 as ready for merge until those pass.

**Blockers / next:** Open a G3 draft PR, run full applicable CI and browser verification, resolve any new failures, confirm final activation date and Vercel flags, then request Chris's distinct **G3 production release approval**. Do not merge, change Vercel env vars, or deploy until that approval.


## 2026-10-29 — G2 protected release workflow for Dashboard milestone reviews (release-only PR; NOT merged, NOT dispatched)

**Status:** Chris approved the G2 release-workflow design with safeguards.
- Implemented and rehearsed on an isolated PostgreSQL.
- Proposed to `main` as a release-only PR, with no `src/` change.
- **Not merged. No stage has been dispatched. The G2 migration is NOT applied** (production read back: 350 history rows, head `20261028040215`, none of the objects).
- No Vercel variable changed. The Dashboard frontend (G3) is not released.
- Design and evidence: `docs/plans/2026-10-29-dashboard-premium-redesign/g2-release-workflow-design.md`.

**What changed:**
- **New `.github/workflows/dashboard-milestones-release.yml`:**
  - dispatch only, main only, behind the protected `google-sheets-production` environment (reviewer cgarness, admin bypass off);
  - four typed, confirmed stages: `check` → `apply-migration` → `record-history` → `rollback-migration`;
  - only `SUPABASE_DB_PASSWORD` / `SUPABASE_POOLER_HOST`, a pinned checkout and CLI 2.121.0.
- **New `scripts/dashboard_milestones_release.py`.**
  - It executes only the approved migration, fed from its checksummed bytes (16,405 B, SHA-256 `e6737493…`), in one psql transaction.
  - It records history with `migration repair` from a temporary workdir that holds only that file. Never `db push` or `migration up`.
  - **Rollback refuses while any milestone review row exists:** a pre-check, then a re-check under `ACCESS EXCLUSIVE` inside the rollback transaction.
  - **CRM activity can't cause a false failure:** the invariants are a schema-only fingerprint and the migration history. No CRM rows are read.
- **New `scripts/tests/dashboard_milestones_release_test.py`:** the rehearsal (real CLI, TLS loopback, synthetic data).
- `dashboard-milestones-backend.yml` gains two jobs: `release-runner` (`postgres:17.6` pinned by digest) and a live, secret-free `environment-guard`.

**Unchanged:**
- the migration and rollback bytes;
- the Google Sheets and hierarchy release workflows;
- unrelated migrations: 12 local files drift from production history; they are listed in the design and untouched.

**Migrations/deploys:** none.
- Read-only production checks only: the state classifier, the `get_org_id` digest, and the fingerprint query (5,892 entries).

**Verification:**
- Rehearsal (local PostgreSQL 16.15, TLS, port 5432; pinned CLI 2.121.0, release checksum verified): `ALL PASSED: 38 checks`.
  - Security failures: refs, confirmations, bytes, copies, CLI, hosts, identity, environment settings, drifted states.
  - The full release under live CRM traffic: about 1,400 committed client write cycles.
  - Interrupted-stage recovery: lock timeout, watchdog, SIGTERM, a lost runner, a lost CLI, a lost rollback.
  - Rollback refusal with review rows, including the race.
  - 13 read-back tamper cases, decoy migrations never run, and no secret in any output.
- SQL suite: 45 checks, both negative controls and the rollback proof pass.
- CI on PostgreSQL 17.6: see the PR.

**Blockers / next (each separately approved):**
1. Chris's merge decision on the release-only PR.
2. Dispatch `check` → `apply-migration` → independent read-back and advisors → `record-history`.
3. Follow-up: move the file out of `pending/` byte-identically, re-pin the runner, regenerate types.
4. G3.

**Context snapshot:** the release machinery is ready for review; production is unchanged; G2 and G3 are still gated.

## 2026-10-28 — Google Sheets v2 source-column UI cleanup (approved, PR candidate)

**Status:** Branch-only frontend refactor `refactor/sheets-map-source-labels-20261028` from `c707bd7cc3e6800ceb82840889f5f62bb9e37a3a`; not merged to `main`, not released to production. Chris explicitly approved removing column letters and sample captions on the mapping screen, retaining the full source header, New indicators and all mapping/Preview behavior.

**What changed:** The source side of each mapping row is now a single ellipsized, full-header-tooltip label vertically aligned with its 36px target dropdown. The source-letter and `e.g.` captions are no longer shown in the mapping step. The Preview step and its server-provided values remain unchanged, as do field options, mapping targets, duplicate confirmation, ignored-column acknowledgments and access checks.

**Files touched:**
- `src/components/settings/google-sheets/MappingColumnRow.tsx`
- `src/components/settings/google-sheets/MappingStepV2.tsx`
- `src/components/settings/google-sheets/__tests__/googleSheetsV2Ui.test.tsx`
- `scripts/tests/google-sheets-ui/verify.mjs`
- `docs/plans/2026-10-28-sheets-map-source-labels/implementation_plan.md`
- `WORK_LOG.md`

**Migrations/deploys:** None; no Supabase queries or mutations; no Edge, Twilio, Google Sheets source or Vercel production changes.

**Verification:** Focused Vitest, ESLint, `npx tsc --noEmit`, meaningful app typecheck against the exact PR base, Vite build, SQL/Edge and 1440px/390px browser CI are **pending on the PR head**. Browser fake provider now supplies a nonempty sample row to verify the mapping step does not display that sample, while Preview values remain intact. Confirm CI results before requesting release.

**Blockers / next:** Open a review PR; obtain Chris's separate explicit merge approval. Teo's mapping correction and Alexa's intentionally retained v1 mapping remain out of scope.

**Context snapshot:** The change only touches frontend presentation and regression tests plus its plan/log; no tenant-data writes, schema changes, new integrations, or backend deployments. Existing imports and mappings remain governed by the original v2 preview/save validation.
## 2026-10-28 — Google Sheets mapping v2 production release closeout and picker polish (PR #499 CI verified; awaiting merge approval)

**Status:** Production R2–R7 live/verified, R8 owner opt-in 3/4; documentation + frontend polish prepared **only on `chore/sheets-v2-closeout-picker-20261028`**, [PR #499](https://github.com/cgarness/agentflow-life-insure/pull/499). **Google Sheets CI passed all 5 jobs** on tested code SHA `9d30a8c2`; merge still needs separate Chris approval. Do **not** describe the new A–Z dropdown as live until the PR is merged and production deployment verified.

**Production history (prior approved actions, not actions of this branch):**
- PR #498 merged to main at `f870755586a94f16caf1af631391de0237d82f31`. Vercel v2 deployment `dpl_ApDSmKFJtJTnfNy4mwdzqLsQk58X` READY, flag `VITE_GOOGLE_SHEETS_MAPPING_V2=true` in production.
- M1 actual version `20261028034425_google_sheets_context_field_types`; M2 actual version `20261028040215_standard_lead_fields`; both bytes matched the exact production statements (MD5 `e93a8f1e3904fa5c6da6cf3843fe2ad4`, `d8a405763974cdccd616b800e4314883` respectively).
- Sheets API v12, Push v6, Worker v11 ACTIVE with `verify_jwt=false`. R7 conversion approved exact Address, City, Zip Code IDs in Chris's organization; 3 audits, no existing lead-value changes, provisioning complete.
- 4 connected sources healthy: 3 v2 (Chris Pilot B, Alexa FEX Real Time, Teo Goat Leads), 1 retained v1 (Alexa FEX Aged). Big Test automatic v2 import succeeded with one receipt and no duplicate. Latest audit had 2,046 leads and 15 import receipts (a snapshot, not a permanent target).

**This branch changes (no Supabase/Vercel data or deployment writes):**
- Renames the two forward migration files from `pending/` to `supabase/migrations/` with their actual history versions, **without changing any as-applied SQL byte**; renames the two never-applied rollback files. Updates runner, CI path filters, and unit test's migration path.
- Updates historical release runbook, `AGENT_RULES.md` mapping v2 status, adds `docs/plans/2026-10-28-sheets-v2-closeout/implementation_plan.md`.
- UI-only: `MappingFieldPicker.tsx` now displays fields A–Z in one searchable list, with no group headings; missing standard field choices are sorted in, and compact In use/Unavailable labels retain tooltips, screen-reader reasons, disabled states and Move confirmation. Updates focused UI tests.

**Files touched:** `AGENT_RULES.md`, `WORK_LOG.md`, `docs/plans/2026-10-27-sheets-mapping-reliability/release.md`, `docs/plans/2026-10-28-sheets-v2-closeout/implementation_plan.md`, `scripts/run_google_sheets_tests.sh`, `.github/workflows/google-sheets.yml`, `src/lib/google-sheets/__tests__/mappingV2.test.ts`, `src/components/settings/google-sheets/MappingFieldPicker.tsx`, `src/components/settings/google-sheets/__tests__/googleSheetsV2Ui.test.tsx`, the two renamed forward SQL files and two renamed rollback SQL files.

**Verification:** Re-read production migration history and original GitHub source checksums; source SQL matched production bytes at reconciliation. Google Sheets CI [run 40751281029](https://github.com/cgarness/agentflow-life-insure/actions/runs/40751281029) completed **SUCCESS (5/5 jobs)** on code SHA `9d30a8c2`: SQL/PostgREST/e2e, Deno Edge, real isolated pg_cron/pg_net, frontend focused Vitest (190 passing tests), ESLint, `npx tsc --noEmit`, app type-check against exact PR base, Vite build, and desktop/mobile (1440/390 px) browser flow. Vercel preview checks passed; no production deployment. Root `npx tsc --noEmit` is vacuous by itself, while the app type baseline check was meaningful. The final commit only updates plan/log test evidence, not tested application code.

**Risks and follow-ups:** Teo owner to fix Beneficiary Name → Full Name and review ignored address fields; Alexa FEX Aged remains v1 by choice; Alexa FEX Real Time ignores Trusted Form URL/OTP/IP (review consent-evidence implications separately). Nine historical Pilot B receipts point to absent leads; no deletion, repair or inferred cause. Do not change mapping JSON or release backend. Review PR CI, obtain Chris's distinct approval for merge and automatic Vercel production build, then verify deployment and signed-in desktop/mobile picker behavior.

**Context snapshot:** No new migrations applied, Edge deployed, Vercel config changed, or production data mutated in this task. Changes are branch-only; next action is CI review and separate merge approval.
