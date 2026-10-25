# Google Sheets real-time sync — verification record (Gate B, local)

**Scope.** Local and CI-equivalent evidence for the Gate B build on `claude/modest-knuth-y5cqor`, base `main`
`27c8d0d`. No production mutation:
- no migration applied;
- no function deployed;
- no secret set;
- no Google watch registered;
- no lead created.

Production was not queried during the build. The read-only Phase 0 observations are in `implementation_plan.md` §1.

## 1. Files and pins

| File | SHA-256 |
|---|---|
| `supabase/migrations/20261025120000_google_sheets_push_sync.sql` (new; version provisional, re-stamped at Gate D) | `2774557acaf98db80fc169f6ed502003d8533ea13a08ebeefdf18657aefa609d` (Gate C hardening, §8; Gate B was `8a7cf14f…e75718b7`) |
| `supabase/migrations/rollback/20261025120000_google_sheets_push_sync.rollback.sql` (new) | `1bc9845031075a47f650d4780b57771946cb2495d347e33cb1874678fc3cce94` |
| `supabase/migrations/pending/20261025120100_google_sheets_push_maintenance_schedule.sql` (new, **pending**) | `2db0a82a52bc591f4f2530ce659ea6b5b406c5322ecb5951bbb6bb628e6283f3` |
| `supabase/migrations/20261022062539_google_sheets_import_foundation.sql` (immutable, unchanged) | `fc68da86bfa972148b72302b3bc0daf8d227453b75fdadd6ef8578908d76efed` |
| `supabase/migrations/pending/20261013120100_google_sheets_sync_schedule.sql` (5-minute poll, **unchanged and unapplied**) | `6116f414faf8313b3d09fa2b721eee79ac43d57f16e9de29ef143b92c54f9665` |

**Preimage guard.** The push migration refuses to apply unless `private.google_sheets_finish` has md5
`f1cf66bea7de1d469e2ff03c57f1a414`, the definition shipped by the foundation migration. That md5 was also read back
from production during Phase 0. The rollback restores that exact text and re-checks the md5.

## 2. Database suite — `scripts/run_google_sheets_tests.sh`

Run on **PostgreSQL 17.6** (`postgres:17.6`, as in CI): `ALL GOOGLE SHEETS CHECKS PASSED`, 65 s. Also run on
**PostgreSQL 16.15**: `ALL GOOGLE SHEETS CHECKS PASSED`, 62 s.

| Stage | Result |
|---|---|
| 1. Harness + foundation + push | Applied. Replay guards refuse a second apply. The preimage guard refuses a tampered `finish`. |
| 2. Foundation behaviour suite | T1–T18 PASS. T1 now pins **75 functions (44 private + 31 public)** and their ACLs. |
| 2c. Push behaviour suite (`supabase/tests/google_sheets_push.sql`) | P1–P14 PASS; see the table below. |
| 2b. Historical regressions | PASS. Each case fails on `8b675e5` and passes here. |
| 3 / 4 / 4b / 4c. Existing concurrency tests | PASS, each with its negative control reproducing the race. The 4b/4c negative controls now patch the stacked (push) copy of `finish`. |
| **4e. Target-lease race** | Two workers race for one job: one wins. Control (lease check removed): both run (`2`). |
| **4f. Source-lease race** | Push and Sync now race for one tab: never both. Control: both run (`1 1`). |
| **4g. Mid-run notification** | Processed only to the claim snapshot; the new work stays queued (`dirty`). Control (completion uses `requested_seq`): the update is lost (`2 2 false`). |
| **4h. Lock order** | Receiver vs `watch_result` on one target gives `queued\|stop_failed\|0` deadlocks. Control (target locked first): `DEADLOCK`. A burst of 80 concurrent notifications: 80 queued, `requested_seq` 1 → 81, no lost increment. |
| 4d. Non-destructive shutdown | PASS with the exact ops files. Drain check columns 16–21 (push) are stable; the pg_net column is NULL-or-0 without pg_net. |
| 5. Rollback + re-apply | The push rollback restores the exact `finish` preimage, 52 functions, no push relations and the 3-value CHECK. The foundation rollback then succeeds, and both migrations re-apply. |
| 6. PostgREST role access | 62 checks. Push wrappers are refused for `anon`/`authenticated`. For `service_role`: `push_accept` returns `unknown_channel` and `push_status` returns mode `off`. Private push tables and `push_maintenance_due` return 404. |
| 7. End-to-end Review harness | 40 checks (unchanged foundation flows). |
| **8. End-to-end push harness** (`scripts/google_sheets_push_e2e.ts`) | 37 checks across 12 scenarios; see below. |

