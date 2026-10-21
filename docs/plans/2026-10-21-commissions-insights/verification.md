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
  server constraints (23514); an owner's own direct table writes work within the policy, grants and checks (a direct
  insert reaches the CHECK constraints; a direct delete removes only the caller's row), while direct writes for another
  owner/organization are refused by RLS and month/owner column updates by grants (the app itself uses the functions); owner isolation (Ben, Admin, Team Leader, other agency, Agency Group peer see nothing);
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

## 7. Gate 2 — database-only release: preparation, rehearsal and production preflight (2026-10-21)

**Approval and source.** Chris approved Gate 2 only for source `0aebd014002341a92e04cba65fd1ffce6a68a1c9`, migration
`20261021180000_policy_commission_center_insights.sql`, SHA-256 `d390cc8e267a86fdc829da3a514d184b74f6d270d4199af1d57f2c9e465b3345`,
34,179 bytes. Recomputed from `git show 0aebd01:<file>`: SHA-256 as approved, MD5 `428020c9b8264e85dc9fcff992c426de`,
34,179 bytes; the working-tree file is byte-identical. Method: plan §11. PR #474 stays draft; PR #473 untouched.

**Result: preflight passed; NOT applied.** This cloud session has no execution route that Chris's approval and
AGENT_RULES allow: no signed-in Supabase SQL Editor (no browser on Chris's computer and no browser-takeover tool here)
and no authorized direct database connection (no credentials). Supabase MCP `execute_sql` is the read-only audit tool
(AGENT_RULES §11) and was used only for SELECTs; `apply_migration` would stamp its own version. Nothing was written to
production: no history row, schema, table, policy, grant, function or commission row.

**Apply package (ready, unexecuted).** `python3 docs/plans/2026-10-21-commissions-insights/release/build_apply.py`
→ 37,157 ASCII bytes, SHA-256 `3cee7e7c047d620e74fe2f09adb8dc17d97e43fbd1557ebd4ac46028880b3778` (deterministic; two
runs identical). It embeds the file with five non-ASCII characters as placeholders (§ U+00A7, – U+2013, → U+2192,
≤ U+2264, ─ U+2500) expanded server-side, then refuses unless the expanded text is 34,179 bytes with the approved MD5
and SHA-256. The wrapper and embedded-migration checksums differ by design.

**Rehearsal (disposable PostgreSQL 16.15, loopback).** The released fixture and the three applied migrations,
hosted-style history (`schema_migrations` with production's columns; the three prerequisites with their exact text;
`20261020192723` before the head), production's default privileges for `postgres` in `public` (tables, functions,
sequences to `postgres`, `anon`, `authenticated`, `service_role`; read from production), and a synthetic book seeded by
the released center suite (captures 12, estimates 12, events 23, handoffs 13, installments 48, receipts 8).

| Step | Result |
|---|---|
| Preflight before apply | 20/20 `t` |
| Open `ROW EXCLUSIVE` writer on `organizations` | refused after 1.04 s (lock timeout); nothing created, no history row |
| One changed byte in the sent text | refused by the hash check ("release text differs…") |
| A later version recorded | refused ("would not sort last"); the disposable row removed afterwards |
| A superuser other than `postgres` | refused ("apply as postgres") |
| Apply (one request) | 0.055 s; history `20261021180000 / policy_commission_center_insights`, one statement, MD5 `428020c9…`, SHA-256 `d390cc8e…`, 34,179 bytes |
| Read-back | 24/24 `t` (history, recorded last, prerequisites, goal table, columns, constraints, single owner policy, grants, no goal rows, schema, 12 exact bodies, invoker/owner/`search_path`/volatility, EXECUTE `authenticated` only, 8 preimages, RLS, not published) |
| Catalog (16 categories) | every existing object identical; added exactly schemas 1, relations 2, columns 6, constraints 4, indexes 1, functions 12, policies 1, types 2 |
| Six-table fingerprints | identical before and after (counts, full-row MD5, write counters) |
| Replay | refused by the wrapper (version recorded) and by the file's own guard ("already applied; refusing replay"); preflight then fails 3 checks as designed |
| Rollback | schema dump (owners, ACLs) equal to the pre-apply dump; catalog and rows unchanged |
| Reapply (disposable history row removed) | schema dump equal to the first apply |
| Reference `psql -1 -f` on a fresh copy | schema dump equal to the wrapper-applied one (10,427 lines) |
| Insights suite on a wrapper-applied copy with production's default privileges | all 8 sections PASS (including the exact-grant catalog checks) |

**Production, read-only (2026-10-21 ~04:50 UTC, `execute_sql` SELECTs and `get_advisors` only).**
- History: `list_migrations` head `20261020212000 / policy_commission_center_reads`; `20261021180000` not recorded.
- Session: `postgres`, PostgreSQL 17.6, TimeZone UTC. Publications `supabase_realtime` and
  `supabase_realtime_messages_publication` are not FOR ALL TABLES, so the new table would not be published. Six event
  triggers (pgrst DDL/drop watch; graphql, cron and net access helpers) do not act on this migration's objects.
