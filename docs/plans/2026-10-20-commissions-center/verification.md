# Commissions center — verification (Gate 2 applied; Gate 3 pending, 2026-10-20)

**Current release status:** migration `20261020212000` applied once to production under Chris's explicit database-only
approval; verification and signed-in read-only preview checks passed (§15). PR #471 remains draft. Merge and frontend
release are not approved. Sections 1–14 retain the earlier local-build and rehearsal evidence; their "not applied"
statements describe those earlier checkpoints.

Branch `claude/epic-tesla-fe96b0` from `main` `0312520` (`main` `381bebb` merged in). The migration was proposed as
`20261020180000` until §14 and renamed byte-identically. Public evidence omits customer details and compensation values.

## 1. Environments

| Where | What |
|---|---|
| Local disposable cluster | PostgreSQL 16.15 (Ubuntu), TCP only, data directory outside the repo; PostgREST 12.2.3 (release tarball, SHA-256 checked) |
| CI (`policy-commission-tracking.yml`) | PostgreSQL 17.6 service container + PostgREST 12.2.3 (pinned digest), Node 22.16.0 |
| Frontend | Node 22, Vitest, `tsc`, ESLint, `vite build`; baseline = `main` `0312520` in the same container |
| Browser | Chromium via playwright-core 1.56.1 against an uncommitted visual harness (§7) |

## 2. Database proofs — `scripts/run_policy_commission_tests.sh` (final migration, PostgreSQL 16.15)

Exit 0. Every Phase 2A suite still passes with the new migration applied, then:

```
PASS commissions center guards and inventory (5 reads, 2 indexes, 173 existing objects unchanged)
 PASS commissions center scenario built
 PASS overview cards, timeline, review and setup reconcile
 PASS statuses, excess, voids, holds, superseded, month timing, unknown dates, non-monthly and zero rates
 PASS card drill-downs reconcile across pagination; filters
 PASS policies list, setup state and completeness
 PASS drawer parity
 PASS reassignment: seller keeps financial history, contact restricted, assignee sees nothing
 PASS same-org admin and team leader, cross-org and Agency Group peer see only their own
 PASS permissions, sign-in, time zone and validation
 PASS commissions center reads
PASS commissions center rollback: exact restore, records kept, replay refusal and reapply
PASS commissions center PostgREST integration (9 checks)
PASS policy commission tracking database proofs
```

- **Guards** (section 1c): the migration refuses without the Phase 2A columns (`expected_until`, `schedule_assumed`),
  refuses replay, and refuses when any of the four md5 preimages (`actor_org()`, `access(uuid)`, `campaign_actor()`,
  `get_client_policy_commissions(uuid)`) has drifted (proved by editing `access()` first).
- **Inventory**: the catalog diff before/after is exactly the five public reads, the helper schema with its functions
  and two types, and the two indexes; the 173 existing commission/sale objects are unchanged (bodies, ACLs, settings).
- **ACLs** (suite, catalog section): every new function has EXECUTE for `authenticated` only (PUBLIC, `anon`,
  `service_role` revoked); the helper schema grants USAGE to `authenticated` only and is not exposed by PostgREST.
- **Reads write nothing**: in one transaction, the per-table insert/update/delete counters are unchanged after every
  read and no transaction id is assigned.