**Push SQL suite (P1–P14).**

| Case | What it verifies |
|---|---|
| P1 | ACL and RLS. All push tables are private; 75 functions. |
| P2 | Server-side scope: mode `off`, and `pilot` with its allowlist. |
| P3 | Registration; a `sync` message arriving before the watch response; the resource-id check. |
| P4 | The receiver validation matrix. |
| P5 | Cross-agency isolation. |
| P6 | Claim, push claim and finish. `done` is verified in SQL; a mid-run notification is not lost. |
| P7a | A push claim is bound to its job lease and target. |
| P7b | Sync now and push share the source lease. Push bypasses only the manual cooldown. |
| P8 | Crash recovery, the concurrency cap and per-connection serialization. |
| P9 | Kick rules. |
| P10a | Renewal overlap. |
| P10b | Reconnect generation and maintenance registration. |
| P11a | Pause, remove and disconnect release. |
| P11b | Maintenance hygiene and retention. |
| P12 | `blocked` and `deferred` outcomes; the cron guard. |
| P13 | The guarded foundation changes. |
| P14 | Push imports keep ownership and receipts, with zero duplicates. |

**Push end-to-end scenarios.** The real receiver, processor, maintenance and API hooks run through PostgREST; Google
is faked.
1. Enable registers one watch, and the catch-up imports nothing (baseline).
2. A new row → a notification → exactly one lead, owned by the connection owner.
3. Google redelivers the same message: acknowledged, with no new run and no duplicate.
4. An incomplete row creates nothing; completing it later imports it.
5. Several rows at once → one notification imports all of them.
6. A second tab of the same spreadsheet shares the watch, and one notification covers both tabs.
7. Forged requests are refused and change nothing.
8. Sync now after a push run imports nothing new (receipts).
9. Pause stops monitoring. A row added while paused imports exactly once after Resume (catch-up).
10. Reconnect: the old channel is ignored, maintenance re-registers with a catch-up, and the old channel is stopped.
11. Disconnect stops the channel first; later notifications import nothing.
12. Zero duplicates overall.

Receiver outcomes logged in this run: `queued` 6, `duplicate` 1, `ignored_inactive` 2, `ignored_stale` 1,
`rejected_token` 1, `unknown_channel` 1. Logs carry only `outcome / state / target / ms`. Local accept time was
4–7 ms; that is not a production latency measurement.

## 3. Real pg_cron / pg_net — `scripts/run_google_sheets_cron_check.sh`

Run on `supabase/postgres:17.6.1.063` with `--network none`: `ALL GOOGLE SHEETS CRON CHECKS PASSED`, 200 s.
Steps 1–6 are the foundation checks, unchanged. Steps 7–10 are new:
- **7.** The old 5-minute schedule is pinned byte-identical (`6116f414…9665`) and is not applied.
- **8.** The exact pending push maintenance job:
  - name `google-sheets-push-maintenance-every-minute`, schedule `* * * * *`;
  - posts to `google-sheets-push-maintenance` with the Vault bearer token;
  - guarded by `private.google_sheets_push_maintenance_due()`.
- **9.** With nothing due, the job makes **0 HTTP requests in 70 s**. That proves the schedule is not a poll. With
  mode `on` and a due registration, a request is attempted and fails at the network layer, as expected under
  `--network none`.
- **10.** The unschedule ops file removes the job and is idempotent. Drain-check column 17 (`push_cron_jobs`) is 0.

## 4. Edge (Deno 2.5.6)

- **`deno test --allow-env`** over `_shared/googleSheets/`, `google-sheets-api/`, `google-sheets-oauth-start/`,
  `google-sheets-oauth-callback/`, `google-sheets-sync-worker/`, `google-sheets-push/` and
  `google-sheets-push-maintenance/`: **112 passed, 0 failed** (78 existing + 34 new).