- `release/preflight.sql`: **20/20 `t`** — server 17.6; three prerequisites recorded with unchanged stored text
  (`b3e4d53f…`, `10897ad6…`, `5bc2eb14…`); nothing at or after `20261021180000`; prerequisite objects present; insights
  schema, goal table and the six public functions absent; **all eight preimage fingerprints equal the reviewed digests**
  (`actor_org` `29be135f…`, `access` `a6da4418…`, `viewer` `b6cfc70b…`, `period` `bc927319…`, `installments`
  `b661f4fd…`, `policies` `58e2a95c…`, `contact_json` `d7121baa…`, `iso_or_null` `4425715c…`); RLS on the six
  commission tables; no publication for all tables; no lock waits.
- Six-table fingerprints (UTC, 04:50:53) — identical to the 2026-10-20 Gate 2 record, so no commission row was written
  since:

  | Table | Rows | Full-row content MD5 | Insert / update / delete |
  |---|---:|---|---|
  | `policy_commission_captures` | 1 | `348550cceac10ab5a980b367160fca25` | 1 / 1 / 0 |
  | `policy_commission_estimates` | 9 | `c3cddcc4d44342dd156e06f089c42935` | 9 / 0 / 0 |
  | `policy_commission_events` | 9 | `87024261631f70cb26a057a389103b93` | 9 / 0 / 0 |
  | `policy_commission_handoffs` | 2 | `9e38319f812467a0118080826ba5c1e0` | 2 / 0 / 0 |
  | `policy_commission_installments` | 36 | `827c12507ddb415fc128de6bf98e1543` | 36 / 0 / 0 |
  | `policy_commission_receipts` | 0 | `d41d8cd98f00b204e9800998ecf8427e` | 0 / 0 / 0 |

- Catalog baseline (`release/catalog.sql`; `n_all` = `n_existing`, nothing of this migration present):

  | Category | Objects | Digest |
  |---|---:|---|
  | columns | 4,474 | `2d799d008a38b6aa07a6f07b267ffc06` |
  | constraints | 1,019 | `4be6a5936b7e2612bbba1763e8b21387` |
  | default_acls | 27 | `6a451785b4d138cfe00b732c8daf282f` |
  | event_triggers | 6 | `d2c0bfc4161f02490033a5ca422a9175` |
  | extensions | 10 | `e4ff5635f74a2998aa11b007639272db` |
  | functions | 3,958 | `b132b91aaa43a0fdb6f609c8a2a1a272` |
  | indexes | 1,029 | `d56f52788cd6576cde16f199b4cf3cf5` |
  | memberships | 26 | `9102e3c468663eb2e5303c36c6276064` |
  | policies | 376 | `e517a5b0d998fedf0c8bb77f1493f306` |
  | publication_tables | 16 | `96931c8f246c3cf205c2c987d8e1c173` |
  | publications | 2 | `9584c331d02d244d51005e787507120c` |
  | relations | 1,678 | `73e1fb9bbc45fcf793981cfef7157812` |
  | roles | 34 | `ecedfab3a470929e5a00d638426753ba` |
  | schemas | 20 | `6b7645e8628ad725328311f32248fb11` |
  | triggers | 150 | `ff5c408e47e40085153b581a053d1fb6` |
  | types | 1,075 | `d1abad017ca6b72641bb2fb9a576376c` |

- Advisors baseline: **security 253** findings (ERROR `rls_disabled_in_public` 2; INFO `rls_enabled_no_policy` 30;
  WARN `anon_security_definer_function_executable` 57, `authenticated_security_definer_function_executable` 138,
  `function_search_path_mutable` 22, `extension_in_public` 3, `auth_leaked_password_protection` 1) — the same total as
  after 2026-10-20's Gate 2; none concerns this migration. **Performance 452** (INFO `unused_index` 141,
  `unindexed_foreign_keys` 81, `table_bloat` 1, `auth_db_connections_absolute` 1; WARN `auth_rls_initplan` 112,
  `multiple_permissive_policies` 110, `duplicate_index` 6); 453 after 2026-10-20's release, one fewer now from
  ordinary usage. Expected delta after this apply: none (the functions are SECURITY INVOKER with a pinned
  `search_path`; the table has one policy with `(SELECT auth.uid())`; its foreign key leads its primary key; the
  primary key is not an `unused_index` candidate) — any change must be explained before Gate 3.

**To finish Gate 2** (the approval stands; the bytes and package are unchanged): from a route Chris authorizes —
the project's SQL Editor in a browser on his computer (for example a Claude Desktop or `claude remote-control`
session, signed in by Chris), or running the package himself — (1) re-run the preflight, fingerprints and catalog
immediately before; (2) regenerate the package with `build_apply.py` and confirm SHA-256 `3cee7e7c…3778`; (3) submit it
once, unchanged, as one request as `postgres`; (4) run `release/readback.sql` (24/24), `release/catalog.sql` (every
`n_existing`/digest equal to the table above; additions exactly as rehearsed), the fingerprints (equal to the table
above unless a real user wrote commission rows in between, which must be explained) and both advisors. Gate 3 stays
separately gated.
