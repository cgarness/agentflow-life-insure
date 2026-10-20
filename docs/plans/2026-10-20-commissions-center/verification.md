# Commissions center — verification (local build and draft PR, 2026-10-20)

Branch `claude/epic-tesla-fe96b0` from `main` `0312520`. Synthetic data only. **No production read, write, migration,
RLS/grant change, merge or deployment was made.** Migration `20261020180000` is NOT applied anywhere but disposable
databases.

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
| `supabase/migrations/20261020180000_policy_commission_center_reads.sql` | `5bc2eb14b52bf72c2516d6d134c0dac52bea052504aff8bb9e723d08fdbd3e08` | 40,850 |
| `supabase/migrations/rollback/20261020180000_policy_commission_center_reads.rollback.sql` | `1ea39c4c23662a829b4b36d9ec1845adeb7da912810e9d35cae8d69deaaa1f18` | 1,984 |

Unchanged against `main` (verified with `git diff`): `20261019170000_policy_commission_tracking.sql`
(`b3e4d53f…011f1f`) and `20261020040000_policy_commission_expected_windows.sql` (`10897ad6…0a5ea8`).

## 10. Production release steps (each needs Chris's separate explicit approval)

**Gate 2 — database (`20261020180000`, read functions and two indexes only).**
1. Read-only preflight on project `jncvvsvckxhqgqvkppmj`: latest history `20261020040000` and version
   `20261020180000` free; schema `policy_commission_reporting` and the five functions absent; the four md5 preimages
   match (the file also refuses otherwise); the agency time zone is set for each organization that will use the
   page (otherwise the page shows "Agency time zone needed"); no lock waits on the commission tables; advisor and
   catalog baselines captured.
2. Apply the exact bytes once with the Gate 3 method (`apply_migration` stamps its own version): one transaction with
   the file's `lock_timeout 1s` / `statement_timeout 60s`, refusing unless MD5, SHA-256 (`5bc2eb14…bd3e08`) and length
   (40,850) match and the version is unrecorded; record `('20261020180000', 'policy_commission_center_reads')`.
3. Read-back: existing-object fingerprints unchanged; the new objects equal a locally migrated reference; ACLs as in
   §2; no row written in any commission table; advisor delta reviewed. PostgREST schema reload.
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
- The Calculator tab reuses `CalculatorWorkspace` unchanged, so it still shows the user's contract level and its grid
  disclaimer (the reporting tabs show neither). Changing that needs a decision from Chris.
- Reused Phase 2A components keep their 11 px secondary text inside the drawer.
- Settings › Commission Grids still says agents "won't see the Commission Calculator" without a grid. With this
  change the Commissions page stays visible and only the Calculator tab shows its "not set up" notice. That copy was
  left unchanged to keep this PR's scope; it is a one-line follow-up.
- The unresolved-write registry is in memory: a full reload or sign-out loses Retry state (Phase 2A behaviour).
- No reminders, cron, exports, imports, team views or Reports-page changes. The earlier preview conversion
  (`2325bc9d` / `7e2c476a`) was not touched and still awaits Chris's classification.
