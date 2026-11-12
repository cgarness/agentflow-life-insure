## November 12 verification status

Refreshed isolated package rehearsal passed (exit0): current timestamp/history guards, all scoped authorization/reconciliation cases, eight-reader parity across six actors before/after/rollback/reapply, drift/refusal checks, exact catalog/history restoration, and unchanged Center/Insights regressions. This does not clear the separate hosted scale blocker.

**Not release-ready:** original hosted run42952161107 failed the1,000-agent/50,000-policy Overview, Policies and all-time Scheduled budgets. All original assertions remain. The historical51local scenario passes below are retained, not presented as a clean hosted gate. Browser readiness is now corrected:49/49checks in each of three cold runs and one4xCPU run, preserving single-Escape/focus behavior. Final hosted browser verification remains required. Currentmain713aa48d and hostedhistory20261111192142 were refreshed; newmigration20261112165503 preserves function logic/security. The proposed40-second new-reader budget requires a decision and has not been implemented.

# Team Commissions verification

Status: all 51 acceptance scenarios executed successfully; complete local verification passed; hosted candidate CI pending. No production changes. Base e07d28bdef1d8a9a21f0eee408b181b625389527. Native authorization/reconciliation, legacy parity and exact package rehearsal passed on the frozen migration SHA-256 553cf6d61c93cbe12de16e0c080b1cd58256b5d6ae659fc32dbd1d4fed346917. Interface evidence uses the final frontend.

## Acceptance tests

Run authorization and calculation tests on isolated synthetic data with actual authenticated database roles and PostgREST where applicable. Load current hierarchy authorization rather than the older commission-only fixture. Include both a retained deleted seller and a retained deleted intermediate upline node. Use no customer write, production impersonation, or real commission receipt as a test.

### Access matrix

| ID | Scenario | Required result | Executed result and evidence |
| --- | --- | --- | --- |
| A01 | Ordinary Agent selects Me | Existing personal records and totals | PASS — Native Agent/self case; eight-reader legacy parity |
| A02 | Ordinary Agent submits a descendant or sibling ID | Denied, including an Agent with profiles beneath them | PASS — Native Agent descendants/siblings refused; HTTP denied scope |
| A03 | Active Team Leader selects a direct downline | Correct read-only data | PASS — Native direct downline selection and read-only detail |
| A04 | Active Team Leader selects an indirect downline | Correct read-only data | PASS — Native indirect downline/current hierarchy |
| A05 | Team Leader selects sibling, upline, or another branch | Denied | PASS — Native sibling/upline/other-branch refusal |
| A06 | Any request supplies another organization or Agency Group peer agent | Denied | PASS — Native and HTTP foreign organization/Agency Group refusal |
| A07 | Admin selects All agents | Only authorized agents in that organization | PASS — Native Admin/Super Admin home-organization All |
| A08 | Own disabled and Others enabled | Sidebar and direct reporting entry work, default All; zero personal financial, goal, or calculator-context requests; direct Calculator route unavailable | PASS — Native Own/Others matrix; page/navigation and browser team-only routes |
| A09 | Non-admin Team Leader with Others disabled | Downline cannot be selected or fetched; Admin/Super Admin full-access semantics remain unchanged | PASS — Native Team Leader Others-off and Admin/Super Admin controls |
| A10 | Demotion, deactivation, organization mismatch, or removed ancestry with stale token | Former downline access is refused; All recomputes current permitted membership; valid personal access survives demotion, while an invalid/inactive actor is denied | PASS — Native stale actor/demotion/deactivation/organization/transfer; HTTP same JWT after demotion; All membership and money recomputed |
| A11 | Mixed allowed and forbidden Selected IDs | Whole request refused | PASS — Native and HTTP mixed allowed/forbidden whole-request refusal |
| A12 | Empty/malformed/null/contradictory selection | Validation error, no scope widening | PASS — Native malformed/null/empty/contradictory selection; URL Zod matrix |
| A13 | Allowed actor has no permitted members | Clean empty scope, no financial request | PASS — Native empty universe; browser zero financial calls |
| A14 | View As active | Navigation absent and direct entry unavailable; zero roster/reporting/goal/calculator requests | PASS — Page/navigation tests and browser zero roster/reporting/goals/calculator requests |
| A15 | Hidden client, visible commission | Restricted contact and no client link/name leak | PASS — Native actual clients RLS, HTTP restricted contact, UI no fallback/link |
| A16 | Direct invocation of granted internal helpers | Same actor/org/scope restrictions as public readers | PASS — Native direct helpers, optional narrowing-argument validation, legacy self-only checks; HTTP schema non-exposure |
| A17 | Anonymous or unintended role invokes a new API | EXECUTE/access denied | PASS — Native role ACL/schema checks; anonymous/service_role HTTP refusal for all seven APIs |
| A18 | Policy belongs to permitted seller outside the current selection | Detail refused | PASS — Native permitted seller outside selected policy detail refused |
| A19 | Raw Selected request containing self only | Effective detail access stays read-only; only an explicit Me request enables existing personal controls | PASS — Native/HTTP raw selected[self] read-only; malicious writable UI payload refused |

