# Reporting integrity implementation verification

Verified October 4, 2026 UTC. Isolated branch `codex/leaderboard-accuracy-audit-20261004`, base `436d9d840732bca1262559597c17e5ef09893fbf`. **Implementation complete; production release and historical corrections are not performed.** This record describes local evidence, not a certification of all historical data.

## Executed checks

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
