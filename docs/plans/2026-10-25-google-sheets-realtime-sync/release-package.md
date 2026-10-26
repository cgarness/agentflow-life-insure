# Google Sheets real-time sync — Gate D production release package

**Status (2026-10-25 21:25 UTC): A, B and C EXECUTED; D FAILED (run 40234513215); recovery in §12.**

- A: PR #491 merged as `0e5b957`.
- B: `check` 40233075500, `apply-migration` 40233249217, `record-history` 40233582885.
- C: `deploy-functions` 40234132795 (`google-sheets-push` v1, `google-sheets-push-maintenance` v1,
  `google-sheets-api` v7).
- D: `configure-secrets` 40234513215 stopped at the Management API write. Vault is absent (verified). The Edge push
  secret names are unproven (expected absent), so the stage is not retried.
- Real-time sync is OFF and stays OFF: push mode `off`, no kill switch, no watch, no schedule. Pilot B is unchanged.
- The text below is the package as prepared. Its "today" columns describe the 15:08 UTC baseline.
- Prepared 2026-10-25, against production `jncvvsvckxhqgqvkppmj` (read-only reads at 15:08–15:12 UTC) and Vercel
  project `agentflow`.
- Each step needs its own approval (§11). Approving one step approves nothing else.

**Release content:** the Gate C-approved commit `24fa80936c9d58e5f344a49159e6a84af1cf72b2` ("source").

**Release vehicle:** the protected runner `.github/workflows/google-sheets-push-release.yml`, added after the source
by a tooling-only commit. It is dispatch-only and main-only, runs in environment `google-sheets-production` behind
Chris's required review, and checks out the pinned source. It follows the Phase B pattern
(`google-sheets-phase-b.yml`, runs 39807937130 … 39812578512).

## 1. GitHub state

| Item | Value |
|---|---|
| PR #491 | draft; head at Gate C = `24fa809…`; mergeable `clean`; 0 reviews or threads |
| CI on `24fa809` | 17/17 checks passed; Supabase Preview skipped (branch limit) |
| `main` | `27c8d0d18b78d133d1f897372ebc09625735a139`, unchanged since the PR base. No drift and nothing to incorporate. |
| Release content vs source | The tooling commit changes no migration, function or `src/` file (`git diff 24fa809 HEAD -- supabase/migrations supabase/functions src` is empty). |
| Production frontend | `dpl_9o7GVcVSvkRPipJn7QuDJrqjoDr7`, READY, at `27c8d0d`. This is the rollback target for step A; re-capture it immediately before the merge. |

## 2. Production baseline (read-only, 2026-10-25 15:08–15:12 UTC)

Reproducible with `supabase/ops/google_sheets_push_release_preflight.sql`. Every `*_ok` column was true.