### Reconciliation matrix

| ID | Scenario | Required result | Executed result and evidence |
| --- | --- | --- | --- |
| F01 | Same fixture before/after migration using old personal APIs | Identical public contracts and financial results | PASS — Before/after/rollback/reapply exact eight-reader parity across six actors, default/filter/page/leap-date calls |
| F02 | Two agents individually versus combined | Amounts and eligible policy counts reconcile | PASS — Native individual/combined saved-cent ledger assertions |
| F03 | Multiple receipts/installments for one policy | No duplicated policy or multiplied money | PASS — Native multi-installment/multi-receipt distinct policies and amounts |
| F04 | Voided receipt and replacement | Existing valid-receipt math retained | PASS — Native valid/void/replacement receipt accounting |
| F05 | Advance overpayment | Excess separate; other installments unchanged | PASS — Native Advance excess separate from Months 10–12 |
| F06 | Superseded estimate, held estimate, open capture, missing estimate, stored zero | Each retains its existing meaning | PASS — Native active/held/superseded/open/missing/zero cases and unchanged Center suite |
| F07 | More than one 25-row page | Totals include all matching rows | PASS — Native >25 rows; HTTP 45-policy two-agent full totals; large HTTP 50,000-policy/200,000-installment full-ledger checks |
| F08 | Month-end, leap date, daylight-saving boundary, and agency timezone | Existing period/window rules retained | PASS — Native actual leap/month-end/DST membership and invalid/missing agency timezone refusal |
| F09 | Missing Sold Date or expected date | Existing eligibility/review behavior; no invented date | PASS — Native undated sale/payment review and forecast exclusion; original Center regressions |
| F10 | Card, chart, carrier/product group, and drill-down | Same selection and effective filters; totals reconcile | PASS — Native group drill-down reconciliation; frontend all scoped card/chart/list links |
| F11 | Weighted averages and comparison periods | Compute from combined underlying values/counts | PASS — Native both-seller unequal nonzero current/previous cohorts and combined values/counts |
| F12 | Current hierarchy transfer | Visibility changes; historical seller/estimates/receipts stay identical | PASS — Native transfer changes Selected/All visibility and totals while preserving seller/financial history |
| F13 | Inactive or retained deleted seller with authorized history | Included in historical totals and selectable when appropriate | PASS — Native inactive/deleted sellers with money and retained deleted intermediate ancestry |
| F14 | Financially permitted but hidden client | Correct saved amounts, permitted Unknown grouping, no client fallback leak | PASS — Native/HTTP restricted client saved fallback; team hidden no-estimate Unknown grouping |

### Interface and recovery matrix