- **Scenario** (synthetic): Alpha (Advance overpaid, excess $70.25), Beta (past window, Check payment), Gamma (held
  with a receipt), Delta (no effective date), Epsilon (quarterly), Zeta (void + replacement, and a void), Eta
  (superseded then replaced), Kappa (window 2031-01-30 → 2031-02-01, crossing a month), Lambda (month timing), Omicron
  (zero rate), Theta (no estimate), Iota (open capture, needs review), Mu (another seller's policy).

## 3. Metric definitions and drill-down evidence

Definitions are the contract in `implementation_plan.md` §4. `cc_expect` in the suite is an independent
recomputation straight from the tables; `cc_walk` pages through a list (page sizes 1–4) and checks every row once.

| Metric | Definition | Opens | Evidence (suite unless noted) |
|---|---|---|---|
| Expected | Σ expected cents of non-held, dated current installments whose window starts in the period | Payments › Scheduled, period | equals `cc_expect` for this month and a two-year range; walked list: count, distinct ids, `total_count`, Σ rows and footer totals all equal the card |
| Received | Σ non-voided receipts with `received_on` in the period (held estimates included) | Payments › History, period | walked History: Σ and count equal the card (four valid receipts: two Alpha, one Gamma, one Zeta replacement) |
| Remaining | Σ max(expected − all valid receipts, 0) over the Expected cohort | Payments › Scheduled, status Remaining | walked list Σ remaining and footer equal the card; asserted ≠ Expected − Received (held receipts, excess and out-of-period receipts) |
| Next 90 days | Σ remaining of non-held dated installments with remaining > 0, `window_end ≥ today`, `window_start ≤ today + 89` | Payments › Scheduled, Next 90 days | equals `cc_expect`; identical for this month, a two-year range and last year (period-independent); walked list Σ and count equal |
| Excess / On hold notes | Σ max(received − expected, 0) over the cohort; Σ expected of held installments in the period | — / Scheduled › On hold | excess 7025 cents (Alpha); Advance excess never settles Months 10–12; held total equals `cc_expect` |
| Timeline | months covering the period, padded to 12; in-period buckets clipped to the period | the month's Scheduled / History | in-period buckets sum exactly to Expected and Received; one-month period = 5 before + 6 after; month-crossing window counted once (Jan 2031: 42975; Feb: 0; Jan–Feb: 42975) |
| Check payment | past window (`window_end < today`), remaining > 0, not held | Scheduled, any date, Check payment | count equals `cc_expect` and the filtered list's `total_count` |
| Date needed | non-held, no stored timing, remaining > 0 | Scheduled, any date, Date needed | 7 (four Delta + three Epsilon Months 10–12); list `total_count` 7 |
| Needs review | open captures on policies without a current estimate | Policies › Needs review | 1 (Iota) |
| Estimates set up | eligible policies with a current estimate / eligible policies | Policies › Missing | 10 of 12 (Mu, another seller's, excluded) |
| Upcoming | first 5 of the Next 90 days rows by date, with the full count | Scheduled, Next 90 days | `total_count` equals the Next 90 days count; rows in date order |

Status and arithmetic proofs: overpaid Advance → Received with excess; past unpaid → Check payment, future → Upcoming;
voided receipts excluded and the replacement counted once; held rows excluded from "All" and listed under On hold;
unknown dates → Date needed; quarterly → only the Advance has a window; month timing is not past until the month ends;
zero rate → real $0.00 rows with status `none`; superseded estimates never listed; another seller's rows never appear;
36 rows = nine current non-held estimates × four installments. Filters: payment type, carrier (trimmed,
case-insensitive), status. History keeps voids with reasons, correction links both ways and superseded estimates;
free-text references are not listed.

Access proofs: the seller keeps financial history after the client is reassigned (contact shows Restricted contact;
the new assignee sees nothing); a same-org admin and team leader, another organization and an Agency Group peer each
see only their own (empty) report; without own access `42501`; unset agency time zone `55000`; invalid input `22023`
with a human message; the drawer read equals `get_client_policy_commissions` for a visible client and is `PT404` for
another seller's or an unknown policy.

Frontend drill-down evidence (`src/components/commissions/__tests__/overview.test.tsx`, `lists.test.tsx`): each card
links to its exact list URL; the timeline month readout links to that month's Scheduled and History ranges; Needs
review links only non-zero items; list footers show totals over the whole filter ("60 payments … Remaining $605.14"
with "1–25 of 60"); pages and filters live in the URL; Payments › History switching keeps the period and drops
view-only filters.

## 4. Real PostgREST + supabase-js (`commission_center_postgrest.mjs`)

Nine checks over HTTP: `anon` and `service_role` cannot call any read (401/403, 42501); records seeded only through
the existing Phase 2A companions; Overview returns the agency date, cards, review and setup for the signed-in seller
only; Scheduled, History and Policies pages with totals over the whole filter; drawer equals the contact read and is
404 PT404 for another seller or an unknown policy; invalid input is 400 22023; the helper schema is not exposed;
403 42501 without own access and 55000 for an unset zone; reads write nothing.

HTTP median of 15, small synthetic book, warm (PostgreSQL 16.15): overview 19.5 ms, installments 24.8 ms, receipts
20.4 ms, policies 16.6 ms, drawer 16.2 ms.

## 5. Read timings (`measure_center_reads.sh`, synthetic book)

Final migration, PostgreSQL 16.15, 4 vCPU container, warm, sequential, server-side execution time. Book: one seller
with 2,000 policies with estimates, 8,000 installments and 666 receipts (first premium dates spread over about two
years); `PC_MEASURE=1 PC_CENTER_POLICIES=2000`. Twenty samples each:

| Read | p50 ms | p95 ms | max ms |
|---|---|---|---|
| Overview (this month) | 448.6 | 535.5 | 540.7 |
| Overview (two years) | 468.9 | 536.6 | 585.5 |
| Scheduled page (period) | 415.1 | 462.4 | 493.7 |
| Scheduled page (any date, last page) | 375.6 | 425.4 | 450.2 |
| History page | 81.6 | 92.4 | 92.8 |
| Policies page | 121.3 | 142.9 | 167.0 |
| Policies (missing) | 106.4 | 166.5 | 192.0 |
| Drawer | 13.0 | 20.6 | 21.6 |

CI runs the same script on PostgreSQL 17.6 with the default 500-policy book (PR body). Phase 2A save overhead in the
same run is unchanged in shape (convert 25 policies: companion p50 74.3 ms vs writer 6.6 ms).

Read cost is dominated by the existing RLS check `policy_commission_authz.access()` (about 23 µs per row), which the
reads deliberately keep. The plan-caching finding (a PL/pgSQL helper fell back to a 2.7 s generic plan after five
calls) is why the shared helper is SQL-language (`implementation_plan.md` §11).

## 6. Frontend — baseline `0312520` vs branch

| Check | `main` `0312520` | Branch |
|---|---|---|
| Full Vitest, inert Supabase env | 380 files, 5,967 tests; 1 failed (`recordingRetentionVoicemail` v29 byte check) | 387 files, 6,010 tests; the same 1 failed |
| Full Vitest, no env | 10 files failed (module-load `supabaseUrl is required`), 1 test failed | the same 10 files, the same 1 test |
| App typecheck (`tsc -p tsconfig.app.json`) | 84 diagnostics | the same 84 lines |
| `npx tsc --noEmit` | exit 0 | exit 0 |
| ESLint (changed `.ts`/`.tsx`/`.mjs`, generated types excluded) | — | clean |
| `vite build` | — | exit 0 (existing chunk-size notice only) |
| `git diff --check` | — | clean |

New and updated suites (9 files, 66 tests, all passing): `centerFilters` (4), `centerSchemas` (10),
`useCommissionsCenter` (4: keys by user, organization and filter; nothing requested under View As, without the Own
permission or for an incomplete custom range; the previous page is never shown to another user; any tracking write
refreshes the center), `commissionsPage` (10: Overview by default with one heading and four tabs; legacy and unknown-tab
redirects; back and forward; each card opens exactly its list; reporting without a grid; calculator inputs kept across
tabs, no write or reporting read, cleared for another user; nothing requested under View As or without permission),
`overview` (5), `lists` (5), `drawer` (4, including an unknown payment outcome locked across closing the dialog and the
drawer, and Retry resending the identical request), `CalculatorTab` (7, moved), `viewAsSidebarNav` (17, Commissions
entry).

## 7. Browser checks and screenshots (`screenshots/`)

Method: an uncommitted Vite harness in the session scratchpad renders the real sidebar, `CommissionsPage`, tabs,
drawer and dialogs with stubbed auth, calling real PostgREST 12.2.3 over a disposable database seeded with synthetic
records through the existing companions. Chromium at 1440 px and 390 px, light and dark. In every final shot there is
no horizontal overflow and no console error (the time-zone shot logs the expected HTTP 500 for `55000`).
End to end: Record payment from the drawer prefilled the remaining amount, saved through the existing receipt RPC,
and the list and totals refreshed.

| Tab | Files |
|---|---|
| Overview | `overview-1440-light.png`, `overview-1440-dark.png`, `overview-390-light.png`, `overview-390-dark.png` |
| Payments | `payments-scheduled-1440-light.png`, `payments-scheduled-390-dark.png`, `payments-history-1440-light.png` |
| Policies | `policies-1440-light.png`, `policies-1440-dark.png`, `policies-390-light.png` |
| Calculator | `calculator-1440-light.png`, `calculator-390-dark.png` |
| Drawer and dialog | `drawer-1440-light.png`, `drawer-390-dark.png`, `record-payment-1440-light.png`, `record-payment-390-dark.png` |
| States | `empty-state-1440-light.png`, `error-timezone-1440-light.png` |

Chart colours: Received and the two Expected parts use the validated categorical slots 1–3 (light `#1baf7a`,
`#2a78d6`, `#eb6834`; dark `#199e70`, `#3987e5`, `#d95926`); estimates are hatched; the legend, a month readout and an
sr-only table carry identity and values without colour.

## 8. CI on the draft PR

Results for the exact final head are recorded in the draft PR body, not here, so that recording them does not
change the head. The workflows that cover these paths run PostgreSQL 17.6 + PostgREST 12.2.3 (database job with
`PC_MEASURE=1`) and the commission, center, sale-handoff, contact and sidebar frontend tests.

## 9. Migration checksums (final files)

| File | SHA-256 | Bytes |
|---|---|---|
| `supabase/migrations/20261020212000_policy_commission_center_reads.sql` | `5bc2eb14b52bf72c2516d6d134c0dac52bea052504aff8bb9e723d08fdbd3e08` (MD5 `a3a67abaf502d84da0d61f4fd1b37b2b`) | 40,850 |
| `supabase/migrations/rollback/20261020212000_policy_commission_center_reads.rollback.sql` | `7ada5b7dff4dfb4bf1361893b9eded8f7e0f4a969cfe0de8252f55fed92e728b` | 1,984 |

The migration's bytes are unchanged by the §14 rename. The rollback's only change is the version in its first-line
comment (`-- Rollback for 20261020180000_…` → `-- Rollback for 20261020212000_…`; it was `1ea39c4c…1f18`).

Unchanged against `main` (verified with `git diff`): `20261019170000_policy_commission_tracking.sql`
(`b3e4d53f…011f1f`) and `20261020040000_policy_commission_expected_windows.sql` (`10897ad6…0a5ea8`).

## 10. Production release steps (each needs Chris's separate explicit approval)

**Gate 2 — database (`20261020212000`, read functions and two indexes only).** The authoritative steps are §13; this
summary follows them.
1. Read-only preflight on project `jncvvsvckxhqgqvkppmj` (`release/preflight.sql`, §13): both prerequisite versions
   recorded and nothing recorded at or after `20261020212000` in the HOSTED history; schema `policy_commission_reporting` and the five functions absent; the four md5 preimages
   match (the file also refuses otherwise); the agency time zone is set for each organization that will use the
   page (otherwise the page shows "Agency time zone needed"); no lock waits on the commission tables; advisor and
   catalog baselines captured.
2. Apply the exact bytes once with the Gate 3 method (`apply_migration` stamps its own version): one transaction with
   the file's `lock_timeout 1s` / `statement_timeout 60s`, refusing unless MD5, SHA-256 (`5bc2eb14…bd3e08`) and length
   (40,850) match and the version is unrecorded and sorts last; record `('20261020212000', 'policy_commission_center_reads')`
   (`release/build_apply.py` builds that exact statement).
3. Read-back (`release/readback.sql`, §13): existing-object fingerprints unchanged; the new objects equal a locally migrated reference; ACLs as in
   §2; six-table fingerprints (counts, content digests, write counters) equal the preflight's; advisor delta reviewed.
   PostgREST schema reload.
4. Rollback if needed: the guarded rollback file drops only the new objects and touches no data.

**Gate 3 — frontend (merge and deploy).** Only after Gate 2: the page calls functions that exist only then. Mark the
PR ready, merge, confirm both Vercel production deployments at the merge commit. Signed-in acceptance with a named
Agent's own policies is read-only unless Chris authorizes a test write; no preview connected to production is used for
sale or commission tests.

## 11. Limitations and open items

- PostgreSQL 17.6 evidence comes from CI on the draft PR (§8); local runs used 16.15.
- Local Supabase advisors were not run for this branch; production advisor deltas belong to Gate 2.
- Balances are current, not historical as-of balances; a missing receipt is not evidence that nothing was paid.
- Pages are offset-paginated; if records change between page requests a later page can shift (totals always come
  from the latest response).
- Reused Phase 2A components keep their 11 px secondary text inside the drawer.
- Resolved in §12: the Calculator's contract-level line and grid disclaimer, and the stale Settings › Commission Grids
  wording.
- The unresolved-write registry is in memory: a full reload or sign-out loses Retry state (Phase 2A behaviour).
- No reminders, cron, exports, imports, team views or Reports-page changes. The earlier preview conversion
  (`2325bc9d` / `7e2c476a`) was not touched and still awaits Chris's classification.

## 12. Amendment — final copy and filter corrections (local, 2026-10-20; plan §12)

Reviewed head `fbe50a8`. No database, SQL-test or script change (`git diff fbe50a8 -- supabase/ scripts/` is empty),
so the migration keeps SHA-256 `5bc2eb14b52bf72c2516d6d134c0dac52bea052504aff8bb9e723d08fdbd3e08` (MD5
`a3a67abaf502d84da0d61f4fd1b37b2b`, 40,850 bytes) and the disposable SQL/PostgREST suites were not re-run locally (the
PR's PostgreSQL 17.6 job re-runs them on the final head).

**Filter regressions — failing first.** The new and extended tests (`filterConsistency.test.tsx`,
`useCommissionsCenter.test.tsx`, `centerFilters.test.ts`) were run against the unfixed code: **12 failed, 11 passed**
of 23. After the fix: **23 passed**.

| Regression | Failing-first evidence (before) | After |
|---|---|---|
| Old rows under a new filter (`previousPageFor` checked only user and organization) | a changed Status still showed the previous filter's rows; rapid Carrier → Status → Type changes showed the first filter's rows while the last was pending; a changed Policies filter showed the previous policies; paging (Scheduled and History) had no busy marker (`aria-busy` absent); the hook returned the old data for a changed status, the first case it checks | loading state until the filter's own rows arrive; with out-of-order responses only the latest filter's rows appear; a failed request shows "Couldn't load", never earlier rows; paging keeps the shown page with `aria-busy="true"`, "Updating…" beside the pager and every row action disabled (a click does nothing) until the new page arrives; back/forward show each filter's own cached rows |
| Hidden custom range blocks Next 90 days / Any date | `?dates=next_90&period=custom`, `?dates=any&period=custom` and `?dates=any&period=custom&from=2026-10-05` made no request (the list stayed on its skeleton); switching Dates from an unfinished custom range made no request; the hook never succeeded for Next 90 days with a hidden range; the normalization helper did not exist yet (`TypeError`) | each requests `p_scope` with `p_period: this_month`, `p_from: null`, `p_to: null` and shows its rows; Next 90 days and Any date share one cache key whatever the hidden range holds; switching back to Selected period waits for a complete range |

Identity changes keep their existing proof (no earlier user's page for another user, hook test) and the page remounts
per user and organization. A side effect found by an existing test: Carrier options came from the old placeholder, so
they vanished while a changed filter loaded; `useCarrierOptions` keeps the seller's carrier list (filter-independent on
the server) for the same identity.

**Calculator and Settings.** "Your level: 100"; "Estimate only" with an ⓘ ("About this estimate") holding "Assumes a 75%
advance. Actual commission and payment timing may vary by age, plan type and carrier rules. Calculator results aren't
saved or reported." No grid name, effective date or revision appears (asserted). The unchanged engine gives the same
figures as before in the workspace unit test and in a new page test that also keeps the full estimate across a tab
switch ("92.5%", "$1,110.00", "$832.50", "$92.50" ×3). Settings: "No grid is selected, so the Calculator is off. Saved
commission history stays available."; turning it off: "The Calculator needs a grid, so it stays off until you choose
one again. Saved commission history stays available."; disabling or deleting the calculator grid: "… the Calculator
stays off until you choose another grid; saved commission history stays available." Deletion consequences ("Its 3
products and every rate are deleted. This can't be undone."), the private-copy sentence and every confirmation are
unchanged. The history claim holds: saved estimates keep their own grid snapshot and have no foreign key to a grid.

**Frontend checks (this head vs `main` `0312520`).**

| Check | `main` | Branch |
|---|---|---|
| Full Vitest, inert env | 380 files, 5,967 tests; 1 failed (`recordingRetentionVoicemail`) | 388 files, 6,026 tests; the same 1 failed |
| Full Vitest, no env | 10 files failed, 1 test failed | the same 10 files and the same 1 test (388 files, 5,937 tests) |
| App typecheck | 84 diagnostics | the same 84 diagnostic lines |
| `npx tsc --noEmit`, ESLint (changed files), `vite build`, `git diff --check` | — | `tsc` exit 0; ESLint clean; build exit 0; diff check clean |

**Browser (harness, Chromium, 1440 and 390 px, light and dark; no overflow, no console error).** Calculator empty and
with an estimate and the ⓘ open; Settings › Commission Grids (harness-only route with synthetic grid data, as in its
unit test) with no grid, the turn-off dialog, the disable dialog and the delete dialog; Payments with the next page held
back 4 s (`aria-busy="true"`, one "Updating…", 46 row buttons disabled, none enabled); `?dates=next_90&period=custom&from=…`
loading its rows. Files: `screenshots/calculator-*`, `calculator-estimate-*`, `settings-*`, `payments-updating-*`,
`payments-next90-custom-*`.

## 13. Database-only release package — Gate 2 (for Chris's separate approval; nothing applied)

**What:** `supabase/migrations/20261020212000_policy_commission_center_reads.sql` exactly as on the PR's final head:
SHA-256 `5bc2eb14b52bf72c2516d6d134c0dac52bea052504aff8bb9e723d08fdbd3e08`, MD5 `a3a67abaf502d84da0d61f4fd1b37b2b`,
40,850 bytes (219 box-drawing characters, three `§`, two `–`; dollar quotes `$$` and `$guard$` only; no INSERT, UPDATE,
DELETE or transaction control). Creates the `policy_commission_reporting` schema (USAGE `authenticated`), two
composite types, seven helpers and five public reads (SECURITY INVOKER, `search_path = pg_catalog, pg_temp`, EXECUTE
`authenticated` only) and two indexes on Phase 2A tables. It changes no existing function, table, policy, grant, role or
row. Rollback: `supabase/migrations/rollback/20261020212000_policy_commission_center_reads.rollback.sql` (SHA-256
`7ada5b7d…e728b`), dropping only those objects (it leaves the history row; removing one needs its own approval).

1. **Preconditions:** PR #471 final head green on PostgreSQL 17.6; still a draft; `main` checked for overlapping
   schema work; Chris's explicit Gate 2 approval naming this file, version and checksum.
2. **Preflight (read-only):** list the hosted history (`list_migrations`) and run `release/preflight.sql`. All 15 checks
   must read `ok = t`: server ≥ 16; `20261019170000` and `20261020040000` recorded; **nothing recorded at or after
   `20261020212000`** (the hosted head was `20261020192723 / uv_personal_brand` on 2026-10-20 21:17 UTC; if anything
   later has been recorded, stop: the version must be re-chosen, never the history edited); both applied migrations'
   stored text still hashes to their SHA-256; prerequisite columns; schema, functions and indexes absent; the four md5
   preimages; RLS on the six commission tables; no lock waits. Save the **six-table fingerprints** (row count, MD5 of
   every row's full text, `n_tup_ins` / `n_tup_upd` / `n_tup_del`, and the session time zone) for handoffs, captures,
   estimates, installments, receipts and events, the list of organizations with an unset or invalid agency time zone
   (their page will show "Agency time zone needed"), and the advisor and catalog baselines as at Gates 3 and 3b.
3. **Apply once:** `python3 docs/plans/2026-10-20-commissions-center/release/build_apply.py > apply.sql` (it refuses
   unless the file's SHA-256, MD5 and length are the reviewed values) and send `apply.sql` as **one** request to the
   hosted SQL endpoint (`apply_migration` would stamp its own version). In one transaction it sets the file's own
   `lock_timeout '1s'` / `statement_timeout '60s'`, expands the three non-ASCII characters server-side, refuses unless the
   expanded text's MD5, SHA-256 and UTF-8 length equal the reviewed values, both prerequisites are recorded, nothing is
   recorded at or after `20261020212000` and the caller is `postgres`; then `EXECUTE`s the text unchanged, re-checks the
   role and records `('20261020212000', 'policy_commission_center_reads', ARRAY[text])`. Any refusal or error rolls back
   everything. The two `CREATE INDEX` statements take brief SHARE locks on receipts and captures; on a lock timeout,
   retry later and never raise the timeouts.
4. **Read-back (read-only):** run `release/readback.sql`. All 13 checks must read `ok = t` (history row with the
   stored text's SHA-256 and length; recorded last; schema owner and USAGE; 12 functions, invoker, owner,
   `search_path`; EXECUTE `authenticated` only and no PUBLIC grant; both indexes valid; the four preimages unchanged;
   RLS on). Its six-table fingerprints must equal the preflight's in every column. Confirm the existing-object
   fingerprints and the advisor delta (expected: two `unused_index` notices for the new indexes, nothing else), then
   PostgREST's schema reload.
5. **Stop conditions:** any preflight or read-back row not `t`, a hash or length mismatch, a later recorded version,
   any unexpected catalog or advisor change, or any fingerprint difference — stop, do not retry blindly, report. No
   production test writes; the frontend (Gate 3) stays unreleased until separately approved.

## 14. Version correction and apply rehearsal (local, 2026-10-20; plan §13)

**Finding (Chris, read-only, 21:11 UTC; re-checked read-only with `list_migrations` at 21:17 UTC):** the hosted head is
`20261020192723 / uv_personal_brand` (PR #470's source file is `20261020171244`; the hosted version was stamped at
apply). The proposed `20261020180000` sorts before it, and the preflight's `version_free_and_sorts_last` correctly
refused it. `20261020180000` was never recorded.

**Correction:** renamed to `20261020212000` with `git mv` (similarity 100%: SHA-256 `5bc2eb14…bd3e08`, MD5
`a3a67aba…2b4b`, 40,850 bytes, unchanged); the rollback differs only in its first-line comment. Current references were
updated in the runner (`CENTER`, `CENTER_ROLLBACK`, comments), test-script and test-SQL comments, one source comment
(`centerSchemas.ts`, no code change), the release SQL, the plans and AGENT_RULES. The workflow's path filters are
version-agnostic globs. No applied migration, history row, reporting SQL, permission, definition, UI, writer or the UV
release was changed; no history row was inserted out of order and the ordering guard stays.

**Rehearsal (disposable PostgreSQL 16.15, synthetic data).** History: `20261019170000` and `20261020040000` with their
exact text, and `20261020192723 / uv_personal_brand` (recorded with its source text, not executed: the fixture has no
UV schema). Book seeded through the existing companions and tracking functions: handoffs 13, captures 12, estimates 12,
installments 48, receipts 4, events 24. The apply statement came from `release/build_apply.py` and was sent as one
request, as on the hosted endpoint.

| Step | Result |
|---|---|
| Preflight before apply | 15/15 `t` |
| Lock contention (an open `ROW EXCLUSIVE` writer on receipts) | refused after 1.05 s (lock timeout); schema absent, no history row |
| One changed byte in the sent text | refused by the hash check before anything ran |
| A later recorded version present | refused ("would not sort last"); removed afterwards (disposable) |
| Apply | 0.07 s; recorded `20261020212000 / policy_commission_center_reads`, one statement, MD5 `a3a67aba…`, SHA-256 `5bc2eb14…`, 40,850 bytes |
| Read-back | 13/13 `t`; six-table counts, content digests and write counters identical to the preflight's |
| Advisors (splinter `main`) | 86 → 88: `+2 unused_index` (the two new indexes, fresh database), nothing removed, no security finding added |
| Replay | refused by the wrapper (version recorded) and by the file's own guard ("already applied; refusing replay"); one history row; the preflight then refuses (4 checks `f`) |
| Rollback | the full schema dump (owners and ACLs) equals the pre-apply dump; fingerprints unchanged |
| Reapply after removing the disposable history row | applied; read-back 13/13 |
| Reference `psql -1 -f` on a fresh database | schema dump identical to the wrapper-applied one, owners and ACLs included (9,349 lines) |

Regression: `scripts/run_policy_commission_tests.sh` on the renamed files passed (exit 0): every Phase 2A suite, center guards
and inventory ("5 reads, 2 indexes, 173 existing objects unchanged"), the center suite, rollback (exact restore, records
kept, replay refusal, reapply), PostgREST 13 + 9 checks. The rehearsal script stays in the session scratchpad (it is
wired to the local disposable cluster); its steps are listed above. PostgreSQL 17.6 +
PostgREST CI on the final head: recorded in the PR body.

## 15. Gate 2 production execution and signed-in preview acceptance (2026-10-20)

**Authorization and source.** Chris's handoff reaffirmed the recorded Gate 2 database-only approval and explicitly
authorized the supported cloud-browser SQL Editor route for project `jncvvsvckxhqgqvkppmj`. Approved source
`60e29422d378f37fae57832821849e5376c30ccf`; execution/preview head `63267f6d09944ce520f4e9d10a8879d3012c2be6`.
The intervening commit only recorded the execution route in plan §14; the migration and release scripts were unchanged.
PR #471 was open, draft and mergeable against `main` `381bebb8adb46adbd22509127524e43bf4abee6f`; all nine GitHub
workflows succeeded on that head, including PostgreSQL 17.6 / PostgREST 12.2.3 policy-commission verification.
No application code was changed for this release record.

**Exact package.** The reattached apply file matched the approved `build_apply.py` output byte-for-byte:
43,980 bytes, wrapper SHA-256 `dbe3795e0f6e4e036b70c50b8552a5ba0da604b83de88c3b7742a2f72757303f`.
Its expanded embedded migration was independently checked at 40,850 bytes, SHA-256
`5bc2eb14b52bf72c2516d6d134c0dac52bea052504aff8bb9e723d08fdbd3e08`,
MD5 `a3a67abaf502d84da0d61f4fd1b37b2b`. The wrapper and embedded-migration checksums are intentionally different.

**Execution.** Immediately before apply, the reviewed preflight passed 15/15, hosted history ended at
`20261020192723`, and catalog/advisor/data baselines were refreshed (baseline collection completed 23:05:02 UTC).
No organization with saved estimates had an unset/invalid agency time zone. SQL Editor identity was verified as
`current_user = session_user = postgres`, database `postgres`, time zone UTC. Full editor clipboard readback matched
the verified attachment. The unchanged file was submitted once as one atomic request, retaining version
`20261020212000`, 1 s lock timeout, 60 s statement timeout and every guard. The editor reported "Success. No rows
returned"; no retry, replay, migration timestamp substitution or manual SQL reconstruction occurred.

**Readback (23:05:38 UTC).** Reviewed `release/readback.sql` passed 13/13: exact stored migration hash/length and
last history version, schema ownership/USAGE, all 12 functions' invoker/owner/search-path/EXECUTE settings, valid
indexes, four unchanged function preimages and RLS on all six commission tables. Every fingerprint column matched
before/after; session time zone was UTC throughout:

| Table | Rows, before = after | Full-row content MD5, before = after | Insert / update / delete counters, before = after |
|---|---:|---|---|
| `policy_commission_captures` | 1 | `348550cceac10ab5a980b367160fca25` | 1 / 1 / 0 |
| `policy_commission_estimates` | 9 | `c3cddcc4d44342dd156e06f089c42935` | 9 / 0 / 0 |
| `policy_commission_events` | 9 | `87024261631f70cb26a057a389103b93` | 9 / 0 / 0 |
| `policy_commission_handoffs` | 2 | `9e38319f812467a0118080826ba5c1e0` | 2 / 0 / 0 |
| `policy_commission_installments` | 36 | `827c12507ddb415fc128de6bf98e1543` | 36 / 0 / 0 |
| `policy_commission_receipts` | 0 | `d41d8cd98f00b204e9800998ecf8427e` | 0 / 0 / 0 |

**Catalog and permissions.** Broad per-object fingerprints across 15 categories found zero existing objects removed
or changed. Additions were exactly the reporting schema, 12 functions (five public reads/seven helpers), two composite
types and their 41 attributes, and two indexes with five index attributes. Counts: columns 3,356 → 3,402; functions
616 → 628; indexes 1,027 → 1,029; relations 895 → 899; schemas 17 → 18. Unchanged: 1,019 constraints, 13 cron jobs,
27 default ACLs, six event triggers, 26 memberships, 376 RLS policies, two publications/10 published tables, 34 roles,
1,278 triggers. The runner's reviewed inventories likewise preserved all 602 general and 830 commission baseline
entries, adding only approved objects (606 and 883 entries afterwards). Existing permissions/functions and
organization isolation were preserved.

**Advisors and API.** Security findings 253 → 253, identical. Performance findings 451 → 453; the only additions
were INFO `unused_index` for `policy_commission_receipts_agent_received` and
`policy_commission_captures_agent_open`, expected immediately after creation. No unexpected finding was removed or
added. PostgREST logs confirmed the reload notification at 23:05:12.452860 UTC, config reload at 23:05:12.525559,
schema query completion at 23:05:12.959250 and cache loaded at 23:05:12.963542 (128 relations, 152 relationships,
224 functions, 1,194 time zones).

**Read-only browser acceptance.** The primary authorized Vercel preview at
`https://agentflow-a5n96c1wb-cgarness-projects.vercel.app` was READY at the execution head
(`dpl_7Gbut4ok6R6dkK1VzVT7k2FhJBqr`). Secure sign-in completed as Chris Garness.
Overview rendered period cards, timeline, upcoming and review counts. Payments rendered Scheduled's selected-period
empty state and Any date's four existing undated installments; History rendered the no-recorded-payments state.
Policies rendered the one eligible existing policy with its saved estimate and undated next payment, consistent with
the schedule and Overview review count. Calculator loaded its existing grid-backed workspace and hypothetical
estimate notice. No load-error screen was observed. No sale, receipt, date, estimate, setting or existing preview
conversion was created or modified. Customer names, carrier products and compensation values are omitted here.
This was a desktop read-only acceptance check, not a new write-path/mobile test; retained browser console logs were
unavailable after secure credential delivery, so no console-clean claim is made.

The secondary preview `https://agentflow-life-insure-7dq58hrfj-cgarness-projects.vercel.app`
(`dpl_9buuUcg7icSKDPQBWpFgcSsbz4rb`) was also READY at the same head; the signed-in UI check was on the primary preview.
**Gate 3 remains pending Chris's separate approval.** After approval: verify final-head CI, merge through PR #471,
verify both Vercel production deployments and the main website's deployed commit, then record release evidence.
Neither production deployment nor a frontend release is claimed here.
