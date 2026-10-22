# Google Sheets V1 — verification record (local + CI; no production)

## Current re-stamp verification — 2026-10-22 06:25 UTC

All 10 GitHub Actions workflows passed on published reconciliation head
`98074fb2e6b9053ad1bc88010c4f3c885d7d06c3`. This is completed evidence for that
head; CI for the filename re-stamp must pass after the new head is published.

Fresh read-only SQL at `2026-10-22T06:25:20.775462Z` returned:

| Observation | Result |
|---|---|
| Hosted history count / latest | `342 / 20261021200000` |
| Sheets history / relations / database functions / cron / Vault secret names | `0 / 0 / 0 / 0 / 0` |
| Permission-helper preimage MD5 | `a199d5ddfb9a56070aeb7706d3e9a4b8` |
| Supabase Deploy to production | OFF, observed after successful sign-in |
| Deployed Edge inventory | 77 visible functions, none `google-sheets-*` |
| Six B1 Edge secret names | Present; no value read/change/validation |
| Backend `GOOGLE_SHEETS_ENABLED` | Absent |
| Frontend `VITE_GOOGLE_SHEETS_ENABLED` | Absent in Vercel project and shared searches across all environments/variables |
| Current frontend rollback candidate | `dpl_CnxbpTh4fae7Bi6RWvZvWsGBDxP3`; Ready / Production / current `www.fflagent.com`; source `1a7ea7a5c1ee5d2b3cd1eece157900f77da24bf4` |