| ID | Scenario | Required result | Executed result and evidence |
| --- | --- | --- | --- |
| U01 | Checkbox drafting/search/Cancel | No committed selection or financial fetch change | PASS — agentScope.test.tsx draft/search/Cancel/Escape; browser draft no reads, Cancel, Escape, dismissal |
| U02 | Apply multiple agents | One selection commit; pagination resets | PASS — core selector default Me+downline preserves self, one commit; centerScope write resets pagination; browser exactly two scoped All resources, no agent fan-out |
| U03 | Refresh, back/forward, all tabs, Scheduled/History | Applied selection preserved | PASS — commissionsPage tab/History/back-forward, lists filter persistence; browser History All plus selected URL reload hydration |
| U04 | Every card/chart/month/review/Upcoming link | Same selected agents at destination | PASS — overview.test.tsx and breakdowns.test.tsx enumerate card/timeline/carrier/product/detail/month/review/Upcoming hrefs with exact scope |
| U05 | A to B to All with late responses | No stale scope displayed | PASS — agentScope tests old denied/revision A→B→All; center hook cancellation and no wrong-scope placeholders; real browser held A→B→All aborted reads |
| U06 | Same IDs in different orders | Same canonical selection/cache identity | PASS — centerScope canonical sorting/deduplication and cache identity tests |
| U07 | Pagination within one scope | Only permitted same-filter placeholder rows, actions disabled while updating | PASS — center hook same-scope/filter paging placeholders only; lists tests Scheduled/History/Policies Updating text and every row action disabled |
| U08 | Access revocation detected with drawer open | Cached figures, names, carrier options, and detail cleared | PASS — provider denial/revision purges cached names/data; browser detected loss with open drawer removes names, figures, carrier options and drawer |
| U09 | Team view including Admin or self row | No financial mutation controls or mutation requests | PASS — team lists/Upcoming absent actions; drawer forces read despite write payload including own/Admin; browser all views + drawer no writes |
| U10 | Me after team view or UI self-only selection | UI commits explicit Me, and existing personal actions work under server permissions | PASS — core exact self normalizes Me, All→Me controls; browser only-self All back to Me |
| U11 | Personal unknown write then scope change | Exact request ID and recovery state survive | PASS — drawer unknown write→team→Me same request/form; tracking denied retry→unmount→Me original exact args/id despite edited callback |
| U12 | Team totals and personal goal | Goal does not load/display or accept writes | PASS — goal.test no team goal read/display; direct managed team goal mutation rejected with zero RPC; browser team goals absent |
| U13 | Calculator round trip | Personal inputs preserved; no selected-agent rate fetch | PASS — commissionsPage calculator inputs survive scoped roundtrip, no selected-agent context |
| U14 | Hide amounts | Every new financial value and accessible label masked | PASS — commissionsHideAmounts all monetary surfaces+aria, team list and readonly drawer; real browser desktop/mobile monetary and accessible labels masked |
| U15 | Desktop, 390-pixel mobile, keyboard, screen reader labels | Usable selector and readable records without new overflow | PASS — actual Chromium1440 and390, overflow, axe closed and open selector, Tab/Space/Enter Apply, Escape focus return; screenshots visually inspected |
| U16 | Failed scope resolution or invalid deep link | Clear error; no silent All/Me fallback | PASS — centerScope invalid parameter matrix; provider malformed zero requests; browser invalid selected URL no widening/financial requests |
| U17 | Picker search/page excludes some permitted agents | All still covers the complete authorized set | PASS — browser empty picker search All still full set and p_agent_ids null; native suite validates universe independent of paging |
| U18 | All URL resolves only to self | Selector or Back to Me remains available; no read-only navigation trap | PASS — provider only-self All selector retained; browser only-self All return Me |

Run the focused commission and hierarchy suites, the existing sale/commission handoff regressions affected by the shared database harness, scoped lint, production build, and `npx tsc --noEmit`. Compare any existing repository-wide failures against the exact base; do not fix unrelated debt or claim baseline failures as new regressions.

Perform a React review after the component edits. Verify actual request counts and set-based query behavior for the scale fixtures. Capture desktop/mobile visual evidence with synthetic data. Verification.md records what ran, its result, remaining limitations, and the exact commit.


## Executed frontend verification

- Full equivalent-tooling suite: exact base 7,059 passed; final frontend 7,110 passed. Both retain one failed voicemail-retention assertion (`recordingRetentionVoicemail.test.ts`, deployed-v29 handler byte comparison) and ten pending tests. The suite is not globally clean. Synthetic Supabase URL/key and full available Git history were used for both.
- Focused commission/frontend suite: 163/163 passed across 16 files. Root `npx tsc --noEmit` passed. Actual `npx tsc -p tsconfig.app.json --noEmit` has the same 79 diagnostics, with byte-identical output to exact base.
- Global ESLint: same 11 errors and 145 warnings, with identical output after worktree-path normalization. Scoped frontend lint: zero errors/warnings. Production Vite build passed on final frontend; existing large-chunk warnings remain.
- Real Chromium 141.0.7390.37: 48/48 checks passed in 7.805 seconds. Desktop 1440 and mobile 390 pixels, no overflow, WCAG axe checks including the open selector, Tab/Space/Enter Apply and Escape focus return. The synthetic Vite adapter imports actual page/components and blocks external browser requests. It is not a live-user or production-backend browser session. The bounded sandbox was stopped.
- Screenshots: [desktop](evidence/desktop.png), [mobile](evidence/mobile.png). Both independently inspected; synthetic identities and amounts only. The complete browser result and preservation hashes are in [evidence/verification-summary.json](evidence/verification-summary.json).

## Revocation behavior