| Item | Value |
|---|---|
| Migration history | head `20261024045812`, **346** rows; no push row |
| Push objects | absent (`private.google_sheets_watch_targets` does not exist) |
| Sheets functions | `private:31, public:21` = 52; digest `6640fc303f4fd426e5d5d3615f211f6d` (**identical to the tested local preimage**) |
| `google_sheets_finish` | md5 `f1cf66bea7de1d469e2ff03c57f1a414` (the guarded preimage) |
| `sync_runs` trigger CHECK | `schedule, manual, activation` (the exact guarded definition) |
| Security | function ACL violations 0; wrapper definer/search_path violations 0; 6 RLS tables; 3 own-read policies; table ACL md5 `cc3c7ea29bdaa0bc447ebf5f8c209b1b`; permission helper `bc6356dd…` |
| Pilot B (must stay intact) | 1 connection `ad9b771e…` (connected, generation 1); 1 source `2a9ce6b6…` "AgentFlow Sheets Pilot B – Leads" (enabled / ok / steady / row_position / v2) |
| Pilot B receipts and leads | 3 receipts (`imported`), each linked to an existing lead in org `a0000000-…-0001` with consistent owner fields; no duplicate phone |
| Pilot B ledger and history | 3 ledger rows `done`; 2 sync runs (`manual`), last 2026-10-24 22:57:19 UTC; 7 OAuth states |
| Data fingerprint | `1\|1\|3\|3\|3\|2\|98aae47446d6778fb467f78b78023b3f` (ids and states only) |
| pg_cron | 13 jobs, **none** for Sheets (the 5-minute poll is not applied) |
| Vault | only the connection's refresh-token secret; no push token |
| Extensions | `pg_cron` 1.6.4, `pg_net` 0.19.5, `supabase_vault` 0.3.1, `pgcrypto` 1.3, `ltree` 1.3; PostgreSQL 17.6 |
| Load | pg_net queue 0; no long or idle-in-transaction client backends |
| Edge Functions | 81. Sheets functions are v6, `verify_jwt=false`, ACTIVE (table below). No `google-sheets-push*`. |
| Advisors (security) | 246 findings. The only Sheets ones are 3 INFO "RLS enabled, no policy" (by design). Pre-existing: 2 ERROR `rls_disabled_in_public` (`public.app_config`, `public.webhook_debug_log`), 52/134 definer WARN, 21 search_path WARN, 3 `extension_in_public`, 1 leaked-password. |
| Advisors (performance) | 459 findings. Sheets: 7 INFO unindexed FKs and 3 `auth_rls_initplan` WARN (foundation). |
| Platform logs (plan §4.3) | Read by key name only. `function_edge_logs` and `edge_logs` record an allowlist of request headers: `accept`, `accept_encoding`, `cf_*`, `connection`, `content_length`, `content_type` (gateway only), `cookie`, `host`, `prefer`, `referer`, `user_agent`, `x_client_info`, `x_forwarded_proto`, `x_real_ip`. `authorization` is recorded as a prefix only. There is **no `x_goog_*` key**, and the log check in §7 returns `0\|0` over 37,767 rows. The step C probe confirms this for the new receiver. |

Edge Functions:

| Function | Version | ezbr hash |
|---|---|---|
| `google-sheets-sync-worker` | v6 | `40eb0ecb…` |
| `google-sheets-api` | v6 | `d0a2cca1…` |
| `google-sheets-oauth-callback` | v6 | `dca4e02e…` |
| `google-sheets-oauth-start` | v6 | `a85b8057…` |

The live `google-sheets-api` was read back on 2026-10-25. All 12 files are byte-identical to `main` `27c8d0d` (bundle
digest `6ab61569…`, the Phase B pin).

