# P0 Dialer Reliability — verification and release package

Status: **production released and verified**, November 4 Pacific / November 5 UTC, 2026. Chris approved exact head `1e98c55`; PR #515 merged as `c971306` with identical source tree. Both production deployments are READY. The earlier candidate/publication snapshots below are historical; the database and frontend gates are complete. Real microphone/carrier/full live disposition acceptance remains unverified.

## Production frontend release

Chris approved PR #515 at `1e98c55ad8d10f88dbc5f62b6d9c4c4405b94cc5` after the database gate. Merged through the PR with expected-head protection as `c9713060949b431ca49b884869165f39e7065666`; the merged tree exactly matches the approved tree `0003afb4957ff3efd0c932d40ad829a06ec6eef4`. No direct main push. Both Vercel production builds are READY; agentflow deployment `dpl_BoEcDFmvef9oFmLBmJNwP6zTyPga` serves www.fflagent.com at that commit.

**Changes:** Skip commits one membership-ID transition and ignores stale queue/URL/async results. Navigation preserves unsaved outcomes and queue locks; calling-hours refusal pauses Auto Dial without persistent automatic skips. Call uses visible shared gates and one action owner, revalidates after async work, retains browser Voice.js re-entrancy guards and records truthful failed/unconfirmed dispatches. Signed admission controls new call totals; new session mode metadata matches the campaign/current runtime toggle. Single-leg Voice.js, DNC, cooldowns, callback/queue locks, disposition history, organization_id and RLS remain preserved.

**Verification:** All six workflows passed on exact head 1e98c55, including 606 dialer tests/47 files, native PostgreSQL 16.15 contention in both admission/failure orders, DNC/claim/save races, drift/replay/rollback and report-reader checks. Full repository comparison: 6,765 base / 6,801 candidate passing tests, zero new failures or unhandled runtime errors; existing one failed test/nine failed files and type/lint debt remain documented. Root tsc, scoped lint and build pass. Immediately before merge, all eight live backend postimages/authorization metadata still matched. Production bundle `/assets/index-BIiTv98T.js` is HTTP 200, SHA-256 `f0f32a6d5bf741173ae6a1a6c4ab5a6451ea6817090fb73acefa153e82f3e870`, with the new gating/mode/admission markers. Public/login browser smoke passes with no captured application errors; Vercel returned no error/fatal runtime groups in the scoped observation. These do not prove live Voice.js audio.

**Migrations/deploys:** Database versions 20261105051018 and 20261105051037 were already applied and verified; neither was replayed. No Edge/RLS change, historical repair, production fixture or real call. This release-record follow-up touches only WORK_LOG.md, root/focused implementation_plan.md, AGENT_RULES.md release status, focused verification.md/manifest.json and new frontend-release.json. Application, SQL, tests and workflow bytes are unchanged.

**Conflicts/next:** Reports head is bfa6ff9627b435a73c48b8c1572a2609b16a93e6; its newer unattributed-display fix adds no dialer/SQL overlap. Preserve the existing appointment type/sourceCallId/API forwarding mounts and coordinate the updated call-facts/recovery pin before Reports release. Live microphone/carrier/full disposition acceptance still needs an authorized synthetic endpoint; no prospect is to be used. Will's historic failed click remains uncorrelated. See focused verification.md and frontend-release.json for evidence and limits.

## Production database release — November 4 Pacific / November 5 UTC

Chris approved both exact SQL hashes below. Applied and read back as **20261105051018** and **20261105051037**, in order; repository files now match those recorded versions with identical SQL bytes. See `production-release.json` for installed object metadata, migration-history SQL checksums and advisor findings. All eight replacement function postimages and three new function bodies/ACLs match. Existing 605 unrelated functions, 371 policies, 170 table security configurations, seven triggers and original call columns are unchanged. The 3,537 signed-admission projections have zero mismatches. Both RPCs refuse missing actors in explicit read-only production checks using nil synthetic IDs; no fixture was inserted.

