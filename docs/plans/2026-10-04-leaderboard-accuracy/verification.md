# Reporting integrity implementation verification

Updated October 5, 2026 UTC. **The approved production release and exact six-link/two-sale correction are complete.** Final evidence is below and in `production-release.md` / `production-release-evidence.json`. Earlier sections preserve historical checkpoints. This is not a certification of all legacy call/booking data.

## Final exact-head and production evidence — October 5

Reviewed head `a773a70185d2e79fa60a26a170ac100a01bd8b4a` and production squash `51308ce16fb570ab668b87ab36df2a2b9abda995` share source tree `291b40e669497ebb7ea7f70f4ddefff49108cd13`. All final gates passed:

| Gate | Run | Result |
| --- | --- | --- |
| Native reporting PostgreSQL 17.6 | `37334465465` | Independent-session policy/booking/provider races, authorization, actual read-only reconciliation and 50,000-call index proof; annual summary 80 ms. |
| Dialer/DNC | `37334465463` | Pass. |
| A2P regression | `37334465474` | Pass. |
| Policy transactions and rendered browser | `37334465430` | Pass; responsive normal/TV totals, exact cents/seconds, geometry, photos, ranks, roster changes and live policy update. |
| Full frontend comparison | `37334465405` | Pass; 4,188 candidate versus 4,126 base passing tests, same one existing failed assertion, failed files 10 versus 11, app diagnostics 87 versus 88, zero new test/type/runtime failures. Root tsc, scoped lint, build and 132 Reports normalization tests pass. |

Browser artifact `11355283507`: SHA-256 `0b237767bcc644f26859812524959836ebde93fda8e44101a6ba665a7013cca0`. Frontend artifact `11355759808`: SHA-256 `457bc826de20db577f84efc6e6d1e48eeffce73357bda8d1825992bf6dc3997d`. These GitHub artifacts expire October 12; the committed scripts and run logs preserve reproduction details. Repository-wide tests/types still contain the disclosed baseline failures.

Chris confirmed calls finished and the coordinated pause at 09:10 PDT. Fresh preflight found zero recent active calls/sessions. Eight recorded migration SQL hashes match approved sources; all 29 reviewed functions have intended ownership/ACLs and no anonymous execution. The five new private tables and repair receipt table have RLS and owner-only access. Original DNC/converter bodies are unchanged. Exact deployed voice-status v45 and Google inbound sync v492 bundles/settings match the approved files. Both Vercel production deployments are READY, and public HTML/entry assets return 200 with the new API markers.

Actual `authenticated` database-role Admin, Agent and Team Leader readbacks passed. Admin, Teo and Will reads after repair return eight equal secured feed rows; Admin year totals are 8 policies/$9,373.92, Teo 1/$701.40, Will 1/$499.68. The October active board is identical across those actors and reconciles to 1,263 recorded outbound calls, 15 bookings, zero policies/$0, and 19,662 talk seconds. Today/current week are zero at the frozen as-of. Anonymous invocation is denied with SQLSTATE 42501.

Observation lasted 636.523 seconds with eight DB read samples. Single-month execution was 73.739–84.955 ms; the three-period batch was 192.549 ms. No DB sample crossed two seconds. Tool round-trip duration is separately recorded and is not API-origin latency. Targeted Vercel and reviewed Edge-function error scans found no matching errors. Two logged heartbeat rejections came from the unchanged `heartbeat_dialer_session` function; no historical sessions were altered.

Approved historical operations `20261005163257` and `20261005163300` applied after observation. Both receipts exactly match source and event postimages. Final read-only reconciliation: eight identities/eight sales/$9,373.92, zero policy identity gaps/unlinked events, no applied duplicate mappings/missing booking targets. Client non-identity details, original sale non-identity facts, 5,220 calls and 89 appointments retain exact before/after hashes. September is 4/$3,205.32; October stays zero. No customer communications or production test records were created.

**Verification limits:** secure production sign-in returned “Failed to fetch”; it was stopped without retry or bypass and the tab closed. No authenticated production browser walkthrough is claimed. No matching reporting HTTP requests were present in the observation log window, so the HTTP-origin response stop rule was not measured; DB timing does not substitute for that measurement. No live provider callback/new-sale/booking smoke was manufactured. Production has no active Group memberships, so Group behavior is verified in isolated tests, not a fabricated production group. Historical call/booking candidates and legacy duration quality remain unresolved as recorded in the release evidence.