- **`deno check`** of all six entry points: exit 0.
- New unit coverage:
  - header parsing;
  - channel mint and verify: HMAC tag, constant-time compare, key id;
  - watch and stop error mapping;
  - the processor: outcome mapping, busy retries, the dirty loop, stealing;
  - watches: `ensureWatch`, `releaseWatches`, maintenance, kill switch, `invalid_grant` → reconnect;
  - the receiver: method/size/header/HMAC validation and status mapping, with no DB call on a bad tag;
  - maintenance auth: constant-time bearer, 403/405, inert while disabled;
  - API hooks: they never throw, the kill switch makes no calls, and Disconnect is bounded to 5 s.

Local note: this container cannot reach `deno.land`. Local runs used a scratchpad import map to
`jsr:@std/assert@1.0.13` with `--no-lock`; CI uses the committed URLs. `deno.lock` is unchanged.

## 5. Frontend

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| Strict app type-check vs PR base (`A2P_BASE_SHA=27c8d0d…`) | base 80, candidate 80, **new 0** |
| Focused Vitest (the CI list) | **6 files, 99 passed** (Sheets 42, including the new monitoring-status unit and UI tests) |
| ESLint (CI file set) | exit 0 |
| `npm run build` | built |
| Browser harness `verify.mjs` at 1440 and 390 px (Vite, mocked Supabase, fake Picker) | **68 PASS, 0 FAIL**. New: "real-time monitoring line and last successful sync shown" at both widths; no horizontal scroll; no page errors. |

UI copy:
- "Real-time sync active", "Setting up monitoring" and "Monitoring interrupted" appear only for enabled, healthy tabs
  that the server reports in push scope.
- "Checked …" became "Last successful sync …".
- The status query refreshes every 60 s only while real-time monitoring applies.

The Sync-now toasts are unchanged.

## 6. Requirement traceability (Gate A "additional build requirements")

| # | Requirement | Where it is met |
|---|---|---|
| 1 | Notification speed is a go/no-go; validate manual and API writes | Gate E procedure (plan §17.5) and `supabase/ops/google_sheets_push_pilot_evidence.sql`. Not runnable before Gate E. |
| 2 | Never mark processed with unfinished work | `push_complete` checks in SQL; P6; 4g and its negative control |
| 3 | Leases and lock order under concurrency; receipts preserved | 4e / 4f / 4h with negative controls; P7a / P7b / P8; P14; push e2e 3, 8, 12 |
| 4 | Missed-notification recovery without polling | Plan §17.3; maintenance re-registration and recovery (P10b, P11b, e2e 10); event-driven catch-ups (e2e 9) |
| 5 | Webhook constraints from current official docs | Plan §17.4 (discovery document revision 20261020); channel id length 43 ≤ 64; token 43 ≤ 256; expiry ≤ 86 400 s |
| 6 | Latency: row → notification, notification → commit, end-to-end | Event `received_at` / `queued_at` and attempt `oldest_received_at` / `started_at` / `first_commit_at`; `google_sheets_push_metrics.sql` (p50/p95/p99). Row → notification needs the pilot's write timestamps (`google_sheets_push_pilot_evidence.sql`). Measured at Gate E. |
| 7 | Keep the 5-minute schedule unapplied | Cron step 7 pins it; it is not in the migrations directory |
| 8 | Surgical changes; org id, RLS, OAuth, `.maybeSingle()`, Zod, Tailwind, dialer | No RLS policy, OAuth, Gmail/Calendar, dialer, SMS consent, DNC or workflow file changed. No new form, so Zod is unaffected. Tailwind only. |
| 9 | Versioned migrations; no secrets in frontend; no mock data in production paths | One versioned migration plus rollback; the schedule is pending. Secrets only in Edge env and Vault. Mocks only in tests. |
| 10 | Re-read the rules docs; update the plan and file list | Plan §17.6 (including the as-built delta) |

## 7. Not verified here (by design or by environment)

- Real Google delivery:
  - whether `files.watch` accepts the Supabase Functions URL without domain verification (R1);
  - the notification delay for Sheets edits (R2);
  - whether API-written rows notify at all (R3).

  All three are Gate E items.
- Production apply, deploy and secrets (Gate D).
- Live browser acceptance with a real Google account.
- CI on the PR head. It is reported on the PR once the workflows complete.