Advisors: **265 before / 267 after**, with only the two intended authenticated, actor/org-scoped RPCs added to the [SECURITY DEFINER execution warning](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). No new RLS-disabled or mutable-search-path finding. The existing app_config/webhook_debug_log findings remain outside this hotfix. No Edge deployment or real call occurred. The later frontend release is recorded above; real media/carrier delivery remains unverified.

Pre-release final head a7c8f74 passed all six CI workflows and both preview builds. Full repository comparison: 6,765 base / 6,801 candidate tests passed, no new failures, zero unhandled runtime errors; one existing failed test and nine existing failed files remain. Final head 1e98c55 subsequently passed all six workflows with the reconciled migration paths. This section supersedes earlier unreleased-status statements below.

## Historical production and conflict baseline before release

- Repository: `cgarness/agentflow-life-insure`; local branch `hotfix/dialer-reliability-20261104`.
- Main and READY Vercel production: `2b6f5cefe4f4d7980ab670067a5634e320cd20fd`; deployment `dpl_6Ue8L6EDqwhqfThT4UJeUA9wuDZc`, serving `www.fflagent.com`. Rechecked unchanged during final review.
- Reviewed all 16 open PR file lists. No core dialer implementation overlap; documentation overlap includes #514.
- Reports V2 branch `claude/great-goodall-911azc-integration` now points to `f7ff977992a873f23ac9bbe27eeadd878a3f83be`. Its two commits since the original review only change WORK_LOG. Preserve its appointment `type: data.type`, `sourceCallId={currentCallId}` conversion mount, and API appointment-type forwarding when integrating. Do not merge the entire Reports branch into this hotfix.
- This candidate changes one inclusion predicate in live `private.report_call_facts` and updates its recovery fingerprint. Coordinate that reader/pin with Reports; exact body/owner/ACL/security/search-path guards reject source drift.
- Read `AGENT_RULES.md`, `VISION.md`, latest main and Reports Work Log entries, all seven requested source files, and related authorization, disposition, booking, session, claim/renew/release, history and provider code. The queue sorter and canonical DNC/claim/disposition functions are preserved.

## Root causes and limits

| Confirmed finding | Exact correction |
|---|---|
| Queue arrays, numeric selection and URL were written separately. Re-sorting could change the contact at an old index while the lifecycle chose the first eligible lead. Several asynchronous finalizers/timers shared the same busy flag. | `useDialerNavigation` stores queue + membership ID together, derives the index, and gives each operation a token only its owner can finish. URL reconciliation handles external input once and ignores its own echoes. Skip persists once and commits one next eligible identity. |
| Skip/arrows could clear an unsaved disposition, notes or current call. | Shared navigation guard covers Skip, arrows, queue selection, contact URL, campaign changes and End Session. Save Only records the saved draft fingerprint; edits afterward become dirty again. Failed saves retain the outcome and lock. |
| Calling-hours refusal invoked persistent Skip from an effect and could repeat through the queue. | The state machine pauses Auto Dial once for that lead. Timers recheck current lead/readiness/hours/callback due time and are canceled when invalidated. No automatic Skip writes. |
| Call UI could remain enabled while its handler/provider would refuse. Early session/DNC awaits had no original-action ownership. Concurrent session starts could return a silent false; thrown dispatch/session failures escaped the gate. | One preflight token is acquired synchronously; identical pending session starts join. UI/handler share the readiness decision and queue-lock refusal. Original user/org/campaign/visit is revalidated after awaits, through microphone and before Voice.js dispatch. Errors surface; late results cannot dial a newly selected contact or release a newer action. |
| Runtime Auto Dial had a true default/loading window and multiple async writers. The database session insert omitted its Auto Dial value, inheriting DEFAULT true. | Runtime starts false and waits for current-scope settings. New sessions initialize from the campaign; the current toggle is recorded through an actor/org/active-session-scoped RPC. Historical sessions are not rewritten. |
| A prepared call row/SDK dispatch was treated as a call count, and rejected dispatch could leave a misleading ringing row. | Remove optimistic call-count writes; keep one UUID through ambiguous insert recovery. Retain a not-sent or unconfirmed audit receipt. Count new guarded rows only after signed admission; retain legacy rows and actual provider-admitted failures. No invented duration, disposition or No Answer. |

