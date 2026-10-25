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
| `supabase/migrations/20261025120000_google_sheets_push_sync.sql` (new; version provisional, re-stamped at Gate D) | `8a7cf14fdbe7ea5f495f45570644efcb3de62971378892a485475e26e75718b7` |
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