Sources: [hosted SQL result](https://supabase.com/dashboard/project/jncvvsvckxhqgqvkppmj/sql/4ee2c7e3-376e-4e27-b00f-977ab28e0211),
[Edge functions](https://supabase.com/dashboard/project/jncvvsvckxhqgqvkppmj/functions),
[Edge secret names](https://supabase.com/dashboard/project/jncvvsvckxhqgqvkppmj/functions/secrets),
[Vercel environment search](https://vercel.com/cgarness-projects/agentflow/settings/environment-variables).

At the verified 06:25:39 UTC clock, release version `20261022062539` was chosen
after the hosted head. Foundation and rollback were renamed without changing
their contents. Active CI/test paths use the new name; the regression-evidence
script keeps the original filename for its historical reviewed tree. The pending
cron file and every Edge bundle are unchanged.

| Re-stamp check | Result |
|---|---|
| SQL and rollback bytes against `98074fb2` | PASS; only filenames change |
| Foundation SHA-256 | `fc68da86bfa972148b72302b3bc0daf8d227453b75fdadd6ef8578908d76efed` |
| Rollback SHA-256 | `d9f36c350c2e02f9004ffe20a029762bd078e67c184ec06f71496e93ebaf0e93` |
| All four Edge bundle digests | Unchanged; exact values in the reconciliation table below |
| Active path resolution, historical/current regression paths, shell syntax | PASS; YAML path filters and raw import resolve, actual regression selector returns each tree's intended path, historical blob exists, unknown tree refused, all three shell scripts parse |
| Path-dependent Sheets Vitest and required root TypeScript | PASS; 12/12 tests and `npx tsc --noEmit` exit 0 |
| New-head CI and runner source/history re-pin | Pending review and publication |

Expected Phase B history is now 342/latest `20261021200000` before apply and
recording, then 343/latest `20261022062539` after recording, with 81 statements
in the one Sheets row. These observations must be rechecked before each stage;
they do not authorize an automatic retry or implicit pin refresh. The
[rollback candidate](https://vercel.com/cgarness-projects/agentflow/CnxbpTh4fae7Bi6RWvZvWsGBDxP3)
was captured before the runner merge and must be captured again before Phase C.
GitHub environment credential readiness remains outstanding. No production mutation,
import, schedule or real Google-account test was performed.

## Earlier reconciliation — 2026-10-22 UTC

Chris approved proceeding after the status review. The feature branch was merged
locally with `main` `1a7ea7a5c1ee5d2b3cd1eece157900f77da24bf4`, preserving
both histories. The four overlapping files (`AGENT_RULES.md`, `WORK_LOG.md`,
root `implementation_plan.md`, and `supabase/config.toml`) retain both sides.
Config was parsed and checked against both parents: every function setting is
preserved, including `uv-profile-sync-worker` and the four Sheets functions.

| Check on the reconciled tree | Result |
|---|---|
| Root `npx tsc --noEmit` | PASS, exit 0 |
| Focused Sheets tests plus contacts permission, reports contract and Settings heading tests | PASS, 5 files / 80 tests |
| Focused Sheets ESLint (same selection as Sheets CI) | PASS, exit 0 |
| `npm run build` | PASS; existing dynamic-import, bundle-size and Browserslist warnings |
| Strict app diagnostics against exact current-main base | PASS, `base=84, candidate=84, new=0`; existing diagnostics remain |
| Reconciliation-head GitHub Actions | PASS, all 10 workflows on published `98074fb2`; the new re-stamp head requires its own CI |
| Real Google-account import | Not run; local and synthetic evidence does not substitute for it |

Artifact identity against the pinned release source is unchanged:

| Artifact | SHA-256 |
|---|---|
| Foundation SQL, 86,193 bytes | `fc68da86bfa972148b72302b3bc0daf8d227453b75fdadd6ef8578908d76efed` |
| `google-sheets-sync-worker` bundle | `3097c65fdd8106407f3bcddbc12386eb88e20b593c23045a5d3fa8a2c0f3c3d0` |
| `google-sheets-api` bundle | `6ab61569c8d53c7347a737214330768db04a4bdb5ae0c550004c53332d8b6308` |
| `google-sheets-oauth-callback` bundle | `0fe3970b9896952fe2d940ff5387daa5b868a83689e4a41acf2d6fa492848a60` |
| `google-sheets-oauth-start` bundle | `7105438ef4d2d33f0cc62a45eb208c0338a618758b9aa2212569d67950a91591` |

Independent source review found no changes since the previous main baseline to
the reviewed permission helper, lead schema/insert triggers, workflow dispatch,
contact history, role permissions or shared CSV import contract. No feature
behavior adjustment is needed. Release ordering does need correction: after a
fresh hosted history read, rename the unapplied migration with bytes unchanged
and refresh the runner pins. Do not infer production counts from the 13 new
repository migrations. The current release checkpoint supersedes old
out-of-order history instructions.

GitHub environment controls were observed through the signed-in UI: required
reviewer `cgarness`, `main` only, administrator bypass off, no environment secrets.
Supabase read-only calls returned no result; the browser dashboard requires
sign-in. Current hosted counts/latest, helper MD5, Sheets inventory, auto-deploy,
Vercel flag and rollback target are therefore **unverified**. No production
mutation, credential entry, import or schedule was performed.

---

**Context**
- Date: 2026-10-13. Branch `claude/keen-brown-e4u3ht`, base `main` `f91e4ba`.
- Original implementation head: `25f0ee9`. Reviewed head: `8b675e5`.
- This record covers the **pre-release integrity corrections** (§0.9 with amendments A–C).
- Code and tests were verified at `3e45be6`. Two final commits follow it.
  - **A small fix commit:**
    - the preview summary now says "1 repeat" (singular) instead of "1 repeats";
    - the A2 regression detail prints "(empty: both rows stay import candidates)" instead of a blank;
    - the shutdown test's drain comparison ignores the informational lease column, matching release-package §5 step 5. Before this, a lease expiring between the two reads would have been reported as BLOCKED;
    - the workflow also triggers on this plan folder.
  - **The docs commit**, with refreshed screenshots.
- After these changes, everything was re-run and passed: the full local suite, the regression evidence, focused Vitest (23), the browser flow (48), ESLint, root tsc, base-relative app tsc (85 = 85, zero new) and the build.

**Local and CI verification only.** There was no production mutation, Google account, live import or deployment.

**Setup gate (2026-10-13).** §12 records the read-only release preflight for the Google setup and pilot-preparation gate. That gate changed no application code, migration or test.

**Reconciliation with current `main` (2026-10-15).** §13 records the merge of `main` `03ef0cb` into the branch (merge commit `94e9bc1`) and the full re-verification of that head against a fresh `03ef0cb` baseline. The merge changed no Sheets code, migration, Edge bundle or test.

**Phase B attempt 1 and the second reconciliation (2026-10-15).**
- §14: the approved Phase B attempt through the Supabase MCP connector stopped at B2, because the connector could not carry the migration. **Production was unchanged.**
- §15: Chris then approved merging `main` `b5976e0` (#448) and finishing Phase B through the documented psql / CLI fallback. §15 records that merge (`bf6b644`) and the re-verification of the merged head against a fresh `b5976e0` baseline.

**Phase B fallback preparation, production changes and the third reconciliation (2026-10-15 to 2026-10-16).**
- §15.4: exact-head CI for `adf6be7`.
- §16: the fresh Phase B preflight and a local dry run of the release package §10.1 commands. Claude's environment has no route to production, so Chris runs those commands.
- §17: the commission release changed production overnight (three migrations, a new frontend). No Sheets object appeared, and nothing interacts with the Sheets migration.
- §18: with Chris's OK, `main` `9a90552` (#447, #449) was merged into the branch (`2f8b543`), and the merged head was re-verified against a fresh `9a90552` baseline.

## 1. Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` (root) | PASS (exit 0) |
| `npx tsc -p tsconfig.app.json --noEmit` | **85 on a fresh `main` (`f91e4ba`) worktree, 85 on the candidate**, with byte-identical sorted diagnostics: zero new. `scripts/verify-a2p-types.mjs`, the exact-base script CI uses, reports `base=85, candidate=85, new=0`. |
| ESLint, all 29 changed or new `src/` and `scripts/` JS/TS files | PASS: 0 errors, 0 warnings |
| `npm run build` | PASS (only the existing chunk-size warning) |
| Vitest, focused Sheets suites | 23 pass: `src/lib/google-sheets/__tests__` 12 and `src/components/settings/google-sheets/__tests__` 11 |
| Vitest, full suite | 5,206 passed, 1 failed, 34 skipped (334 files). **The 10 failing files and the single failing test are identical on an untouched `main` worktree** (`addLeadAssignmentGate`, `dialerCampaignPresenceHook`, `contactName`, `contactScope`, `leadDisposition`, `recordingRetentionVoicemail` (one test), `userLocalDayBounds`, `caller-id-selection`, `runtimeEventLogger`, `custom-fields-settings`). They are pre-existing and not Sheets-related. |
| Deno: `deno check` on the four entry points | PASS |
| Deno tests (`_shared/googleSheets` + four functions) | **78 passed, 0 failed** (78 in CI as well). deno.land is blocked by this environment's proxy, so `std@0.190.0/testing/asserts.ts` was mapped locally to `jsr:@std/assert@1`. CI uses the real module. |
| `scripts/run_google_sheets_tests.sh` (PostgreSQL 16 locally; PostgreSQL 17.6 in CI) | **ALL PASSED**: the suite T1–T18, 9 regression cases, concurrency with three negative controls, the shutdown gate, rollback, 33 PostgREST checks, 40 end-to-end Review checks (§3–§7) |
| `scripts/run_google_sheets_cron_check.sh` (`supabase/postgres:17.6.1.063`, `--network none`) | **ALL PASSED**: real pg_cron 1.6.4, pg_net 0.19.5, supabase_vault 0.3.1 (§6) |
| `scripts/google_sheets_regression_evidence.sh 8b675e5` | **EVIDENCE OK**: every regression fails on `8b675e5` and passes on the candidate; every control passes on both (§2) |
| Browser flow `scripts/tests/google-sheets-ui/verify.mjs` (Chromium 1194; mocked Supabase host + fake Picker script) | **48/48 PASS** at 1440×900 and 390×844 (§8) |
| Exact-head CI (`.github/workflows/google-sheets.yml`) | §9 |

## 2. Regression evidence (reviewed `8b675e5` vs candidate)

**Method**
- `scripts/google_sheets_regression_evidence.sh` checks out `8b675e5` in a temporary worktree.
- The same tests run against both trees, exercising only behaviour present in both versions:
  - **Deno:** `planRows`/`planSourceId`/`runSource` with fakes, `pickerToken` and `preview` with a fake service client. Run with `--no-check` because type shapes changed. Assertions are on candidates, ingest payloads, outcomes and returned tokens.
  - **SQL:** `supabase/tests/google_sheets_regressions.sql` calls whichever `finish`/`review` signature exists and asserts on **database state**.
  - **Two-session races:** each version's own `finish` signature.
- A missing symbol or an incompatible signature is never counted as a reproduction.

| Kind | Reviewed | Candidate | Test |
|---|---|---|---|
| REGRESSION | FAIL | PASS | F1: sorted blank-ID baseline that later gets an ID is never imported automatically (exact repro) |
| REGRESSION | FAIL | PASS | F1: excluded row edited, moved and then given an ID is not imported automatically |
| REGRESSION | FAIL | PASS | F1: several excluded blank-ID rows shuffled, one completed → nothing imported |
| REGRESSION | FAIL | PASS | F1: identical-looking row with a new ID while the excluded twin moved → review, not import |
| CONTROL | PASS | PASS | F1: an excluded blank row completed in place (nothing else moved) stays excluded |
| REGRESSION | FAIL | PASS | F3: same Lead ID + same core, different state → conflict |
| REGRESSION | FAIL | PASS | F3: same Lead ID + same core, different DOB → conflict |
| REGRESSION | FAIL | PASS | F3: same Lead ID + same core, different notes → conflict |
| REGRESSION | FAIL | PASS | F3: same Lead ID + same core, different custom value → conflict |
| REGRESSION | FAIL | PASS | F3: valid + invalid row sharing a Lead ID with identical core → conflict, not the valid one |
| CONTROL | PASS | PASS | F3: genuinely identical repeats import once |
| REGRESSION | FAIL | PASS | F1 (engine): the sorted, completed excluded row is never sent to ingest |
| REGRESSION | FAIL | PASS | F2 (engine): a finish that was not applied (released) is not reported as a completed sync |
| REGRESSION | FAIL | PASS | F2 (engine): a review finish that lost the lease is not reported as needs_review |
| REGRESSION | FAIL | PASS | Picker: a reconnect while the token is minted → no token returned, newer connection untouched |
| REGRESSION | FAIL | PASS | Picker: a disconnect while the token is minted → no token returned |
| REGRESSION | FAIL | PASS | Picker: import permission removed while the token is minted → no token returned |
| CONTROL | PASS | PASS | Picker: unchanged connection → short-lived token after the actual-scope check |
| CONTROL | PASS | PASS | Picker: broader actual scopes are refused |
| REGRESSION | FAIL | PASS | F3 preview: the rows the preview calls ready are exactly the rows processing imports |
| REGRESSION | FAIL | PASS | SQL F2a: reconnect, then the old finish (access_lost / needs_review / error / ok) writes nothing |
| REGRESSION | FAIL | PASS | SQL F2b: expired lease (not re-claimed): finish writes no success time, schedule or history |
| REGRESSION | FAIL | PASS | SQL F2c: disconnect, then the old finish writes nothing |
| REGRESSION | FAIL | PASS | SQL F2d: permission revoked mid-run, then finish writes nothing |
| CONTROL | PASS | PASS | SQL takeover: the old worker cannot touch the newer lease or state |
| REGRESSION | FAIL | PASS | SQL B1: a review read before a reconnect cannot apply afterwards (baseline, Needs review, mapping, schedule unchanged) |
| REGRESSION | FAIL | PASS | SQL B2: a review read before a disconnect cannot apply afterwards |
| REGRESSION | FAIL | PASS | SQL A1: a content-only match is not labelled "already handled" without the agent's decision |
| REGRESSION | FAIL | PASS | SQL A2: the agent's explicit "import" for a content-matched row is honoured (not silently baselined) |
| REGRESSION | FAIL | PASS | Two-session: a finish racing a reconnect writes nothing (reviewed: `t`, health `access_lost`; candidate: `released`, health `ok`) |
| REGRESSION | FAIL | PASS | Two-session: a lease expiring during the finish lock wait writes nothing (reviewed: `t`, success written; candidate: `released`, nothing written) |

**Totals:** 26 regressions (all fail on `8b675e5`, all pass here) and 5 controls (all pass on both). The failure messages on `8b675e5` are behavioural, for example:
- "the excluded row must not become an import candidate";
- "a conflicting duplicate ID must never import a silent winner";
- "status must not be ok when finish returned released (got ok)";
- "Expected function to reject" (the Picker returned the token);
- the SQL case details listed above.

**Mutation check.** With the `identity_ambiguous` guard removed from `planSourceId`, end-to-end scenario 1 fails ("sorted + completed → review, nothing imported (ok)"). The end-to-end harness detects the original defect.

## 3. SQL suite (`supabase/tests/google_sheets_import.sql`, local disposable database)

**Harness fidelity**
- `supabase/tests/google_sheets_harness.sql` reproduces the live `_contacts_permission_default` exactly (MD5 `a199d5dd…b8`).
- It mirrors Supabase default privileges and the production lead triggers verbatim.
- It now skips its Vault stand-in where a real `supabase_vault` exists, as in the Supabase image used by §6.

| Block | What it checks |
|---|---|
| T1 | ACL of **52 functions** (31 private + 21 public): no EXECUTE for anon, authenticated or PUBLIC; private helpers denied even to `service_role`; definer + pinned `search_path` |
| T2–T6, T8–T11, T13–T14 | As before: permissions, OAuth state, the connection lifecycle and Vault, drafts, activation and ingest, the 24-combination duplicate matrix (192 checks), stale work, remove/re-add, RLS, protected records |
| T7 | `noid:<n>` missing-ID keys; a carry must match the consumed baseline's fingerprint; `blank:` can no longer be a pending or clear key; clear never removes a baseline; an approval is consumed when its receipt is written, and a stale approval is cleared |
| T12 | Structural review: established / content-matched / unmatched counts; the dry run writes nothing; multiset matching; **an explicit choice is required for content-matched rows**; **apply refuses `review_changed` when the rows differ from the reviewed snapshot** and changes nothing; the stale version is refused |
| T12b | ID-mode review: established by receipt or ID baseline vs content-matched; rows chosen for import become `approved:<id>` |
| T15 | Finish: reconnect → `released` with no write, for access_lost / needs_review / error / ok; disconnect → `released`; expired lease → `released`; takeover → `not_owner`, with the newer lease and state intact; the newer worker → `completed`; permission revoked → `released`; edited → `released`; paused → `not_owner`; removed → `not_found`; ingest refuses an expired lease on the real clock |
| T16 | Review read under generation g → reconnect (**same Google account**) → old apply refused `connection_changed`; the old snapshot under the new generation → `review_changed`; disconnect → `not_connected`; the source snapshot and the ledger are byte-identical afterwards; `resolve_identity` is bound the same way |
| T17 | `resolve_identity`: refused on a healthy source; the dry run writes nothing; malformed classifications refused (established ID offered, bad key, `noid` key/row mismatch, a baseline unaccounted for, kept and retired at once, duplicate keys); incomplete or invalid or extra decisions refused; a changed classification → `review_changed`; apply writes exactly: exclude → ID baseline / re-anchored blank baseline, import → approval, unresolved baselines retired, kept baselines untouched; review cleared and due now; a replay is refused |
| T18 | Picker re-check: `current`, another owner, reconnect → `changed`, permission removed → `not_permitted`, disconnect → `not_connected` |

## 4. Concurrency (real sessions) and negative controls

| Test | Result | Negative control |
|---|---|---|
| Two sources importing the same person | `imported flagged` | advisory lock removed → `imported imported` |
| Overlapping SKIP LOCKED claims | 4 + 4, 0 overlap | — |
| **4b** Finish while a reconnect holds the connection lock (same account) | `released ok` | `FOR SHARE` removed → `completed access_lost` |
| **4c** Lease expires while finish waits for the source lock | `released` | `clock_timestamp()` replaced by `now()` → `completed` |

## 5. Non-destructive shutdown (`run_google_sheets_tests.sh` §4d, using the exact `supabase/ops` files)

| Step | Observed |
|---|---|
| Invocation already running (batch 1 committed, then a 3 s "Google read") | `batch1=1`; after the gate closed, its next ingest and its finish were **denied (`42501`)**; batch 2 never written |
| RPC already executing when the gate closed (waiting on the duplicate advisory lock) | `executing at close: 1`; **completed** (`inflight=1`) once released |
| New admission (a queued request arriving) | `google_sheets_claim` **denied** |
| `google_sheets_disconnect` under the gate | still succeeds (agents can remove access) |
| Drain check | `wrappers_executable=0`, `active_backends=0`; markers (columns 2–14) identical across two reads; `unexpired_leases_informational=2` is excluded from the comparison (leases are not proof of termination either way) |
| Data and intent | committed leads and receipts kept; the blocked batch is absent; every source still `enabled`/`ok` |
| Reopen (`admission_open.sql`) | exact ACL restored (T1 assertions); the source resumes after lease expiry; the committed row → `already` (no replay); the blocked row imports; finish `completed` |

## 6. Real pg_cron / pg_net (`scripts/run_google_sheets_cron_check.sh`)

| Step | Observed |
|---|---|
| Isolation (before anything is scheduled) | network mode `none`; only the `lo` interface; the production host does not resolve |
| Harness + foundation + fixtures | 52 Sheets functions; a refresh token round-trips through the **real** `supabase_vault` 0.3.1; synthetic worker token |
| Exact pending schedule migration | job `* * * * *` posting to the worker with the Vault token; **replay refused** |
| The job runs | 1 cron run; pg_net outcome: no HTTP status, error `Couldn't resolve host name`. No request reached any server. |
| `supabase/ops/google_sheets_unschedule.sql` | job gone; idempotent; **0 cron runs in the 70 s after unscheduling**; request queue empty |
| Drain check against real pg_cron / pg_net | `queued_worker_requests=0`, `cron_jobs=0` |

## 7. End-to-end Review harness (`scripts/google_sheets_e2e.ts`, §7 of the runner)

**Setup:** the real `google-sheets-api` actions and sync engine, through local PostgREST v12.2.3, against the candidate migration. Only Google HTTP is faked. 8 scenarios, **40 checks**, each running planner → Review preview → Review apply → next sync:
1. **Exact sorted repro → Keep out.** Review lists `id:NEWID` (hint: content; unresolved original row 2; 1 established). The row is never imported, the next sync is healthy, and later syncs stay excluded.
2. **Same repro → explicit Import.** Imported once; the receipt prevents replay.
3. **Excluded row edited, moved, then completed.** Needs review, not imported. The row is listed with **no hint** but still needs a decision; Keep out is honoured.
4. **Several excluded rows** (one moved but still blank, one completed and moved, one deleted, one still in place) plus a new row.
   - Nothing imports while ambiguous, not even the new row.
   - Decision rows: `noid:2` (content), `id:A7` (content), `id:N1` (position). Cy stays kept; unresolved rows [2, 5, 6].
   - Only the new row imports. No further review.
   - A later ambiguity never offers established rows.
5. **Genuinely new look-alike next to its excluded twin.** Review (`noid:2` same_row, `id:N9` content); explicit Import imports it once, with no replay and no new review.
6. **A row arriving, then a row changing, between preview and apply.** Each time: `review_changed`; the refused apply changed nothing; the refreshed preview includes the change; only the reviewed decisions apply.
7. **Reconnect (same account) between preview and apply.** The old snapshot is refused and nothing changed (health, version, `next_sync_at`); a fresh review under the new generation applies.
8. **Structural review without a Lead ID.** Counts 0/3/1; a choice for content-matched rows is required; only the unmatched row imports, and an earlier import is not repeated.

## 8. Browser flow (48 checks; screenshots in `screenshots/`)

At 1440×900 and 390×844, the earlier 36 checks still pass:
- connected account from server status;
- Picker `setAppId` = `87346168200` and the developer key;
- the token never stored in browser storage;
- auto-mapping;
- preview makes no write;
- "Also import existing rows" unchecked by default, with the workflow warning;
- enable;
- sync results;
- pause, resume, remove;
- no horizontal scroll and no page errors.

New checks:
- the preview shows the shared ID-classifier outcomes ("No Lead ID", "Lead ID conflict", "Repeat · imported once", and the repeat count);
- an interrupted sync is reported as "Sync stopped because the sheet or its Google connection changed · 1 imported before it stopped", never "Checked";
- **identity review:**
  - it shows why each row is listed, with **no preselected decision**;
  - a row arriving before apply → "changed since you opened this review", the earlier choice is kept ("1 of 2 chosen") and the new row needs its own decision;
  - the decisions are applied to the refreshed snapshot only.

New screenshots: `gs-desktop-5-identity-review.png` and `gs-mobile-5-identity-review.png`, captured after the explicit choice. Before the choice, the verifier checks that no option is selected. The preview screenshots were refreshed to show the shared-classifier outcomes.

## 9. Exact-head CI

The workflow `.github/workflows/google-sheets.yml` runs on `pull_request` and `workflow_dispatch`, with `contents: read`, no secrets and pinned actions.

**`1011a04`** (first run):

| Job | Result |
|---|---|
| `cron` | **pass** |
| `ui` | **pass** |
| `frontend` | **pass** |
| `sql` | **fail** at the PostgREST step. Everything before it passed in CI on PostgreSQL 17.6: suite, regressions, concurrency, 4b/4c, the shutdown gate, rollback. The failure was a readiness race: the wait loop accepted PostgREST's 503 `PGRST002` (schema cache still loading). |
| `edge` | **fail** before any test: Deno needed the repository `node_modules` for `@types/node`, which esm.sh type files reference |

Both were fixed in `3e45be6` (wait for HTTP 200; `npm ci` in the edge job).

**`3e45be6`** (run [38356691351](https://github.com/cgarness/agentflow-life-insure/actions/runs/38356691351)): **all five jobs passed**.

| Job | Result (from the job log) |
|---|---|
| `sql` | **pass**: T1 (52 functions) through T18; "ALL GOOGLE SHEETS SQL TESTS PASSED"; the 9 regression cases; `imported flagged` vs negative control `imported imported`; 4 + 4 claims, overlap 0; 4b `released ok` vs control `completed access_lost`; 4c `released` vs control `completed`; shutdown gate (`executing at close: 1`, `wrappers_executable=0 active_backends=0`); reopen; rollback; 33 PostgREST checks; 40 end-to-end checks; "ALL GOOGLE SHEETS CHECKS PASSED" |
| `cron` | **pass** (real pg_cron / pg_net, `--network none`) |
| `edge` | **pass**: 78 passed, 0 failed; `deno check` on the four entry points |
| `frontend` | **pass** (focused Vitest, Sheets ESLint, root tsc, base-relative app tsc, build) |
| `ui` | **pass** (48 browser checks) |

Every other repository workflow that finished on `3e45be6` passed. "Reports frontend verification" (10–16 minutes; it compares the full Vitest run against the PR base) was still running when the final commit was pushed, so its result is reported for the final head. The final head is the docs commit on top of the small fix commit (see the header), and this workflow runs on it. Its results are reported in the PR description and the handoff, since a commit cannot record its own CI.

## 10. Checksums (SHA-256)

```
fc68da86bfa972148b72302b3bc0daf8d227453b75fdadd6ef8578908d76efed  supabase/migrations/20261013120000_google_sheets_import_foundation.sql
6116f414faf8313b3d09fa2b721eee79ac43d57f16e9de29ef143b92c54f9665  supabase/migrations/pending/20261013120100_google_sheets_sync_schedule.sql
d9f36c350c2e02f9004ffe20a029762bd078e67c184ec06f71496e93ebaf0e93  supabase/migrations/rollback/20261013120000_google_sheets_import_foundation.rollback.sql
9af0e1331d8410a43909d377bc1f03334ad4c090b50099eb09f8143ad90ee46f  supabase/ops/google_sheets_unschedule.sql
4255a54f950a91ed0227f80caf62276b46b61a0dcdc82a7298ba207f0ba9c5c8  supabase/ops/google_sheets_admission_close.sql
265fca871aee8c9aa51ea46996f7c3a11b1f3e35f83733e2b7d715524c676135  supabase/ops/google_sheets_admission_open.sql
0465beed2466882564213029ec38b0c2beed02f1f3760ccd23cbaa04218d80ee  supabase/ops/google_sheets_drain_check.sql
32e1eb1766d68523a3c2bccaf407878e650a80a174f3b59e9e9f9a00bfa2ea39  supabase/functions/_shared/googleSheets/auth.ts
69f8b0fb022a25a7e444f7ca3b173b30ebb24452d9cdaabcb2d971fa7037e36e  supabase/functions/_shared/googleSheets/config.ts
93ff0530d1a3fd74c6072ac56ccc101221713722199ead0290a58f1d836e759f  supabase/functions/_shared/googleSheets/crypto.ts
f23991831794c141d8b599560067ad75b2a29f2f209ccaf7197528d74e52b3ea  supabase/functions/_shared/googleSheets/db.ts
d4f3a006582b2389a6e023273bcf8ef3f19ecae8f8826b759a1f07ae91e4a2b1  supabase/functions/_shared/googleSheets/engine.ts
4264d9014631b95e2a39bc3039f0d487984f140e7f9366e69245c39f68564633  supabase/functions/_shared/googleSheets/errors.ts
93464d53ce96044ea6b37e5f52b2efc506b2b7938076ff93bc3955d77551c3df  supabase/functions/_shared/googleSheets/google.ts
b04a85967f04177e2aaa3ac0b7c6f04381aa0153994e62fdded9dcca54b605ad  supabase/functions/_shared/googleSheets/http.ts
c88d9abf0916abcc529d14fc0f30e876b8ed7a8984c320ed80b81f0f89222732  supabase/functions/_shared/googleSheets/identity.ts
8f6b1a62aab3608b0e6fa2aa83843893ca478ecca81313e2e1e9247d11e1c033  supabase/functions/_shared/googleSheets/mapping.ts
bd4421a3cb49777b73dae23d511ccfbbe9f5ed94d7b1a61e5b25e16679c0efab  supabase/functions/_shared/googleSheets/oauth.ts
642cdda8b9e09bc4510f3c8078a9557ec116f90a39c0f2ed0625c17b570b14d4  supabase/functions/google-sheets-api/actions.ts
7d0489305074e00a42485e58c6804269986eebedef94081ebc80280f72c80d09  supabase/functions/google-sheets-api/index.ts
14b26e77c8e9cef7fe915903614968593eff463e7fd675bcce377b8da4886e9a  supabase/functions/google-sheets-oauth-callback/deps.ts
fd9f8d754f63c0e62f39014200f7b052807c51d9f693aeaff0eb260e982e0edb  supabase/functions/google-sheets-oauth-callback/index.ts
fb671d3e49f98476e74fd2b56ec9f0d7e2ac69d5c6fa2264b617ec378d1c27d4  supabase/functions/google-sheets-oauth-start/deps.ts
1848091f95e27dab97d7adfb2e503e4f148851a5cfa37def9cef807b86cd0986  supabase/functions/google-sheets-oauth-start/index.ts
4ff85135f698b839269bb08759d8cae53452fb467be0e8a8eac037c707ff3c23  supabase/functions/google-sheets-sync-worker/index.ts
```

**Unchanged since `25f0ee9`:** the pending schedule migration, the rollback, `auth`, `config`, `crypto`, `errors`, `google`, `http`, `oauth`, and the OAuth start/callback files. Recompute after any later commit; the release must deploy exactly the reviewed head.

## 11. Not performed (pending)

- **The real Google-account test** (release package §6): Picker selection → server read → a fresh access token from the stored refresh token → the server read succeeds again. **The mocked Picker checks above are not that test.**
- Production migration, Edge deployment, secrets, Google Cloud setup, cron, Vercel flags, privacy publication, merge and release.
- **Google Cloud setup (release package §1 G0–G7):** not performed in the setup gate. This session has no authenticated Google access (§12.6). The steps remain owner actions.
- A fresh check of Google publishing status, branding verification, OAuth clients, enabled APIs and test users (§1 G1, owner).
- Confirming on the Supabase Custom Domains page that no custom domain is active (§1 G2, owner). Only live-traffic evidence was available (§12.5).
- A hosted authenticated walkthrough, real Lead Created workflow execution, and real Gmail/Calendar regression checks beyond the code isolation shown here.

## 12. Setup-gate release preflight (2026-10-13, about 07:30–08:00 UTC; read-only)

This section is evidence only. Planned and blocked work is in the release package: the sequence table, §1, §5, §6 and §10. No production row, setting, secret, function or Google resource was changed.

**Test environment (updated 2026-10-13):** Chris approved running the real Google test in live production at `https://www.fflagent.com`, in release Phases A–E. The protected branch preview recorded in §12.7 is evidence of what exists; it is **not** the test environment, and no preview or `*.vercel.app` origin is added to the Picker key or the Sheets return origins.

### 12.1 Code and CI
- `main` = `f91e4ba` (re-fetched). PR #442 head = `b66c44f4b336b3ee5cb385f54ee7920d41f9d7a6`: draft, no conflicts, no review threads.
- **Checks on that head:** 14 passed and Supabase Preview was skipped (preview-branch limit). They include the five Sheets jobs (run 38358513920) and Reports frontend verification.
- No open PR newer than #441, which is docs-only. #378 (Google OAuth review) is still draft and unmerged.

### 12.2 Production database `jncvvsvckxhqgqvkppmj` (read-only SQL)
| Probe | Result |
|---|---|
| Latest migration | `20261010172702` |
| Sheets migrations, relations, functions, cron jobs, Vault secrets | 0, 0, 0, 0, 0 |
| `_contacts_permission_default` MD5 | `a199d5ddfb9a56070aeb7706d3e9a4b8` (the preimage the migration requires) |
| Server and extensions | PostgreSQL 17.6 (`17.6.1.063`); pg_cron 1.6.4, pg_net 0.19.5, supabase_vault 0.3.1, pgcrypto 1.3. `pg_graphql` is available but **not installed**. |
| Edge Functions (`list_edge_functions`) | no `google-sheets-*` function |
| Organizations and users | 1 active organization with 13 profiles, 8 of them Active (1 Admin, 1 Team Leader, 6 Agents); 3 suspended organizations with 3 profiles (ineligible) |
| Stored `role_permissions` rows for `contacts.leads.import_google_sheets` | 0 |
| Workflows (all organizations) | 0 |
| Triggers on `public.leads` | `tr_sync_leads_user_id` (before insert/update), `contact_history_capture`, `trg_notify_lead_assignments_ins`/`_upd`, `trg_workflow_lead_created`, `trg_workflow_lead_updated`, all enabled. `notify_lead_assignments` skips self-imports. `workflow_on_lead_created` posts one pg_net request to `workflow-trigger-evaluator`. |
| Google connections | `user_email_connections` (provider google): 1 row, connected (Chris); `calendar_integrations` (google): 0 |

### 12.3 Pilot account (read-only)
- Chris Garness: profile `ecf2bb91-0350-4542-85ec-14d914311e99`, Admin, Active, super admin and platform admin. Organization `a0000000-0000-0000-0000-000000000001` ("Family First Life - Chris Garness"), active.
- His Gmail connection's Google account matches his AgentFlow login email (a boolean check; neither address is printed here). The candidate pilot Google account comes from that live connection, not from the login, and Chris confirms it.
- A second Active profile in the same organization ("chris test", Agent) exists. It is not the pilot account.
- **Organization duplicate settings:** rule `phone_or_email`, scope `assigned_only`, import action `flag`.
- **Synthetic-data collision check:** 0 leads match the planned phones (702-555-0101…0104, 0111…0114, with or without a leading 1); 0 have an `example.test` email; 0 have lead source "Google Sheets".
- **Baseline:** Chris has 3 assigned leads.

### 12.4 Advisor baselines (`get_advisors`, before any Sheets object exists)
| Advisor | Findings by lint | Total | Fingerprint (SHA-256 of sorted `name\|level\|metadata`) |
|---|---|---|---|
| Security | rls_enabled_no_policy 25, function_search_path_mutable 22, rls_disabled_in_public 2, extension_in_public 3, anon_security_definer_function_executable 58, authenticated_security_definer_function_executable 113, auth_leaked_password_protection 1 | 224 | `6dad3ab98a6d8f5fe91896c6e8c9cfc2e5dc082817c448b6189bc3270341f1ff` |
| Performance | unindexed_foreign_keys 81, auth_rls_initplan 112, unused_index 123, multiple_permissive_policies 86, duplicate_index 6, table_bloat 1, auth_db_connections_absolute 1 | 410 | `9a1674ecc2168bb231467e126a713a61d6027fb14afad73701b5ea5e5c0cb9b7` |

None of these findings mentions `google_sheets`.

**Expected delta (production image, local):**
- **Set-up:** the harness and splinter (`d8d558baad3e03832e521c527907fa50a9a172fabd899dd0f5c2504a5a0e9349`) ran in `supabase/postgres:17.6.1.063` with `--network none`, before and after the foundation migration.
- **Added:** 20 lint rows; **none removed**.
  - **Security:** 3 INFO `rls_enabled_no_policy` on `private.google_sheets_{oauth_states,receipts,source_rows}`.
  - **Also security, but not applicable to production:** 3 WARN `pg_graphql_authenticated_table_exposed`. This lint only fires when `pg_graphql` is installed, and production does not have it.
  - **Performance:** 7 INFO `unindexed_foreign_keys`, 4 INFO `unused_index`, 3 WARN `auth_rls_initplan`.
- **Helper MD5:** `a199d5dd…b8` before, `bc6356dde683e628b88b631dd5f6d01e` after.
- **Read-backs:** 52 functions; 0 anon/authenticated EXECUTE on the public wrappers; defaults `t`/`f`; RLS true on all six tables.

### 12.5 Callback host evidence
| Source | Result |
|---|---|
| `get_project_url` | `https://jncvvsvckxhqgqvkppmj.supabase.co` |
| `edge_logs`, last 24 h | 30,658 requests, all with `request.host = jncvvsvckxhqgqvkppmj.supabase.co` |
| `function_edge_logs`, last 24 h | 3,149 requests on that host (host header identical); none on another host |
| `function_edge_logs`, 2026-10-11 07:40 → 10-12 07:40 | 3,609 requests, same single host |
| `function_edge_logs`, 2026-10-06 07:40 → 10-07 07:40 | 1,225 requests, same single host |
| Gmail/Calendar OAuth callbacks in those windows | 0 (no connects happened). Their redirect URIs come from secrets, so the repository cannot show their host. |
| Supabase Custom Domains page / Management API | not reachable from this session (no management token) → owner check G2 |
| Public DNS (`dns.google`) and `www.fflagent.com` | blocked by the egress policy (403 on CONNECT); not retried |

**Conclusion:** no custom or vanity domain appears in live traffic. The specified callback is used.

### 12.6 Google Cloud access
- `gcloud projects describe project-b7e9b5b4-d066-48c9-b36` → `UNAUTHENTICATED` / `CREDENTIALS_MISSING`. The session's `CLOUDSDK_AUTH_ACCESS_TOKEN` is not a valid credential.
- The Google Drive and Google Calendar connectors are installed but not connected, and no browser or computer-use tool is available.
- **Nothing in release package §1 was performed or observed.**
- **Google documentation used for the checklist:** the Picker guide says a website-restricted key must also allow `https://docs.google.com/*` (the Picker iframe), and that `setAppId` takes the project number. Google's OAuth guidance says refresh tokens issued while an app is in Testing expire after 7 days.

### 12.7 Vercel (read-only)
- **Project `agentflow`** (`prj_vUIiwhdXPw4H9uxRZ1zTf28KIXbc`):
  - domains `www.fflagent.com`, `fflagent.com` (redirects to www), `agentflow-eta.vercel.app`, `agentflow-cgarness-projects.vercel.app` and `agentflow-git-main-cgarness-projects.vercel.app`;
  - SSO protection enabled for `all_except_custom_domains`.
- **Production deployment:** `dpl_E7C5dN2ATUhWbTCfrupJfSamkQws`, READY, `main` `f91e4ba`.
- **Branch preview:** `dpl_6ncQHEs8yxNBdGjU4TFRfvvzcRQM`, READY at `b66c44f`, alias `agentflow-git-claude-keen-brown-e4u3ht-cgarness-projects.vercel.app`. This is informational only; the test runs on `www.fflagent.com`.
- **Environment variables:** listing them was refused (403), so their values are an owner check.

### 12.8 Edge bundles (reproducible)
Run from the repository root:

`sha256sum <files in C-locale order> | sha256sum`

The file lists come from tracing each entry's relative imports:

| Function | Files | Digest |
|---|---|---|
| `google-sheets-sync-worker` | 12 | `3097c65fdd8106407f3bcddbc12386eb88e20b593c23045a5d3fa8a2c0f3c3d0` |
| `google-sheets-api` | 12 | `6ab61569c8d53c7347a737214330768db04a4bdb5ae0c550004c53332d8b6308` |
| `google-sheets-oauth-callback` | 8 | `0fe3970b9896952fe2d940ff5387daa5b868a83689e4a41acf2d6fa492848a60` |
| `google-sheets-oauth-start` | 8 | `7105438ef4d2d33f0cc62a45eb208c0338a618758b9aa2212569d67950a91591` |

Per-file checksums are unchanged from §10.

## 13. Reconciliation with current `main` (2026-10-15; branch only; no production mutation)

**What changed.** `main` moved from `f91e4ba` to `03ef0cb` (19 commits):
- #443 `dacd921`: ClearPath saved-lead alerts;
- #445 `26f9bc1`: instant manual SMS, frontend only;
- #446 `03ef0cb`: docs.

It was merged into the branch with a merge commit, `94e9bc18dde7b662939e6807cbb2dddca6537f29`, whose parents are `18e5395` (the reconciliation plan) and `03ef0cb`. There was no rebase, amend or force-push. Plan: the 2026-10-15 entry of the root `implementation_plan.md`.

### 13.1 Conflicts and resolutions

| File | Git | Resolution | Proof |
|---|---|---|---|
| `WORK_LOG.md` | conflict (both prepend) | `main`'s 6 new entries (four 2026-10-15, two 2026-10-14), then the 4 Sheets entries (2026-10-13, all committed that day), then the shared history | 145 entries = 141 (`main`) + 139 (branch) − 135 (shared). No duplicate heading. Every entry is byte-identical to its side. Dates are non-increasing through all new entries; the two older out-of-order pairs already exist in the shared history. |
| `supabase/config.toml` | conflict (both append) | `main`'s file unchanged, then the Sheets comment and four blocks | TOML parse: 69 functions = `main`'s 65, all unchanged, plus 4 Sheets functions (`verify_jwt=false`). Non-function sections equal `main`'s. `clearpath-lead-alert` keeps `verify_jwt=false`. |
| `AGENT_RULES.md` | auto-merged | `main`'s two manual-SMS amendments plus the Sheets invariant section | merged − `main` = exactly the branch's Sheets section; merged − branch = exactly `main`'s two hunks. Each appears once; nothing moved. |

**Every other file is byte-identical to its side:** `main`'s 66 others to `03ef0cb`, and the branch's 85 others to `18e5395`. The merged tree differs from `main` in exactly the PR's 88 files, and from the pre-merge branch in exactly `main`'s 69 files.

### 13.2 Semantic review (no textual conflict)
- **Settings and permissions.** `main` changed no Settings, `src/config/`, permission or `role_permissions` code. Two tests on the `main` side read PR files, and both pass on the merged head:
  - `reportsContracts.test.ts`, which pins `permissionDefaults.ts`. The PR's updated pin applies, because `main` did not change the test.
  - The onboarding `catalog.test.ts`, which needs its CTA routes in `App.tsx` and its section slugs in `settingsConfig.ts`.
- **Supabase client and auth.** Both are unchanged. `main`'s `PendingSmsAuthorityBridge` binds only the memory-only SMS store. The Sheets OAuth return is a full page load.
- **Contacts and lead creation.** `main`'s changes are SMS display only, with no migration, trigger or lead-insert hook. `clearpath-lead-alert` runs only on signed external requests, with a fixed organization, sender and recipient, and never reads `leads`. A lead created by Sheets therefore cannot fire it.
- **Build and runtime.** `main` changed no `package*.json`, Vite, TypeScript, ESLint or Vitest config, `deno.*`, `index.html`, `vercel.json` or `supabase/functions/_shared/**`. `main` added no migration and no `cron.schedule`.

### 13.3 Release artifacts are unchanged
- **Migration:** SHA-256 `fc68da86bfa972148b72302b3bc0daf8d227453b75fdadd6ef8578908d76efed`, MD5 `94c7be79a3a95b4a2b971f4b4513838b`, 86,193 bytes, identical before and after the merge.
- **Pending cron migration, rollback and the four ops files:** identical to §10.
- **Per-file Edge checksums:** all 25 lines of §10 pass `sha256sum -c`.
- **Bundle digests:** the four §12.8 digests are recomputed identically.

### 13.4 Verification on the merged head (local; baselines from a fresh `03ef0cb` worktree)
| Check | Result |
|---|---|
| `npx tsc --noEmit` (root) | PASS (exit 0) on the merged head and on `03ef0cb` |
| App type-check, `tsc -p tsconfig.app.json` | **84 on a fresh `03ef0cb` worktree, 84 on the merged head.** The sorted diagnostics are byte-identical, so zero new. `scripts/verify-a2p-types.mjs` with `A2P_BASE_SHA=03ef0cb…` reports `base=84, candidate=84, new=0`. |
| Full Vitest against `03ef0cb`, using `scripts/verify_reports_frontend.py`, the same script and method as the CI "Reports frontend verification" (no Supabase env; shallow clone) | **Exit 0.** `03ef0cb`: 5,407 tests (5,372 passed, 1 failed, 34 skipped) in 339 files. Merged head: 5,430 tests (5,395 passed, 1 failed, 34 skipped) in 341 files. The 10 failing files and the single failing test (`recordingRetentionVoicemail`, pre-existing) are identical on both. No base test is missing or changed status. The skipped inventory is identical (34). The only additions are the 23 Sheets tests. 0 unhandled runtime errors. The same script's Reports tests, ESLint on changed files and build also pass. |
| Vitest, focused (the Sheets CI list) | 5 files, **79 passed**; Sheets suites alone: **23 passed** (12 + 11) |
| Deno, Sheets (`_shared/googleSheets` and the four functions) | **78 passed, 0 failed**; `deno check` on the four entry points passes. deno.land is blocked locally, so the std asserts module is mapped to a local shim; CI uses the real module. |
| Deno, every test under `supabase/functions/` (`--no-check`) | Merged head **340 passed**: `03ef0cb`'s 262, all still passing, plus the 78 Sheets tests. 0 status changes. The onboarding `catalog.test.ts`, which reads `App.tsx` and `settingsConfig.ts`, passes. |
| `scripts/run_google_sheets_tests.sh` (PostgreSQL 16 locally) | **ALL PASSED.** T1 (52 functions) through T18; 9 regression cases (8 regressions, 1 control); concurrency (`imported flagged` vs negative control `imported imported`); SKIP LOCKED claims 4 + 4 with overlap 0; 4b `released ok` vs control `completed access_lost`; 4c `released` vs control `completed`; the shutdown gate; rollback and re-apply; 33 PostgREST checks; 40 end-to-end Review checks |
| `scripts/run_google_sheets_cron_check.sh` (`supabase/postgres:17.6.1.063`, `--network none`) | **ALL PASSED** (real pg_cron 1.6.4, pg_net 0.19.5, supabase_vault 0.3.1; 0 runs in the 70 s after unscheduling; drain check 0/0) |
| `scripts/google_sheets_regression_evidence.sh 8b675e5` | **EVIDENCE OK**: 26 regressions fail on `8b675e5` and pass on the merged head; 5 controls pass on both |
| ESLint, all 29 changed `src/` and `scripts/` JS/TS files against `03ef0cb` (`--max-warnings=0`) | PASS: 0 errors, 0 warnings. The Sheets CI lint list is also clean. |
| `npm run build` | PASS (only the existing chunk-size warning) |
| Browser flow `scripts/tests/google-sheets-ui/verify.mjs` (Chromium 1194; mocked Supabase host and fake Picker script) | **48/48 PASS** at 1440×900 and 390×844 |

### 13.5 Production, read-only (2026-10-15, about 16:05–16:10 UTC)
- **Database `jncvvsvckxhqgqvkppmj`:**
  - latest migration `20261010172702`; `list_migrations` has no Sheets entry;
  - 0 Sheets relations, functions, cron jobs or Vault secrets;
  - 0 `role_permissions` rows carrying the new key;
  - helper MD5 `a199d5ddfb9a56070aeb7706d3e9a4b8` (the migration precondition still holds);
  - 0 workflows; 1 active organization with 8 active users (1 Admin, 1 Team Leader, 6 Agents); 3 suspended organizations; 0 Calendar integrations.
- **Edge Functions:** no `google-sheets-*` function. `main`'s `clearpath-lead-alert` v2 is deployed (`verify_jwt=false`); it was deployed for #443, not by this task.
- **Vercel `agentflow` production:**
  - `dpl_BoRbMNiVBBw3NCjLbcN7c8JQdQ3t`, READY at `03ef0cb`;
  - earlier deployments: `dpl_4UtN9j5bbNemnXAeoVpFXyknUX3f` (`26f9bc1`), `dpl_AqcLLxULHBXWQ4zjP8jPkeXWBGk2` (`dacd921`), `dpl_E7C5dN2ATUhWbTCfrupJfSamkQws` (`f91e4ba`);
  - no Sheets UI code is deployed.

### 13.6 Exact-head CI
Pushing the records commit that adds this section triggers the repository workflows on PR #442. A commit cannot record its own CI, so the results for that exact head are in §13.7 below and in the PR description.

### 13.7 Exact-head CI on `a624ebaad4db5e5c591b11d575f703445821aa0b` (the records commit on top of merge `94e9bc1`)

PR #442 is mergeable against base `main` `03ef0cb`: GitHub reports `mergeable_state: clean`, with no conflict and every check complete. Every workflow triggered on this head passed:

| Workflow (run) | Jobs | Result |
|---|---|---|
| Google Sheets ([38770550907](https://github.com/cgarness/agentflow-life-insure/actions/runs/38770550907)) | sql (SQL, PostgREST, regressions, concurrency, shutdown, end-to-end Review); cron (real pg_cron/pg_net); edge (Deno tests and types); frontend (focused Vitest, lint, types, base-relative app tsc, build); ui (browser flow) | **all five passed** |
| Reports frontend verification ([38770550898](https://github.com/cgarness/agentflow-life-insure/actions/runs/38770550898)) | frontend: the full Vitest run against the PR base `03ef0cb` | **passed**: `03ef0cb` 5,374 passed and this head 5,397 passed; the same 1 pre-existing failing test and 10 failing files on both sides; app tsc 84, none new; 0 unhandled errors; ESLint and build pass. These counts are 2 higher on each side than the local run because CI's full history lets git-object tests run. Artifact `reports-frontend-evidence-38770550898`. |
| SMS consent integration ([38770550926](https://github.com/cgarness/agentflow-life-insure/actions/runs/38770550926)) | consent, including `main`'s new pending-SMS tests and responsiveness fixture | passed |
| Onboarding emails ([38770550936](https://github.com/cgarness/agentflow-life-insure/actions/runs/38770550936)) | verify, postgres | passed |
| A2P registration ([38770551018](https://github.com/cgarness/agentflow-life-insure/actions/runs/38770551018)) | verify | passed |
| Twilio account balance ([38770550875](https://github.com/cgarness/agentflow-life-insure/actions/runs/38770550875)) | verify | passed |
| Dialer DNC integrity ([38770551172](https://github.com/cgarness/agentflow-life-insure/actions/runs/38770551172)) | postgres | passed |
| Reporting integrity ([38770551087](https://github.com/cgarness/agentflow-life-insure/actions/runs/38770551087)) | native | passed |

**Other checks:**
- Vercel Preview Comments: passed.
- Vercel previews READY for both projects: `agentflow` `ERe6uiLwvYoAUWfqCLoLvvdAYtTZ` and `agentflow-life-insure` `CSoQDBK2fYRP4dGxjp5owiLMWFS9`. They are protected previews; production is untouched.
- Supabase Preview: **skipped**, as on every earlier head, because the preview-branch limit is reached.

The documentation commit that adds this subsection becomes the new head. Its own CI is reported in the PR description and the handoff.

## 14. Phase B attempt 1 — stopped at B2 (2026-10-15, about 17:30–18:25 UTC; production unchanged)

**Approval.** Chris approved Phase B: B1 (the six Edge secrets he entered), B2 (the foundation migration) and B3 (the four Edge Functions, still disabled). The procedure was release package §10.

**Preflight (before B2).**
- Every value matched the release package.
- Both advisor baselines were identical to the §0.A reference after normalization:
  - security: 224 findings, fingerprint `6dad3ab9…f1ff`;
  - performance: 410 findings, fingerprint `9a1674ec…b9b7`.

**B2: two identical `apply_migration` calls, about 17:45 and 17:55 UTC.**
- Each carried the exact file (SHA-256 `fc68da86…6efed`).
- Each timed out at this environment's 60-second MCP tool limit (`MCP_TOOL_TIMEOUT=60000`).
- The second call was the one retry, made after confirming that the first had written nothing.

**Neither call reached the database.**
- The project runs `log_statement = ddl`. A real `apply_migration` logs a `statement: begin; create schema if not exists supabase_migrations…` line, then `statement: begin; -- apply sql from post body…`. The 2026-10-10 17:27:02 UTC apply of `20261010172702` shows both.
- Neither attempt logged anything: no DDL line, no error, no cancellation and no lock wait (`log_lock_waits` is on).
- Afterwards there was no running backend and no ungranted lock.
- Migration history was unchanged: 324 rows, latest `20261010172702`.
- `to_regclass('public.google_sheets_sources')` was null and the helper MD5 was still `a199d5dd…`.

**What the connector could not carry (read-only probes).**
- `execute_sql` with the same SQL sent only as a string literal (`SELECT md5(…)`) also stalled, at 86 KB, at about 68 KB (a 66,863-byte prefix) and at about 30 KB (a 30,326-byte prefix).
- Small queries returned instantly, including ones that contain `DROP` / `DELETE` text and nested dollar quotes.
- On 2026-09-15 a 76,994-byte migration (`20260915035141`) went through the same tool, so this is new connector behaviour.
- The Edge deploy requests are about 86 KB (api), 68 KB (sync-worker) and 23 KB each (OAuth start and callback), so B3 would have hit the same limit.

**Deviation recorded.** The single retry departed from the `RELEASE_READINESS.md` P1 precedent written for M4: do not resubmit after a timeout unless the first call is known to have ended without committing.
- The retry relied on the empty DDL log.
- It also relied on the migration's own guards. A concurrent second run would fail on the first conflicting catalogue row, and its whole transaction would roll back.
- No further attempt was made.

**After.**
- 18:09 UTC: production was unchanged, with zero Sheets objects and no `google-sheets-*` function.
- 18:23 UTC: advisors were identical to the pre-B2 baseline after normalization.

**`main` moved during the attempt.**
- `b5976e0` (#448, the Team Leader invitation hotfix) merged at 17:55 UTC.
- It had already deployed `invite-user` v232 (17:28:56 UTC) and `send-invite-email` v236 (17:30:25 UTC). These were not touched by this task.
- Production frontend: `dpl_6LM8RRL2guFmeMzxjA7bhEVDv44B`, READY at `b5976e0`.

**Outcome.** Chris approved the documented fallback and the reconciliation (§15). Further large requests through the connector are not used for this release.

## 15. Reconciliation with `main` `b5976e0` (2026-10-15; branch only)

**What changed on `main`.** One squash commit, `b5976e0` (#448), with parent `03ef0cb`.
- **Files:** `supabase/functions/invite-user/index.ts`, `supabase/functions/send-invite-email/index.ts`, `src/components/settings/UserManagement.tsx`, `src/components/settings/user-management/InviteUserModal.tsx`, and two new tests (`InviteUserModal.test.tsx`, `teamLeaderInvitations.test.ts`).
- **Docs:** its plan, one `AGENT_RULES.md` bullet and a WORK_LOG entry.
- **Full diff checked.** It touches invitations only:
  - no migration, `config.toml`, permission default, shared Edge module, `package*.json` or build configuration;
  - no Sheets file imports anything it changed.

**Merge.** `bf6b644` has parents `fffd67f` (the plan) and `b5976e0`. There was no rebase, amend or force-push.

### 15.1 Conflicts and resolutions

| File | Git | Resolution | Proof |
|---|---|---|---|
| `WORK_LOG.md` | conflict (both prepend) | #448's 2026-10-15 entry first (deployed 17:29 UTC, merged 17:55 UTC), then the branch's entries | The merged file equals #448's entry block plus the previous branch file, byte for byte. 147 entries = 146 + 1. No markers remain. |
| `AGENT_RULES.md` | auto-merged | #448's Team Leader invitation bullet (invariant #20 area) plus the Sheets section | Against the branch: +1 line, 0 removed. Against `main`: +65 lines (the Sheets section), 0 removed. Each appears once. |

`supabase/config.toml` did not change. Every other file is byte-identical to its side.

### 15.2 Release artifacts are unchanged
- All 11 checksum lines are identical before and after the merge: the migration (SHA-256 `fc68da86…6efed`, MD5 `94c7be79…`), the pending cron migration, the rollback, the four ops files and the four bundle digests.
- The PR's diff against `main` is still exactly its 88 files.

### 15.3 Verification on the merged head (local; baselines from a fresh `b5976e0` worktree)

| Check | Result |
|---|---|
| `npx tsc --noEmit` (root) | PASS (exit 0) |
| App type-check against `b5976e0`, `scripts/verify-a2p-types.mjs` | `base=84, candidate=84, new=0` |
| Full Vitest against `b5976e0`, `scripts/verify_reports_frontend.py` (the CI method) | **Every assertion passed.** `b5976e0`: 5,455 tests (5,420 passed, 1 failed, 34 skipped) in 341 files. Merged head: 5,478 tests (5,443 passed, 1 failed, 34 skipped) in 343 files. The single failing test (`recordingRetentionVoicemail`, deployed v29, pre-existing) and the 10 failing files are identical on both sides. The only additions are the 23 Sheets tests. App tsc showed no new diagnostic, and both sides had 0 unhandled runtime errors. The Reports tests pass. The run stopped only at the script's final changed-file lint step, because the local run lacked `REPORTS_BASE_SHA`; that lint and the build were run directly (rows below). |
| Vitest, focused (the Sheets CI list plus #448's two new files) | 7 files, **127 passed**: 79 from the Sheets list, 48 from #448 (35 + 13) |
| Deno, Sheets (`_shared/googleSheets` and the four functions) | **78 passed, 0 failed**. `deno check` passes on the four entry points. The std asserts module is mapped to a local shim, because deno.land is blocked here. `deno.lock` was restored afterwards. |
| Deno, every test under `supabase/functions/` (`--no-check`) | Merged head **340 passed**; `b5976e0` **262 passed**. 262 + 78 = 340, with no status change. |
| `scripts/run_google_sheets_tests.sh` (PostgreSQL 16 locally) | **ALL PASSED**: replay guard; T1 (52 functions) through T18, including the 24-combination duplicate matrix (192 checks); 9 regression cases (8 + 1 control); concurrency with its negative control; SKIP LOCKED claims; 4b and 4c with negative controls; the shutdown gate; rollback and re-apply; **33 PostgREST checks**; **40 end-to-end Review checks** |
| `scripts/run_google_sheets_cron_check.sh` (`supabase/postgres:17.6.1.063`, `--network none`) | **ALL PASSED**: real pg_cron / pg_net; 0 runs in the 70 s after unscheduling; drain check 0/0 |
| `scripts/google_sheets_regression_evidence.sh 8b675e5` | **EVIDENCE OK**: every regression fails on `8b675e5` and passes here; every control passes on both |
| ESLint, all 29 changed `src/` and `scripts/` JS/TS files (`--max-warnings=0`), plus the Sheets CI lint list | PASS, 0 errors and 0 warnings |
| `npm run build` | PASS (only the existing chunk-size warning) |
| Browser flow, `scripts/tests/google-sheets-ui/verify.mjs` (Chromium 1194; mocked Supabase host and fake Picker) | **48/48 PASS** at 1440×900 and 390×844 |

### 15.4 Exact-head CI
**`adf6be7` (the records commit on top of `bf6b644`): every check passed** (2026-10-15, 19:17–19:30 UTC).
- Google Sheets [38792676928](https://github.com/cgarness/agentflow-life-insure/actions/runs/38792676928): all five jobs (sql, cron, edge, frontend, ui).
- Reports frontend verification [38792676835](https://github.com/cgarness/agentflow-life-insure/actions/runs/38792676835), against base `b5976e0`: 5,422 passed on the base and 5,445 on the head, with the same pre-existing 1 failing test and 10 failing files; 84 = 84 app diagnostics; 0 runtime errors; ESLint and build pass.
- Also passed: SMS consent integration [38792676980](https://github.com/cgarness/agentflow-life-insure/actions/runs/38792676980), Onboarding emails [38792676829](https://github.com/cgarness/agentflow-life-insure/actions/runs/38792676829), A2P registration [38792676863](https://github.com/cgarness/agentflow-life-insure/actions/runs/38792676863), Twilio account balance [38792676856](https://github.com/cgarness/agentflow-life-insure/actions/runs/38792676856), Dialer DNC integrity [38792676838](https://github.com/cgarness/agentflow-life-insure/actions/runs/38792676838) and Reporting integrity [38792676860](https://github.com/cgarness/agentflow-life-insure/actions/runs/38792676860).
- Both Vercel previews were READY. Supabase Preview was skipped (preview-branch limit).
- GitHub reported `mergeable_state: clean` on base `b5976e0` at 19:34 UTC.

## 16. Phase B fallback: fresh preflight and a local dry run of the §10.1 commands (2026-10-15, 19:17–19:38 UTC; read-only and local only)

**Direct access.** None from Claude's environment: there is no database credential, and the egress policy blocks the Supabase hosts. As Chris instructed, Claude stopped before any production change and handed Chris the release package §10.1 stage 0 and stage 1 commands, pinned then to `adf6be7`.

**Production, read-only (19:17–19:29 UTC).**
- 324 history rows, latest `20261010172702`. No Sheets relation, function, history row, cron job or Vault secret. Helper MD5 `a199d5dd…`.
- Advisors identical to the pre-B2 baseline after normalization (security 224 findings, performance 410).
- The exact stage 1 preflight query returned the expected `postgres|t|0|0|a199d5dd…|20261010172702` (19:23:37 UTC).
- Edge Functions: 76, none `google-sheets-*` (`invite-user` v232, `send-invite-email` v236).
- Frontend: `dpl_6LM8RRL2…` at `b5976e0`.
- Locking: `lock_timeout = 0` and `idle_in_transaction_session_timeout = 0`. No idle-in-transaction session, no client transaction older than 30 s, and no write lock on `profiles` or `organizations`.

**The migration file, lexed.**
- 81 top-level statements: 52 `CREATE FUNCTION`, 6 `CREATE TABLE`, 6 `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, 4 `CREATE INDEX`, 3 `DO`, 3 `REVOKE`, 3 `CREATE POLICY`, `CREATE SCHEMA IF NOT EXISTS private`, the helper's `CREATE OR REPLACE` and 2 `GRANT`.
- Quoting is balanced. There is no top-level transaction control or non-transactional statement, and no psql `:variable` reference outside quotes or comments.
- Every privilege statement is scoped by name to Sheets objects or the helper.
- The CI harness already applies this file with `psql -1 -v ON_ERROR_STOP=1 -f`.

**Lock window.**
- The only existing tables locked in a write-blocking mode are `public.profiles` and `public.organizations`: `SHARE ROW EXCLUSIVE`, from the nine foreign keys, held until `COMMIT`.
- Locally the whole transaction takes about 0.1 s. From a remote client, psql sends the 81 statements one at a time, so the window is roughly 81 round trips, a few seconds.
- Reads are unaffected. Hence the §10.1 Ctrl-C rule.

**Dry run on local throwaway databases only** (PostgreSQL 16.15, Supabase CLI 2.121.0, a clean worktree at `adf6be7`).

| Probe | Result |
|---|---|
| The stage 1 block, extracted verbatim from §10.1 (`bash -n` OK), on a local database | The HEAD, clean-checkout and checksum gates pass. It prints `connection: 127.0.0.1 54329 repair_probe postgres`, then STOPs at the identity gate with exit 1. |
| The same block with only the two production constants swapped, on a harness database whose preflight equals production's apart from the database name | `B2 psql exit=0`. The log tail is four `CREATE FUNCTION` lines and `DO`; 82 log lines, 0 errors. Helper MD5 afterwards: `bc6356dd…`. |
| The same block again | Preflight `…\|f\|52\|0\|bc6356dd…\|…`, so it STOPs at the preflight gate: no double apply. |
| `supabase migration repair 20261013120000 --status applied --db-url …`, on a copy of production's history table (`version` primary key, `statements`, `name`, `created_by`, `idempotency_key` unique, `rollback`) | Exit 0. The SQL it sent: connection checks; a "provisioned" check (`count(*) = 3` over `version`, `name`, `statements`), true, so no DDL; then `BEGIN; INSERT … (version, name, statements) … ON CONFLICT (version) DO UPDATE …; COMMIT`. Row written: `20261013120000`, `google_sheets_import_foundation`, 81 statements; `created_by`, `idempotency_key` and `rollback` stay NULL. |
| `supabase migration list --db-url …` piped to the stage 3 `grep` | In a plain terminal, the two table rows. With `AI_AGENT` or `CLAUDECODE` set, one JSON line instead. |
| Local side effects | Only `supabase/.temp/cli-latest`, which is gitignored; `git status --porcelain` stays empty. |
| TLS | The CLI requires TLS by default. The local probe needed `sslmode=disable`; production supports TLS. |

## 17. Production changes during the wait: the commission release (2026-10-15 21:19 UTC to 2026-10-16 08:55 UTC; not Sheets; read-only)

The safety-net check-ins found these changes. Every Sheets read-back stayed at zero throughout: no Sheets relation, function, history row, cron job or Vault secret. The helper MD5 stayed `a199d5dd…`, and the Edge Functions did not change (76; none updated after #448's deploys at 17:29–17:30 UTC on 2026-10-15).

| When (UTC) | Change | Source |
|---|---|---|
| 2026-10-15 21:18:58 | History row `20261015211858` `commission_grids_schema` (55,888 bytes) | PR #447's `20261015120000_commission_grids_schema.sql`, restamped on apply; under Chris's account |
| 2026-10-16 03:51:50 | `20261016035150` `commission_grids_operations` (54,543 bytes) | PR #447, under Chris's account |
| 2026-10-16 03:56:26 | `20261016035626` `commission_grids_reference_import` (19,528 bytes) | PR #447, under Chris's account |
| 2026-10-16 04:26:09 | `main` `1ad0226` (#447 merged); production frontend `dpl_8p1nHPt2s5gcE9CSTnYcYs7d7dES` | Vercel |
| 2026-10-16 08:54:55 | `main` `9a90552` (#449, the UI refresh); production frontend `dpl_7C68MvwQxhH43ExdVNLWprGvEKTf` | Vercel |

**Interaction check** (server-side summaries of the stored statements):
- `commission_grids_schema` creates:
  - nine tables: `public.comp_grids`, `comp_product_variants`, `comp_products`, `comp_rates`, `comp_reference_imports`, `comp_variant_references`, `organization_comp_grid_availability`, `organization_comp_grids` and `organization_comp_settings`;
  - the `comp_authz` schema and 14 functions (`comp_authz.*`, `private.comp_*`);
  - triggers and policies on its own tables only.

  It drops nothing.
- `commission_grids_operations`: 16 functions in `comp_authz`, `private` and `public`. No tables, triggers or drops.
- `commission_grids_reference_import`: 7 functions in `private`. No tables, triggers or drops.
- None of the three references `public.leads`, `role_permissions`, the permission-default helper, Google Sheets, cron or Vault. None grants or revokes on the whole `private` schema. The first references `public.profiles` (9 times) and `public.organizations` (11 times).
- The Sheets migration's privilege statements and per-function loops are scoped by name to `google_sheets_*` objects and the helper, so they cannot touch `private.comp_*` or `comp_authz` objects. No object names overlap.

**Effect on Phase B.**
- The stage 1 preflight value becomes `…|20261016035626`, and the history count after stage 3 becomes 328 (release package §10.1).
- The 19:17 UTC advisor baseline predates the commission tables, so a fresh baseline is taken before stage 1.
- The Phase C rollback target becomes `dpl_7C68MvwQxhH43ExdVNLWprGvEKTf`.

## 18. Reconciliation with `main` `9a90552` (2026-10-16; branch only; approved by Chris: "OK to reconcile")

**What changed on `main` since `b5976e0`.**
- #447, the Commission Calculator and agency compensation grids, merged as `1ad0226`.
- #449, its UI refresh, at `9a90552`.
- Together these add commission UI and settings components, the three migrations already applied in production (§17) with their rollbacks, tests, scripts and docs.
- No package file, `deno.lock`, `supabase/config.toml`, Sheets path or Edge Function changed.

**Merge.** `2f8b543` has parents `adf6be7` and `9a90552`; there was no rebase, amend or force-push. An earlier local merge with `1ad0226` (`f015e7d`) passed the same verification at about 05:30 UTC. It was replaced, unpushed, when #449 landed.

### 18.1 Conflicts and resolutions

| File | Conflict | Resolution |
|---|---|---|
| `WORK_LOG.md` | Both sides inserted entries at the top and below #448's entry. | `main`'s blocks first, then the branch's. Neither side edited or removed an entry. |
| `AGENT_RULES.md` | Both appended a section at the same place. | `main`'s commission section, then the Sheets section. `main`'s one-line edit elsewhere is kept. |
| `implementation_plan.md` | Both prepended a section. | `main`'s sections first, then the branch's. |
| `src/config/settingsConfig.ts` | Both extended the same icon import line. | `…, Network, Percent, Sheet,`. The `google-sheets` entry (Automation & API) and the `commission-grids` entry (Agency & Team) both remain, with no duplicate slug. |
| `src/components/settings/SettingsRenderer.tsx` | Both added an import at the same place. | Both imports kept; both `case`s remain. |

**Proof.**
- For each file, dropping the branch's insertions and edits from the merged text gives `main`'s file byte for byte, and dropping `main`'s gives the branch's file byte for byte.
- No conflict marker remains.
- `src/pages/__tests__/settingsPageHeading.test.tsx` merged automatically; it adds only the Sheets mock line.

### 18.2 Release artifacts are unchanged
- `git diff adf6be7 2f8b543` is empty over the migration, the pending cron migration, the rollback, the four ops files, `_shared/googleSheets` and the four functions.
- The PR's diff against `main` is exactly its 88 files.

### 18.3 Verification on the merged head (local; baselines from a fresh `9a90552` worktree)

| Check | Result |
|---|---|
| `npx tsc --noEmit` (root) | PASS (exit 0) |
| App type-check against `9a90552`, `scripts/verify-a2p-types.mjs` | `base=84, candidate=84, new=0` |
| Full Vitest against `9a90552`, `scripts/verify_reports_frontend.py` (the CI method, with `REPORTS_BASE_SHA` set) | **Every assertion passed.** 5,564 passed on `9a90552` and 5,587 on the merged head: the +23 are the Sheets tests. The same pre-existing 1 failing test and 10 failing files on both sides. App tsc 84 = 84, 0 unhandled runtime errors, and the Reports tests, ESLint and build pass. |
| Vitest, focused (the Sheets CI list) | **80 passed** |
| ESLint, the 29 changed `src/` and `scripts/` JS/TS files (`--max-warnings=0`) | PASS: 0 errors, 0 warnings |
| `npm run build` | PASS |
| Deno, Sheets (`_shared/googleSheets` and the four functions) | **78 passed, 0 failed**. `deno check` passes on the four entry points. |
| Deno, every test under `supabase/functions/` (`-A --no-check`, both sides) | Merged head **340 passed**; `9a90552` **262 passed**. 262 + 78 = 340, with no status change. |
| `scripts/run_google_sheets_tests.sh` (PostgreSQL 16 locally) | **ALL PASSED**, including 33 PostgREST checks and 40 end-to-end Review checks |
| `scripts/run_google_sheets_cron_check.sh` (`supabase/postgres:17.6.1.063`, `--network none`) | **ALL PASSED** |
| `scripts/google_sheets_regression_evidence.sh 8b675e5` | **EVIDENCE OK**: every regression fails on `8b675e5` and passes here; every control passes on both |
| Browser flow, `scripts/tests/google-sheets-ui/verify.mjs` (Chromium; mocked Supabase host and fake Picker) | **48/48 PASS** at 1440×900 and 390×844 |

### 18.4 Exact-head CI
Exact-head CI for the pushed head is recorded in the PR description and in the next records commit. A commit cannot record its own CI.

## 19. Cloud runner and fourth main reconciliation (2026-10-17)

Chris authorized ownership of PR #442 from the cloud, branch updates and testing, retaining explicit approval before each production phase or consequential action. Reviewed AGENT_RULES.md, VISION.md, the recent work log and Sheets release package. Direct production credentials are unavailable in this runtime; use the planned GitHub Actions route, not another large MCP apply.

- Runner draft PR #451: `codex/google-sheets-phase-b-runner`, exact head `c7e1c56e94ae8cbde7cc42567c4e642ceb2b38de`, reconciled with main `91eabff1896e9410a53a40afea6144336902b86d` (#450 client policy display). Its no-secret PostgreSQL 17.6 verification passed: run `38993502917`, job `117280799328`. Real apply/read-backs/history repair, replay refusal, lock-timeout rollback, watchdog SIGINT rollback, six out-of-order/replay refusals and error redaction all pass. No production connection was made by the test.
- PR #442 reconciles the same main by merge, preserving both documentation histories. Only WORK_LOG.md and root implementation_plan.md conflicted; the main-only prefix was prepended to the entire prior branch file. No release artifact changes. The runner remains pinned to `eaf988bc276a3922ee0ec6c3c6038665be9f1678`, whose migration/four function bundles are byte-identical here. New-head CI must pass before release.
- Read-only production check at about 02:03 UTC: 327 history rows, latest `20261016035626`, helper MD5 `a199d5ddfb9a56070aeb7706d3e9a4b8`, zero Sheets relations/functions; 76 Edge Functions, none Sheets. Current frontend is `dpl_BPvvQ9KWdNtcnpHTuSzHpWMkabdZ` at main `91eabff`; capture again immediately before any merge.
- Access gate: GitHub connector can edit branches/PRs but cannot configure protected environments or enter secrets. Cloud browser is signed out. Secure browser authentication and owner-entered environment secrets are required; never enter them in chat. No Mac or local commands are required.
- Next: verify Supabase GitHub Deploy to production is OFF; prepare protected `google-sheets-production` environment and secure secret entry; request approval to merge #451 (it rebuilds Vercel production). Then read-only `check`, followed by separate approved migration, history and four-function stages. No merge, migration, deployment, activation, cron, privacy publication or dialer modification has occurred in this work.


Exact-head #442 CI is recorded in the PR body after this commit is pushed. No real Google-account test has been performed.

## 20. Fifth main reconciliation and runner re-pin (2026-10-17, about 07:45–08:00 UTC; branch only; no production change)

The 07:43 UTC check-in found `main` at `95009d15cf1ca342845032007091a157c7049ebf` instead of `91eabff`. Three merges had landed: #452 (callbacks dashboard modal), #453 (Sold Date reporting, with two production migrations) and #454 (docs). Under the PR rules, both branches were reconciled by merge, with no rebase or force-push.

### 20.1 Production (read-only, Supabase connector, 07:49–07:57 UTC)
- State line: `postgres|t|0|0|a199d5ddfb9a56070aeb7706d3e9a4b8|20261017043757|329`. That means no Sheets relation, zero `google_sheets_*` functions, zero Sheets history rows, the helper preimage unchanged, and 329 history rows with latest `20261017043757`.
- The two new rows are `20261017043142` performance_sold_date_basis and `20261017043757` performance_wins_sold_date_index, applied under Chris's account for #453.
- In every schema there are zero `google_sheets_*` relations, Sheets cron jobs and Sheets Vault secrets.
- 76 Edge Functions, none `google-sheets-*`.
- Frontend: `dpl_FQifs5hMooAKyRiGDZcjwj7FUEGB`, READY at `95009d15`. Before it: `dpl_5vRNhKc3p72a8HCwevHDASq3gVwD` (`12901e5`, #453), `dpl_DaCf85efcFDr1ua5EzceACoNsexh` (`f20b30b`, #452) and `dpl_BPvvQ9KWdNtcnpHTuSzHpWMkabdZ` (`91eabff`, #450).

### 20.2 Interaction check
#453's two migrations replace reporting functions and add one index on wins. They make no DDL change to `profiles` or `organizations`, no change to `role_permissions` or `_contacts_permission_default`, and no default-privilege change. The Sheets migration's preconditions and read-backs (helper preimage `a199d5dd…b8`, function and table ACLs, and the §3 table-privilege read-back) are unaffected. The only effect on Phase B is the history count: 329 rows before stage 3 and 330 after.

### 20.3 Runner PR #451
- **Merge `264cb682`** (main `95009d15` into `394de1a4`): only `WORK_LOG.md` and `implementation_plan.md` conflicted. Each resolves to main's insertion, then the branch's, then the shared base, byte for byte.
- **Re-pin `5aab5e06`:** the expected states move to 329, 329 and 330 rows with latest `20261017043757`, and the synthetic driver now seeds 328 rows plus that latest version. No other runner logic changed. Without the re-pin, every stage would stop at the state check.
- **Local:** the full synthetic driver passed against disposable PostgreSQL 17.6 with CLI 2.121.0.
- **CI:** `verify-runner` passed on `5aab5e06` (run `39015204526`, job `117345788689`). The earlier hardening head `394de1a4` passed in run `38996292162`. That head moved the read-only settings into in-session `SET` and switched to the client-side `\conninfo` TLS check.

### 20.4 PR #442
- **Merge `3342db63`** (main `95009d15` into `fa819eee`): only `WORK_LOG.md` and the root `implementation_plan.md` conflicted. Every line of both sides is kept in order, with main's new blocks first.
- **Release artifacts:** on the merged head, the recomputed migration SHA-256 and four bundle digests match the pinned values (§3–§4 of the release package). The merge commit differs from `eaf988b` in 48 files: 46 from main and the two Sheets records (this file and the release package). No main-changed path is Sheets-related.
- **Local checks on the merged head:**
  - root `npx tsc --noEmit` exits 0;
  - strict `npx tsc -p tsconfig.app.json --noEmit` emits 230 lines (84 errors), byte-identical to a `95009d15` worktree;
  - the Sheets Vitest suites pass (2 files, 23 tests).
  The Deno and SQL suites run in exact-head CI.
- **Records:** the release package gains a revision note, §0.E, the 329/330 history counts and the Phase C rollback target `dpl_FQifs5hMooAKyRiGDZcjwj7FUEGB`. Capture that target again after #451 merges, because the merge redeploys production.

No merge to main, migration, deployment, activation, cron, privacy publication or dialer change has occurred. Phase B still needs Chris's GitHub setup and his explicit GO. Exact-head CI for this head is recorded in the PR body.