Will Harrison's **“Goat leads aged 11/3”** was inspected read-only. The Personal campaign has Auto Dial off; its eight newest session rows reported Auto Dial on. Live function/default inspection explains that metadata mismatch; it does **not** prove the browser automatically dialed. The sampled 32 calls over the last two days all had provider SIDs and positive signed admission; their statuses were completed/no-answer. There is no correlated failed-click event. The incident-specific Call failure remains unconfirmed; the repaired refusal/race paths are established from source and synthetic tests, not guessed from successful calls.

Queue snapshot: 35 Queued, 12 Called, two Skipped and one DNC; the Called/Skipped retry windows were still pending. `retry_interval_minutes=0` uses the existing server fallback; this hotfix does not reinterpret it as immediate retry. No lead phone numbers or personal call content were copied into fixtures.

## Call gate trace

| Gate | Failure behavior / preserved authority |
|---|---|
| Page entry | Current authorized campaign and lead, existing call, pending navigation/save, unsaved outcome and phone readiness determine the visible disabled state. A lost Team/Open lock blocks Call. One synchronous token spans preflight. |
| Campaign session | Matching active session reused; identical pending starts join; a different active/requested campaign or unauthorized Personal campaign is refused. No automatic end/replacement of another session. |
| DNC preflight | Existing RPC fails closed; manual click shows the existing DNC interaction, automatic intent pauses. Neither intent bypasses DNC. |
| Caller-ID selection | Preserve agency/owned Personal eligibility, active/cap/group checks and Inbounds exclusion. Empty/invalid selection surfaces an actionable error, with no unauthorized fallback. |
| Provider re-entrancy/readiness | Preserve `isDialingRef`, active/incoming/dialing checks, registered readiness, Device presence and status. Reserve before auth/microphone awaits. |
| Auth / tenant | Existing refresh, organization claim, profile, user and org consistency gates remain. No frontend secrets or service role usage. |
| Microphone | Denied, missing and busy/unreadable microphones each explain recovery. A permission result returned to a stale action is stopped without inserting a call or connecting. |
| Final provider DNC/lineage | Repeat DNC after asynchronous setup; existing server insert guards validate actor/org/campaign/contact lineage. One attempt UUID, optional-row `.maybeSingle()`, same-UUID lookup on ambiguous insert response. |
| Dispatch | Recheck action and Device; call the existing single-leg `twilioMakeCall` → browser `device.connect()` exactly once. No REST dial, second leg, automatic retry, SDK replacement or Edge change. |
| Signed admission / provider callbacks | Existing live webhook v61 (`verify_jwt=false`, provider signature validation) and `admit_twilio_outbound` stay unchanged. Signed admission, DNC and queue-lock checks remain authoritative. Duration/status callbacks, recordings, disposition transaction and queue locks remain intact. |
| Dispatch error accounting | Before connect: not-sent hint; after invocation: unconfirmed hint. New own-call RPC takes the same call row lock as admission and cannot overwrite an existing SID/admission. Later signed truth controls inclusion/history. Phone-number dispatch quota behavior is unchanged; the candidate corrects business call totals. |

## Verification

All tests use synthetic data. No real prospect was called, no production fixture inserted, and no live campaign/session/queue record was changed.

