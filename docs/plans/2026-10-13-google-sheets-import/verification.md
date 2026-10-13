# Google Sheets V1 — verification record (local + CI; no production)

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