## 8. Gate C hardening (approved 2026-10-25; plan §18)

**What changed.** These edits are in the unapplied migration only, plus tests, an ops comment, the stop-all ops file
and docs:
- bounded rejection sampling;
- write-free, target-lock-free redeliveries;
- a UNIQUE dedupe index;
- a retention clause in the cron guard;
- a 900 s renewal overlap with delayed stop;
- the seamless-renewal rule (a `stopping` channel is never coverage);
- a bounded late-delivery grace (3600 s, Google-confirmed channels only);
- active-only status.

The function inventory is unchanged at 75. There are no Edge, frontend or CI workflow changes.

| Check | Result |
|---|---|
| `run_google_sheets_tests.sh` on PostgreSQL 17.6 | **ALL GOOGLE SHEETS CHECKS PASSED** (76 s) |
| `run_google_sheets_tests.sh` on PostgreSQL 16.15 | **ALL GOOGLE SHEETS CHECKS PASSED** (75 s) |
| Push SQL suite | P1–P14 (P1, P4, P10 and P12 updated) **plus P15, P16a–d**: all PASS |
| 4i (new): rejections and redeliveries never wait | `20|1|0|0|1`. While another session held the channel and target rows: 20 wrong-token requests were rejected, 1 redelivery returned `duplicate`, 0 lock timeouts and 0 rows were recorded; after release, one sampled row. Negative control (authenticate under `FOR UPDATE`, the Gate B code): **2 lock timeouts**, detected. |
| 4e–4h, 3/4/4b/4c, 4d, rollback, PostgREST (62), Review e2e (40) | unchanged, PASS |
| Push e2e | **43 checks** (was 37). New scenario 10b: the maintenance renewal does not stop the superseded channel; a row notified only on it is imported exactly once; Disconnect stops both channels. |
| `run_google_sheets_cron_check.sh` (real pg_cron / pg_net, `--network none`) | **ALL GOOGLE SHEETS CRON CHECKS PASSED** (231 s). With nothing due: 1 run in 70 s, **0 requests**. |
| Deno: `deno test` | **112 passed** |
| `deno check` | 6 entry points plus `scripts/google_sheets_push_e2e.ts`: exit 0 |
| ESLint, Google Sheets CI set (both e2e scripts included) | exit 0 |
| ESLint, exact Reports command (29 changed `.ts`/`.tsx`) | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| Strict app type-check vs base `27c8d0d` | base 80, candidate 80, **new 0** |
| Focused Vitest (CI list) | 6 files, **99 passed** |
| `npm run build` | built |
| Browser harness `verify.mjs` at 1440 and 390 px | **68 PASS, 0 FAIL** |

**New SQL cases.**

P15, bounded replays:
- 50 redeliveries: 0 rows, 0 jobs, and the target row untouched.
- The UNIQUE index refuses a second authenticated row.
- 50 wrong tokens plus 50 resource mismatches in one minute: 1 sampled row and no job. The next minute adds 1 more.
- Genuine messages reusing the numbers of rejected requests are still queued.
- Unknown and invalid requests write nothing.

P12, retention: an event older than 14 days, or an attempt older than 30 days, makes the guard true, and one pass
deletes it.

P16a, renewal:
- The renewal is seamless and returns no stop item. The old channel is `stopping`/`superseded` with
  `next_stop_at ≈ now + 900 s`.
- Its notification during the overlap is queued (live).
- Maintenance does not stop it during the overlap, and does once the overlap has passed.
- After the stop, a delayed delivery within the grace is queued (`late_delivery`) and its replay is `duplicate`.
- After the grace, `ignored_inactive`.

P16b, acceptance by state:

| Channel | Outcome |
|---|---|
| `failed` | ignored |
| `abandoned` (confirmed or not) | ignored |
| never-confirmed `stopping` / `stopped` | ignored |
| `registering` ≤ 5 min | queued |
| `registering` > 5 min | ignored |
| stopped 10 min ago | queued (grace) |
| stopped 2 h ago | ignored |
| expired 30 min ago | queued (grace) |
| expired 2 h ago | ignored |
| `stopping`, expired 5 min ago | queued (grace) |