| Check | Result |
|---|---|
| Broad focused Vitest | **606/606 passing, 47 files**, independently repeated in GitHub CI on `2fc8dce8`. Includes mounted DialerPage rapid Skip/resort/draft/failure/Call readiness, session authorization/coalescing, queue/callback/disposition/booking/conversion, caller-ID/DNC, Team/Open reveal/renew/release and real TwilioProvider with a synthetic SDK. |
| Chromium fixture | PASS: actual navigation hook, state machine and primary controls; rapid clicks, one persisted Skip, sorting, URL, dirty Back/link refusal, stale Call cancellation, automatic-hours pause. External requests blocked, no page errors. This is an isolated component integration fixture, not a signed-in production browser/media test. |
| Actual migration files | PASS in PGlite and native PostgreSQL 16.15 in disposable GitHub CI. Both transactions apply; eight replaced functions retain exact ACLs/security/search paths. Changed security mode/ACL is refused before mutation. Replay is refused. |
| SQL behavior | PASS: existing disposition/DNC, DNC security and DNC matrix suites; new metadata authorization, cross-tenant refusals, forged admission flags, failure hints, signed-admission precedence, legacy/admitted counting in trusted v1/v2 and campaign cards. |
| Reporting readers | PASS: actual candidate performance aggregates/details, profile-book achievements and Reports V2 readers with legacy + signed admitted failures included and unconfirmed rows excluded. Actual versioned Reports recovery script accepts the new pin and preserves the existing V2 grants. |
| Rollback | PASS: exact eight function preimages/ACLs restored; drift and replay refused; additive fields/history retained. No production rollback executed. |
| `npx tsc --noEmit` | PASS. Root configuration has empty files/references; app check below is the meaningful additional check. |
| `npx tsc --noEmit -p tsconfig.app.json` | **79 baseline / 79 candidate diagnostics, zero new signatures**. Exit 2 is existing repository debt, not a clean app typecheck. |
| Scoped lint | PASS: zero errors on all changed JS/TS files; 21 warnings remain. |
| `npm run lint` | **11 baseline / 11 candidate errors, zero new error signatures**. Baseline 152 warnings; candidate 142. Full lint remains exit 1. No unrelated lint fixes mixed in. |
| `npm run build` | PASS. Existing outdated Browserslist and large-bundle warnings remain. |
| Whitespace / runner syntax | `git diff --check` and Node syntax checks PASS. |
| Native PostgreSQL contention | **PASS** in [Dialer DNC integrity run 41943152769](https://github.com/cgarness/agentflow-life-insure/actions/runs/41943152769), job `126968704909`, native PostgreSQL 16.15. Both failure/admission row-lock orders passed: provider truth wins with no fabricated duration. Existing simultaneous DNC, claim race, stale admission, duplicate saves and SKIP LOCKED checks also passed. Actual migration, rollback, ACL, reporting-reader and recovery-pin tests passed in that same run. No production credentials or database were used. |
| Real Voice.js media/carrier delivery | **NOT RUN.** Synthetic SDK/media denial paths are covered. A controlled, separately authorized test with synthetic contacts and approved test endpoints is required to verify live audio/provider callbacks. |

Reporting functions are exercised in their corresponding complete synthetic dependency fixtures. The combined migration/rollback fixture disables function-body dependency validation only for unrelated reporting dependencies, then separately executes each changed reader against its real SQL fixture in `counts.mjs`. No mock reader implementations replace the candidate SQL. This is not a complete clone of every production table/trigger/RLS policy.

Reproducible commands (never load an application `.env`):

```bash
VITE_SUPABASE_URL=http://127.0.0.1:9 VITE_SUPABASE_ANON_KEY=synthetic_test_only \
  npx vitest run dialer twilio teamOpen teamCampaign dncCheck useTeamOpen \
  caller-id-selection convertLeadModalPolicyFields leadDisposition outboundPathPinned
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.app.json
npm run lint
npm run build
# Embedded option: PGLITE_PACKAGE must be an installed @electric-sql/pglite path.
PGLITE_PACKAGE=/path/to/@electric-sql/pglite node scripts/tests/dialer-reliability/database.mjs
PGLITE_PACKAGE=/path/to/@electric-sql/pglite node scripts/tests/dialer-reliability/counts.mjs
# Native option, disposable loopback cluster ONLY, postgres user, no database suffix.
PGURL=postgresql://postgres:local_test_only@127.0.0.1:55439 \
  node scripts/tests/dialer-reliability/database.mjs
PGURL=postgresql://postgres:local_test_only@127.0.0.1:55439 \
  node scripts/tests/dialer-reliability/counts.mjs
node scripts/tests/dialer-reliability/check.mjs
```

The Chromium runner uses Playwright; this environment used a portable Chromium executable because the normal browser download failed. It also accepts `CHROMIUM_PACKAGE`/`CHROMIUM_EXECUTABLE`. Dependencies were installed only in scratch; no package/lockfile changes.

## Exact applied backend payloads

| Order | File | SHA-256 |
|---|---|---|
| 1 | `20261105051018_dialer_reliability.sql` | `dc0fe4c680e8915e5a47735fb479c2347320be44b75042a06b3a633cc0707328` |
| 2 | `20261105051037_dialer_admitted_call_counts.sql` | `46bda3ed1a6c6d2e82106d4809b0424c1beb26393f0bd306b6747ebf3af98940` |
| Rollback, separate approval only | `rollback.sql` beside this report | `332e951d2d273be36b06f84eff37a466b9adeef0ffb00f70275385b8e84fa5c3` |

Migration 1 adds two call metadata columns, a private admission-projection trigger, two actor-scoped RPCs and fixes session initialization/trusted counters. The projection backfill is derived solely from existing private admissions. Read-only release sizing found **3,487 matching rows: 3,484 admitted, three refused**. This is a snapshot, not a reserved count. It does not rewrite call outcomes, durations, timestamps, dispositions, queue state or historical session modes. All six existing `calls` trigger bodies were inspected; the projection update does not invoke an INSERT-only call-created workflow.

Migration 2 adds exactly one admission predicate to each captured reader: campaign-card stats, Reports call facts, performance rows, performance details and profile-book stats. No report attribution, date, policy, duration or visibility rules change. Existing ACLs are preserved. Both migrations use a three-second lock timeout and 60-second statement timeout; failure rolls back the transaction and requires investigation, not an automatic retry with weaker guards. PostgREST reload is notified after the new columns/RPCs are committed.

`manifest.json` records all changed files/hashes. `live-function-metadata.json` pins source body hashes and existing owner/security/search-path/ACL values. Eight `.before.sql` snapshots and the old Reports recovery script are included. No Edge deployment, RLS-policy change, session-history repair, production test row, call or provider purchase is proposed.

## Release sequence and rollback

1. **Publish/CI complete:** Chris approved publication; all six workflows and both previews passed on final head 1e98c55. PR #515 is now merged.
2. Recheck main, Reports branch, open PR overlaps, deployment SHA and all eight live function/ACL preimages. Resolve overlaps without losing Reports appointment-type/source-call mounts or its new reader work. Re-run affected checks if source changes.
3. Native PostgreSQL CI is green on the published source, including both admission/failure lock orders and existing DNC/claim concurrency. Require all final-head PR checks green as well. Preserve the baseline app type/lint comparison as explicit existing debt, not a misleading green check.
4. **Database gate complete:** Chris approved the two hashes above; migration 1 then migration 2 were applied and their exact SQL bytes read back from history. Columns/check, trigger, RPC ACLs/actor checks, eight function postimages, existing policies/telephony functions and security advisors are verified in production-release.json. Do not replay. Unrelated `app_config`/`webhook_debug_log` findings remain with their dedicated security task.
5. **Frontend release complete:** Chris separately approved exact head 1e98c55. PR merge c971306 has the identical reviewed tree; both production deployments, custom-domain bundle and public/login smoke are verified above. No direct main push or forced reload of active agents. Controlled live microphone/carrier/disposition acceptance remains unverified.
6. Observe Skip transition counts, explicit preflight errors, unconfirmed attempts, duplicate UUID/SID detection and admission-to-counter agreement. Correlate any fresh failed click by time/attempt ID without collecting prospect content. A successful recent call alone does not close the original failed-click diagnosis.
7. Roll back frontend first to the known production baseline if the new UI regresses. The backend is additive and compatible with the old frontend, so leave it in place unless it is implicated. Any backend rollback needs explicit approval for `rollback.sql`; it refuses drift and restores eight exact function preimages while keeping secure new fields/RPCs/trigger and all history/receipts. Pair it with the archived `reports_integrity_enable.before.sql` for subsequent Reports recovery, not the new pin. Do not delete migration history, audit rows or additive columns, and do not blindly replay the original migrations after rollback; prepare a forward repair.

Remaining acceptance: an authorized synthetic endpoint for live microphone/carrier/full disposition verification, plus correlation of any fresh failed click. Both approved release gates are complete; native contention and all six final-head checks passed. The production frontend and backend are released and verified within the documented limits.
