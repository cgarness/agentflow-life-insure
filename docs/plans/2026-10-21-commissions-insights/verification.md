# Commissions insights — verification (local build and disposable databases only)

Approval: local implementation and disposable tests (task prompt, 2026-10-21). No production read beyond the read-only
hosted migration list, no production write, migration, policy, merge or deployment. Synthetic data only.

## 1. Hosted history and immutability

- Read-only `list_migrations` (2026-10-21): hosted head `20261020212000 / policy_commission_center_reads`. The new
  version `20261021180000` sorts after it and after every repository migration. Re-check immediately before Gate 2.
- Applied migrations `20261019170000`, `20261020040000`, `20261020212000` are byte-identical to `main` (`git diff
  origin/main` empty for all three; `20261020212000` SHA-256 `5bc2eb14…bd3e08`).

| File | SHA-256 | MD5 | Bytes |
|---|---|---|---|
| `supabase/migrations/20261021180000_policy_commission_center_insights.sql` | `d390cc8e267a86fdc829da3a514d184b74f6d270d4199af1d57f2c9e465b3345` | `428020c9b8264e85dc9fcff992c426de` | 34,179 |
| `supabase/migrations/rollback/20261021180000_policy_commission_center_insights.rollback.sql` | `215e5fa055dfe2be7955a22a4f80bf519b185efcfbe9479fcd08df3e2c585082` | `fb85894e849582c7611d71bf76de6ed9` | 1,966 |

Preimage digests the migration requires (computed on a disposable database after the three applied migrations):
`actor_org()` `29be135f…`, `access(uuid)` `a6da4418…`, `viewer()` `b6cfc70b…`, `period(…)` `bc927319…`,
`installments(…)` `b661f4fd…`, `policies(…)` `58e2a95c…`, `contact_json(…)` `d7121baa…`, `iso_or_null(text)` `4425715c…`.

## 2. Database — disposable PostgreSQL 16.15 (loopback cluster) + PostgREST 12.2.3

`PGURL=postgres://postgres@127.0.0.1:55432 POSTGREST_BIN=<pinned 12.2.3, digest-verified> PC_MEASURE=1 bash
scripts/run_policy_commission_tests.sh` → exit 0. The cluster runs as the `postgres` OS user in `/tmp/pc_cluster_55432`
(the server refuses to run as root and the session scratchpad is root-only).

| Step | Result |
|---|---|
| Released Phase 2A, expected-windows and center steps | unchanged; all PASS (173 existing objects unchanged) |
| Insights guards | refuses without `20261020212000`; refuses a drifted reused definition (`viewer()`), nothing created; refuses replay |
| Inventory | no existing object changed (177 existing objects); added exactly 6 public functions, the goals table and its key |
| New suite `policy_commission_insights.sql` | 8 sections PASS (below) |
| Released center suite on the final state | all 10 sections PASS (its reads and helpers unchanged) |
| Rollback | refuses while a goal exists; otherwise restores both inventories exactly, keeps every commission record, refuses replay; reapply works |
| PostgREST (new) | 9 HTTP checks PASS; released center (9) and Phase 2A (13) HTTP checks still PASS |

New suite (synthetic March 2026 cohort compared with February; Months 10–12 relative to the agency date):
- **Cohort, carriers, products** equal hand-computed values: 11 policies (with or without estimates), 5 active estimates
  counted once (a replaced estimate never doubled), 1 held disclosed, 5 without, 1 open capture, 1 undated; carriers
  grouped by case and surrounding spaces (`SYNTHETIC LIFE ` joins `Synthetic Life`; `Synthetic` matches nothing);
  a restricted contact without an estimate is Unknown; Final Expense on a whole-life grid product is Final Expense,
  never Whole Life; a blank sale type falls back to the visible client's type only; groups add up to the totals.
- **Drill-downs**: every carrier bar (Policies/Est.), every Received bar and every product slice equals its list's
  totals and rows walked page by page (page size 2, no duplicates); filters compose with Show; without a period the
  list is identical to the released Policies list (undated included); History without a carrier equals the released
  receipt list.
- **Received** follows `received_on` (a February sale paid in March counts in March; a held estimate's receipt counts;
  voids excluded) and equals the Received card; month boundaries (Mar 31 / Apr 1).
- **Comparison windows** (pure helper): month to date (also on the 1st), last day of the month, Mar 30 → Feb 28 and leap
  Feb 29, year to date on a leap day, completed month/year/quarter, custom ended/in progress, one day, future month and
  future custom (none); March vs February figures; zero baselines return zeros (no ratio on the server).
- **Months 10–12** equals an independent recomputation and the Scheduled list (Next month · Remaining · Months 10–12),
  including a partly paid Month 10, a Month 11 after an Advance overpayment, and excluding held and Advance payments.