Also in P16b:
- A replay inside the grace returns `duplicate`.
- Inside the grace, the wrong token and the wrong resource are still rejected.
- An old generation inside the grace is `ignored_stale`.
- A channel removed by retention is `unknown_channel`.
- With `late_grace_s = 0`, nothing late is accepted.

P16c, interruptions:
- An old channel that would expire inside the overlap triggers a catch-up.
- Stopping-only coverage shows status `interrupted`, and the next registration triggers a catch-up.
- Expiry without renewal leads maintenance to register `recover`, which triggers a catch-up.

P16d, connections: inside the grace, a revoked connection (reconnect required), the old generation after a
reconnect, a paused target, and a disconnected connection are all ignored. The controls at the current generation are
queued.

**Residual risk.** A notification Google holds longer than the 900 s overlap and then discards because the channel was
stopped, or delivers more than 3600 s after the channel ended. Both windows are configurable without a migration.
Gate E/F measures the real delay.

## 9. Gate D release preparation (2026-10-25; read-only; nothing executed)

**Scope.**
- The release tooling commit only:
  - `.github/workflows/google-sheets-push-release.yml` (protected runner) and `…-release-check.yml` (its synthetic
    CI);
  - `scripts/tests/google_sheets_push_release_runner.py`;
  - `supabase/ops/google_sheets_push_release_{preflight,verify}.sql`;
  - docs.
- `git diff 24fa809 HEAD -- supabase/migrations supabase/functions src` is **empty**, so the release content is
  exactly the Gate C head. Package and fingerprints: `release-package.md`.

**Production reads** (connector, read-only, 2026-10-25 15:08–15:12 UTC):
- the preflight returned every `*_ok` true;
- the baseline is in `release-package.md` §2;
- the live `google-sheets-api` v6 is byte-identical to `main` `27c8d0d`;
- the platform logs hold no `x_goog_*` key (§7 log check `0|0` over 37,767 rows).

No write, deploy, secret, schedule or watch.

| Check (this head) | Result |
|---|---|
| `run_google_sheets_tests.sh`, PostgreSQL 17.6 | **ALL GOOGLE SHEETS CHECKS PASSED** (74 s) |
| `run_google_sheets_tests.sh`, PostgreSQL 16.15 | **ALL GOOGLE SHEETS CHECKS PASSED** (69 s) |
| What those runs include | PostgREST 62, Review e2e 40, push e2e 43 |
| `run_google_sheets_cron_check.sh` | **ALL GOOGLE SHEETS CRON CHECKS PASSED**: `cron_jobs=0`; 1 run in 70 s, **0 requests** |
| `google_sheets_push_release_runner.py` (PostgreSQL 17.6, CLI 2.121.0) | **ALL PUSH RELEASE RUNNER CHECKS PASSED** (31 s); details in `release-package.md` §8 |
| Migration replay and rollback (inside the runner test) | apply, then history, then replay refused, then rollback; preimage `6640fc30…`, `finish` `f1cf66be…`, data fingerprint unchanged; lock-timeout and watchdog paths roll back |
| `deno test` (7 directories) | **112 passed** |
| `deno check` (6 entry points plus push e2e) | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| Strict type-check vs `27c8d0d` | base 80 = candidate 80, **new 0** |
| Focused Vitest | 6 files, **99 passed** |
| ESLint (Sheets CI set; Reports command on the 29 changed `.ts`/`.tsx`) | exit 0 |
| `npm run build` | built |
| `git diff --check` | clean |
| Polling audit | no Sheets `cron.schedule` outside `pending/`; UI refreshes read AgentFlow only, and the status refresh is off while mode is `off` |

**Local environment notes.**
- Only `deno test` was affected, and the code under test is the same.
- This container's proxy refuses `deno.land`. Locally, the one std import
  (`https://deno.land/std@0.190.0/testing/asserts.ts`) was mapped to `jsr:@std/assert@1.0.13` with `--import-map`
  and `--no-lock`.
- CI resolves the original import.

## 10. Approval D runner fix (2026-10-25; after run 40234513215; nothing executed)

Runner and tests only. `git diff 0e5b957 HEAD -- supabase src` is empty, and the release content `24fa809` is
unchanged. Local runs used Docker `postgres:17.6`, Supabase CLI 2.121.0 (`@supabase/cli-linux-x64`), psql 16.15 and
Deno 2.5.6.