Every server request resolves current actor, organization and membership; neither browser IDs nor revision strings grant authority. The roster refetches on mount, focus and reconnect, and every scoped financial response is checked against the admitted scope revision. A detected refusal, changed revision, or personal-tool denial cancels/removes affected cached results and unmounts the financial subtree, including names, breakdowns and open drawers. Superseded responses cannot re-admit an old selection. There is no push subscription for arbitrary remote permission changes: an already displayed page can remain visible until the next request/refetch or local identity/permission change detects revocation. This is not instantaneous remote revocation.

## Executed native verification and scale status

Final-source native authorization and reconciliation passed with restored current hierarchy/RLS, including every A/F row above and the strengthened All-transfer, unequal-cohort, hidden-Unknown and helper-filter assertions. All eight legacy APIs match the same fixture before/after and after rollback/reapply across six actors. Existing security, handoff, tracking, expected-window, Center, Insights, sale-call-link and Fidelity alias/new-sale/retry/correction regressions passed. Exact release packages passed apply/history-bytes/replay/history-drift/hash-drift/rollback-catalog/history-preservation/reapply checks. No assertion was removed to make the fixture pass; the synthetic login issuer was corrected to support actor switching under restored real profile RLS.

Initial 50,000-policy measurements exposed a generic-plan/join amplification timeout, followed by an inherent eight-second limit on full Overview/all-time Scheduled. Fixed bound SQL, exact join keys, typed composite projections and equivalent filter pushdown removed the amplification. No new index, RLS, authorization primitive, role/database setting or writer change was needed. The original eight-second failures are retained in evidence.

The three new public aggregate APIs alone now have a prepared 20-second function-specific request budget. Actual PostgREST 12.2.3, one pooled connection, authenticator/authenticated defaults eight seconds: three repeats of each new aggregate returned HTTP 200 with independently reconciled full-ledger values. Overview 11.13–11.74 seconds; all-time Scheduled 9.59–9.85 seconds; Breakdown 7.66–8.81 seconds. Every following request observed the original eight-second default. A synthetic nine-second request was canceled at 8.010 seconds; a 21-second function-budget probe was canceled at 20.004 seconds; the next default was restored again. No production timeout or credential was used.

The final complete native runner exited **0** in approximately **13m12s**: 36 cases for 1/10/100/1,000 sellers and 50/500/5,000/50,000 policies, seven warm samples per case plus one cold sample (288 total), 36 EXPLAIN plans, zero unexpected benchmark errors. Exact packages, repeated HTTP budget/reconciliation proofs, and final unchanged Center/Insights regressions passed. Full log SHA-256: `3b8454cb19a5fc5772ccd5d74fa88d520b084811cc496b95b95924cfe01869b1`. Hosted CI is pending publication; inspect the exact PR head checks. These are isolated synthetic measurements, not a guarantee for production hardware, concurrent load, or unlimited books. Default-window and all-time workloads have different costs; do not extrapolate the fastest filtered case to an unfiltered book.

## Final native large-book measurements

1,000 authorized sellers, 50,000 policies, 200,000 saved installments; milliseconds. Seven warm samples, one cold call, plus a separate measured query plan per resource. Full 36-case raw samples/plans and actual HTTP samples are embedded in `evidence/verification-summary.json`.

| Resource | Median | p95 | Maximum including cold | Budget |
| --- | ---: | ---: | ---: | --- |
| Breakdown | 6,886.69 | 7,336.73 | 7,475.93 | 20s |
| History | 1,804.85 | 1,854.98 | 2,738.04 | 8s |
| Months 10–12 | 3,702.41 | 4,039.09 | 4,086.44 | 20s |
| Overview | 11,277.16 | 11,818.97 | 11,940.22 | 20s |
| Policies | 3,888.52 | 4,145.08 | 4,179.76 | 8s |
| Agents roster | 34.01 | 36.14 | 36.51 | 8s |
| Scheduled, all time/any | 10,414.17 | 11,109.84 | 11,328.38 | 20s |
| Scheduled, default period | 3,860.48 | 4,232.43 | 4,265.78 | 20s |
| Scheduled, next 90 days | 7,338.63 | 7,775.91 | 7,898.38 | 20s |

At 100 sellers/5,000 policies, median Overview was 1,115.57ms and default Scheduled 510.50ms. At 10 sellers/500 policies, they were 119.81ms and 47.42ms. The browser observed one roster admission plus two set-based Overview resources, never one financial request per selected agent. Search requests are discovery only. Every request revalidates authority.

## Production status

Prepared and locally tested; no migration applied, no customer data changed, no merge, no production deployment. The exact migration/rollback/transaction-package hashes and final function signatures/security pins are in `release/manifest.json`. Separate AI source/package review passed; it is not an independent human sign-off. Production release and any conditional rollback require the exact consolidated approval in `release.md`.