- **Goals**: none until set; set/edit one month leaves others; clear explicit and idempotent; validation (22023) and
  server constraints (23514); direct table writes for another owner/organization refused by RLS, month/owner column
  updates refused by grants; owner isolation (Ben, Admin, Team Leader, other agency, Agency Group peer see nothing);
  overachievement; a void lowers the month's Received in the card and breakdown alike.
- **Permissions**: Own toggle off → 42501 for all six functions and goal rows unreadable; no signed-in actor → 42501;
  anon and service_role cannot execute or read goals; unset time zone → 55000; invalid input → 22023.
- **Reads never write**: the four reads assign no transaction id and change no table counters; reading a month creates
  no goal row.
- **Catalog**: SECURITY INVOKER, owner `postgres`, pinned `search_path`, volatility as declared, EXECUTE `authenticated`
  only; insights schema USAGE `authenticated` only; goals table RLS on with one owner policy and the stated grants.

HTTP median (small synthetic book, warm, sequential): breakdown 16.0 ms, policy list 16.2 ms, receipt list 14.8 ms,
goal 12.4 ms. Server-side timings over a 500-policy synthetic book: §4.

Supabase advisors were not run: no hosted database change is approved here. Run them before and after Gate 2.

## 3. Frontend — baseline `e762454` (separate worktree) vs branch

| Check | `main` `e762454` | Branch |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | exit 0 |
| App typecheck (`tsc -p tsconfig.app.json`) | 84 diagnostics | the same 84 lines (none in changed files) |
| Full Vitest, inert Supabase env | 388 files, 6,026 tests; 1 failed (`recordingRetentionVoicemail` v29) | 395 files, 6,074 tests; the same 1 failed (48 new tests) |
| CI frontend set (workflow list + new page test) | — | 72 files (2 skipped), 653 passed, 7 skipped, 0 failed |
| ESLint (changed and new `.ts`/`.tsx`/`.mjs`, generated types excluded) | — | clean |
| `vite build` | — | exit 0 (existing chunk-size notice only) |
| `git diff --check` | — | clean |

New and updated tests (48 new): `insights` (6), `amountsPreference` (4), `centerInsights` (6), `breakdowns` (10),
`goal` (5), `commissionsHideAmounts` (4), `hideAmountsDialogs` (6), `useCommissionsCenter` (+2), `lists` (+3),
`commissionsPage` (+2); `overview`, `filterConsistency`, `lists`, `commissionsPage` updated for the new list reads.

## 4. Server-side timings (500-policy synthetic book, PostgreSQL 16.15, p50 / p95 ms)

Same runner step as the released center (`measure_center_reads.sh`, 20 samples after one warm-up, as the seller under
RLS; 500 policies with estimates, 2,000 installments, 166 receipts, plus 50 without an estimate). Observations, not
guarantees.

| Read | p50 | p95 | max |
|---|---|---|---|
| overview (this month) — released, for comparison | 84.0 | 95.5 | 109.6 |
| breakdown (this month) | 91.8 | 109.0 | 121.4 |
| breakdown (two years) | 104.0 | 118.3 | 119.2 |
| policy list (sold this year, one carrier) | 47.5 | 52.4 | 54.3 |
| receipt list (one carrier) | 27.8 | 40.5 | 46.2 |
| goal | 7.1 | 9.6 | 11.8 |

The breakdown costs about the same as the released Overview read: both walk every eligible policy under the existing
RLS `access()` check (the dominant cost recorded for the released reads). The Overview tab issues both reads in
parallel; the goal read only for a single-month period.

## 5. Browser (uncommitted Vite harness: real page and components, stubbed auth and RPCs, synthetic fixtures)

Chromium (playwright-core, pre-installed browser) at 1440 px and 390 px, light and dark; no horizontal scroll at 390 px.
Keyboard only: Tab reaches the eye control (Enter hides and shows) and each carrier bar (Enter opens
`/commissions/policies?period=this_month&carrier=Harbor+Mutual`). Screenshots in `screenshots/`: Overview (both
widths and themes), View all with details, Received bars and the Est. commission doughnut, Policies drill-downs (carrier,
type), History by carrier and Unknown carrier, goal editor, and Hide amounts on Overview, Payments, the drawer, the
Record payment dialog and the Calculator.

## 6. Limitations

- Not run against the hosted database; Gate 2 must re-check hosted history, run advisors and verify the preimage
  digests on production before applying.
- PostgreSQL 17.6 and the CI job run only on the PR's CI; local evidence is 16.15.
- Screenshots use stubbed RPC responses (synthetic fixtures), not a live database.
- Hide amounts is a display preference; amounts still reach the authorized browser.