## Release-record filename alignment checks

The follow-up release record changes documentation and renames the eight applied migrations only. Each new path resolves uniquely by suffix and retains the exact approved/recorded SHA-256. Shared fixture generation resolves all 29 policy/performance steps and all eight booking/duration steps. Root `npx tsc --noEmit` passes; actual app TypeScript still has the same 87 known diagnostics. No source, script, workflow or package file differs from the released commit. `git diff --check` passes. Affected remote checks are recorded on the follow-up PR.

## October 5 remote evidence and corrective follow-up

PR [#416](https://github.com/cgarness/agentflow-life-insure/pull/416), head `3edb2817e7817c86975eb53ab880914b4f6fdb3f`, tree `c2795fe111726514b321d3601b1eb523ccbb72d7`, is published as a draft. This supersedes the unpublished/local-only status in the original record below. Production remains unchanged.

- Native reporting integrity run `37203643788` **passed** on PostgreSQL 17.6: independent-session policy/booking replay contention, busy/release, provider duration races, Google identity races, 50,000-call index proof and annual summary (55 ms), and actual read-only reconciliation script. Policy transaction job in `37203643810`, DNC `37203643840` and A2P `37203643781` passed.
- Frontend run `37203643830`: base 4,126 passing / 1 failed test; candidate 4,187 passing / 2 failed tests. One new failed assertion was the missed-call voicemail test's missing permission provider; its explicit all-scope mock now restores the existing behavior assertions. `clientMapping` simultaneously improved from setup failure to 14 passing tests. The comparator now permits resolved failures and rejects new/replacement/duplicate failure identities, with negative controls. The actual new assertion was fixed before accepting the comparison. TypeScript comparison passed (87 versus 88 diagnostics); both runtime error reporters recorded zero.
- Browser run `37203643810` **failed** on table-photo clipping at 1366×768, with zero page errors. Wrapped headings exceeded the fixed panel budget. The correction uses intrinsic header/body minimum height; existing minimum row size, geometry assertions, rank motion, centering and scroll access remain. Added scrolled-table screenshots expose lower rows to manual inspection.
- Local corrective follow-up: 30 tests pass across voicemail, client mapping and leaderboard status suites; root TypeScript, scoped ESLint and whitespace checks pass. Revised browser and full-suite runs remain pending; no browser success is claimed yet.

## Original October 4 local checks

| Check | Result and practical limit |
| --- | --- |
| All changed/new frontend tests | **27 files, 521 passed, 2 existing skips**. Real modal and Dialer flows, retry retention, request identities, conversions, reserved custom fields, dashboard, widget, main/TV status surfaces, request gates, feed celebration, scope validation, precision, CSV and duration evidence. |
| Disposable policy/performance database | Actual migration SQL passed against verbatim baseline tables/functions plus scoped fixtures. Covers primary/additional/first policy, multi-policy conversion, zero/unknown, retries, authorization, immutable snapshots, reassignment/reorder/removal/deletion, recreation refusal and raw-write enforcement. |
| Secured reporting database | Active roster/excluded activity, outbound/future bounds, setter attribution, exact cents, Agent/Admin identical $900 legacy feed without raw client grants, denied group membership, actual-profile authority, downline limits, canonical duplicate exclusion and trusted Dialer parity passed. |
| Disposable booking/duration database | Original DNC/disposition body preserved; atomic booking rollback, request replay and changed-payload rejection, pre-upgrade committed-disposition completion, setter protection, cross-org rejection, provider 120-estimate → 90-authoritative correction, late/conflicting evidence and provider booking uniqueness passed. |
| Exact historical scripts | Six unambiguous identity links add no events. Two-sale repair produces **8 events / $9,373.92 annual premium**. Replay adds zero; drift in the second source rolls back the first; exact reversal preserves the six original events and cannot silently reapply. September becomes 4 / $3,205.32; October remains 0. |
| Reconciliation SQL | Executed in a **read-only transaction** against the disposable upgraded schema. Scope, three periods, empty applied mappings and receipt checks passed. Not executed against production's pre-upgrade schema. |
| Application TypeScript | **87 existing diagnostics versus 88 on exact base; no new diagnostics** after normalizing line/column positions. Removed obsolete Dashboard callback union diagnostic. |
| Root TypeScript | `npx tsc --noEmit` passes, with the repository's documented solution-config limitation. |
| Scoped ESLint | 76 files; 1 existing error, 58 warnings; **no new errors** against exact-base scoped result. Not a globally clean lint claim. Some files are ignored by the existing ESLint configuration. |
| Production Vite build | Pass, 15.82 seconds; existing large-bundle warning remains. |
| Isolated browser-fixture build | Pass. Normal/TV fixture now contains agency/as-of/roster captions, $701.40, exact seconds, unknown premium and undefined ratio. Building is not browser execution. |
| Script syntax / diff | Node syntax checks, Bash syntax check and `git diff --check` pass. |

Reproduce the frontend selection with the modified/new `*.test.ts` and `*.test.tsx` files recorded in `implementation-files.json`. Both embedded database entrypoints share `scripts/reporting_fixture.py` with the native runner:

```bash
PGLITE_PACKAGE=/absolute/path/to/@electric-sql/pglite node scripts/tests/policy-integrity-embedded.mjs
PGLITE_PACKAGE=/absolute/path/to/@electric-sql/pglite node scripts/tests/booking-integrity-embedded.mjs
```

Dependencies were installed in scratch only. Application package files and lockfile are unchanged. PGlite validates transactions, SQL, grants and constraints, but cannot prove independent-session contention. Fixtures deliberately withhold raw grants for authenticated policy/performance tests; they do not reproduce every hosted RLS policy, automation integration or provider service.

## Required checks not completed here

- **Native PostgreSQL 17.6 independent sessions:** local startup is blocked because `chown`/`runuser` cannot switch to the required unprivileged account. Prepared `scripts/run_reporting_integrity_tests.sh` and `reporting-integrity.yml` cover policy/booking retry contention, advisory busy/release, duration evidence races, external-event races and a 50,000-call indexed/year-summary latency gate. They have not run. A successful embedded suite is not a substitute.
- **Browser:** `agent-browser install` failed downloading Chromium with certificate validation `UnknownIssuer`. No TLS bypass was attempted. The agent-browser verification workflow remains incomplete. Expanded localhost normal/narrow/TV fixture checks are prepared in the existing browser CI job. No signed-in Agent/Admin production walkthrough, live sale, provider callback or audio/call test occurred.
- **Exact-head full frontend/DNC/backend CI:** not run remotely; no branch was published. A local full-suite attempt was interrupted after obsolete RPC mocks produced excessive failures; affected changed suites now pass. One unrelated `recordingRetentionVoicemail` failure was reproduced unchanged on base (79 passing / 1 failing); no global-green claim.
- **Provider-dependent historical reconciliation:** 277 distinct suspect call rows and 12 booking candidate rows remain review manifests, not certified corrections. No canonical rows were guessed, no historical durations rewritten, no production mappings inserted.

## Evidence and boundaries

`reconciliation-manifest.json` freezes the read-only production evidence at `2026-10-04T06:23:07.20119Z`; `full_audit.md` records the earlier common comparison as-of. No customer names/phones are required in that manifest. Repair fixtures reuse the exact policy-critical preimages with synthetic contact/profile names, avoiding a claim of full production-row equivalence.

Production Supabase access during this task was read-only. No migration, repair, provider request, public push, PR, merge, deployment, customer communication or synthetic production data was performed. Reports source/RPCs remain unchanged; only a compatibility test's obsolete hash of the now-authorized Dialer helper was removed, while Reports-owned hashes remain pinned.


## Approved release amendment, 05:46 PDT

The trusted Dialer fixture now reproduces the actual live ACL, including anonymous execution before upgrade. The exact-ACL guarded migration explicitly removes anonymous/public execution as Chris approved. All 29 embedded policy/performance/repair/reconciliation steps pass again, including anonymous invocation denial, preserved signed-in grants and Admin self-scope. The frontend CI comparator now ignores moved line/column positions and permits resolved baseline diagnostics while rejecting any new file/code/message/multiplicity. Existing test/runtime regression checks are retained. The pre-existing AppointmentModal prefer-const error is fixed without behavior change.