Not verifiable from this session (the runner's `check` stage verifies names only):
- Edge secret names. Six B1 names are expected present; `GOOGLE_SHEETS_PUSH_*` absent.
- Supabase GitHub integration "Deploy to production" (dashboard only; must be OFF).

## 3. Migration

| Item | Value |
|---|---|
| File | `supabase/migrations/20261025120000_google_sheets_push_sync.sql` |
| Version | `20261025120000` sorts after the hosted head `20261024045812`, so **no re-stamp**. The runner refuses if the head moves. |
| Bytes / SHA-256 | **80,739** / `2774557acaf98db80fc169f6ed502003d8533ea13a08ebeefdf18657aefa609d` |
| Recorded history | `google_sheets_push_sync`, **57 statements**, statements SHA-256 `0561e767049e118b1cf53d9e51e2ec69a8eab5069bee82592e724535db5b79ff` (from the real CLI 2.121.0 `migration repair`) |
| Rollback | `rollback/20261025120000_google_sheets_push_sync.rollback.sql`, 9,467 bytes, `1bc9845031075a47f650d4780b57771946cb2495d347e33cb1874678fc3cce94` |
| Pending (NOT part of Gate D) | maintenance schedule `pending/20261025120100_…` (`2db0a82a…`); the 5-minute poll `pending/20261013120100_…` (`6116f414…`) stays unapplied for good |

**Schema changes.**

| Before | After |
|---|---|
| — | `private.google_sheets_push_config` (singleton: mode **off**, cap 4, renew 10,800 s, overlap 900 s, grace 3,600 s) |
| — | `private.google_sheets_push_pilot_sources` (empty) |
| — | `private.google_sheets_watch_targets` |
| — | `private.google_sheets_watch_channels` |
| — | `private.google_sheets_push_events` (UNIQUE `(channel_row_id, message_number)` for authenticated rows) |
| — | `private.google_sheets_push_attempts` |
| 52 Sheets functions | **75** = 44 private + 31 public (13 private helpers and 10 wrappers added); digest `6e8c43651043ce83254dcec092505cd6` |
| `finish` md5 `f1cf66be…` | `e684c572b950e35487b0e4eb33ac0830` (adds `push` and records `backlog`; otherwise identical) |
| CHECK `schedule, manual, activation` | `… , push` |
| table ACL md5 `cc3c7ea2…` (6 tables) | `e4a0ad1431818dd40a2fb32489ddcfa2` (12 tables) |

**Grants.**
- The new tables are `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated` and `service_role`, with RLS on and no
  policy.
- Private functions: no EXECUTE for anyone but the owner.
- The 10 public wrappers: EXECUTE for `service_role` only.
- The policies are unchanged (3).

**Safety.**
- **Replay protection:** the migration's preflight refuses if the push objects exist, if `finish` differs from the
  preimage, or if the CHECK differs. The runner's state machine also refuses any stage out of order. Both are tested.
- **Data:** the migration deletes nothing. The only `DELETE` in its text is the foundation's unchanged keep-last-50
  runs trim inside `finish`, plus retention of the new push tables. The runner requires the data fingerprint to be
  identical before and after the transaction.
- **Locks:** a single transaction with `lock_timeout` 5 s and `statement_timeout` 30 s, under a 120 s watchdog
  (SIGINT). It briefly takes ACCESS EXCLUSIVE on `public.google_sheets_sync_runs` (CHECK swap) and replaces
  `finish`. Run it when no Sync now is in progress; a lock wait aborts and rolls back cleanly (tested).
- **Rollback validated against the production preimage.**
  - Applying the rollback restores *every* preimage fingerprint exactly:
    - functions digest `6640fc30…` (identical to production);
    - `finish` md5;
    - the 3-value CHECK;
    - table ACL `cc3c7ea2…`;
    - 6 tables;
    - 3 policies.
  - It removes only push objects.
  - If `push` runs exist, the CHECK is restored `NOT VALID` instead of deleting them.
  - It refuses while the push maintenance job is scheduled.

**Expected advisor delta.**
- **Security:** +6 INFO `rls_enabled_no_policy` (the six new private tables, server-only by design).
- **Performance:** +5 INFO `unindexed_foreign_keys`:
  - `push_attempts.organization_id`;
  - `push_events.organization_id`;
  - `push_pilot_sources.organization_id`;
  - `watch_channels.organization_id`;
  - `watch_targets.user_id`.
- **Performance:** INFO `unused_index` for the new indexes until they are used.
- **No new WARN or ERROR.** The wrappers are not executable by `anon` or `authenticated`, and every function pins
  `search_path`.

## 4. Edge Function bundles

Manifest method: the Phase B method. The digest is the SHA-256 of `sha256␠␠path\n` lines over the deployed local
files, sorted. It reproduces Phase B's pinned `oauth-start` / `oauth-callback` digests exactly.

| Function | Files | Bytes | Bundle digest | Today |
|---|---|---|---|---|
| `google-sheets-push` (new) | 17 | 86,169 | `ba1e374b88d60a52aa9e25d18ad92637b066a776365cf11edba38a8f1684b239` | absent |
| `google-sheets-push-maintenance` (new) | 18 | 92,535 | `f206df480d737f109aedebbbfaadb9cb7cd5a82beb7372ee7dc920d52e0f2c06` | absent |
| `google-sheets-api` (replaced) | 21 | 120,044 | `1416a03d2cd6fe885b6b4a3d0d7deeea5672f419f7a7f2988b1c9ea2d9e57605` | v6 = `6ab61569…` |

- **Not redeployed:**
  - `google-sheets-oauth-start` (`7105438e…`) and `google-sheets-oauth-callback` (`0fe3970b…`): unchanged.
  - `google-sheets-sync-worker`: live v6 keeps the foundation engine. This PR's engine change is behaviour-neutral
    for it, and no cron invokes it. Its repository bundle (`2c306ae6…`) differs only in that neutral change.
- **Dependencies:** one remote import, `https://esm.sh/@supabase/supabase-js@2`, spelled exactly as in the live
  Sheets functions. No new third-party code. The import floats within major 2 at deploy time, as it did for v6;
  `deno.lock` pins the `2.98.0` redirect for local runs.
- **Configuration:**
  - `verify_jwt = false` for all three (`config.toml` and `--no-verify-jwt`).
  - The receiver authenticates by HMAC channel id and token digest.
  - Maintenance uses a constant-time bearer.
  - The API keeps the user JWT check.
  - Service role is used only server-side.
- **OAuth and Sync now:** the OAuth functions are untouched. Sync now uses the same engine and receipts (the
  `actions.ts` change only adds push hooks, which are inert without `pushReady`).
- **With no push secrets** (Gate D after step C):
  - receiver POST → 503 (`not_configured`), GET → 405;
  - maintenance → 403 to everyone;
  - API hooks do nothing.

  After step D (secrets, kill switch absent): receiver POST without notification headers → 400, and a bad HMAC tag
  → 404 with no database call. Nothing is registered or processed.

## 5. Secrets inventory

| Name | Kind | Needed by | Today | Set in |
|---|---|---|---|---|
| `GOOGLE_SHEETS_CLIENT_ID`, `_CLIENT_SECRET`, `_REDIRECT_URI`, `_ALLOWED_RETURN_ORIGINS`, `_STATE_KEY`, `_WORKER_TOKEN` | Edge | foundation | present (Phase B verified; re-verified by runner `check`) | unchanged |
| `GOOGLE_SHEETS_ENABLED` | Edge | foundation backend flag | present (Pilot B ran); not touched | unchanged |
| `GOOGLE_SHEETS_PUSH_KEY` | Edge | receiver HMAC, ≥ 32 chars | absent | step D (runner-generated, 64 chars) |
| `GOOGLE_SHEETS_PUSH_MAINTENANCE_TOKEN` | Edge | maintenance bearer, ≥ 32 chars | absent | step D (runner-generated, 64 chars) |
| `google_sheets_push_maintenance_token` | Vault | the pending maintenance schedule (Gate E) | absent | step D (the same value, written over psql stdin) |
| `GOOGLE_SHEETS_PUSH_ENABLED` | Edge | kill switch | absent | **Gate E only**. Every Gate D stage refuses if it exists. |

**Secure setup (step D, `configure-secrets`; corrected after run 40234513215, §12).**
- **Token prerequisite:** the environment's `SUPABASE_ACCESS_TOKEN` needs **Edge Function Secrets: Read-write**
  (bulk create/delete) as well as **Edge Functions: Read-write** (deploy/delete). A scoped token with only Edge
  Function Secrets *Read* lists names but is refused on every write, `rollback-secrets` included.
- The runner generates both values with `secrets.token_urlsafe(48)` and masks them in the log before any use.
- It sends them only to the Management API (`POST /v1/projects/{ref}/secrets`) and, over psql **stdin** as a
  **`\bind` parameter**, to `vault.create_secret`.
  - The value never appears in statement text, so never in `pg_stat_activity`.
  - Production has `log_min_error_statement=error`, so a failing statement's text is logged; bind parameters are not
    (`log_parameter_max_length_on_error=0`).
- It verifies Vault by comparing a SHA-256 inside SQL; only the hash is passed.
- **Write order:**
  1. remove any stale Vault copy;
  2. POST both names;
  3. read the names back and require that each pre-existing name's platform digest changed;
  4. write the Vault copy last.

  A failure at any step therefore leaves a `partial` state, never all three names with mismatched values.
- **Any failed write** prints a sanitized label (category, HTTP status, `json`/`html`/`text`/`other`; never a
  body). It then reads back `SECRETS AFTER FAILURE: <name>=present|absent … vault=present|absent` and stops.
- **Verification marker (PR #492 hardening).**
  - The Vault row is created with the description `Google Sheets push maintenance bearer (unverified)`.
  - It becomes `…; verified v1 <sig>` only as the **last** step, after the Edge read-back, the digest change, the Vault
    SHA-256 and `http_checks`. The write goes through `vault.update_secret` (production `postgres` cannot UPDATE
    `vault.secrets`) and is guarded: Vault must still hold this run's token.
  - `sig` = SHA-256(`v1|` + SHA-256(Vault value) + `|` + SHA-256 of both Edge platform digests). It is computed inside
    SQL, so only non-secret hex is stored and Python receives booleans.
  - A final self-check re-reads the Edge digests and the marker.
- **Credential-set states:**
  - `deployed` = none of the three;
  - `configured` = all three **and** a marker matching the current Vault value and Edge digests;
  - `partial` = anything else, including all three names after a failed, interrupted or drifted verification
    (`vault=present verification=missing`).

  `partial` is used by nothing, and only `recover-secrets` (replace all three in one run) or `rollback-secrets`
  (delete what exists) may touch it. `check` names a partial set and stops.
- No person sees, copies or stores a value. Rotation is `rollback-secrets` followed by `configure-secrets`.
  `recover-secrets` is refused on a complete set.

## 6. Release order (each step separately approved), verification and rollback

| # | Step | Action | Verify (pass = all) | Rollback |
|---|---|---|---|---|
| 0 | Pre-snapshot | Read-only `preflight.sql` via the connector; capture the Vercel production deployment id, `list_edge_functions` and both advisor sets. Chris may confirm that the latest scheduled backup exists (Dashboard → Database → Backups). The release does not depend on it: every step has an exact SQL or CLI rollback. | every `*_ok` true; data fingerprint recorded | — |
| A | Merge PR #491 | Mark ready, then use a **merge commit** (not squash), expecting the exact head named in the approval (§11). A merge commit keeps the pinned source `24fa809` in `main`'s history, as #488 and #490 did. Vercel then builds `main`. | Vercel READY; `www.fflagent.com` 200. The Settings → Google Sheets rows show no monitoring line (no `realtime` until C), and the label "Last successful sync" appears. No backend change. | Vercel instant rollback to the captured deployment; `git revert` the merge |
| B1 | Runner `check` | Read-only on production | `STATE: before`; preimage digest; B1 names present; kill switch absent | — |
| B2 | Runner `apply-migration` | Single transaction | `STATE` applied; the runner's 75-function postimage, ACL, RLS, `off\|4\|10800\|900\|3600`, empty push tables, no Sheets cron, data fingerprint unchanged; then `verify.sql` via the connector: all `*_ok` true except `history_ok` (history row not yet written) | Runner `rollback-migration` |
| B3 | Runner `record-history` | `supabase migration repair --status applied` | 347 rows; head `20261025120000`; `google_sheets_push_sync\|57\|0561e767…`; `verify.sql` all true | Runner `rollback-migration` (rollback SQL plus `--status reverted`) |
| C | Runner `deploy-functions` | Deploy the 3 bundles; push secrets must be absent | Inventory: 3 ACTIVE, `verify_jwt=false`, API version > 6, the other 78 unchanged (incl. worker and oauth v6); HTTP: push 405/503, maintenance 403, API status 401; `verify.sql` all true. The receiver probe carries the dummy `X-Goog-Channel-Token: agentflow-gate-d-log-probe`, and the log check (§7) returns `0\|0`. | Runner `rollback-functions` (redeploys the exact v6 API `6ab61569…` from `27c8d0d`; deletes both push functions) |
| D | Runner `configure-secrets` (from `deployed`) or `recover-secrets` (from `partial`, §12) | Generate and store `GOOGLE_SHEETS_PUSH_KEY`, `_MAINTENANCE_TOKEN` and the Vault copy | Names present; Vault hash match; HTTP push POST 400, maintenance 403; kill switch still absent; `verify.sql` all true; log check `0\|0`; no `create_secret` in `postgres_logs` | Runner `rollback-secrets` (from `configured` or `partial`) |
| — | Post-release | Connector: `get_advisors` (expected delta §3); `list_edge_functions`; optional: Chris clicks Sync now on Pilot B (imports only rows genuinely new in the sheet; with no new rows it imports nothing) | Matches §3 and §4 | per step |

**Rollback order** is the reverse: D → C → B (`rollback-secrets`, `rollback-functions`, `rollback-migration`).
- Every rollback stage refuses unless production is in the exact expected state.
- A `rollback-migration` interrupted after its SQL committed is recognized as `reverted-recorded` and resumed.

All of this is tested against real PostgreSQL 17.6 and the real CLI (§8).

**Real-time stays OFF throughout:**
- push mode `off` (checked by every stage);
- `GOOGLE_SHEETS_PUSH_ENABLED` absent (checked by every stage);
- zero targets, channels, events and attempts;
- no Sheets cron job;
- no watch registration (impossible without the kill switch).

## 7. Preflight and post-stage SQL

- **`supabase/ops/google_sheets_push_release_preflight.sql`** (read-only).
  - Columns: `history_ok`, `not_applied_ok`, `functions_preimage_ok`, `finish_preimage_ok`, `trigger_check_ok`,
    `operations_off_ok`, `quiet_ok`, plus the data fingerprint.
  - Run on production 2026-10-25: **all true**.
- **`supabase/ops/google_sheets_push_release_verify.sql`** (read-only).
  - Columns: `functions_postimage_ok`, `finish_postimage_ok`, `security_ok`, `realtime_off_ok`, `history_ok`, plus the
    data fingerprint.
  - Run after each stage; tested on a local push-applied database.
- **Log check (plan §4.3)**, read-only, through the connector's `query_logs`. Run it after C and after D, with a
  window that covers the stage. Pass = `goog_keys = 0` and `probe_hits = 0`, meaning the platform kept neither a
  Google notification header nor the dummy token value:

  ```sql
  select countIf(arrayExists(k -> positionCaseInsensitive(k, 'goog') > 0, mapKeys(log_attributes))) as goog_keys,
         countIf(position(event_message, 'agentflow-gate-d-log-probe') > 0
                 or arrayExists(v -> position(toString(v), 'agentflow-gate-d-log-probe') > 0, mapValues(log_attributes))) as probe_hits,
         count() as rows_scanned
    from logs where source in ('function_edge_logs', 'edge_logs', 'function_logs')
  ```

  If either count is not 0, stop before D. Real tokens arrive only after Gate E, so a non-zero count exposes nothing,
  but it blocks Gate E until a fix is in place.
- All three print ids, states, counts and digests only.

## 8. Evidence

- **CI on `24fa809`:** 17/17 passed (PR #491).
- **Runner verification** (`scripts/tests/google_sheets_push_release_runner.py`; CI
  `google-sheets-push-release-check.yml`). Run locally on PostgreSQL 17.6 with the real CLI 2.121.0: **ALL PUSH
  RELEASE RUNNER CHECKS PASSED**.
  - 21 migration-order refusals.
  - Real apply with data unchanged.
  - Every read-back.
  - Real `migration repair` (57 statements, exact hash).
  - Replay refusal.
  - Real lock-timeout and watchdog-SIGINT rollbacks.
  - 25 out-of-order and 6 inconsistent-state refusals.
  - `deploy` limited to the three bundles; unrelated drift and premature secrets refused.
  - `configure-secrets`: values never printed, Vault verified by hash.
  - All three rollbacks, including the interrupted one, back to the exact preimage.
  - `http_checks`: exact statuses before and after the secrets; the probe carries only the log marker; a wrong
    receiver status is refused.
  - Error redaction; TLS identity; read-only check sessions.
- **Local regression on this head (2026-10-25)** (`verification.md` §9):

  | Check | Result |
  |---|---|
  | `run_google_sheets_tests.sh`, PostgreSQL 17.6 | ALL PASSED (74 s) |
  | `run_google_sheets_tests.sh`, PostgreSQL 16.15 | ALL PASSED (69 s) |
  | What those runs include | PostgREST 62, Review e2e 40, push e2e 43 |
  | `run_google_sheets_cron_check.sh` (real pg_cron / pg_net) | ALL PASSED; 0 requests with nothing due |
  | Release runner test | ALL PASSED (31 s) |
  | `deno test` | 112 passed |
  | `deno check` (6 entry points plus the push e2e) | exit 0 |
  | `npx tsc --noEmit` | exit 0 |
  | Strict type-check | base 80 = candidate 80, new 0 |
  | Vitest | 6 files, 99 passed |
  | ESLint (Sheets set and the exact Reports command) | exit 0 |
  | `npm run build` | built |
  | `git diff --check` | clean |
  | Polling audit | no polling: no spreadsheet poll, no 1- or 5-minute job |

  Polling audit detail: no Sheets `cron.schedule` in any applied-path migration. Both every-minute schedules live
  only in `pending/`: the poll (never) and the guarded maintenance (Gate E). UI refreshes read AgentFlow only, and the
  status refresh is off while push mode is `off`.

## 9. Risks and blockers

1. **Blocker for A (Chris, dashboard only).** Supabase GitHub integration "Deploy to production" must be **OFF**.
   If it were on, the merge could apply the migration or deploy functions outside these gates.
2. Edge secret names can't be read from this session. The runner's `check` verifies them before anything mutates.
   - Since D failed, `check` also names a `partial` set.
   - **Blocker for D:** the runner token's Edge Function Secrets permission (§5, §12).
3. The floating `supabase-js@2` import resolves at deploy time (pre-existing pattern, the same as v6).
4. The worker stays on v6 (behaviour-identical; not invoked). A later redeploy is optional.
5. Supabase Preview was skipped (branch limit), so there was no hosted preview. Mitigated by the exact-preimage
   rehearsal.
6. A brief lock on `google_sheets_sync_runs` during apply (≤ 5 s wait, then abort).
7. The Gate E risks R1–R7 are unchanged:
   - R1: domain verification;
   - R2: Sheets coalescing;
   - R3: API-write notifications;
   - R4: quota;
   - R5: Testing-mode tokens;
   - R6: CPU;
   - R7: logs.

   Plus the residual overlap/grace risk (plan §18).

## 10. Gate E prerequisites (NOT authorized by any Gate D approval)

- Gate D steps A–D complete and verified.
- A Gate E tooling package, separately reviewed:
  - set `GOOGLE_SHEETS_PUSH_ENABLED=true`;
  - run `google_sheets_push_pilot_enable.sql` (mode `pilot` plus the Pilot B allowlist);
  - apply the pending maintenance schedule `20261025120100`, which still sorts after `20261025120000`.
- The Gate E rollback: `google_sheets_push_stop_all.sql`, then `…_unschedule.sql`, then unsetting the kill switch.
- The pilot procedure (plan §17.5): manual rows plus API writes through Chris's connected ChatGPT Google Drive
  integration; the first registration settles R1.
- Measurement with `google_sheets_push_metrics.sql` and `…_pilot_evidence.sql` against the go/no-go criteria.
- The privacy/Terms copy is not required before the pilot, and is required before Gate G (D9).

## 11. Approval requests (each one exact; none implies another)

**How each runner stage is executed.**
- The workflow is dispatched on `main` with `stage` and `confirm` both set to the stage name. Claude can dispatch it
  through the GitHub connector once the stage is approved; Chris can also dispatch it himself under Actions →
  "Google Sheets push release".
- The `google-sheets-production` environment holds the run until **Chris approves the deployment in GitHub**. That
  approval is the second key, so nothing reaches production on a dispatch alone.
- The runner uses the existing environment secrets `SUPABASE_DB_PASSWORD`, `SUPABASE_POOLER_HOST` and
  `SUPABASE_ACCESS_TOKEN`, the same as Phase B. **No new GitHub secret is needed.**
- After each stage, Claude runs the read-only connector checks in §6 and §7, reports, and stops.

| Approval | Exact scope | Pinned by | Not included |
|---|---|---|---|
| **A** | Mark PR #491 ready and merge it with a **merge commit** at the exact head named in the request. Vercel builds `main`. | The PR head SHA; source `24fa809`; rollback deployment `dpl_9o7GVcVSvkRPipJn7QuDJrqjoDr7` | Any Supabase change. **Precondition:** Chris confirms that Supabase GitHub integration "Deploy to production" is OFF. |
| **B** | Runner `check`, then `apply-migration`, then `record-history`, with connector verification between them. Rollback, if needed: `rollback-migration`. | `20261025120000`; 80,739 B; `2774557a…a609d`; preimage `6640fc30…`; postimage `6e8c4365…`; history `57\|0561e767…` | Edge deploys, secrets, cron, watches. Push mode stays `off`. |
| **C** | Runner `deploy-functions`: `google-sheets-push` (new), `google-sheets-push-maintenance` (new), and `google-sheets-api` (replaced), from source `24fa809`; then the HTTP and log checks. Rollback: `rollback-functions` (restores the v6 API bundle `6ab61569…` from `27c8d0d`). | `ba1e374b…b239`, `f206df48…2c06`, `1416a03d…7605` | Worker and OAuth functions; secrets |
| **D** | Runner `configure-secrets`: generate and store `GOOGLE_SHEETS_PUSH_KEY`, `GOOGLE_SHEETS_PUSH_MAINTENANCE_TOKEN` and the Vault `google_sheets_push_maintenance_token`. Values are never shown. Rollback: `rollback-secrets`. | The names only; hash-verified Vault copy | `GOOGLE_SHEETS_PUSH_ENABLED`; push mode; the maintenance schedule; any watch |
| **D-R** | **After run 40234513215 (§12).** Corrected runner `check`, then **one of** `configure-secrets` (state `deployed`) or `recover-secrets` (state `partial`). Values are never shown. Rollback: `rollback-secrets`. Precondition: the token has Edge Function Secrets Read-write. | The names only; hash-verified Vault copy; the `check` state line | `GOOGLE_SHEETS_PUSH_ENABLED`; push mode; the maintenance schedule; any watch; any automatic retry |
| **E** | **Not requested now.** Gate E (Pilot B real-time pilot) gets its own reviewed package after A–D are verified (§10). | — | — |

## 12. Approval D failure (run 40234513215) and recovery

**What happened.**
- Every gate passed up to `PASS: generated 64-char secrets` (21:15:15.2347 UTC).
- **≤ 129 ms later** the catch-all printed `STOP: execution failed`. The `POST /v1/projects/{ref}/secrets` had raised;
  no 2xx was received.
- The request shape matches the official reference and CLI: an array of `{name, value}`, 201 with an empty body.
- The old runner discarded the HTTP status. The probable cause is a 403 from a token without Edge Function Secrets
  Read-write: it was the token's first secrets write, and listing and deploying had worked. This is not proven.
- The Vault write never ran: the pooler logs show no session after the POST. Vault is absent.
- The Edge push secret names were not readable from the connector.
- Real-time stayed off; Pilot B is unchanged (`1|1|3|3|3|2|98aae474…`). Full diagnosis:
  `implementation_plan.md` (2026-10-25 Approval D entry).

**Correction (runner only; the release content `24fa809` is unchanged).** Recorded in §5:
- the sanitized Management API classification, with redirects refused and an explicit `User-Agent`;
- the failure read-back;
- the `partial` state and the `recover-secrets` stage;
- `rollback-secrets` from `partial`;
- the Vault copy through `\bind`;
- the write order;
- the verification marker (§5), the final verification step, which `configured` requires.

Tests: `verification.md` §10.

**Recovery procedure.** Each step is separately approved. Never retry automatically.
0. **Chris** (credential action; the agent never handles it):
   - confirm that the `google-sheets-production` `SUPABASE_ACCESS_TOKEN` has **Edge Function Secrets: Read-write** on
     `jncvvsvckxhqgqvkppmj`;
   - otherwise create a project-only scoped token with Edge Functions Read-write and Edge Function Secrets
     Read-write, replace the environment secret, and revoke the old token.
1. Merge the corrected runner (merge commit) after review and CI.
2. Run the corrected `check`. It prints `STATE: deployed`, or `STATE: partial (…)` and stops.
3. Run `configure-secrets` if the state is `deployed`, or `recover-secrets` if it is `partial`.
4. Connector checks:
   - Vault row count 1, by name, whose description starts with `Google Sheets push maintenance bearer; verified v1 `
     followed by 64 hex characters (the description is non-secret);
   - mode `off`; 0 targets, channels, events and attempts; 0 Sheets cron;
   - `list_edge_functions` unchanged;
   - the data fingerprint unchanged;
   - the §7 log check `0|0`;
   - 0 `postgres_logs` rows mentioning `create_secret`.
5. Stop. Gate E needs its own package.