| Check (this head) | Result |
|---|---|
| `google_sheets_push_release_runner.py` (PostgreSQL 17.6, CLI 2.121.0) | **ALL PUSH RELEASE RUNNER CHECKS PASSED** (41 s); 4 of 4 runs (different hash seeds) |
| Workflow YAML and embedded program | `yaml.safe_load`, `ast.parse` and `py_compile` OK; nine dispatchable stages |
| `run_google_sheets_tests.sh`, PostgreSQL 17.6 | **ALL GOOGLE SHEETS CHECKS PASSED**: PostgREST 62, Review e2e 40, push e2e 43 |
| Focused Vitest | 6 files, **99 passed** |
| `npx tsc --noEmit` | exit 0 |
| ESLint (Google Sheets CI set) | exit 0. The Reports command lints changed `src/` files; there are none. |
| `npm run build` | built |
| `git diff --check` | clean |

**What the runner test now covers.**
- **Stage machine** (all mutators patched, so a refusal calls none and an accepted stage calls exactly its one
  mutator):
  - 24 migration-order refusals;
  - 67 out-of-order refusals;
  - 8 inconsistent-state refusals: kill switch, half-deployed functions, secrets or Vault before deployment;
    `recover-secrets` with the kill switch present;
  - `check` passes `deployed` and `configured`, and repeats identically;
  - `check` names each of the 6 partial shapes (`STATE: partial (…)`) and stops after every read-back;
  - `configure-secrets` only from `deployed`; `recover-secrets` only from `partial`; `rollback-secrets` from
    `configured` or `partial`.
- **`management()`** is the real function over a fake opener. 29 outcomes each map to their exact sanitized label:
  - 201 and 200;
  - 202/204 → `unexpected success status; write outcome unknown`;
  - DELETE 200/204/202;
  - GET 200, a GET HTML body, a GET 204 and a GET 403;
  - 400, 422, 401, 403 (json, html, DELETE), 404, 409, 429, 500, 503, 418 and 302;
  - `TimeoutError`, `URLError(timeout)`, `URLError`, `ConnectionResetError`, `RemoteDisconnected`.

  A sentinel placed in every body, reason, URL and exception never reaches the log or the error. The `User-Agent`
  and the 30 s timeout are asserted. A non-list inventory is refused.
- **Redirect guard** against a real loopback server: `NoRedirect` refuses a 302 on POST. Negative control: default
  urllib replays it as a GET and reports 200.
- **Real synthetic database and real Vault stand-in:**
  - 10 `configure-secrets` failures (403 json/html, 400, 401, 409, 429, 500, timeout, network, 202) each print the
    label and `SECRETS AFTER FAILURE: … =absent … vault=absent`, write no Vault row, and pass `operations_gate`;
  - an unreadable read-back prints `unknown`;
  - success: two 64-char values, 2 masks, never printed, Vault hash equal to the token;
  - `rollback-secrets`: from `configured`; from one secret plus Vault (deletes only that name); from Vault alone (no
    API call); a refused DELETE leaves the set intact and reports it;
  - a write that stored one secret and then failed reads back as `partial`;
  - `recover-secrets` replaces every copy: from KEY only, and from TOKEN only with a stale Vault row;
  - inside recovery, three failures each leave `partial` with Vault absent, never three mismatched names: a Vault
    failure after the Edge write, a silent no-op 201 (digest unchanged), and a refused write with a stale Vault row;
  - recover, then rollback, repeat cleanly;
  - every write carries only the two push names, never the kill switch;
  - a value appears in psql stdin only as a `\bind` argument.
- **Negative controls**, each a separate mutated copy of the runner; all fail the suite:
  - leaking the HTTP reason → `server or network text reached the log`;
  - a literal token in SQL → `a value in SQL statement text`;
  - following redirects → `management() must refuse redirects`;
  - no failure read-back;
  - writing Vault before the Edge check;
  - classifying both Edge names without Vault as `configured`.

**Not verified here.** These need production:
- a real Management API response;
- whether the platform digest is SHA-256 of the value (the runner prints an `INFO` line and never gates on it);
- the scoped token's permissions.
