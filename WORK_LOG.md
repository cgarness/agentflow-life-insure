# AgentFlow Work Log

## 2026-11-03 — Reports V2 PKG-F preview batches F-1 and F-2: the first Example 2 page on the v3 contract (branch `claude/great-goodall-911azc-pkg-f` at `969a2fa`; branch only; nothing merged, applied, enabled or deployed)

**Status.** The private preview's first two sections are real, reusable D6 components. They run in the isolated harness on real v3 SQL payloads plus labelled synthetic variants.
- **Not built yet:** sections 3–7 (trends and call outcomes, agent table, Regional map, calling heatmap, breakdowns), exports, customizer v5, How it's calculated, `verify.mjs` v3.
- A successful synthetic screen proves presentation only.

**Changed on `-pkg-f`.**
- **F-1 `06e4537`, the lib layer:**
  - `reports-v3-schemas.ts`: the 29 reason codes, the envelope superRefine, strict per-KPI detail, exact per-reader metric order, and all nine reader schemas.
  - `reports-v3-queries.ts`: the nine readers only.
  - `reports-queries.ts`: exports, v3 names, `57014` → timeout.
  - `reports-kpi-registry.ts`: equal to the SQL registry.
  - `reports-kpi-format.ts`: single rounding (BigInt; exact cents and millionths), tile views and disclosures.
  - `reports-v3-text.ts`.
  - Tests: `reportsV3Fixtures.ts` (the 11 BC4 cases and the preview scenarios), `reportsV3Schemas`, `reportsKpiRegistry`, `reportsKpiFormat`.
- **F-2 `969a2fa`:**
  - `Reports.tsx` is the v3 page. The scope gates it, and a denied scope or disabled v3 shows "Reports unavailable" with zero panel requests.
  - `useReportsPage.ts` and `reports-panels.ts`: eight parallel panels, each failing closed.
  - New components: `KpiTile`, `KpiStatusNote`, `ReportsProduction`, `ReportsEffortSection`, `ActivityStrip`, `MoreMetrics`.
  - The accent tokens in `index.css` and `tailwind.config.ts`.
  - The narrower `ReportScopeView` type in `ReportsToolbar`, `ReportContextLine` and `ReportScopeTabs`. `ReportScopeTabs` is a type-only deviation from the D6 file list.
  - The harness `stubs.ts`, `vite.config.ts` and `README.md`.
  - `reportsKpiTile.test.tsx`.
- **On the foundation branch:** `d52d4db` makes the payload window end on the agency's today.

**Verification.**
- Every real payload parses: 9 readers × agency, team and personal.
- Lib and tile tests: 64 pass, including the payload parse.
- Full Vitest: 6,831 tests, 6,745 passed. The 13 baseline failing files are unchanged by identity. **48 new failures**, all in the three v2-page tests that D6 §7 says to rewrite: `reportsPage`, `reportsScopeIntegration` and `reportsDialerIntelligence`. Pending.
- eslint 0; `tsc --noEmit` 0; `tsc -p tsconfig.app.json` exit 2, with 222 lines identical to the baseline after normalization; build 0.
- The production bundle contains no fixture code, and the Reports code names only v3 readers.
- **Harness, nine requests per scope, all accepted:**
  - 23 tiles in every data scenario;
  - unavailable: one scope request and zero panel requests;
  - error: only the failed panels show "—";
  - values fit with no page overflow at 1440, 1024, 768, 390 and 320 px;
  - the chip disclosure opens and closes with Escape.
- Screenshots (dark, desktop and mobile) were delivered outside the repository.

**Preview hosting.**
- Vercel's automatic branch previews (`agentflow` and `agentflow-life-insure`) built `969a2fa`. Both projects have SSO protection on all deployments except custom domains.
- They use the hosted database, where v3 is not released, so `/reports` fails closed with "Reports unavailable". No production RPC was enabled.
- The synthetic review build exists only as the local harness. Hosting it would need a new configuration or deployment action, which is requested, not taken.

**Draft wording for review:** `SALE_SOURCE_NOTE`, `ORIGINAL_SELLER_NOTE`, `EFFECTIVE_PREMIUM_BASIS` and `HOW_CALCULATED_DESCRIPTION`. The plan names these but does not pin their text.

## 2026-11-03 — Reports V2 Batch F-A: the v3 payload file for the isolated preview (branch `claude/great-goodall-911azc`; test tooling only; nothing applied, merged, enabled or deployed)

**Request:** Chris's "complete the remaining build; first deliver the private Reports preview" message. The completion checklist, shared-file ownership and next file lists are in `implementation_plan.md`.

**Changed.**
- `scripts/reports_v3_fixture.py`: `--part payloads` (D1 X9). In one REPEATABLE READ snapshot it calls every report reader (the nine v3 readers and the six v2 readers) as the synthetic scale organization's Admin. It covers agency, team and personal scope over the 30 days ending on the fixture's end date, then rolls back. The sealed v3 readers are granted only inside that transaction.
- `scripts/run_reports_v3_tests.sh`: `REPORTS_V3_PAYLOADS=<path>` writes the file after the suites pass. It loads the scale organization only when the suites did not, and checks each v3 bundle's `reports_v3` marker and requested scope.

**Verification** (local PostgreSQL 16.15):
- `REPORTS_V3_PERF=0` run: every v3 suite passed, and the file was written (2.1 MB, three scopes).
- The payloads show the PKG-A state as specified: KPIs 12 and 15–18 `evidence_not_captured`, KPI 38 `sale_call_link_not_captured`, and Partial coverage from unverified attempts and missing premiums.
- Contract test 41/41.

**Found:** production now has `20261103191631_inbounds_room_v1` applied, which is later than every unapplied Reports migration. This is recorded as a release blocker for Chris's decision. No renumbering.

## 2026-11-03 — Reports V2 PKG-A Batch 8: query-only optimization after X1; no reader change retained; journey reader scale coverage added (branch `claude/great-goodall-911azc`; tests and documentation only; NOT merged, applied, enabled or deployed)

**Status.**
- Chris accepted stopping the maintained pointer layer. X2 and Phase B are off the path, and nothing of them was built.
- **No query-only optimization was worth keeping.** `…12`, `…14` and `…15` are byte-identical to `bf7d5d6`. The enforced two-run acceptance was not rerun on unchanged code, so **performance acceptance remains failed** (summary and state at agency-366; journey at agency-366 on the slower CI runner), and PKG-A is not release-ready. No other cache architecture is proposed; the next step is Chris's decision.
- No migration, reader, helper, workflow, runner, reference-source, telephony, `TwilioContext`, duration-writer or v2 change. No hosted command, production grant, enablement, release runner or deployment. `…17` is untouched.
- **Still pending:** ★1, ★4, E1–E6 acceptance, the campaign-copy fallback security review, the named reviewer and the PKG-A production approval. No agency-only fallback.

**Changed (tracked).**
- `supabase/tests/reference/reports_v3_reference_manifest.json`: `scale_cases` 19 → 25 (six journey reader cases) and `scale_note`. The pinned sources, the reference-only repair and `generated_sha256` are unchanged, so the frozen reference implementation is unchanged.
- `supabase/tests/reports_v3_differential.sql` (part 2): the journey reader cases run only with `REPORTS_V3_DX_JOURNEY_SCALE=1` (`\getenv`). It always asserts the variable's value and that the six cases are pinned, and requires `6/6` payload_equal when enabled and `0/0` otherwise. It prints and records `journey_reader_cases` as `compared` or `not run`.
- `src/lib/__tests__/reportsV3Contracts.test.ts`: pins the 25 scale cases, the six journey cases in order, and the gate's text in the differential.
- `docs/plans/2026-10-31-reports-v2/implementation_plan.md` §14.G; D1 §3.11, D3 and D5 §3.3 notes; `appendix/tests.md` (the differential row; total 276).
- `implementation_plan.md`: the scope entry (written first, pushed as `80c1ba6`) and its outcome. This entry.

**Candidates** (scratch schemas in a disposable 500k database, PostgreSQL 16.15, diagnostic only; each copy differs from the installed function only in its `@call-pointers` block, with byte identity asserted).
- **Q1** (summary, state, journey rows): one `MATERIALIZED` pass over the window's calls collects both pointer kinds instead of one DISTINCT pass per kind. The window bound is kept, so no scope becomes organization-wide.
- **JU** (journey rows only): the pointer sets are the CRM tables' ids in the organization, resolved live, so the history pass needs no pointer pass over the calls.
- **Equivalence before timing: 1,448 comparisons with the current code, 0 differences** (Q1: 816 reader cases and 180 journey-helper cases; JU: 272 reader cases and 180 journey-helper cases).

**Measurements** (interleaved in one session, arm order rotated, 0 timeouts; p95, paired median in brackets).

| Reader | Combination | Current | Q1 |
|---|---|---|---|
| summary | agency-366 (miss) | 2,316.5 ms | 2,334.4 ms (−16.0) |
| summary | agency-30 / personal-366 / agency-366 one agent | 606 / 243 / 269 ms | −54 / −46 / −65 ms |
| state | agency-366 (miss) | 2,346.5 ms | 2,344.4 ms (−27.1) |
| state | team-30 / agency-366 one agent | 495 / 463 ms | −80 / −64 ms |
| journey | agency-366 (miss) | 4,330.6 ms | 4,898.7 ms (+687.7) |

- Summary and state: 20 samples after warm-up over eight combinations each, narrow and wide. Journey: an 8-sample screen over seven combinations; both candidates regressed every combination (Q1 +745 to +798 ms, JU +849 to +994 ms paired), so no 20-sample run was spent on them.
- **Rejected, per reader:** summary and state, because the miss does not move and the gains fall only where the reader already passes (keeping them would split the shared `@call-pointers` text for no gate effect); journey, both candidates, as repeatable regressions. A `MATERIALIZED` CTE and the CRM-universe union are parallel-restricted and remove the history pass's Gather; JU's universe resolution (465 + 160 ms) also costs as much as the calls pass it removes (457 + 121 ms).

**Journey reader scale coverage** (local, PostgreSQL 16.15).
- **Opt-in: 4 of the 6 journey cases compared, all `payload_equal`** (identical payload hashes): agency 1 day, team 30, personal 366, and agency 366 for one agent. Each ran in its own REPEATABLE READ transaction (public and baseline on one snapshot) with the differential's exact `rt.dx_case` expression, six in parallel on the surviving database of the full run. Reader grants were committed once around the runs instead of being toggled per transaction, because parallel `GRANT`s on the same functions would serialize.
- Baseline-dominated wall times in parallel: 3,012 s, 3,934 s, 7,327 s and 7,317 s. Alone, the baseline's agency-1 call took 1,880 s; the public reader 1,424 ms.
- **Agency 30 and agency 366 days were not compared.** The full gated opt-in run (started 08:40 UTC) and two per-case attempts were each lost when the session's container restarted (about 13:50, 16:24 and 18:48 UTC); the uncommitted transaction goes with it. These two baseline calls ran more than 2 h 20 min on each attempt, on one CPU each, without finishing, so they cannot complete in this environment. **They remain unverified at scale** and are not counted as compared.
- The texts that said "about 31 minutes per baseline call" were corrected to "31 minutes to more than 2 hours", and the default path was rerun on the corrected files.
- The default path (the variable unset, as CI runs it) passed through the gated runner: fixtures 0 mismatches (1,428 payloads, 708 refusals, 180 journey, 120 by-agent, 55 resolver); scale 0 mismatches (19 reader payloads, call facts 2, resolver 1, journey helpers 1); `journey_reader_cases: not run (REPORTS_V3_DX_JOURNEY_SCALE unset)`.
- **CI coverage of the six cases needs an approved workflow change** (for example a dispatch-only job with a longer limit). The differential job's 60-minute limit already holds a 36.6-minute run.

**Checks** (hardened exit-status ledger).
- The differential, default path, on the final files: exit 0, 0 mismatches (fixtures: 1,428 payloads, 708 refusals, 180 journey, 120 by-agent, 55 resolver; scale: 19 reader payloads, call facts 2, resolver 1, journey helpers 1), `journey_reader_cases: not run`.
- SQL suites: `reports_rpc` 0, `reports_v3` 0, `profile_rpc` 0. `reports_integrity` failed (exit 3, "Selective date-window index was not used") while it ran beside the multi-hour REPEATABLE READ differential, whose snapshot holds back the xmin the new index needs; **rerun alone on an idle cluster: exit 0**, with no file left in the checkout.
- Vitest, on an idle machine: 6,767 tests, 6,730 passed; the 13 failing files and 2 failing tests are identical by identity to the Batch 7 baseline. A run under the journey queries' CPU load showed three extra timing failures in untouched files (a 5.1 s timeout against 5 s); they did not recur idle.
- **PostgreSQL 17.6 CI** (manual dispatch, `performance_acceptance` false), run 41702506540 on `ff40bdb`: `postgres` and `differential` passed; the differential reports 0 mismatches (fixtures and scale) and `journey_reader_cases: not run (REPORTS_V3_DX_JOURNEY_SCALE unset)`. The acceptance jobs were skipped, as selected.
- Contract test 41/41; scoped eslint 0; `npx tsc --noEmit` 0; build 0; `npx tsc -p tsconfig.app.json --noEmit` exit 2, 222 lines, byte-identical to the baseline.

**Evidence:** the bundle `reports_v3_b8_evidence_80c1ba6.tar.gz` (sha256 `7e17f9153bfa3ea605c769d18dc9d7af1596241cde1bd858566278b5ff6aef28`), delivered to Chris outside the repository: the scripts, generated SQL, equivalence outputs, raw samples, plans, the differential and journey-case outputs (including the lost runs' logs) and the check logs.

**Blockers and next steps.**
- Performance acceptance is not passed, and no remedy is proposed; the next step is Chris's decision.
- The journey reader's agency 30 and 366 day cases are unverified at scale. Comparing them needs a run longer than this environment allows, for example an approved dispatch-only CI job with a longer limit.
- ★1, ★4, E1–E6, the fallback review, the named reviewer and the PKG-A production approval remain pending.

## 2026-11-03 — Reports V2 PKG-A X1: isolated pointer-map read-path experiment; recommendation: stop the maintained layer (branch `claude/great-goodall-911azc`; documentation only; NOT merged, applied, enabled or deployed)

**Status.**
- X1 was approved alone. **Phase B and X2 are not approved, and neither was started.**
- Performance acceptance remains failed, and PKG-A is not release-ready.
- No migration, production-reader, workflow, telephony, `TwilioContext`, duration-writer or v2 change. No hosted command, grant outside the disposable harness, enablement or deployment. `…17` is untouched.
- **Still pending:** ★1, ★4, E1–E6 acceptance, the campaign-copy fallback security review, the named reviewer and the PKG-A production approval. No agency-only fallback.

**Changed (tracked).**
- `implementation_plan.md`: the X1 scope, written first and pushed as `abe6e0b`, and its outcome.
- `docs/plans/2026-10-31-reports-v2/implementation_plan.md`: §14.F (the measured result and recommendation), the B5/B6 correction (out-of-order journal commits) and a supersession note in §14.A.

**Experiment** (disposable loopback databases; PostgreSQL 16.15; diagnostic only; not an acceptance run).
- **Prototype:** the scratch `x1.pointers` was populated from the live resolver text: 225,500 rows for the scale organization in 1.07 s, 48 MB with indexes. Each arm copies the reader and replaces only its `@call-pointers` block, with byte identity asserted.
  - W: the window's pointer sets mapped by keyed lookup.
  - U: the whole organization's stored rows.
  - F: W plus the §14 B4/B7 freshness gate and live branch.
- **Equivalence with the current code:** 2,732 comparisons and 0 differences, covering:
  - the fixture inventory (1,408 payloads, 704 refusals);
  - 540 journey-helper cases;
  - the 15 scale inventory cases;
  - the 48 measured-combination cases;
  - 6 scale journey-helper cases;
  - verify over 11 organizations.

  Controls: 8 of 8.
- **A/B, p95, agency-366** (20 interleaved samples, 0 timeouts):

  | Reader | Baseline | W | U | F |
  |---|---|---|---|---|
  | summary | 2,387 ms | −2.4% | −14.4%, still 43 ms over | −3.0% |
  | state | 2,343 ms | −1.7% | n/a | −1.9% |
  | journey | 3,814 ms | +2.3% | −8.9% | +20.0% |

  - U regresses small summary scopes by 38–104 ms (paired).
  - F loses the journey history pass's parallel plan: about +0.8 s on every journey combination.
- **Plans:** the resolver's joins are negligible. The attributable pointer cost is the second pass over the window's calls that builds the distinct pointer sets.
- **Recommendation: stop the maintained pointer layer.** It does not support further investment for summary or state, and the journey gain alone does not justify it.
- **Evidence:** the bundle `reports_v3_x1_evidence_772e883.tar.gz` (sha256 `fddeed87…d08225`), delivered to Chris outside the repository. A proposed PostgreSQL 17.6 CI mode is included as a patch and is not applied.

**Design correction.** §14 B5/B6's high-water mark is unsafe: a `bigserial` id is allocated at insert, not at commit. The counterexample: id 100 is uncommitted while 101 commits, repair records 101, then 100 commits before cleanup. Global acknowledgments fail the same way. This is recorded as a pending concurrency proof, with no mechanism chosen. The mandatory journal append's ability to fail the CRM write remains unapproved.

**Checks:** the hardened exit-status ledger (see the checkpoint commit).

## 2026-11-03 — Reports V2 PKG-A Batch 7 checkpoint review: verification hardening, differential-job allowance, parallel-safety review and the Phase B design delta (branch `claude/great-goodall-911azc`; documentation and one workflow timeout only; NOT merged, applied, enabled or deployed)

**Status.**
- Batch 7 (Phase E, Phase A, KPI 24) is a completed branch checkpoint at `d2bba9e`. **Performance acceptance remains failed**, and PKG-A is not release-ready.
- No SQL, schema, trigger, reader or planner-setting change. No hosted mutation, migration, grant, enablement, release runner, deploy or settings change. No telephony, TwilioContext, duration-writer or v2 change. `…17` is untouched and Phase B is not implemented.
- **Still pending:** ★1, ★4, E1–E6 acceptance, the campaign-copy fallback security review, the named reviewer and the PKG-A production approval. No agency-only fallback.

**Changed.**
- `.github/workflows/reports-backend.yml`: the `differential` job's `timeout-minutes` 45 → 60. The CI run of `66663f4` used 36 m 37 s. All other workflow values are unchanged: the 8 s request timeout, the 2 s and 4 s targets, 147 combinations, 20 samples, and two passing runs.
- `implementation_plan.md`: the checkpoint authorization (written first), the verification procedure and the outcome.
- `docs/plans/2026-10-31-reports-v2/implementation_plan.md` §14: the Phase B design delta.
- D1 §3.9, D3 §3.2, D5 §3.3: the parallel-safety findings.

**Verification hardening.**
- Every required check runs with `pipefail`. Its status comes from `PIPESTATUS[0]` or `wait PID` and goes into a ledger. The commit and push stage runs only when every required step shows 0.
- Demonstrated without committing:
  - a deliberate foreground failure, a background failure and a missing step each stopped the stage;
  - a passing run reached it (dry-run stand-in);
  - the old `| tail` pattern let the failure through, which was the `3dd8f87` slip.
- No new tracked script; the procedure is recorded in the plan.

**Parallel-safety findings.**
- **Reviewed:** the six helpers marked in Batch 7, all PARALLEL RESTRICTED:
  - `local_day_start(date,text)`;
  - `identity_receipts(uuid,uuid[])`;
  - `identity_numbers(uuid,text[])`;
  - `sale_call_links(uuid,timestamptz)`;
  - `first_sales(uuid,timestamptz)`;
  - `identity_states_by_id(uuid,uuid[],uuid[])`.

  And their callees: `client_identity_key`, `phone_last10` (SAFE), `state_classify` (SAFE) and `normalize_us_state`.
- **No actually unsafe operation** in the transitive closure: no write, sequence, subtransaction or `set_config`; only reads and constant `EXECUTE … USING`.
- **Plans** (VERBOSE, 500k fixture): the journey statement's only Gather covers the history pass, with no `report_v3_*` call beneath it; every helper runs in the leader. The state statement is serial: `report_v3_sale_facts` is UNSAFE.
- **Forced-parallel check** (parallel costs 0, `debug_parallel_query = on`, isolated functional database): the payloads of ADM1, A1, A2 and A3 were byte-identical to the normal plans, and the seal held.
- **Label mismatch, not an unsafe dependency:** the production `public.normalize_us_state` (pure, md5 `c80ff9ad…`, UNSAFE by default) sits under the SAFE `state_classify`. It is left unchanged because it is protected.
- **Replacements:**
  - PKG-C `…32` replaces `sale_call_links`. Its preimage includes PARALLEL RESTRICTED; the replacement keeps the marking only after review, and the rollback restores it.
  - PKG-B replaces `report_v3_sale_premium` (`…21`), which sits under `sale_facts`, outside the restricted set.
  - After any replacement, rerun the pins and tests listed in D3 and D5.

**Phase B design delta** (proposal; §14).
- **Benefit** (measured CI p95, overlapping instrumented node times, estimates labelled):
  - the layer alone is **not** expected to clear summary (2,770.9 ms) or state (2,752.9 ms) at agency-366, with estimates of −0.25 to −0.45 s;
  - journey (4,426.8 ms) is borderline (−0.35 to −0.5 s);
  - an isolated experiment X1 is proposed before any claim.
- **Correctness:**
  - a pending journal committed together with the CRM write, so maintenance and marker cannot both be lost;
  - the WHEN OTHERS boundary, under which 57014 cancellation and P0004 assertion propagate;
  - freshness evaluated inside the reader's one snapshot;
  - online, high-water-mark repair;
  - per-organization clearing of global rows;
  - a live fallback when objects are missing;
  - trigger-disable detection, with the bypass and restore exposure window stated (the read path does not verify).
- **CRM impact:** conversion, inbound auto-create, cascades, imports and bulk deletes are in scope. The total budget is a key cap plus a deadline, because a per-lock timeout is not a budget. Subtransaction overflow is to be measured (X2).
- **Install and recovery:** a lock window for trigger creation only, then online per-organization backfill. Rollback and repair are built and rehearsed with any implementation.
- **Approval list:** version placement (a, b or c, since `…17` cannot move), files, objects, experiments X1 and X2, mechanisms and acceptance criteria.

**Checks** (ledger, all exit 0):
- YAML validity, and a one-line workflow diff;
- `reportsV3Contracts.test.ts`: 40 of 40, as at baseline;
- `git diff --check`;
- the path-scope check;
- the push-automation check: only `s1-plan-verify.yml` runs on push, and only for `main`.

The acceptance matrix was not rerun, which this documentation and timeout change does not require.

**Next.** Stopped before further performance implementation. Chris's decisions:
- the §14 approval list (placement, X1 and X2 first);
- whether summary and state need non-Phase-B work, since the layer alone is not expected to clear them.

## 2026-11-02 — Reports V2 PKG-A Batch 7: Phase E (evidence and acceptance), Phase A (SQL performance) and the KPI 24 pre-release amendment; performance acceptance NOT passed (branch `claude/great-goodall-911azc`; NOT merged, applied, enabled or deployed)

**Status.**
- **Authority:** Chris's Batch 7 message: Phase E, Phase A and the KPI 24 pre-release amendment, branch-only. **Phase B is not authorized**, and nothing of it was built: no maintained identity table, trigger, repair function or stored/live mode.
- **Sealed:** every reader and helper is still created sealed. Grants exist only inside the disposable measurement databases, and the seal is re-asserted after every run.
- **Performance acceptance is NOT passed.** CI run 41541165337 on `66663f4` (PostgreSQL 17.6, 147 combinations × 20 samples, enforced):
  - run 1 (Intel Xeon 6973P-C): 147 of 147;
  - run 2 (AMD EPYC 7763): 144 of 147. The misses are summary agency-366 (p95 2,770.9 ms against 2,000), state agency-366 (2,752.9 against 2,000) and journey agency-366 (4,426.8 against 4,000);
  - both runs must pass, so the verdict is FAIL. Run 1's pass is not acceptance evidence on its own.
- **Stopped for review**, as the approval requires: no further architecture is proposed here, and the measured remaining cost is below.
- **Still pending:** ★1 and ★4; E1–E6 acceptance, including the campaign-copy fallback's security review; the named reviewer; the PKG-A production approval. No agency-only fallback exists.
- **Not touched:** applied migrations, `AGENT_RULES.md`, v2 bodies and privileges, telephony, `TwilioContext`, the duration writers and their guards, and the `…17` placeholder.

**Commits** (all pushed; no force push).
| Commit | Change |
|---|---|
| `d099277` | Batch 7 plan entry (the first edit) |
| `2d9702c` | Phase E: committed differential harness and enforceable two-run performance acceptance |
| `6cb3571` | Phase A, shared block: keyed disposition joins and exact-value direction classes (all 8 copies) |
| `62d498e` | Phase A, journey: typed narrow history, numbers normalized once, PARALLEL RESTRICTED helpers |
| `3f961e2` | Phase A, state: typed resolution inputs and narrower intermediates |
| `3dd8f87` | Static-test follow-up for `3f961e2` (see "Process slip") |
| `a2a7982` | Phase A, summary: one per-agent grouping |
| `66663f4` | KPI 24 pre-release amendment `kpi24-quality-a1`. CI tested this commit. |

**Phase E** (`2d9702c`).
- **Differential** (`scripts/run_reports_v3_differential.sh`, `supabase/tests/reports_v3_differential.sql`). It compares the code under test with the reviewed baseline `4236b8a`:
  - the baseline is generated mechanically into `rtref` by `scripts/reports_v3_reference.py`, with the one documented reference-only UUID cast repair. Every source blob, source hash and the generated hash are pinned in `supabase/tests/reference/reports_v3_reference_manifest.json`;
  - both sides run in one REPEATABLE READ snapshot, with the same `now()`, role and claims. jsonb equality keeps array order;
  - every case comes from the pinned inventory with its expected outcome type: 2,136 reader cases, 1,428 payloads and 708 refusals. A matching error never stands in for a payload;
  - three planted self-controls bite;
  - retained comparisons: the resolver (55 adversarial cases and a 9,957-key scale sample), the journey (180 sets and 120 by_agent rows), call facts against pinned v2 and the baseline on 457,311 rows, and 19 scale reader cases;
  - the evidence is sanitized (outcomes and sha256 only) and written outside the tree, with a manifest.
- **Acceptance** (`scripts/run_reports_v3_perf_acceptance.sh`, staged `reports_v3_performance.sql`, `scripts/reports_v3_perf_verdict.py`):
  - 147 combinations; one warm-up round, 20 measured rounds and a first-after-restart round; nearest-rank p95 on the unchanged 2 s and 4 s targets; the unchanged 8 s statement timeout;
  - missing samples, timeouts (warm-up and restart included) and unexpected errors fail;
  - only an enforced PostgreSQL 17.6 run with every requirement is acceptance-eligible. Diagnostic runs never are;
  - gate controls, a negative-control mode, seal verification, and evidence on failure;
  - two runs of one SHA are aggregated, with no best-of.
- **Workflow:** the functional job measures nothing. The differential runs on PRs and dispatch. The two-run acceptance, the negative control and the verdict run only when a manual dispatch selects them.

**Phase A** (SQL only, one area at a time). Each change has a same-session interleaved A/B and a clean differential.
- Unless stated otherwise, A/B figures are median ms of 5 samples after warm-up, on local PostgreSQL 16.15 with production session settings and the 500,000-call fixture.

1. **Shared call-row block** (`6cb3571`).
   - Dispositions: one organization-scoped `NOT MATERIALIZED` set, joined by id when the call has one (no name fallback), else by `lower(name)`, which `dispositions_org_lower_name_unique` makes unique.
     - A materialized version broke call volume's parallel plan (1,262 → 2,108 ms) and was replaced.
   - Direction: the exact lower-case values are matched before `lower()`.
   - Tests: v2 matching and precedence, row cardinality, and the whitespace and other-organization variants the schema allows; direction classes. A planted error fails them.
   - A/B, original → keyed → keyed + direction:

     | Reader / window | Original | Keyed | Keyed + direction |
     |---|---|---|---|
     | Summary, agency-366 | 3,520 | 3,428 | 2,997 |
     | State, agency-366 | 2,981 | 3,006 | 2,800 |
     | Call volume | 1,219 | 1,191 | 779 |
     | Dispositions | 1,409 | 1,389 | 1,209 |
     | Campaign | 1,123 | 1,046 | 859 |
     | Lead source | 598 | 565 | 503 |
     | Journey, agency-1 | 4,094 | 4,051 | 3,259 |
     | Journey, agency-366 | 6,977 | 6,663 | 6,293 |
     | Journey, personal-366 | 4,187 | 4,217 | 3,420 |
2. **Journey** (`62d498e`).
   - The history pass keeps narrow rows. Each identity is a (uuid, kind) pair; its `identity_key` is NULL exactly when the kind or the uuid is. The text key is built only for member identities.
   - `identity_numbers` normalizes each number once.
   - The five helpers the statement calls are PARALLEL RESTRICTED. They are read-only and use no subtransaction, and they run in the leader. Their default PARALLEL UNSAFE had made the whole statement serial. A test pins the marking, and D3 records it for PKG-C's stub replacement.
   - A/B for typed rows: agency-1 3,207 → 2,924; agency-366 5,958 → 5,235; personal-366 3,398 → 2,901; team-366 4,736 → 4,140.
   - A/B for restricted helpers, on top: agency-1 3,007 → 2,011; agency-366 5,361 → 4,507; personal-366 3,164 → 2,108; team-366 4,509 → 3,486.
3. **State** (`3f961e2`).
   - The rules run in the new `report_v3_identity_states_by_id(org, lead ids, client ids)`. The key form parses its keys exactly as before and reads it.
   - The reader passes typed ids and joins pointers and policies to states on (kind, uuid). No text identity key is built, parsed or compared on its path.
   - The ids are deduplicated before the statement. A DISTINCT inside it had cost the hash joins.
   - A/B, median (p95): agency-366 2,791 (3,281) → 2,562 (2,681); team-366 1,255 → 1,131; personal-366 475 → 450.
4. **Summary** (`a2a7982`).
   - One `GROUPING SETS ((agent), ())` grouping replaces the identity-level sort.
   - `reached` is the distinct lead ids plus the distinct client ids. `lead_identities` is the distinct lead ids. The scope's own grouping set counts its identities once.
   - A/B for the whole reader, median (p95): agency-366 2,786 (2,949) → 2,408 (2,516); agency-30 602 → 571; team-366 878 → 821.

- **Measured and not adopted:**
  - a per-disposition "no answer" precomputation: within noise;
  - outbound-only summary rows: no gain;
  - a fenced per-row flag projection: slower;
  - PARALLEL RESTRICTED state-statement helpers: no agency-366 gain, and `report_v3_sale_facts` (`…11`) is outside this batch's files.
- **Not done (a settings decision):** with lower planner parallel costs, set for one session as a diagnostic only, the summary's call statement takes a parallel plan, about 1.9 s → 1.4 s locally.

**KPI 24 pre-release amendment** (`66663f4`).
- **Precondition.** It amends 3.0.0 in place because no v3 consumer has shipped. All three conditions were checked on 2026-11-02:
  - `main` (`6e39c15`) has no v3 file;
  - nothing outside the PKG-A tests calls a v3 reader;
  - the hosted migration history ends at 20261029200000 (a read-only listing).
- **Rules, over attempt rows:**
  - `inconsistent` (new) is a non-conflicting `terminal_non_answer` row recorded above 0 s;
  - `provider_confirmed` needs a recorded duration: `provider`, or `terminal_non_answer` at exactly 0;
  - a missing duration never counts as `provider_confirmed`. It counts as `unknown` unless the row is conflicting. A recorded zero is not a missing duration;
  - unchanged: the value, conflict precedence, KPI 25, and every stored duration and writer.
- **Tests:**
  - the six cases;
  - a missing-duration day and a recorded provider zero;
  - per-agent output, through each agent's summary and through `report_v3_agent_call_stats`;
  - scope totals: the agency figure is the sum of its agents', and by_agent values sum to the value;
  - the empty window;
  - October's agency quality, against an independent count of its rows: estimate 1, legacy 4 (one with a missing duration), provider 3, conflicting 1, and one non-answer recorded at 20 s;
  - two negative controls.
- **Differential.** It admits only `kpi24-quality-a1`, key by key, against counts from the baseline's own call rows. The rest of every summary payload must equal the baseline.
- **Docs:** D1 §3.5, D3, D6 (planned PKG-F schema keys and the coverage and CSV Note text), `tests.md`, and the main plan's key table. PKG-F is not started.

**Correctness comparisons** (differential against `4236b8a`, no mismatch in any run).
- **Local** (PostgreSQL 16.15), after every change:
  - fixtures: 1,428 payloads, 708 refusals, journey 180, by_agent 120, resolver 55;
  - scale: 19 readers, journey 1, call facts 2, resolver 1.
- **CI** run 41541165337 (PostgreSQL 17.6, `66663f4`): the same counts. Approved differences: `kpi24-quality-a1`. Run time: 36 m 37 s, against the job's 45-minute limit.

**Performance evidence (CI, PostgreSQL 17.6, p95 ms).**
| Combination | Before: run 41517981836 on `2d9702c`, both runs AMD EPYC 7763 | After, run 1: Intel Xeon 6973P-C | After, run 2: AMD EPYC 7763 |
|---|---|---|---|
| summary agency-366 (2,000) | 3,859.6 / 3,721.0 | 1,988.7 | 2,770.9 |
| state agency-366 (2,000) | 3,543.2 / 3,339.5 | 1,853.1 | 2,752.9 |
| journey agency-366 (4,000) | 7,480.3 / 7,266.5 | 3,098.2 | 4,426.8 |
| journey team-366 (4,000) | 6,253.6 / 6,053.8 | 2,239.1 | 3,108.1 |
| journey agency-30 (4,000) | 5,165.3 / 5,032.1 | 1,914.3 | 2,671.1 |
| journey personal-1 (4,000) | 4,399.5 / 4,223.2 | 1,476.2 | 2,014.6 |
| combinations passing | 127 / 127 | 147 | 144 |

- On the same AMD EPYC 7763 runner class as the baseline, the 20 misses fell to 3. Run 2 was slower than run 1 almost everywhere: the median ratio per reader is 1.30–1.72.
- Local timings of the final code (PostgreSQL 16.15, 7 samples, median / p95):

  | Reader / window | Median | p95 |
  |---|---|---|
  | Journey, agency-366 | 4,162 | 4,374 |
  | Journey, team-366 | 3,281 | 3,311 |
  | Journey, agency-1 | 1,869 | 1,950 |
  | Summary, agency-366 | 2,282 | 2,311 |
  | State, agency-366 | 2,288 | 2,509 |

**Measured remaining cost** (local instrumented plans of the final code, agency-366; timings overlap). No further architecture is proposed here.
- **Journey** (about 4.2 s; 4.4 s p95 on the AMD runner):
  - the one pass over the whole history, about 1.6 s wall, run in parallel. Each process builds its own resolution of the 85,360 contact pointers (about 0.5 s);
  - the candidates' ordered linked history, 398,275 rows: about 0.7 s;
  - member numbers 0.5 s, receipts 0.3 s, and gates, links and output about 0.8 s.
- **Summary** (about 2.3 s):
  - the call statement, about 1.9 s:
    - the base call pass (scan, disposition and admission joins): about 0.9 s;
    - resolving and attaching the window's 82,812 contact and 16,376 membership pointers: about 0.9 s;
    - the sort and grouping: about 0.5 s;
  - production about 0.3 s; sessions and payload about 0.2 s.
- **State** (about 2.3 s):
  - pointer resolution about 0.5 s;
  - sale facts about 0.3 s;
  - the typed resolver about 0.5 s;
  - the per-call pass about 1.4 s: base pass 0.6 s, pointer grouping 0.24 s, state attachment 0.3 s.
- **The common floor** is the per-request resolution of every call pointer in the window (or, for the journey, the history) and the base pass over about 457,000 calls.

**Tests.**
- **Local:**
  - every functional v3 suite after every change;
  - the CI-equivalent backend suites, all pass: `run_reports_rpc_tests`, `run_reports_integrity_tests`, `run_reports_v3_tests`, `run_profile_rpc_tests`;
  - static contract tests: 40 of 40;
  - `npx tsc --noEmit`: exit 0;
  - `npx tsc -p tsconfig.app.json --noEmit`: exit 2, with 222 lines of pre-existing errors, identical to the `6e39c15` baseline. There are no new errors;
  - scoped ESLint: 0;
  - `npm run build`: pass;
  - full Vitest: 11 failing files and 2 failing tests, identical to the `6e39c15` baseline. Branch totals: 6,766 tests, 6,727 passed.
- **CI run 41541165337:**
  - functional and real-page jobs: pass;
  - differential: pass;
  - negative control: failed as planted;
  - acceptance: run 1 pass, run 2 fail;
  - verdict: FAIL.
- **Database security:** the seal and helper-shape assertions, the security suite and the integrity privacy and mutation proofs pass in the isolated databases. No hosted change was made, so the advisors were not run.

**Process slip.** `3f961e2` was pushed while two static contract assertions still described the old two-helper `…14`: a pipe to `tail` hid vitest's exit code. `3dd8f87` fixed them. No force push.

**Migration and deployment state.**
- Nothing is applied to any hosted database; the history still ends at 20261029200000.
- No PR, no merge, no push to `main`, no grant or enablement, no release runner, no deploy.
- The branch's access-protected Vercel preview is the only automatic artifact.

**Next steps (Chris's decisions).**
- Performance acceptance is not passed. Any further performance work, Phase B included, needs a separate decision. Phase B's proposal must first resolve the questions listed in the Batch 7 approval.
- The CI differential job used 36.6 of its 45 minutes. A bounded timeout increase may be worth approving before it grows.
- Still open: ★1, ★4, E1–E6, the campaign-copy fallback review, the named reviewer and the PKG-A production approval.

## 2026-11-02 — Reports V2 PKG-A Batch 6: performance and correctness hardening; the performance gate is built and NOT passed (branch `claude/great-goodall-911azc`; NOT merged, applied, enabled or deployed)

**Status.**
- **Authority:** Chris's Batch 6 message, under the 2026-11-01 branch-implementation approval for PKG-A's reviewed file list. Normal checkpoint pushes and manual `reports-backend.yml` dispatches are authorized; nothing else is.
- **Sealed:** every reader and helper is still created sealed. The harness grants EXECUTE to `authenticated` only inside the disposable database, for the measurement, then revokes it and re-asserts the seal.
- **Not release-ready.** The performance gate is not passed in either environment (below):
  - locally (PostgreSQL 16.15, 20 samples), 43 of 51: summary and state miss at 366-day agency scope, and journey misses at every combination;
  - on PostgreSQL 17.6 CI at the final head (run 41408083919, 5 samples), 43 of 51 with the same misses. An earlier run of the same code on a faster runner gave 48 of 51.
  - The release suite, the recovery proofs and the security review are also still open.
- **Still pending:** ★1 and ★4; E1–E6 acceptance, including the campaign-copy fallback's security review; the named reviewer; the PKG-A production approval. No agency-only fallback exists.
- **Not touched:** applied migrations, `AGENT_RULES.md`, telephony, the duration writer and its guard, v2 bodies and privileges, the runner and the workflow.

**What changed.**
- **Correctness defect fixed (`…12`).** `report_v3_contact_identity` cast `substr(identity_key, 6)::uuid` in a join condition guarded only by `AND`. At 500,000 calls the planner hashed on the cast for client keys, and every call-based reader raised 22P02. The cast now sits under `CASE`.
- **One call pass per reader (`…15`).** The four call readers, the summary and the state reader each run one constant statement, planned for the call's bounds (`EXECUTE $q$ … $q$ USING`).
  - The call rows come from one shared block of SQL text. It is copied byte for byte into every reader and into `report_v3_call_facts`; the static test checks the copies.
  - The block reproduces the pinned v2 rows exactly. The calls suite compares `report_v3_call_facts` with `private.report_call_facts` on every carried column.
  - Pointers resolve once each (`-- @call-pointers`) and attach to calls by single-key hash joins (`-- @call-identity`).
  - Reviewed duplicates are counted from the reviewed rows (`report_v3_duplicates_excluded`). KPIs 5 and 6 come from one shared builder (`report_v3_attempt_kpis`).
- **State (`…14`, `…15`).**
  - `report_v3_identity_states` is now set-based. It is PL/pgSQL running two constant statements: keys are validated exactly as before (the same pattern, without a regex) and deduplicated, then each key's records are read in one row.
  - It relies on `uq_clients_lead_id` for at most one converted client per lead, and the `…14` preflight now refuses to install without that index. Speed: 18 s → 0.27 s on 20,000 keys; 64,100 keys in about 0.6 s.
  - The state reader looks a state up once per pointer, groups calls by pointer first, and takes KPI 1 and 2 statuses from its own sale facts, so the second production pass is gone.
- **Journey (`…12`, `…15`).**
  - `report_v3_journey_rows` reads the organization's call history before `as_of` in one pass, for every agent and every date. The pass must be complete because unresolved activity and numberless calls count every unresolved call in the lookback.
  - Candidates come first: in-window journey contacts credited in scope, plus the sold window's first buyers. Only their linked histories are then ordered.
  - The gates are set-based: the earliest related call, phone change and unverified attempt per member, and attempts from one ordered pass.
  - `report_v3_journey_facts_by` computes the scope's counts and every by_agent row's counts from that one member set, plus the counts of an agent with no members. Each group counts only its own rows and computes its own medians; nothing is summed or averaged.
  - `report_v3_journey_members` and `report_v3_journey_facts` keep their signatures as views of the new helpers. The reader calls the journey once, not N+2 times.
  - Supporting rewrites:
    - receipts match import history set-based, with exactly the `?` operator's matches (53 s → 0.27 s for 59,100 leads);
    - numbers use single-key joins;
    - first sales build each first-sale set in one grouping (3.5 s → 0.12 s);
    - call facts use the shared block (19.3 s → 3.6 s over the whole history).
- **Sale facts (`…11`).** The premium stub is PL/pgSQL with the same result; it was 200 µs per sale as SQL and is 72 µs now. D2 records this.
- **KPI 24 (talk time).** The six evidence cases are tested (below). The inconsistent case has a proposal, which is not applied.
- **Performance suite** (`supabase/tests/reports_v3_performance.sql`, new). `scripts/reports_v3_fixture.py` appends it after the functional suites.
  - Fixture: one organization with 500,000 calls, 59,100 leads, 80,000 memberships, 5,000 clients, 10,000 policy objects with one sale each, 10,000 appointments, 63,100 history events and 17,383 sessions.
  - Calls go through the public readers as `authenticated`, with JWT claims, under production's session planner settings. Each sample is its own statement under the 8 s `statement_timeout`.
  - Matrix: 51 combinations. One warm-up round, then N measured rounds, interleaved; nearest-rank p95.
  - `auto_explain` logs EXPLAIN (ANALYZE, BUFFERS) for each reader's 366-day agency path.
  - The verdict table is printed. `REPORTS_V3_PERF_ENFORCE=1` makes a miss fail the run; CI runs in report mode with N = 5.

**Correctness comparison.**
- **Method:** the reviewed head's (`4236b8a`) reader and helper bodies were mechanically renamed into a scratch schema, with only the cast guard added (not committed; a new test path needs approval). Both versions run in one REPEATABLE READ snapshot, and payloads are compared by jsonb equality with array order kept.
- **Matrix:** 2,136 cases, all equal, 708 of them equal errors (same SQLSTATE and message).
  - Coverage: 24 persona, scope and filter cases × 11 windows × the 8 windowed readers, plus the scope reader.
  - Scopes and filters: agency, team, personal, single-agent filters, a cross-organization agent, refused scopes and other organizations.
  - Windows: month, single days, both DST days, an empty day, a future month, a 366-day window and a straddling window.
  - Rerun after every step, last on the final code.
- **Identity-state resolver against the reference body:**
  - 55 of 55 adversarial cases are equal: 605 rows over 6 organizations, including own, foreign, duplicate, NULL, unresolved and malformed keys (case, whitespace, braces, a missing dash, non-hex, multibyte, an empty key);
  - a 7,123-key sample of the scale data is identical (107 campaign-copy rows, 863 conflicts, 184 with history).
- **Journey at scale:** personal scope, 30-day window. 58 member rows are identical in both directions and the facts are equal; the gates seen were none, hand_entered_client, phone_changed, possibly_related_unlinked_call and receipt_contradicted. The old path takes 34 s for the members and 44 s for the facts; the new one takes 7 s and 6 s.
- **The suites' own expectations are unchanged:** every journey (BC1–BC5), state, call, sale, security and negative assertion written for Batch 5 passes on the new bodies. The controls whose target text moved were retargeted to the same defect: 4 resolver, 3 journey, 2 call-facts and 2 reader controls.

**Performance results.**
- **Before Batch 6** (single runs on the reviewed head, with a scratch cast fix): every call-based reader timed out (over 8 s) at 366 days, at any scope. Journey timed out at every window, 1 day included. State timed out from 30 days.
- **After: local evidence run.** PostgreSQL 16.15 (the local cluster; CI is the 17.6 evidence), the gate suite exactly as CI runs it with `REPORTS_V3_PERF_SAMPLES=20`: one warm-up round, then 20 measured rounds interleaved over 51 combinations, under production's session settings and the 8 s `statement_timeout`. Verdict: **43 of 51 combinations meet their target.** p95 in ms:

  | Reader (target) | agency 1 d | agency 30 d | agency 366 d | team 366 d | personal 366 d | agency 366 d, one agent |
  |---|---|---|---|---|---|---|
  | Scope (2,000) | — | — | 9.3 | 9.8 | 9.5 | — |
  | Summary (2,000) | 265 | 789 | **3,625** | 1,121 | 311 | 313 |
  | State (2,000) | 256 | 998 | **3,217** | 1,545 | 583 | 612 |
  | Sales appointments (2,000) | 19 | 17 | 18 | 15 | 13 | 12 |
  | Call volume (2,000) | 58 | 276 | 1,447 | 647 | 190 | 188 |
  | Dispositions (2,000) | 185 | 424 | 1,542 | 522 | 249 | 240 |
  | Campaign calls (2,000) | 143 | 324 | 1,177 | 486 | 199 | 210 |
  | Lead-source calls (2,000) | 84 | 213 | 678 | 371 | 134 | 127 |
  | Journey (4,000) | **4,495** | **5,243** | **7,736** | **5,975** | **4,398** | **4,376** |

  - Journey at 366-day agency: median 6,910, max 8,010. One of its 20 samples reached the 8 s budget (a `statement_timeout`), so that combination also fails the budget.
  - Scope reader values are the personal, team and agency combinations.
- **After: PostgreSQL 17.6 CI, final head.** Run 41408083919 on `08b8534` (a GitHub-hosted runner), the same suite with its default 5 measured rounds after one warm-up round. With 5 samples, the nearest-rank p95 is each combination's slowest sample. Verdict: **43 of 51 combinations meet their target**, with the same misses as locally. No sample exceeded the 8 s budget. p95 in ms, as printed:

  | Reader (target) | agency 1 d | agency 30 d | agency 366 d | team 366 d | personal 366 d | agency 366 d, one agent |
  |---|---|---|---|---|---|---|
  | Scope (2,000) | — | — | 15.3 | 18.3 | 12.4 | — |
  | Summary (2,000) | 242.7 | 701.2 | **3,725.7** | 1,060.2 | 300.7 | 296.3 |
  | State (2,000) | 209.4 | 877.0 | **3,440.4** | 1,476.4 | 504.7 | 512.6 |
  | Sales appointments (2,000) | 18.1 | 17.8 | 18.0 | 15.9 | 15.7 | 15.4 |
  | Call volume (2,000) | 71.3 | 250.5 | 1,360.6 | 597.5 | 196.8 | 207.5 |
  | Dispositions (2,000) | 145.8 | 348.2 | 1,504.9 | 484.0 | 223.3 | 227.3 |
  | Campaign calls (2,000) | 132.4 | 247.3 | 1,240.5 | 454.9 | 205.8 | 182.4 |
  | Lead-source calls (2,000) | 67.4 | 176.1 | 683.4 | 326.8 | 123.4 | 121.2 |
  | Journey (4,000) | **4,445.9** | **5,077.1** | **7,618.2** | **6,203.0** | **4,531.6** | **4,518.7** |

  - Journey at 366-day agency scope reached 7,618.2 ms, 4.8% below the 8 s budget.
- **Same code on a faster runner.** Run 41405559061 on `f098b62` (identical migrations and suite): **48 of 51**. Summary, state and journey missed only at 366-day agency scope. p95 in ms, as printed:

  | Reader (target) | agency 1 d | agency 30 d | agency 366 d | team 366 d | personal 366 d | agency 366 d, one agent |
  |---|---|---|---|---|---|---|
  | Scope (2,000) | — | — | 9.6 | 11.8 | 9.7 | — |
  | Summary (2,000) | 154.7 | 549.2 | **2,461.0** | 785.4 | 255.5 | 286.7 |
  | State (2,000) | 155.9 | 659.3 | **2,464.2** | 1,158.0 | 427.7 | 432.0 |
  | Sales appointments (2,000) | 13.1 | 12.9 | 12.8 | 12.4 | 10.4 | 10.4 |
  | Call volume (2,000) | 38.9 | 171.2 | 879.8 | 405.4 | 148.9 | 185.3 |
  | Dispositions (2,000) | 112.1 | 290.7 | 1,129.6 | 396.5 | 208.2 | 205.8 |
  | Campaign calls (2,000) | 97.1 | 234.9 | 851.1 | 339.0 | 144.4 | 177.4 |
  | Lead-source calls (2,000) | 47.0 | 145.1 | 534.0 | 237.4 | 106.7 | 102.7 |
  | Journey (4,000) | 2,999.5 | 3,465.3 | **4,996.0** | 3,936.8 | 2,891.9 | 2,966.1 |

  - **The two runners differ widely on identical code.** The slower one took:
    - 47–58% longer for every journey combination;
    - 51% and 40% longer for summary and state at 366-day agency scope;
    - 48% longer for step 4: 9 min 1 s against 6 min 6 s.
  - Journey at 366-day team scope passed by 63 ms on the faster runner and took 6,203.0 ms on the slower one, so one 5-sample CI run cannot settle a marginal combination.
  - In all three runs (local and both CI runs), summary, state and journey miss at 366-day agency scope.
  - Neither environment is production hardware.
- **Evidence locations:**
  - The verdict table, the parameters row and the fixture row (sizes, server version, `shared_buffers`) are printed by the suite.
  - The local run printed 32 `auto_explain` plans (EXPLAIN ANALYZE with BUFFERS, nested statements of 100 ms or more) for the summary, state, four call readers and journey on their 366-day agency paths. Scope and sales appointments finish in under 25 ms, so none of their statements reaches the 100 ms logging threshold.
  - In CI, all of this is in `reports-v3-results.txt` in the run's `reports-backend-evidence-<run id>` artifact. For the final head, that is run 41408083919's artifact. Run 41405559061's artifact holds the same code's faster run (both below).
- **What remains in the slow paths:**
  - **Summary and state at 366-day agency** resolve about 58,000 identities, and their states, from about 457,000 calls on every request. The call rows alone cost about 0.7 s with identities.
  - **Journey** resolves the whole history of about 500,000 calls on every request; about 4 s is that pass.
  - No index applies to this work: it is CPU-bound per-request resolution.

**KPI 24 talk-time quality** (inspected, not changed: `record_call_duration_evidence` and `guard_call_reporting_fields`, `20261005161632`).
- **The six cases** (new organization O24, 2026-06-15): value 375 s = 120 + 0 + 90 + 40 + 100 + 25, with quality `{unknown 1, estimated 1, conflicting 1, provider_confirmed 3, duplicates_excluded 0}`.
  - The 0 s `terminal_non_answer` row is a provider-backed known zero: it adds 0 s and counts as confirmed.
  - The 120 s provider row is measured talk.
  - The conflicting row keeps its value but is not counted as confirmed.
  - KPI 25 is unaffected.
- **The inconsistent case misleads.** The writer accepts `terminal_non_answer` evidence with any non-negative candidate while the stored duration is NULL or 0. A non-answer can therefore store a positive duration, and KPI 24 then reports those seconds as provider-confirmed talk: K24_6 with 25 s, and fixture RC2 with 20 s.
- **Proposal: smallest reporting-only correction, not applied.** The quality keys are frozen in D3, D1, D6 and tests.md C9, so this needs a contract decision.
  - `provider_confirmed` would count attempt rows with no conflict whose evidence is `provider`, or `terminal_non_answer` with canonical duration 0.
  - A new key `inconsistent` would count attempt rows with no conflict whose evidence is `terminal_non_answer` with canonical duration > 0.
  - The value (Σ canonical seconds of attempt rows) and KPI 25 do not change.
  - Six-case payload: `{"quality": {"unknown": 1, "estimated": 1, "conflicting": 1, "inconsistent": 1, "provider_confirmed": 2, "duplicates_excluded": 0}}`, value 375. O1 agency: `provider_confirmed` 4 → 3, `inconsistent` 1, value 725.
  - Doc changes: D3 (KPI 24 table row and quality bullet), D1's key table row 24, D6's KPI 24 line, tests.md C9's key set and the main plan's key table.
  - Code changes: the two quality expressions in `…15`, the O1 and six-case assertions, and the contract key set.

**Files touched.** All are on the reviewed PKG-A list; D2 and D5 were added to the plan entry before either was edited.
- Created: `supabase/tests/reports_v3_performance.sql`.
- Modified:
  - Migrations (unpublished placeholder versions): `supabase/migrations/20261101000011_reports_v3_sale_facts.sql`, `20261101000012_reports_v3_call_journey_helpers.sql`, `20261101000014_reports_v3_state_helpers.sql`, `20261101000015_reports_v3_readers.sql`.
  - Tests: `supabase/tests/reports_v3_call_readers.sql`, `reports_v3_calls_identity.sql`, `reports_v3_journey.sql`, `reports_v3_negative.sql`, `reports_v3_state_breakdown.sql`.
  - Harness and static test: `scripts/reports_v3_fixture.py`, `src/lib/__tests__/reportsV3Contracts.test.ts`.
  - Docs: `docs/plans/2026-10-31-reports-v2/implementation_plan.md`, and `appendix/D1.md`, `D2.md`, `D3.md`, `D5.md`.
  - Plan and log: `implementation_plan.md`, `WORK_LOG.md`.
- **Committed by mistake, then removed.** `9b46456` also committed `reports-integrity-payloads.json`.
  - What it is: the synthetic payload file that `scripts/run_reports_integrity_tests.sh` writes to the repository root (63 KB, synthetic organization only, no production data).
  - It is not on the file list and is absent from the reviewed head and from `main`.
  - `08b8534` removes it without rewriting history.
  - CI overwrites the file in its own workspace before the browser check, so no run used the committed copy.

**Migrations and deploys.** None. Disposable local and CI synthetic databases only, with placeholder versions. No grant outside the harness, no enable, no PR, merge or deploy.

**Verification** (local, base `6e39c15`, head `9b46456`):
- **v3 runner** (PostgreSQL 16.15, with the gate at 20 samples) passes.
  - Counts: 424 assertions (Batch 5: 419; +4 KPI 24, +1 fixture size), 32 mutation controls, 97 refusal checks, 15 seal checks (+1, after the measurement) and 1 index check.
  - No ERROR line; the only FAIL text is the 8 verdict cells.
  - The temporary grants are revoked and `rt.assert_sealed_v3(true, false)` holds afterwards.
- **Other SQL suites:** the RPC, integrity and profile suites pass.
- **Extra comparisons beyond the suites:**
  - the journey on its suite's organization J: 180 of 180 facts and member sets equal (744 member rows) over agency, each agent and a pair, 6 windows and 5 as_of values including maturity boundaries;
  - all 120 by_agent rows from the one-read rollup equal the frozen per-agent computation (48 with members, 72 from the empty group);
  - at scale, `report_v3_call_facts` equals the pinned v2 `report_call_facts` on all 457,311 rows of the 366-day window and every carried column.
- **Static test:** 35/35.
- **TypeScript:** root `npx tsc --noEmit` passes. The app typecheck's 80 errors are identical, line for line, to base and Batch 5.
- **ESLint and build:** scoped ESLint is clean; `npm run build` passes.
- **Full Vitest:** 6,722 passed, 2 failed, 37 skipped across 1,976 suites. Against the clean `6e39c15` base (6,687 passed across 1,966 suites), the 11 failing files and the 2 failing tests are identical by name. The 35 extra passing tests are this branch's static contract test.
- **Pre-push automation check:**
  - Only `s1-plan-verify.yml` runs on push, and only for `main`.
  - Every other workflow runs on `pull_request` or `workflow_dispatch`.
  - Vercel builds an access-protected branch preview, which is permitted.
- **PostgreSQL 17.6 CI.**
  - **The first run was cancelled by the job's timeout, after its measurements.** Run 41398958478, on `9b46456d388134370f34e1b1022b143da53899fb`, was read through a log reader using the last 5,000 of 6,640 log lines.
    - The service reported PostgreSQL 17.6 (Debian 17.6-2.pgdg13+1).
    - The RPC and integrity suites passed. The functional v3 suites ran 06:20:05–06:20:24, and the 500k fixture loaded in 32 s with the required sizes.
    - All 306 samples ran in 338 s.
    - The EXPLAIN step then logged each plan's bound parameters in full. One line held the 57,723-key identity array (2.4 MB), and the job log ends there.
    - The job was cancelled at 06:47:19, so step 4 never finished and no artifact was uploaded. The window has no ERROR, FATAL or `##[error]` line.
  - **Fix, test file only (`625b02b`).** `auto_explain.log_parameter_max_length = 0`, and the parameters row and verdict table now print before the plans. Locally the longest log line is 1,352 characters, there is no parameter dump, and the verdicts are unchanged.
  - **The second run is green, but its verdicts were not readable from the log tail.** Run 41403248712, conclusion success, on `625b02ba8af1fd79a5fd5c19c5630fbb3cbcafaa`.
    - Step 4 ran 06:58:30–07:07:23; the whole job took about 11 minutes.
    - The last 5,000 of its 20,829 log lines are entirely the service container's own log, dumped at "Stop containers". That dump carried a second copy of every `auto_explain` plan, and it reports `starting PostgreSQL 17.6 (Debian 17.6-2.pgdg13+1)`.
    - The dump's only ERROR line is the profile suite's deliberate control ("NEGATIVE CONTROL FIRED: an annualized total was detected"). Its 22 FATAL lines are the health check's `role "root" does not exist`.
    - Artifact `reports-backend-evidence-41403248712` (id 13122319736, 2,270,100 bytes, sha256 `0213fc322c0131f621a76bf6faaa77cadcf395a237946f02acfc4d1827c280d7`).
  - **Fix, test file only (`f098b62`).** The EXPLAIN step sets `log_min_messages = fatal` (plans go to the session's client only), and the verdict table is repeated after the plans, just before the gate line.
  - **The third run is green, and its verdicts are in the log tail.** Run 41405559061, conclusion success, on `f098b62fa7099481e896258a244a3755ff633770`. The migrations are unchanged since `9b46456`.
    - Step 4 ran 07:19:51–07:25:57; the job finished at 07:27:19. A log reader used the last 5,000 log lines.
    - The service reported `starting PostgreSQL 17.6 (Debian 17.6-2.pgdg13+1)`.
    - The v3 output ends with:
      - the repeated verdict table (above);
      - the gate line: "48 of 51 combinations meet their p95 target; 0 exceed the 8 s budget in a sample (misses: summary/agency-366, state_breakdown/agency-366, journey/agency-366)";
      - the seal re-assertion after the measurement;
      - "All Reports v3 contract, registry, seal and refusal proofs passed."
    - The earlier v3 output comes before the window: counts, the first verdict table, the parameters and fixture rows, and the plan headers. It is in `reports-v3-results.txt` in the artifact.
    - The longest log line is 1,381 characters (a plan's group key). No parameter is dumped.
    - The server log, dumped at the end of the job, now covers the whole run.
      - Its 25 ERROR lines are all deliberate controls of existing suites that this batch does not change. 24 come from `run_reports_rpc_tests.sh`'s `expect_fail` probes between 07:20:04 and 07:21:03: mutation probes, preflight and replay refusals, the enable and rollback refusals, permission denials and the broken-fixture check. The 25th is the profile suite's control at 07:25:56.
      - No ERROR falls in the v3 suites or the measurement, whose controls are caught inside their own subtransactions.
      - Its 90 FATAL lines are all `role "root" does not exist`, from the `pg_isready` health check every 5 s.
    - Artifact `reports-backend-evidence-41405559061`: id 13123871630, 2,266,878 bytes, 71 files, sha256 `382f49ef9a89eb380f8d0c7ca0c1dfc81d873161833f7698b85cb2850149ab08`, expires 2026-11-16.
  - **The fourth run, on the final head, is green.** Run 41408083919, conclusion success, on `08b8534452fc2fe09d5cce8cd05c284a306a87b8`. Its code is identical to `f098b62`; that commit only removes the stray payload file and updates docs.
    - Step 4 ran 07:43:23–07:52:24; the job finished at 07:54:06. A log reader used the last 5,000 log lines.
    - The service reported `starting PostgreSQL 17.6 (Debian 17.6-2.pgdg13+1)`.
    - The gate line: "43 of 51 combinations meet their p95 target; 0 exceed the 8 s budget in a sample (misses: summary/agency-366, state_breakdown/agency-366, journey/agency-1, journey/agency-30, journey/agency-366, journey/team-366, journey/personal-366, journey/agency-366-one-agent)".
    - Then come "All Reports v3 contract, registry, seal and refusal proofs passed." and the profile suite's "ALL PROFILE RPC PROOFS PASSED".
    - The server log's 25 ERROR lines are the same 25 deliberate controls as in the third run, with the same messages:
      - 24 from `run_reports_rpc_tests.sh`, between 07:43:43 and 07:45:06;
      - the profile suite's control, at 07:52:24.
    - No ERROR falls in the v3 suites or the measurement.
    - Its 128 FATAL lines are all the health check's `role "root" does not exist`. There is no `##[error]` line.
    - The longest log line is 1,381 characters. No parameter is dumped.
    - Artifact `reports-backend-evidence-41408083919`: id 13124323941, 2,270,726 bytes, 71 files, sha256 `789eabc2dabdd59e3aa671a9d5538719383a7db5402a48626bac8d8841221ff9`, expires 2026-11-16.

**Open PKG-A requirements (not claimed as passed).**
- **Performance gate: not passed in either environment.**
  - Local PostgreSQL 16.15, 20 samples: 43 of 51. Summary and state miss at 366-day agency scope, and journey misses everywhere. One journey sample at 366-day agency reached the 8 s budget.
  - PostgreSQL 17.6 CI at the final head, 5 samples: 43 of 51, with the same misses. Journey at 366-day agency scope is 7,618 ms, 4.8% below the 8 s budget.
  - A faster runner gave 48 of 51 on the same code. No CI sample reached the budget.
  - D1 §3.11 names the remedy: a separately approved maintained identity table. It has not been requested or started. No index, table, cache or timeout change was made.
  - Bounded options to decide between:
    - (a) the maintained call-to-identity table (D1's remedy);
    - (b) a maintained per-identity first-contact record for the journey;
    - (c) accepting different targets at 366-day agency scope.
- **KPI 24:** the inconsistent-case proposal awaits a contract decision.
- **Release and recovery (recorded, not done):**
  - `reports_v3_release.sql`, the ops enable and disable scripts and `…17`;
  - the R5 rollback files and recovery proofs, and S15 across the release and recovery states;
  - the A7 runner stage with exact index-definition, `indisvalid` and `indisready` checks, where a wrong or invalid index fails closed with no automatic drop or rebuild;
  - final fingerprints; and no migration-history repair.
- **Security review:** the named §2.9 review of the actual SQL; the campaign-copy fallback review.

**Next.** Stop for review after Batch 6.

## 2026-11-02 — Reports V2 PKG-A Batch 5: the nine v3 readers and the calls index; branch pushed; PostgreSQL 17.6 CI green after a test-only collation fix (branch `claude/great-goodall-911azc`; NOT merged, applied, enabled or deployed)

**Status.**
- **Authority:** built under Chris's Batch 5 message and the existing branch approval. Normal checkpoint pushes and manual `reports-backend.yml` dispatches for isolated synthetic verification are authorized; nothing else is.
- **Sealed:** every reader is created sealed. No execution grant and no enable step exists; the class E enable (`…17`) stays a later, separately approved step.
- **Still pending:** ★1 and ★4. The linked-history effects E1–E6, including E4's campaign-copy fallback, are a proposed branch implementation, not accepted disclosures. No agency-only fallback is implemented. The AGENT_RULES amendments remain proposed.
- **Not touched:** no PKG-D evidence, category or outcome write, and no telephony, `TwilioContext`, call-initiation or duration-writer change.

**What changed.**
- **Readers** (`20261101000015_reports_v3_readers.sql`, placeholder version, class C, **not applied**).
  - **Form:** nine public readers, each `plpgsql STABLE SECURITY DEFINER`, owned by postgres, with `search_path` pinned. None takes an organization, time zone or as_of argument.
  - **Order:** each windowed reader resolves access first through the unchanged `report_access_v2` (42501; NULL never widens; an agent filter only narrows), then the window (22023, then 55000), then computes.
  - **Readers:**
    - *Summary:* KPIs 1–11, 24, 25 and 34, by_agent, `production_by_date` and `call_population`.
    - *Journey:* KPIs 14, 19, 21 and 38 (the proposed option (a), BC1 and BC2 applied).
    - *Sales appointments:* over the `…13` stub, so every KPI is truthfully `unavailable/evidence_not_captured`.
    - *State:* D5's recorded-state split over `…14`: 51 jurisdictions, 6 unmapped reasons, totals and modes.
    - *Call readers:* call volume, dispositions, campaign calls and lead-source calls, ported from v2 onto the attempt population.
  - **Call readers:** call-only payloads with exact rate parts. Hidden campaigns appear only in the "Other campaigns" counts. They include "Calls without a campaign" and "Not linked to a current lead" rows.
  - **Internal helpers (5):** the by_agent roster (the v2 rule), the credit map, per-agent call counts with `report_v3_call_counts`' exact keys, KPI 25 quality, and the ordered summary envelopes. Envelopes are built only through the foundation builders.
  - **Guards:** the preflight refuses replay and re-verifies the 15 v2 and 12 closure pins. The postcondition proves owner, security, volatility, search_path and arguments, and that no client EXECUTE was added anywhere.
- **Talk time and dialer time (KPIs 24, 25).**
  - KPI 24 is the canonical duration of attempt rows. Its quality is disclosed and never upgraded: estimated, unknown, conflicting, provider_confirmed, duplicates_excluded.
  - KPI 25 is the pinned session interval: window clipping, the 3-minute heartbeat cap, same-agent overlap union, and the owner-preserved late-ended rule. Its quality counts are `stale_capped` and `late_ended`.
  - D3 now records the exact definitions.
- **Calls index** (`20261101000016_reports_v3_calls_campaign_lead_index.sql`, placeholder version, **not applied**). The file holds exactly one statement: `CREATE INDEX CONCURRENTLY IF NOT EXISTS report_v3_calls_org_campaign_lead ON public.calls(organization_id, campaign_lead_id, created_at)`.
  - The harness runs it the way the runner will: outside a transaction, with `lock_timeout` 2 s, then an exact-definition and `indisvalid`/`indisready` post-check.
  - A leftover index with another definition, or an invalid one, is refused rather than silently kept.
- **Harness.**
  - O1 reader fixtures: role permissions; visible and hidden campaigns; leads with sources, states and assignments; a lead in two campaigns; dispositions.
  - Calls of every class: a window-start and a window-end call, inbound calls, a recruit call, a reviewed duplicate, and DST-day calls.
  - Admissions, sessions (overlap, edge-clipped, stale, late-ended, DST day) and buyer states.
  - Grant-confined call helpers: the EXECUTE grant to authenticated never outlives one call.
  - Non-transactional fixture steps for the concurrent index.
- **Plan.** §2.6 lists the reader helpers. §9.1 now records the open PKG-A release items.

**Required cases covered.**
- **Public boundary:**
  - Readers stay sealed for anon, authenticated, service_role, a PUBLIC-only role and a member of authenticated, both by `has_function_privilege` and by direct execution (42501).
  - Scope: personal, team and agency scope; authorized and unauthorized agent filters; another organization's agent.
  - Errors come in order: 42501 before 22023 before 55000.
  - Cross-organization isolation: changes in another organization leave every O1 payload byte-identical.
  - Privacy scans: no other agent, hidden campaign, prospect, client, call or recruit id, phone number, row timestamp, or unattributed bucket below agency scope.
  - S14a with the BC1 additions is byte-identical. S14b covers E4 (a state change regroups calls with changed-after flags) and E6 (a reassignment changes New leads), plus a negative fixture.
- **Reconciliation:**
  - In one REPEATABLE READ snapshot at agency, team, personal and agent-filter scope, Calls made = Σ heatmap = Σ by_date = Σ by_hour = Σ by_weekday = Σ dispositions = Σ duration buckets = Σ campaign rows (including both extra rows) = Σ lead-source rows (including Not linked) = the regional total. Contacted calls reconciles the same way.
  - `call_population` is one block across seven views.
  - v2 `calls_made` − KPI 5 = non-attempts + unverified.
  - Regional mapped plus unmapped policies and AP equal KPIs 2 and 1, to the cent.
  - A lead in two campaigns and a buyer with two policies multiply nothing.
  - KPI 7 deduplicates identities rather than summing agent rows.
- **KPIs 24 and 25:** cases cover an empty window, missing quality, both window edges, a session clipped at both edges, and the 2026-03-08 spring-forward day.
- **Appointment and regional readers:**
  - The appointment reader stays `evidence_not_captured`, and appointments in the window move nothing.
  - The regional reader is tested on missing and invalid premiums (the RL-11 matrix), unverified calls, unresolved identities, recruit calls, a source conflict, a campaign copy and a future Sold Date.
- **Index:** exact definition and validity; a missing index, a leftover with another definition and an invalid leftover are each refused.
- **Negative controls (11):**
  - narrowing removed from three readers;
  - roster widened;
  - unknown premium emitted as 0;
  - stub evidence emitted as 0;
  - a v2 policy field leaked into a call reader;
  - non-attempts counted;
  - a membership join that multiplies calls;
  - a hidden campaign leaked;
  - AP pre-rounded.

  An anon grant also breaks the seal check.

**Files touched.**
- Created:
  - `supabase/migrations/20261101000015_reports_v3_readers.sql`
  - `supabase/migrations/20261101000016_reports_v3_calls_campaign_lead_index.sql`
  - `supabase/tests/reports_v3_security.sql`
  - `supabase/tests/reports_v3_call_readers.sql`
  - `supabase/tests/reports_v3_negative.sql`
- Modified:
  - `supabase/tests/reports_v3_fixtures.sql`
  - `supabase/tests/reports_v3_contract.sql`
  - `supabase/tests/reports_v3_state_breakdown.sql`
  - `supabase/tests/reports_v3_appointment_facts.sql`
  - `scripts/reports_v3_fixture.py`
  - `src/lib/__tests__/reportsV3Contracts.test.ts`
  - `docs/plans/2026-10-31-reports-v2/implementation_plan.md`
  - `docs/plans/2026-10-31-reports-v2/appendix/D3.md`
  - `implementation_plan.md`
  - `WORK_LOG.md`

**Migrations and deploys.** None. Disposable local synthetic databases only, with placeholder versions. No grant, enable, PR, merge or deploy.

**Verification** (local, base `6e39c15`):
- **Failing first:** with `…15` and `…16` left out, each new suite stops at the missing reader (security fails S1–S3: 42883 instead of 42501), and the index check reports the index missing.
- **SQL suites:** the v3 suite passes on PG 16.15.
  - Assertions per suite: appointment 29 (6 new), state 40 (12 new), call readers 38, security 29, reader contract 7, and the negative suite's restore check 1. That is 93 new in all (326 to 419).
  - Controls: 11 new negative controls, plus 7 new refusal and index steps.
  - Whole runner: 419 assertions, 32 mutation controls, 97 refusal checks, no error lines.
  - The integrity, RPC and profile suites also pass.
- **Static test:** 33/33.
- **TypeScript:** root `npx tsc --noEmit` passes. The app typecheck gives 80 errors whose identities match base, line for line.
- **ESLint and Reports Vitest:** scoped ESLint is clean. Reports Vitest: 27 files, 436 passed, 1 pre-existing skip.
- **Full Vitest:** 6,720 passed, 2 failed, 37 skipped across 1,975 suites. Against the clean `6e39c15` worktree (6,687 passed across 1,966 suites), the 11 failing files and the 2 failing tests are identical by name. The 33 extra passing tests all come from this branch's static contract test, and no test that passes at base fails here.
- **Build:** `npm run build` passes.
- **PostgreSQL 17.6 CI.**
  - **The first run failed on a test-ordering defect, not a reader defect.** Run 41374560449 on `3e9998e636a85c144e6bc8d91b3e0f1c77936f90` stopped at V5 in `reports_v3_call_readers.sql`: `got [Facebook:3:1:2 (No source):1:1:1 Referral:4:3:2 Web:0:0:2 | not linked 2] want [(No source):1:1:1 Facebook:3:1:2 Referral:4:3:2 Web:0:0:2 | not linked 2]`.
    - The CI cluster's locale is en_US.utf8, which ignores punctuation at the first comparison level. So the test's own `string_agg … ORDER BY lead_source` put "(No source)" after "Facebook", while the expectation had been written on the C.UTF-8 local cluster. Every value matched; only the order inside the test's string differed.
    - Before the stop, that run passed the RPC and integrity suites. In the v3 runner it passed every refusal and apply step through `…15` and `…16`, the index checks, and the appointment and state suites. The call-reader, security, negative-control and reader-contract suites, and the profile suite, did not run.
    - Artifact `reports-backend-evidence-41374560449` (sha256 `af900355…`).
  - **Fix, tests only (`eb6fde0`).** Every text-valued ORDER BY in the Batch 5 test code now uses `COLLATE "C"`: 20 places across the call-reader, security, contract, state and appointment suites. The readers are unchanged; they keep v2's `lower(name)` ordering under the database collation.
    - Reproduced first in a disposable ICU `en-US-u-ka-shifted` database, which also ignores punctuation: the same V5 message as CI.
    - After the fix, the whole v3 runner passes there, and on the C.UTF-8 runner, with output identical to the pre-push run apart from temp-file names.
  - **The second run is green.** Run 41376387202, conclusion success, on head `eb6fde0d2e89c580552267dad2f24ebc554ebc13` (GitHub's job record). Every step passed, including the browser check.
    - The job's only database, the service container, reported `starting PostgreSQL 17.6 (Debian 17.6-2.pgdg13+1)`.
    - The connector returns the last 5,000 of the job's 7,185 log lines. The window starts at the v3 runner's line 401, so its first 400 lines (its own version line, the harness, the v2 migrations and the original fixtures) fall before the window, as do the checkout and the RPC and integrity suites' output. All of those steps succeeded.
    - From line 401 to "All Reports v3 contract, registry, seal and refusal proofs passed." the CI output equals the local run line for line, apart from two temp-file names.
    - Every Batch 5 step label appears exactly once:
      - the `…15` refusals, apply and replay refusal;
      - "v3 readers are created sealed";
      - the index steps and "index definition and validity";
      - the appointment, state, call-reader, security, negative-control and reader-contract suites;
      - "v2 surface unchanged after the v3 readers".
    - The counts equal the local run: 419 assertions, 32 mutation controls, 97 refusal checks, 14 seal checks and 1 index check. The v3 output has no ERROR or FAIL line.
    - **Expected errors stay separate.** The service-container log holds 25 ERROR entries, all server-side records of other suites' deliberate controls.
      - 24 come from the RPC and integrity suites, between 02:12:15.940 and 02:13:12.488. Examples: "T3 contacted FAIL: got [5] want [4]" and "reports preflight: report objects already exist; refusing replay".
      - 1 is the profile suite's negative control at 02:13:50.557: "NEGATIVE CONTROL FIRED: an annualized total was detected".
      - None falls inside the v3 output (02:13:38.857 to 02:13:50.107 in the window). There is no `##[error]` annotation.
    - Artifact `reports-backend-evidence-41376387202` (sha256 `2698f658…`).

**Open PKG-A requirements (not claimed as passed).**
- **Performance gate:** the 500k/5k/10k gate with EXPLAIN evidence (`reports_v3_performance.sql`) is not built or passed.
- **Journey optimization:** before the gate, the journey query must be narrowed to window-bounded candidate identities while keeping every earlier event its first-contact and first-sale classification needs. The journey reader currently recomputes journey facts once per by_agent row.
- **Release suite and the remaining PKG-A files:** `reports_v3_release.sql`, the ops enable and disable scripts with the `…17` class E enable, the R5 rollback files for `…15` and `…16`, and S15 in the enabled, disabled and rolled-back states.
- **Runner index stage (A7, environment approval):** the runner must run `…16` outside a transaction with `lock_timeout 2s` and then refuse an invalid index.
  - Only the harness performs that post-check today (`rt.v3_index_check`). On its own, the file's `IF NOT EXISTS` keeps any leftover with the same name, as the harness steps show.
  - Proposed for the release batch: the runner should also require the exact definition, as the harness does. D1 names only `indisvalid`.
- **Security review:** the named §2.9 security review of the actual reader SQL.

**Next.** Stop for review. No enable or release work.

## 2026-11-02 — Reports V2 PKG-A Batch 4: appointment-facts stub and state helpers; branch pushed; PostgreSQL 17.6 CI green (branch `claude/great-goodall-911azc`; NOT merged, applied or deployed)

**Status.**
- **Authority:** built under Chris's Batch 4 message and the existing branch approval. Normal checkpoint pushes and one isolated `reports-backend.yml` dispatch on the pushed head are authorized; nothing else is.
- **Still pending:** ★1 and ★4. The AGENT_RULES amendments remain proposed.
- **State fallback:** the state helpers implement D5's recorded-state fallback: the current record, then the narrowed campaign copy (D5-2's default; omitting the copy remains Chris's alternative). Its privacy effect E4 (D5-17) still needs the §2.9 security review, and nothing here records it as accepted.
- **Not touched:** no appointment evidence table, trigger, outcome write or capture. No telephony, `TwilioContext`, call-initiation or duration-writer change.

**What changed.**
- **Appointment facts stub** (`20261101000013_reports_v3_appointment_facts_stub.sql`, placeholder version, class C, **not applied**). `private.report_v3_appointment_facts` has the final X1 signature.
  - KPIs 12, 15, 16, 17 and 18 come back in registry order as `unavailable/evidence_not_captured`, with value, numerator, denominator, coverage, maturity and detail all null.
  - They are built only through the foundation builders, so missing evidence never becomes a zero.
  - There is one `by_agent` row per distinct roster id, in roster order, each with the same five envelopes.
  - It reads no table. Basis flags stay at contract 3.0.0 with `appointment_evidence: not_installed`.
  - It refuses replay. It also refuses to install over a changed registry order, kinds or config codes, or over installed appointment evidence.
- **State helpers** (`20261101000014_reports_v3_state_helpers.sql`, placeholder version, class C, **not applied**).
  - **Classifier:** trims space, tab, LF, VT, FF and CR, then calls the unchanged `public.normalize_us_state`. It returns one of the 51 supported jurisdictions (DC included), or `missing_state`, `unsupported_geography` (12 listed territory and military codes and their names) or `invalid_state`. It never echoes the raw input.
  - **Identity states:** an identity's own same-org lead and client records decide first. Only when they are all blank does a same-org campaign-membership copy apply, reached through `campaign_leads.lead_id`, the conversion lineage, or a same-org call on the identity by any agent.
    - Two or more distinct codes give `source_conflict`.
    - No same-org record gives `unresolved_identity`, with no fallback.
    - Results are all-time and keyed only by the identities asked for. Phone numbers are never read.
  - **Private index:** `report_v3_lineage_original_lead`, built in the migration's transaction.
  - **Guards:** replay refusal; order (…12 and …13 first); `normalize_us_state` pinned (md5(prosrc) `c80ff9ad…`, immutable, invoker, its search_path); dependency columns.
  - **Postconditions:**
    - helper metadata and the seal;
    - the exact index definition;
    - the normalizer's body, flags, owner and privileges unchanged;
    - RLS still on for the lineage and history tables.
- **D3 KPI 19 maturity wording.** The maturity block counts the whole group (every first-contact member, assessable or not). The value keeps the assessable-cohort denominator.
  - This matches plan §2.2 rule 7 and the Batch 3 SQL. The journey suite already pins it: personal KPI 19 has denominator 5 and maturity members 7.
  - No SQL changed.
- **Harness.**
  - `public.normalize_us_state`, verbatim from the baseline, with its production owner and grants. The platform-only `supabase_auth_admin` revoke is left out, because the runner refuses any database with that role.
  - Production `state` columns on leads, clients, campaign_leads and recruits, and the `contact_history_calls_page` index.
  - A snapshot of the normalizer's privileges, for the unchanged check.
- **Static test.** The function parser now skips OUT parameters. New checks cover …13 and …14.

**Required cases covered.**
- **Replay:** both migrations refuse a second run.
- **Dependency drift:**
  - …13 refuses installed appointment evidence and a changed registry order.
  - …14 refuses a changed normalizer body, a volatile or definer normalizer, a changed search_path and a missing state column.
  - Each refuses to run before the migration it depends on.
- **Cross-organization isolation:**
  - Another tenant's lead resolves only in its own organization.
  - Cross-tenant memberships, calls and lineage never supply a copy.
  - Changes made in the other tenant leave every result in this one byte-identical: its states, memberships, history, calls and lineage.
- **Conflicting evidence:**
  - Lead CA with client NV, and copies TX and OK, give `source_conflict`.
  - A supported code wins over an invalid one, and 'California' and 'CA' agree.
- **Blank states:**
  - Blank, whitespace-only, NULL and control-character values are `missing_state`.
  - An all-blank identity falls back to its copy; nothing recorded anywhere stays missing.
- **Unsupported geography:** PR, Guam, AE and the other listed codes and names.
- **Invalid states:** NBSP+TX, D.C., Ontario, XX and 'v', among others. An invalid recorded value never falls back to a copy.
- **Sealed permissions:** neither migration grants anything. Every new helper is non-executable for anon, authenticated, service_role, a PUBLIC-only role and a member of authenticated, and is owned by postgres with invoker rights and a pinned search_path.
- **Mutation controls:**
  - stub (3): a misleading zero, a lost roster, a broken order;
  - state helpers (5): no pre-trim, a fallback after an invalid value, a collapsed conflict, a cross-tenant membership, a cross-tenant call.

**Files touched.**
- Created:
  - `supabase/migrations/20261101000013_reports_v3_appointment_facts_stub.sql`
  - `supabase/migrations/20261101000014_reports_v3_state_helpers.sql`
  - `supabase/tests/reports_v3_appointment_facts.sql`
  - `supabase/tests/reports_v3_state_harness.sql`
  - `supabase/tests/reports_v3_state_breakdown.sql`
- Modified:
  - `scripts/reports_v3_fixture.py`
  - `src/lib/__tests__/reportsV3Contracts.test.ts`
  - `docs/plans/2026-10-31-reports-v2/appendix/D3.md`
  - `implementation_plan.md`
  - `WORK_LOG.md`

**Migrations and deploys.** None. Disposable local synthetic databases only, with placeholder versions.

**Verification** (local, base `6e39c15`):
- **Failing first:** without …13 and …14, the new suites stop at `private.report_v3_appointment_facts(...) does not exist` and `private.report_v3_state_classify(text) does not exist`. The static test fails to load without the two migrations.
- **SQL suites:** the v3 suite passes on PG 16.15: 23 stub assertions, 28 state assertions, 4 harness assertions, 11 refusal steps and 8 mutation controls. The integrity, RPC and profile suites also pass.
- **Static test:** 26/26.
- **TypeScript:** root `npx tsc --noEmit` passes. The app typecheck gives 80 errors whose identities match base, line for line.
- **ESLint and Reports Vitest:** scoped ESLint is clean. Reports Vitest: 27 files, 429 passed, 1 pre-existing skip.
- **Full Vitest:** 6,713 passed, 2 failed, 37 skipped across 1,973 suites. Against the clean `6e39c15` worktree (6,687 passed across 1,966 suites), the 11 failing files and the 2 failing tests are identical by name. The 26 extra passing tests all come from this branch's static contract test, and no test that passes at base fails here.
- **Build:** `npm run build` passes.
- **PostgreSQL 17.6 CI on the Batch 4 head:** run 41367676663, conclusion success, on head `e3a262a171c8de2d487ae5198342d9c1d6fa87db` (GitHub's job record). The server reported `PostgreSQL 17.6 (Debian 17.6-2.pgdg13+1)`.
  - The v3 runner built the verbatim state normalizer and the state harness (4 assertions).
  - It refused `…13` before the call and journey helpers, over installed appointment evidence, over registry drift and on replay, then applied it.
  - It refused `…14` before `…13`, over four kinds of normalizer drift, over a missing state column and on replay, then applied it.
  - It ran the stub suite (23 assertions, 3 mutation controls) and the state suite (28 assertions, 5 mutation controls), and ended with "All Reports v3 contract, registry, seal and refusal proofs passed."
  - Across the whole v3 runner the counts equal the local run exactly (326 assertions, 21 mutation controls, 89 refusal checks), with no error lines.
  - Artifact `reports-backend-evidence-41367676663` (sha256 `d3ba77fb…`).
  - The connector returns at most the last 5,000 of the job's 6,404 log lines, so the checkout lines and the Reports RPC suite's output at the top were not read. Both of those steps succeeded, and the `…13`, `…14` and new-suite labels in the log exist only from this commit on.

**Known follow-ups (not claimed as done).**
- The state reader `get_report_state_breakdown_v3` and its cases (cardinality, premium, attempt classes, cross-reader equalities, S14a/S14b) come in Batch 5 with `…15`.
- The state lookups' performance is measured by D1's gate.
- The campaign-copy fallback (D5-2) and E4 (D5-17) stay on the §2.9 security review list.

**Next.** Stop for review before Batch 5 (`…15` readers and `…16` index). Its exact file list will be recorded first.

## 2026-11-01 — Reports V2 PKG-A Batch 3: call and journey helpers; branch pushed; PostgreSQL 17.6 CI green (branch `claude/great-goodall-911azc`; NOT merged, applied or deployed)

**Status.** Built under Chris's Batch 3 message and the existing branch approval. Normal checkpoint pushes and one isolated `reports-backend.yml` dispatch on the pushed head are authorized; nothing else is. ★1 and ★4 remain pending: the journey history gates are the **proposed design**, implemented and tested only in isolation. No privacy acceptance, reviewer or agency-only fallback is recorded or enabled. No telephony, `TwilioContext`, call-initiation or duration-writer change.

**What changed.**
- **Call and journey migration** (`20261101000012_reports_v3_call_journey_helpers.sql`, placeholder version, class C, **not applied**). It creates 14 sealed private helpers.
  - **Call facts** wrap the pinned v2 `report_call_facts`, so the row set and carried columns match v2 exactly. They add three evidence classes:
    - **attempt:** a pre-admission legacy row, or an admitted row. Genuine failed, busy and no-answer attempts stay calls.
    - **non_attempt:** an admission the server refused. It is proven and disclosed.
    - **unverified:** no admission row. It counts as unknown evidence, never as zero activity.

    They also add the contacted and answered-inbound flags, identity resolution and the credited agent.
  - **Contact predicate:** No Answer is tested first, then duration > 45 s (exactly 45 does not pass), then a qualifying disposition. Inbound journey contacts never enter outbound totals.
  - **Supporting helpers:** the single identity resolver (D3 rules 1–8, same-organization lookups only), lead receipts from five sources, a person's current numbers, first sales, and the PKG-A sale-call link stub (no rows).
  - **Journey members and facts** apply the metric-specific gates:
    - KPI 14 uses receipt and sale gates only.
    - KPIs 19 and 21 include prospects who never buy and exclude prior buyers.
    - 21 counts any possibly related call and an unverified linked call; 19 counts only calls that could have qualified as a contact.
    - 1 Call Close is Yes, No or Unclassified, and missing or uncertain evidence is never No.
    - A phone number only rules relatedness out for one member. It never links or attributes anything, and no key, number or id leaves the facts.
  - **KPI assemblers:** call counts plus the KPI 5–11 and 34 envelopes, and the KPI 14, 19, 21 and 38 envelopes, all built only through the foundation builders. KPI 38 reports `sale_call_link_not_captured` until PKG-C.
- **Foundation fix** (`…10`, branch-only, never applied). KPI 34's `attempt_unverified` now counts on both sides (`ND`), so unverified lead-stage rows block `no_lead_calls`, as D3 §3.3 requires. The contract suite gained the matching cases. I added both files to the Batch 3 list before editing them.
- **Harness.**
  - Production-named dependency stubs for the October call and journey columns and tables.
  - `public.phone_last10` extracted verbatim from `20260823222528`.
  - A synthetic call and journey organization with scenarios S1–S14, a numberless call, classification calls and resolution calls.
  - Ordering, drift and replay refusals for `…12`.
- **Tests.**
  - `reports_v3_calls_identity.sql`: 48 assertions, 2 refusal checks and 3 mutation controls.
  - `reports_v3_journey.sql`: 55 assertions, BC1 and BC2 savepoint blocks, and 3 mutation controls.
  - The static test adds `…12` checks: the 14 helpers, numbers never resolving identities, and the v2 call reader as the single row source.
- **Plan.** §2.6 now lists the four internal helpers.

**Required cases covered.**
- **Call classes:** attempt, non-attempt and unverified stay separate; failed attempts remain calls; unverified rows stay unknown; legacy rows follow the retained rule; raw call records are unchanged (fingerprint).
- **Contacted:** No Answer is excluded first; 45 s does not qualify; 46 s or a qualifying disposition does; inbound evidence never enters outbound totals.
- **BC1:**
  - Adding a numberless unresolved call, a call to an unrelated number, and an out-of-scope person's phone change leaves the personal and team envelopes byte-identical.
  - Organization-wide uncertainty (numberless calls) appears only at agency scope.
  - An in-scope person's own phone change affects only that person.
- **BC2:**
  - A receipt on October 1 and a first sale on October 5 give KPI 14 = 4 days with no call recorded.
  - A non-buyer stays in KPI 19's denominator.
  - An earlier confirmed No Answer attempt still allows a 1 Call Close Yes.
  - A missing link, or a link to a non-contact call, is Unclassified and never No.
  - A number-matched call stays unresolved and is never attributed.
  - Agency results stay partial while numberless calls exist (no match is not proof of complete history).
- **BC4:**
  - Complete zero activity over 2 policies gives 0. Zero policies give no ratio. Unverified-only evidence is unavailable, never 0.
  - KPI 19 for a non-buyer cohort is 0.0 % available with maturity complete.
  - Status and maturity are separate: the same partial value shows maturity complete at one as_of and in progress at an earlier one.

**Files touched.**
- Created:
  - `supabase/migrations/20261101000012_reports_v3_call_journey_helpers.sql`
  - `supabase/tests/reports_v3_calls_identity.sql`
  - `supabase/tests/reports_v3_journey.sql`
  - `supabase/tests/reports_v3_journey_fixtures.sql`
- Modified:
  - `supabase/tests/reports_v3_dependencies.sql`
  - `scripts/reports_v3_fixture.py`
  - `src/lib/__tests__/reportsV3Contracts.test.ts`
  - `supabase/migrations/20261101000010_reports_v3_foundation.sql`
  - `supabase/tests/reports_v3_contract.sql`
  - `docs/plans/2026-10-31-reports-v2/implementation_plan.md`
  - `implementation_plan.md`
  - `WORK_LOG.md`

**Migrations and deploys.** None. Disposable local synthetic databases only, with placeholder versions.

**Verification** (local, base `6e39c15`):
- **Failing first:** without `…12`, both new suites stop at the missing functions.
- **SQL suites:** the v3 suite passes on PG 16.15. The existing integrity and RPC suites also pass.
- **Static test:** 17/17.
- **TypeScript:** root `npx tsc --noEmit` passes. The app typecheck gives 80 errors whose identities match base, line for line.
- **ESLint and Reports Vitest:** scoped ESLint is clean. Reports Vitest: 27 files, 420 passed, 1 pre-existing skip.
- **Full Vitest:** 6,704 passed, 2 failed, 37 skipped across 1,971 suites. Against the clean `6e39c15` worktree (6,687 passed across 1,966 suites), the 11 failing files and the 2 failing tests are identical by name. The 5 extra suites and 17 extra passing tests all come from this branch's static contract test, and no test that passes at base fails here.
- **Build:** `npm run build` passes.
- **PostgreSQL 17.6 CI on the Batch 3 head:** run 41362691717, conclusion success, on head `c54ec678a9f6f6842b73672900d7a1414f13f7ca` (GitHub's job record). The server reported `PostgreSQL 17.6 (Debian 17.6-2.pgdg13+1)`. The v3 runner refused `…12` before sale facts, on v2 call-reader drift and on replay, then applied it. It ran the calls and identity suite (48 assertions, 2 refusal checks, 3 mutation controls) and the journey suite (55 assertions, 1 refusal check, 3 mutation controls, and the BC1 and BC2 savepoint blocks). It ended with "All Reports v3 contract, registry, seal and refusal proofs passed." and had no error lines. Artifact `reports-backend-evidence-41362691717` (sha256 `414395b3…`). The connector returns at most the last 5,000 of the job's 5,899 log lines, so the checkout lines and the Reports RPC suite's output at the top were not read. Both of those steps succeeded, and the `…12` and new-suite labels in the log exist only from this commit on.

**Known follow-ups (not claimed as done).**
- The journey history reads are organization-wide in this batch. D3's index-bounded phase-2 reads are a performance follow-up before the performance gate.
- D3 §3.3's KPI 19 maturity text still says "members = assessable members". The contract (rule 7, whole group) governs and is what is implemented; the D3 wording needs a documentation fix.
- KPIs 24 and 25 (talk time, dialer time) are assembled with the readers in `…15`.

**Next.** PKG-A Batch 4: `…13` appointment-facts stub and `…14` state helpers. The exact files are listed first.

## 2026-11-01 — Reports V2 PKG-A Batch 2: sale facts; branch pushed; PostgreSQL 17.6 CI green; appendices added (branch `claude/great-goodall-911azc`; NOT merged, applied or deployed)

**Status.** Chris authorized:
- normal pushes of this branch;
- manual dispatches of the isolated Reports backend verification workflow (`reports-backend.yml`) on this branch: one per pushed head;
- the appendix documentation addition.

Nothing else was done: no PR, merge, push to `main`, production read or write, migration application, release-runner stage, deploy promotion or settings change.

**Push and CI for Batches 0 and 1.**
- **Pre-push automation check.** Only `s1-plan-verify.yml` runs on push, and only for `main`. Every other workflow runs on `pull_request` or `workflow_dispatch`. Supabase production deploys act on `main`, and Supabase preview databases need a PR. Vercel builds an access-protected preview, which is permitted.
- **Push.** `e1dde84` and `5efc7c9` were pushed with a normal push. The remote head was `5efc7c9fc074020e4a26d6a13fd040e14e72d2db`.
- **CI.** `reports-backend.yml` was dispatched on the branch as run 41354339631, conclusion success, on head `5efc7c9…`.
  - It used the `postgres:17.6` image; the server reported `PostgreSQL 17.6 (Debian 17.6-2.pgdg13+1)`.
  - The v3 runner's output (job log lines 1787–3155) ends with "All Reports v3 contract, registry, seal and refusal proofs passed." It has no error lines, and it ran the same 64 refusal checks and 4 mutation controls as the local run.
  - Artifact `reports-backend-evidence-41354339631` (sha256 `eea68e2c…`) holds `reports-v3-results.txt`.
  - This session's proxy blocks the log and artifact download hosts, so the log was read through the GitHub connector.

**Documentation addition (`b395d49`).**
- `docs/plans/2026-10-31-reports-v2/appendix/` now holds D1–D6 and the test, backend-action and ruling indexes. They were scanned first: no credentials, personal data, record ids or production extracts.
- Appendix wording is aligned with the builders-only rule.
- Plan §2.6 lists the implemented helpers.
- ★1 and ★4 stay pending, the AGENT_RULES texts stay proposed, and the agency-only fallback is marked not approved.

**Batch 2: what changed.**
- **Sale-facts migration** (`20261101000011_reports_v3_sale_facts.sql`, placeholder version, class C, **not applied**). It creates five sealed private helpers:
  - the PKG-B premium stub: the value comes only from `performance_sale_monthly`, and source and state are classified;
  - sale facts, with the plan §2.6 columns;
  - the stored-without-sale count;
  - production: totals, by_agent and production_by_date at an as_of, with the agency-only disclosures null below unfiltered agency scope;
  - the KPI 1–4 envelopes, built through the foundation builders.

  Its preflight refuses replay, requires the foundation, and pins the live premium choke point: source `7e706331…` and `deb0d333…`, definition `51e06b46…`. The harness-built functions match all three. It also checks every dependency column.
- **Harness.**
  - `reports_v3_dependencies.sql`: production DDL for the October `wins` columns and `private.policy_identities`.
  - The premium functions, extracted verbatim from `20261005161623`.
  - `reports_v3_fixtures.sql`: synthetic organizations O1–O4 and a 17-sale premium and credit matrix.
  - New fixture steps: an ordering refusal, a drift refusal and a replay refusal.
- **Tests.**
  - `reports_v3_sale_facts.sql`: the contract, credit, the premium matrix, rollups, exact values, the KPI 1–4 status matrix, and 3 mutation controls.
  - The static test now also checks for exactly five helpers, a single premium source and the live pins.
- **Decision.** D2's KPI 1–4 envelopes are built through the foundation builders, not the validator directly. This keeps one BC4 evaluation, and the static test enforces it.

**Files touched.**
- Batch 2:
  - `supabase/migrations/20261101000011_reports_v3_sale_facts.sql`
  - `supabase/tests/reports_v3_sale_facts.sql`
  - `supabase/tests/reports_v3_dependencies.sql`
  - `supabase/tests/reports_v3_fixtures.sql`
  - `scripts/reports_v3_fixture.py`
  - `src/lib/__tests__/reportsV3Contracts.test.ts`
  - `WORK_LOG.md`
- Documentation addition: `docs/plans/2026-10-31-reports-v2/appendix/` (9 files), `docs/plans/2026-10-31-reports-v2/implementation_plan.md`, `implementation_plan.md`.

**Migrations and deploys.** None. Disposable local synthetic databases only, with placeholder versions.

**Verification** (local, base `6e39c15`):
- **Failing first:** without `…11`, the sale-facts suite stops at `report_v3_sale_facts(...) does not exist`.
- **SQL suites:** the v3 suite passes on PG 16.15, with 7 mutation controls in all. The integrity and RPC suites pass.
- **Static test:** 14/14.
- **TypeScript:** root `npx tsc --noEmit` passes. The app typecheck gives 80 errors whose identities match base, line for line.
- **ESLint and Reports Vitest:** scoped ESLint is clean. Reports Vitest: 27 files, 417 passed, 1 pre-existing skip.
- **Full Vitest:** 6,701 passed, 2 failed, 37 skipped across 1,970 suites. Against a clean `6e39c15` worktree (6,687 passed across 1,966 suites), the 11 failing files and the 2 failing tests are identical by name. The 4 extra suites and 14 extra passing tests are this branch's new tests.
- **Build:** `npm run build` passes.
- **PostgreSQL 17.6 CI on the Batch 2 head:** run 41356530257, conclusion success, on head `83e3d4e479103352c4b48e0eb7f1990be27647d5`. The server reported `PostgreSQL 17.6 (Debian 17.6-2.pgdg13+1)`. The v3 runner applied `…11`, ran the sale-facts suite (2 refusal checks and 3 mutation controls) and ended with "All Reports v3 contract, registry, seal and refusal proofs passed." It had no error lines. Artifact `reports-backend-evidence-41356530257` (sha256 `b594ca8b…`). The connector returns at most the last 5,000 of the job's 5,176 log lines, so the image-pull lines at the top were not read this time; the server version line and the container's own startup lines show 17.6.

**Next.** PKG-A Batch 3: `…12` call and journey helpers, with the BC1/BC2 cases. The exact files are listed first.

**Still open.** A named reviewer for ★1/★4. Placeholder versions get renumbered before any backend merge. The PKG-A production packet comes later and needs separate approval.

## 2026-11-01 — Reports V2 PKG-A Batch 1: v3 contract foundation, harness and contract tests (branch `claude/great-goodall-911azc`; committed locally; NOT pushed, merged, applied or deployed)

**Status:** Branch-only build under Chris's 2026-11-01 conditional approval (plan revision 2.1, `docs/plans/2026-10-31-reports-v2/implementation_plan.md`; root pointer entry of the same date). No push, PR, migration application, production read or write, deploy or settings change.

**What changed:**
- **Foundation migration** (`20261101000010_reports_v3_foundation.sql`, placeholder version, privilege class C, **not applied**). It creates 14 sealed private helpers:
  - the 29-code reason registry and the kind of each code;
  - the 23-row metric registry;
  - each KPI's applicable codes, with the side each coverage code's unknown items sit on;
  - KPI ids per reader;
  - the 3.0.0 basis-flags stub;
  - the half-open Sold Date window;
  - the payload-meta envelope (`report_meta` verbatim, plus v3 markers);
  - the envelope validator, the BC4 evaluator, and four builders (ratio, rate, total, median).

  Its preflight pins the 15 v2 readers and the 12 shared helpers, and refuses replay. The 12 helper fingerprints match the production prefixes recorded in discovery. Postconditions check helper metadata and that no client role or PUBLIC can execute a helper.
- **BC4 in code.** Status comes only from the evaluator, in the order config → zero → coverage → partial → available, on each KPI's own numerator and denominator evidence. The validator independently refuses:
  - unknown numerator evidence shown as 0;
  - a zero code while the deciding side has unknown items;
  - a cohort with members but no maturity block.

  A static test stops any other v3 file from building envelopes directly.
- **Harness.**
  - `scripts/reports_v3_fixture.py` builds the production-equivalent v2 state from the verbatim v2 fixture steps, plus production's default function privileges in `public`.
  - `scripts/run_reports_v3_tests.sh` runs on loopback only and refuses hosted platform roles.
- **Tests.**
  - `supabase/tests/reports_v3_controls.sql`: a five-role effective-privilege seal, including a PUBLIC-only role and an inheriting member of authenticated.
  - `supabase/tests/reports_v3_contract.sql`: the registries; the envelope; every validator rule, including the P0001 SQLSTATE; the 11 required BC4 cases plus about 40 further truth-table rows; precision; an empty window that raises nothing; created-sealed checks; and 4 mutation controls.
  - `src/lib/__tests__/reportsV3Contracts.test.ts`: the file → class map, a GRANT parser, a REVOKE check for every created function, the search_path check, and the builders-only rule.
- **CI.** `.github/workflows/reports-backend.yml` runs the v3 runner on PG 17.6: two path entries, one step line and one artifact line.

**Files touched:**
- `supabase/migrations/20261101000010_reports_v3_foundation.sql`
- `supabase/tests/reports_v3_controls.sql`
- `supabase/tests/reports_v3_contract.sql`
- `scripts/reports_v3_fixture.py`
- `scripts/run_reports_v3_tests.sh`
- `src/lib/__tests__/reportsV3Contracts.test.ts`
- `.github/workflows/reports-backend.yml`
- `WORK_LOG.md`

**Migrations/deploys:** None. Disposable local synthetic databases only.

**Verification** (local, base `6e39c15`):
- **Failing first:** without the foundation, the contract suite stops at `private.report_v3_reason_codes() does not exist`.
- **SQL suites:** `run_reports_v3_tests.sh` passes on PG 16.15. `run_reports_integrity_tests.sh` and `run_reports_rpc_tests.sh` pass. PG 17.6 CI has not run, because no push is authorized.
- **Static test:** 11/11. It fails when one REVOKE is removed (checked, then the file was restored).
- **TypeScript:** root `npx tsc --noEmit` passes. `npx tsc -p tsconfig.app.json --noEmit` gives the same 80 errors as base, compared line by line.
- **ESLint and Reports Vitest:** scoped ESLint is clean. Reports Vitest: 27 files, 414 passed, 1 pre-existing conditional skip.
- **Full Vitest:** 6,698 passed, 2 failed, 37 skipped across 1,969 suites. The 11 failing files are the 11 known at base, outside Reports; this batch changed no application module.
- **Build:** `npm run build` passes.

**Remaining gates and next step:**
- PKG-A Batch 2: `…11` sale facts with the dependency stubs and the v3 fixtures. Its exact file list is stated before editing, and it adds the five internal helpers to plan §2.6.
- Push authorization.
- A bounded change request for the appendix paths.
- A named reviewer for ★1/★4 before any PKG-A production approval.

## 2026-10-30 — Prebuilt SMS and Email Templates V1.1 branch build (NOT merged, seeded or deployed)

**Status:** Branch-only implementation in `claude/sharp-johnson-2ojnub`, continuing Claude's plan using the source ZIP previously supplied in ChatGPT. **Production database seed is NOT approved or run.** No schema/RLS, Twilio/Edge Function, workflow-executor, dialing, Vercel or frontend production changes.

**What changed:** Committed reviewed V1.1 library (12 SMS + 6 email) and exactly matching insert-only home-organization SQL under docs/ and supabase/ops/, plus a read-only fingerprint/collision report. The existing manual template picker now issues one warning toast for absent or unrecognized merge fields while preserving the editable draft and existing manual send logic. Workflow action choices exclude incompatible manual-merge templates, and re-saving such a selected template is refused rather than sending blank automation text. Existing agency/personal template editing and permissions remain in place; no new data fields were needed.

**Files touched:** `implementation_plan.md`, `AGENT_RULES.md`, `WORK_LOG.md`; `docs/plans/2026-10-30-starter-templates/agentflow_starter_templates_v1_1.json`; `supabase/ops/starter_templates_v1_1_{seed_home_agency,report}.sql`; `src/lib/messageTemplateMerge.ts`; `src/components/messaging/MessageTemplatesPickerModal.tsx`; `src/components/workflows/panels/ActionConfigPanel.tsx`; focused tests in `src/lib/__tests__/`, `src/components/messaging/__tests__/`, and `src/components/workflows/panels/__tests__/`.

**Migrations/deploys:** None. All new SQL is review-only; no production writes, emails or SMS were sent.

**Verification:** Data integrity validation (12/6, five supported categories, valid merge fields, STOP on seven marketing SMS drafts, matching SQL) staged in focused Vitest. Browser, TypeScript, lint, build and PR checks will be verified before recommending the separate frontend release gate. The production pre-seed audit checks only counts/fingerprints without changing data.

**Remaining gates:** Review source/CI in draft PR; explicitly approve frontend merge/release separately; explicitly approve the exact home-org seed SQL separately. After an authorized seed, independently compare pre-existing row fingerprints and verify 18 new agency rows. Personal templates must be unchanged.


## 2026-10-30 — Calling Settings teammate picker fits short viewports (follow-up; branch `claude/zen-cerf-tjf1gq`; PR open, NOT merged, NOT released)

**Status:** Chris approved the follow-up from the entry below. Same branch and PR as the modal fix. No merge or deploy.

**What changed:** One class in `src/components/dialer/CampaignUserPicker.tsx`. The teammate list (`CommandGroup`) cap went from `max-h-60` to `max-h-[min(15rem,calc(var(--radix-popover-content-available-height)-3.5rem))]`: still 240px where there is room, otherwise the space Radix reports on the open side minus the search row. Tailwind compiles it to `max-height:min(15rem,calc(var(--radix-popover-content-available-height) - 3.5rem))` (checked in the build CSS). `CommandList`'s 300px cap stays as the fallback. Search, filtering, selection toggling, chips, same-org profile list, permissions and keyboard navigation are unchanged. The picker is only used by the Calling Settings modal.

**Files touched:** `src/components/dialer/CampaignUserPicker.tsx`, `implementation_plan.md`, `WORK_LOG.md`.

**Migrations/deploys:** None.

**Verification:**
- **Browser, picker:** real Chromium, the same harness and 12 combinations as the entry below (320×568, 390×844, 1366×768, 1440×900, 200% zoom at 683×384 and 720×450, light and dark). The popover and its search box are fully on screen at every size. At 683×384 the popover went from top −37px (search box off-screen) to 17px, 241px tall.
- **Browser, rest of the modal:** search and Enter select, ArrowDown+Enter selects, Enter again deselects with the menu staying open; arrow keys scroll the list; Escape closes only the picker. All earlier modal checks still pass.
- **TypeScript:** root `npx tsc --noEmit` passes. The app project has 80 errors, identical to base `245f4b3`.
- **Lint and build:** ESLint on touched dialer files is clean; `vite build` passes.
- **Tests:** dialer Vitest 135/135. The full suite has the same 10 pre-existing failing files as on base.

**Correction to the entry below:** its "wheel-scroll" result was a false pass. Playwright `hover()` scrolled the list itself. Measured correctly, mouse-wheel scrolling over the teammate list does not work in the **original production modal either** (scroll position stays 0); it is not caused by this branch. The Dialog's scroll lock blocks wheel events on this dropdown, which renders outside the dialog. Arrow keys and typing to filter still work (verified). Not changed here, to keep existing behaviour as approved. Fixing it is a separate decision.

## 2026-10-30 — Dialer Calling Settings modal fits the viewport (branch `claude/zen-cerf-tjf1gq`; NOT merged, NOT released)

**Status:** Approved by Chris and implemented. Frontend layout only. Pushed to `claude/zen-cerf-tjf1gq`; no PR, merge or production release. Plan: top entry of `implementation_plan.md`.

**Problem:** Dialer → Campaign Selection → Settings ("Calling Settings", `CampaignSettingsModal`) used `DialogContent` with only `max-w-md`. Measured before the fix, the dialog was 1,087–1,207px tall, so the title, Close X, Save and Cancel were off-screen at every tested size, including 1440×900.

**What changed:** The modal frame (local classes only; shared `ui/dialog.tsx` untouched) is now `max-h-[calc(100dvh-2rem)]` × `w-[calc(100vw-1.5rem)] max-w-md`, `flex-col`.
- **Fixed header:** the title is padded clear of the Close X; long campaign names wrap, with the full name in a `title` tooltip.
- **Scroll body:** only the settings scroll (`min-h-0 flex-1 overflow-y-auto overscroll-contain`).
- **Pinned error:** the save/validation error moved above the buttons as `role="alert"`, so it is never scrolled out of view.
- **Footer:** Cancel and Save always visible, side by side with a gap.
- **Keyboard:** a control that gets focus inside the scroll body is scrolled into view. Radix wraps Tab with `preventScroll`, which otherwise left the wrapped-to field hidden.
- **320px wrapping:** time inputs, Retry Interval and Ring Timeout rows wrap; toggle switches `shrink-0`.
- **Line limit:** Max Call Attempts and Calling Window moved verbatim into `campaignSettingsControls.tsx`, keeping both files under 200 lines (191 / 189).

Values, Zod validation, `handleSaveCallingSettings`, `canEditSettings` / licensed-state gating, Settings Access options, same-org teammate list, `update_campaign_settings` RPC, `organization_id` and RLS are all unchanged.

**Files touched:**
- `src/components/dialer/CampaignSettingsModal.tsx`
- `src/components/dialer/campaignSettingsControls.tsx`
- `src/components/dialer/__tests__/campaignSettingsModal.test.tsx` (new, 13 tests)
- `implementation_plan.md`
- `WORK_LOG.md`

No `DialerPage.tsx`, schema, permissions, Twilio, queue, Edge Function or Vercel changes.

**Migrations/deploys:** None.

**Verification:**
- **TypeScript:** root `npx tsc --noEmit` passes. The app project (`-p tsconfig.app.json`) has 80 errors, an identical set to base `245f4b3`.
- **Lint and build:** ESLint on touched files is clean; `vite build` passes.
- **Focused tests:** Vitest on `src/components/dialer/__tests__` passes, 135/135.
- **Full suite:** 10 files fail (1 test, plus 9 files that cannot load without `VITE_SUPABASE_URL` in this container). The same 10 fail identically on the unchanged base, so they are not regressions.
- **Browser QA:** real Chromium on a git-ignored `scratch/` harness rendering the real modal with app CSS and stub props (no Supabase or network). Sizes: 320×568, 390×844, 1366×768, 1440×900, and 200% zoom (683×384, 720×450), each in light and dark.
  - Every check passed at each size: dialog inside the viewport; header, X, Save and Cancel visible; all eight sections reachable by scrolling; no horizontal overflow.
  - Interactions checked: Settings Access Select, teammate picker (search, select, wheel-scroll, Escape closes only the picker), custom retry input, toggles.
  - Tab and Shift+Tab stay in the dialog and the focused control stays visible; Save, Cancel and Escape work.
  - Loading, saving and error states checked, with the error visible with the body scrolled to top and bottom; long campaign name and long teammate chips checked.

**Follow-up (needs separate approval):** At 683×384, `CampaignUserPicker`'s popover (~280px) opens upward with its search box just above the viewport; list, selection and typing still work. Before this fix the picker was not reachable at all at that size. Proposed one-class fix: on its `CommandGroup`, `max-h-60` → `max-h-[min(15rem,calc(var(--radix-popover-content-available-height)-3.5rem))]`. Validated in the browser by injecting the CSS: the popover fits at 683×384, 720×450, 320×568 and 1366×768.

## 2026-10-29 — Dashboard Polish V2 G3 production complete; G4 reconciliation staged on draft PR #504

**Status:** G3 BACKEND COMPLETE. Protected GitHub Actions runs `40967614726` (check), `40968145912` (apply-migration), and `40968675025` (record-history) succeeded for production `jncvvsvckxhqgqvkppmj`. Supabase independently confirms **352 migration-history entries**, version `20261029200000_dashboard_attention_clearances`, **24 statements**, recorded digest `43769e1677e2a218021e7f8bc146f92e86b1154ae00aa1d3c63e8d1515f07693`. The table, 3 RLS policies, 3 indexes, guard trigger and 2 SECURITY INVOKER RPCs are installed. Security advisor 256 findings (unchanged); performance 465 (+1 informational unused-index notice on the new empty table).

**G4 branch-only reconciliation:** Draft PR #504 `claude/upbeat-cannon-uy6fpg` moves the approved 16,396-byte SQL Git blob `4ab80696278eb8a0bf2b6731b0d8c64e708a52da` unchanged from `supabase/migrations/pending/20261029200000_dashboard_attention_clearances.sql` to `supabase/migrations/20261029200000_dashboard_attention_clearances.sql`. Approved SHA-256 remains `85ac2ff7dcd435bd48718311b05704e4e7d96293abf9b47fd062ce30610cb8e8`. Rollback Git blob `647e78d16ba39480da5e7ec754f1f43598f9c3d6` is unchanged. Protected release runner, rehearsal path guards and workflow comments follow the new path; recorded-state gates still refuse apply/history replay and rollback with existing clearance records. **No production SQL executed during reconciliation.**

**Live-generated TypeScript types:** `dashboard_attention_clearances`, `clear_dashboard_attention_item` and `undo_dashboard_attention_clear` declarations already on PR #504 match live Supabase-generated definitions byte-for-byte. No `types.ts` edit or wholesale regeneration required.

**Files touched:** migration path move (same Git blob), `scripts/dashboard_attention_release.py`, `scripts/tests/dashboard_attention_release_test.py`, `.github/workflows/dashboard-attention-release.yml` (comments), `AGENT_RULES.md`, `WORK_LOG.md`, Dashboard Polish V2 and G3 release plans. No frontend `src/`, Twilio, Dialer or Edge Function edits.

**Verification:** Production G3 history/advisors verified. New PR #504 CI (PostgreSQL 17.6 rehearsal, Dashboard regression/typecheck/lint/build, desktop/mobile dark/light browser and KPI parity) is pending after this reconciliation. The frontend is NOT released; `VITE_DASHBOARD_ATTENTION_CLEARANCES` remains unverified in production.

**Next:** Review all PR #504 checks and Vercel preview, resolve any new failures on draft branch only, then request Chris's separate **G5 production frontend release approval**. No merge, Vercel configuration or deployment until then.

## 2026-10-29 — Private homepage V2 production test-route release approved

Chris authorized merging PR #503 to production for testing before replacing the current homepage. Release only the existing Super Admin-gated `/homepage-v2`; keep `/` and `/homepagetest1` unchanged. Incorporate current main without changing its CRM/backend files. No migration dispatch, environment change, auth change or public-homepage replacement is authorized. Deployment and production-route verification are recorded in PR #503.

## 2026-10-29 — Private homepage V2 authentic demos and review candidate (PR #503)

**Status:** The earlier secure-login blocker is resolved. The test account signed
in through browserAuth; rendered UI confirms Super Admin access to private V2.
Branch-only review candidate; PR remains unmerged and production approval is
still required. Shared real agency names were excluded from every recording.

**What changed:** Replaced all four V2 concept/illustrative panels with actual
shipped dashboard, dialer, AP board and messaging component recordings. Each
approximately six-second loop uses synthetic fixtures in an isolated capture
workspace, with real numeric/rank/glow animations, local call/message simulation,
explicit demo disclosure, blocked backend access and no real calls or sends.
Authorized AgentFlow imagery consists of existing brand assets and genuine
product frames. Removed the illustrative component module and stale pending
labels. Optimized H.264 MP4/VP9 WebM/WebP set totals 656,701 bytes; every encoded
frame decodes, with no audio and stripped source metadata. Added reproducible capture/encoding
tools, provenance, budgets and hashes. No runtime dependency was added.

**Files touched:** V2 page, DemoShell/ProductSections/media and page tests;
`public/marketing-v2/*`; non-production `scripts/tests/homepage-v2/capture/*`;
private V2 plan, claims/capture evidence and media manifest; this work log.

**Verification:** 22 focused Vitest checks; scoped ESLint, including capture
tools with zero warnings (entry component exported for development hot refresh); root TypeScript;
meaningful app types versus exact base `7a03033492c55fd16ea1bacd049934102fe340e4`
(80 baseline, zero added errors); Vite production build. Actual footage checked
on desktop 1440/mobile 390 CSS viewports with no horizontal overflow, muted
viewport autoplay, deferred offscreen sources, offscreen pause, manual pause
retained on resize, mobile menu and FAQ. Capture fixtures remain outside dist.
Both Git-linked preview outcomes and the final signed-in walkthrough are
recorded in PR #503 after push, along with protection/production read-back.

**Migrations/deploys:** No backend/data write, schema/RLS/auth/telephony change,
Vercel configuration change, main update, merge or production release. Only
protected branch previews. Live homepage and CRM functionality are unchanged.

**Review:** See PR #503 and its protected `/homepage-v2` URL. Separate user
approval is required before merging or releasing the homepage.

## 2026-10-29 — Private homepage V2 playback/access polish (PR #503; capture BLOCKED)

**Status:** Explicitly requested by Chris on `feat/private-homepage-v2-20261029`.
Branch-only preparation; draft PR remains open, not merged or released.
**Not complete:** secure AgentFlow sign-in returned `Invalid login credentials`;
authentic dashboard/dialer/AP board/messaging clips and authenticated preview QA
remain pending. No footage is represented as real and no real prospect was
called or messaged.

**What changed:** Preserved the approved dark navy/sky layout; split V2 into
small components; lazy-loaded only V2 behind the unchanged SuperAdminRoute.
Player attaches sources near the viewport, plays only in view/active tab, honors
reduced motion, Save-Data and slow networks, preserves manual pause, handles
blocked autoplay and per-source format failure, and reserves media space.
Added accessible navigation, FAQ relationships and private metadata cleanup.
Removed V2 links to unsupported pricing/trial promises and the contact form
that only shows a local success toast. Get started uses the existing `/signup`
setup flow; no purchase, trial or immediate-access promise.

**Files touched:** `src/pages/LandingPageV2.tsx`; V2 lazy import/route wrapper in
`src/App.tsx`; `src/components/marketing-v2/*` and focused tests;
`scripts/tests/homepage-v2/*` (isolated, non-production visual/playback harness);
`docs/plans/2026-10-29-private-homepage-v2/{implementation_plan,claims-and-capture}.md`;
`WORK_LOG.md`.

**Migrations/deploys:** No backend commands, data writes, Edge deploys, RLS,
telephony changes, Vercel settings or production release. Only the existing
Git-linked protected branch previews may build from this update. `/`,
`/homepagetest1`, SuperAdminRoute, live pricing/contact and CRM functionality
remain byte-identical.

**Verification:** 21 focused Vitest checks; scoped ESLint; root TypeScript;
meaningful app TypeScript against exact base `7a03033492c55fd16ea1bacd049934102fe340e4`
(80 baseline errors, 0 added); Vite production build. Browser QA on isolated
1440/390px viewports: no horizontal overflow, mobile navigation/FAQ, real video
loading/autoplay/manual pause/offscreen pause with an explicitly technical
six-second color-pattern fixture. Fixture/harness excluded from dist. Both
Vercel projects retain SSO protection `all_except_custom_domains`. Final deployed
branch SHA/URL and Ready state are recorded in the PR, not assumed here.

**Blockers / next:** Secure sign-in via browser handoff; locate a safe synthetic
capture workspace; record/review/encode all four authentic loops, replace the
legacy concepts, complete signed-in protected-preview review. See the capture
document for exact boundaries and provenance requirements. Separate approval is
still required before merge or production release.

## 2026-10-29 — Dashboard attention G3 protected backend release PR prepared (NOT applied)

**Status:** Chris approved exact Gate 3 migration and RLS bytes with separately controlled protected workflow stages. This change is release-only, staged on `release/dashboard-attention-g3-20261029`, and **does not apply any database migration or merge Dashboard PR #504**. No Vercel flag, production frontend, CRM source row or Twilio/telephony change.

**Files:** New `.github/workflows/dashboard-attention-release.yml`, `scripts/dashboard_attention_release.py`, `scripts/tests/dashboard_attention_release_test.py`, `docs/plans/2026-10-29-dashboard-polish-v2/g3-release/implementation_plan.md`; extended `.github/workflows/dashboard-attention-backend.yml`; copied byte-identically from PR #504 the forward SQL, rollback, 2 SQL tests and `scripts/run_dashboard_attention_tests.sh`. This newest-first `WORK_LOG.md` entry. No `src/` changed.

**Pinned files:** forward 16,396 bytes SHA-256 `85ac2ff7dcd435bd48718311b05704e4e7d96293abf9b47fd062ce30610cb8e8`, rollback 2,338 bytes SHA-256 `9250e2e7cedc8d8e6476838d84e1bc924b869b79248a0e982f68dd267393db55`; Git blobs match approved PR #504.

**Read-only production preflight:** PostgreSQL 17.6, 351 migration history rows, latest `20261029120000`, all new objects absent, `get_org_id` MD5 `fb1d12f537aac3b3ed18c9e0628f2251`, advisors 256 security / 464 performance findings. The protected release workflow uses manual stage+confirm, main-only, existing `google-sheets-production` environment with reviewer, a protected stage, pinned CLI 2.121.0, and 2 existing database secrets. Never `db push` or automatically execute migrations.

**Verification/next:** Existing 69-test SQL suite passed in PR #504. The release-only PR must pass PostgreSQL 17.6 rehearsal, verify the pinned 24-statement CLI digest 43769e1677e2a218021e7f8bc146f92e86b1154ae00aa1d3c63e8d1515f07693, and check protected environment settings before a separate merge approval. Then read-only `check`, separately approved production `apply-migration`, read-back/advisors, separately approved `record-history`, and later distinct G5 frontend approval. No production work executed in this task.

## 2026-10-29 — Dashboard Polish V2: G2 built on the feature branch (Clear / Dismiss, visual polish, Team-mode context); migration PREPARED, NOT applied

**Status:**
- G1 plan approved by Chris (D1–D16 as recommended, including the narrow protected `dashboard-callbacks.ts` edit).
- G2 is implemented on `claude/upbeat-cannon-uy6fpg` only.
- **Not merged, not deployed. No production SQL. No Vercel variable changed.**
- `VITE_DASHBOARD_ATTENTION_CLEARANCES` is unset everywhere real.
- Plan and evidence: `docs/plans/2026-10-29-dashboard-polish-v2/implementation_plan.md`.

**Correction to the entry below (stale):**
- G3 is no longer branch-only: PR #502 was merged as `7a03033`, and Vercel production deployment
  `dpl_EDZ4obVUw3dgB8fwxPi7PnbgkoUq` is READY.
- Whether `VITE_DASHBOARD_MILESTONE_REVIEWS=true` is set in production could not be read from this session (Vercel env
  listing returned 403).

**What changed:**
- **Clear (Missed Calls, Callbacks):**
  - Per-viewer, occurrence-specific alert state in the new `dashboard_attention_clearances`, written only by two
    SECURITY INVOKER RPCs.
  - A visible Clear button on widget and modal rows; Undo (toast and history); the Cleared view; "N cleared" links.
  - Persists across refresh and login (database, not the browser).
  - A rescheduled callback has a new due time, so it returns on its own.
  - Source records are never written: calls, voicemails, notifications, campaign leads (due, owner, status, queue),
    appointments.
- **Exact counts:**
  - Cleared items are excluded inside the paging math: each branch reads `K` rows deeper, then the merge and slice.
  - Totals subtract only clearances that still match under the same branch filters.
  - Widget rows, modal pages, active totals and "View All N" agree, including when campaign and appointment callbacks
    interleave.
- **Dismiss (Client Milestones):** a visible Dismiss button (stored as the existing `reviewed`); Pending · Snoozed ·
  Dismissed history; a "View dismissed" link. No schema change.
- **Missed Calls:**
  - One shared contract (`dashboard-missed-calls.ts`) for the widget and the modal. The modal can now call back linked
    contacts.
  - An explicit organization filter closes a latent Agency-Group peer exposure (0 groups exist today).
- **Visual polish:**
  - Shared status badges with text labels, in the approved colors.
  - A primary Calls-blue call action; Clear / Dismiss as secondary actions.
  - Blocked actions stay focusable and state their reason (`aria-disabled`).
  - Focus moves to the next row after a removal.
  - Rows wrap on narrow screens (no horizontal scroll at 390 px).
  - Normal-case typography; exact or "N+" callback bucket counts.
- **Team-mode context** (an Admin's Team view; the Team Leader list scope is unchanged):
  - owner, campaign, assignee, client agent and writing-agent names, from batched organization-scoped reads;
  - missed-call recipients from routing metadata, never `calls.agent_id`, and never one agent for a call that rang
    several;
  - initials only.
- **Unchanged:** the four KPI cards (pixel-identical), telephony, Twilio, the Dialer, the scope rules, contact identity
  and RLS on existing tables.

**Files touched:**
- **Backend package (not applied):**
  - `supabase/migrations/pending/20261029200000_dashboard_attention_clearances.sql`;
  - `supabase/migrations/rollback/20261029200000_dashboard_attention_clearances.rollback.sql`;
  - `supabase/tests/dashboard_attention_clearances{,_harness}.sql`;
  - `scripts/run_dashboard_attention_tests.sh`;
  - `.github/workflows/dashboard-attention-backend.yml`.
- **New frontend:**
  - `src/lib/dashboard-attention{,-config,-sources}.ts`, `dashboard-missed-calls.ts`, `dashboard-people.ts`,
    `dashboard-widget-loads.ts`;
  - `src/hooks/useAttentionClearActions.ts`, `useAttentionDetailFeed.ts`, `useRowFocusRecovery.ts`;
  - `src/components/dashboard/DashboardAttentionModal.tsx`, `DashboardMissedCallsModal.tsx`,
    `attention/AttentionModalLayout.tsx`, `callbacks/CallbackRow.tsx`, `missed-calls/MissedCallRow.tsx`;
  - `ui/DashboardActionButton.tsx`, `ui/DashboardPersonChip.tsx`, `ui/DashboardAttentionSummary.tsx`.
- **Modified frontend:**
  - `src/lib/dashboard-callbacks.ts` (approved exception), `dashboard-milestones{,-data}.ts`;
  - `src/hooks/useDashboardDetailFeed.ts`, `useMilestoneActions.ts`;
  - `src/pages/Dashboard.tsx`;
  - `DashboardCallbacksModal.tsx`, `DashboardDetailModal.tsx`, `DashboardMilestonesModal.tsx`, `DashboardRecordRow.tsx`,
    `DashboardRecordsModal.tsx`, `dashboardRecordText.ts`;
  - `milestones/MilestoneRow.tsx`, `milestoneCopy.ts`;
  - `ui/dashboardTones.ts`, `DashboardListRow.tsx`, `DashboardRowActions.tsx`, `DashboardModalShell.tsx`,
    `DashboardFilterChips.tsx`, `DashboardWidgetFrame.tsx`;
  - all six widgets and `LeaderboardPreviewRow.tsx`;
  - `src/integrations/supabase/types.ts` (surgical: one table and two RPCs).
- **Tests:**
  - new: `dashboardCallbacksClearances`, `attentionClearActions`, `dashboardMissedCallsModal`, `dashboardTeamContext`,
    `dashboardStatusBadges`, `src/lib/__tests__/dashboardAttention`, `dashboardMissedCalls`, `dashboardPeople`, and
    `src/test/fakePostgrest.ts`;
  - updated: `dashboardCallbacks`, `dashboardCallbacksModal`, `dashboardDetailModalVoicemail`,
    `clientMilestonesWidget`, `dashboardMilestonesModal`;
  - `scripts/tests/dashboard-ui/verify.mjs`;
  - `.github/workflows/dashboard-g3-frontend.yml`.
- **Docs:** `AGENT_RULES.md` (new attention-clearance invariant, #22 amendment, milestone wording and status), the plan,
  root `implementation_plan.md`, this log.

**Migrations/deploys:**
- None applied or deployed.
- Read-only production catalog / aggregate reads during G1 only.
- Migration SHA-256 `85ac2ff7dcd435bd48718311b05704e4e7d96293abf9b47fd062ce30610cb8e8` (16,396 bytes).
- Rollback SHA-256 `9250e2e7cedc8d8e6476838d84e1bc924b869b79248a0e982f68dd267393db55`.

**Verification (local; CI not yet run):**
- **SQL** (disposable PostgreSQL 16.15, `plpgsql.variable_conflict = error`):
  - 69 behaviour checks, plus the replay guard, the concurrency check, three negative controls and the rollback proof;
  - all passed.
- **Vitest:** 492 passed and 12 skipped across the 33 Dashboard and milestone files (base: 440).
  - The new tests include an exclusion property test against a brute-force oracle, 40 seeded scenarios × 2 scopes ×
    4 page sizes.
  - The milestone engine passed under America/Los_Angeles, Pacific/Auckland and UTC.
- **Full Vitest:** 6,637 passed. The 10 failing files fail identically on untouched `main` `7a03033`: 9 need
  `VITE_SUPABASE_URL`, 1 is a recording-retention byte check. None is caused by this change.
- **Type checks:** `npx tsc --noEmit` clean. App typecheck against `7a03033`: base 80, candidate 80, new 0.
- **ESLint:** clean on all 59 touched TypeScript files.
- **Build:** `npm run build` passed (the existing chunk-size warning only).
- **Browser** (`verify.mjs`, mocked Supabase, 1440/390 px, light/dark, reduced motion): 80/80 checks.
  - Covered: Clear, Undo and the Cleared view on Callbacks; Clear on Missed Calls; keyboard Dismiss and the Dismissed
    history; focus after a removal; no horizontal overflow.
  - KPI cards are pixel-identical to `main` in all four captures (0 changed pixels).

**Blockers / next (each separately approved):**
1. Chris reviews the G2 package. A PR for CI (G4 checks) only on request.
2. **G3:** approval of the exact migration bytes and RLS. Then the apply through the approved route (recommended: a
   protected-workflow release-only PR), catalog read-back, advisors against the 256 / 466 baseline, the history record,
   a byte-identical move out of `pending/`, and a regenerated-types diff.
3. **G4:** CI and Vercel preview, plus visual verification.
4. **G5:** frontend merge, then Chris sets `VITE_DASHBOARD_ATTENTION_CLEARANCES=true`.
5. Confirm `VITE_DASHBOARD_MILESTONE_REVIEWS` in production (Dismiss needs it).
6. Follow-ups needing their own approval: `get_performance_details` agent / carrier fields; Team Leader downline lists.

**Context snapshot:** frontend and migration package on the branch only. Production database, Vercel and flags
unchanged.

## 2026-10-29 — G2 production closeout; G3 Dashboard release candidate prepared on current main

**Status:** G2 PRODUCTION COMPLETE. Protected PR #501 merged at `78d532b` (release workflow only). `check` [#40925336827], `apply-migration` [#40925926281], and `record-history` [#40926621789] succeeded; independently verified in production on project `jncvvsvckxhqgqvkppmj`. G3 visual release is **branch-only**, not merged, not activated or deployed.

**Production database and history:** `20261029120000_dashboard_milestone_reviews` recorded as history #351, 28 statements, approved digest `07cabc94f4a42c2c0d9a7c1265c9aa622eee65af14bb26dc9889b878d9765ec7`. Table, two SECURITY INVOKER RPCs and guard trigger exist; RLS enabled with four authenticated-only policies, 12 columns, five indexes, 3 cascading FKs, five checks. No client/policy/call data migration; review table initially empty. Security advisors remain 256 findings (no new milestone finding); performance 466 versus 464 baseline (two new unused-index INFO notices on the empty milestone table).

**G3 candidate changes (not production):** New branch `claude/dashboard-g3-finalize-20261029` based on production `main` `78d532b`; copied only approved G1 dashboard source, tests and `AGENT_RULES.md` from `claude/great-clarke-c1gpw6`. Four existing KPI cards remain untouched. Reconciled approved migration blob (SHA-256 `e673749357f7612991cccf7405aa0f5f0a9ac49c798bfbd13b006d34f78d8806`) from `pending/` to `supabase/migrations/20261029120000_dashboard_milestone_reviews.sql`, unchanged bytes. Re-pinned protected G2 runner/workflow/rehearsal to the new path. Generated live Supabase TS types, added **only** milestone table and two RPC signatures to `src/integrations/supabase/types.ts`, and switched milestone read/write queries to the typed client instead of `as any`. Existing unrelated live-schema type drift was deliberately not copied.

**Files touched:** Approved G1 `src/pages/Dashboard.tsx`, dashboard widgets, detail modals, UI components, hooks, milestone engine, tests, browser harness; `AGENT_RULES.md`; `src/integrations/supabase/types.ts`; `src/lib/dashboard-milestones-data.ts`; G2 migration path (move only); `scripts/dashboard_milestones_release.py`; `scripts/tests/dashboard_milestones_release_test.py`; `.github/workflows/dashboard-milestones-release.yml`; Dashboard plan and G2 release-design docs; `WORK_LOG.md`.

**Migrations/deploys:** G2 production applied/recorded through the previously approved protected workflow. **No additional production backend writes or G3 Vercel changes** during this preparation.

**Verification:** Prior G1 branch: 440 focused Dashboard tests, 44 browser checks, byte-identical KPI captures and no new app type errors; G2 protected runner/SQL suite passed on PostgreSQL 17.6. Current G3 branch CI / typecheck / browser verification still needs fresh runs and PR review. Do not describe G3 as ready for merge until those pass.

**Blockers / next:** Open a G3 draft PR, run full applicable CI and browser verification, resolve any new failures, confirm final activation date and Vercel flags, then request Chris's distinct **G3 production release approval**. Do not merge, change Vercel env vars, or deploy until that approval.


## 2026-10-29 — G2 protected release workflow for Dashboard milestone reviews (release-only PR; NOT merged, NOT dispatched)

**Status:** Chris approved the G2 release-workflow design with safeguards.
- Implemented and rehearsed on an isolated PostgreSQL.
- Proposed to `main` as a release-only PR, with no `src/` change.
- **Not merged. No stage has been dispatched. The G2 migration is NOT applied** (production read back: 350 history rows, head `20261028040215`, none of the objects).
- No Vercel variable changed. The Dashboard frontend (G3) is not released.
- Design and evidence: `docs/plans/2026-10-29-dashboard-premium-redesign/g2-release-workflow-design.md`.

**What changed:**
- **New `.github/workflows/dashboard-milestones-release.yml`:**
  - dispatch only, main only, behind the protected `google-sheets-production` environment (reviewer cgarness, admin bypass off);
  - four typed, confirmed stages: `check` → `apply-migration` → `record-history` → `rollback-migration`;
  - only `SUPABASE_DB_PASSWORD` / `SUPABASE_POOLER_HOST`, a pinned checkout and CLI 2.121.0.
- **New `scripts/dashboard_milestones_release.py`.**
  - It executes only the approved migration, fed from its checksummed bytes (16,405 B, SHA-256 `e6737493…`), in one psql transaction.
  - It records history with `migration repair` from a temporary workdir that holds only that file. Never `db push` or `migration up`.
  - **Rollback refuses while any milestone review row exists:** a pre-check, then a re-check under `ACCESS EXCLUSIVE` inside the rollback transaction.
  - **CRM activity can't cause a false failure:** the invariants are a schema-only fingerprint and the migration history. No CRM rows are read.
- **New `scripts/tests/dashboard_milestones_release_test.py`:** the rehearsal (real CLI, TLS loopback, synthetic data).
- `dashboard-milestones-backend.yml` gains two jobs: `release-runner` (`postgres:17.6` pinned by digest) and a live, secret-free `environment-guard`.

**Unchanged:**
- the migration and rollback bytes;
- the Google Sheets and hierarchy release workflows;
- unrelated migrations: 12 local files drift from production history; they are listed in the design and untouched.

**Migrations/deploys:** none.
- Read-only production checks only: the state classifier, the `get_org_id` digest, and the fingerprint query (5,892 entries).

**Verification:**
- Rehearsal (local PostgreSQL 16.15, TLS, port 5432; pinned CLI 2.121.0, release checksum verified): `ALL PASSED: 38 checks`.
  - Security failures: refs, confirmations, bytes, copies, CLI, hosts, identity, environment settings, drifted states.
  - The full release under live CRM traffic: about 1,400 committed client write cycles.
  - Interrupted-stage recovery: lock timeout, watchdog, SIGTERM, a lost runner, a lost CLI, a lost rollback.
  - Rollback refusal with review rows, including the race.
  - 13 read-back tamper cases, decoy migrations never run, and no secret in any output.
- SQL suite: 45 checks, both negative controls and the rollback proof pass.
- CI on PostgreSQL 17.6: see the PR.

**Blockers / next (each separately approved):**
1. Chris's merge decision on the release-only PR.
2. Dispatch `check` → `apply-migration` → independent read-back and advisors → `record-history`.
3. Follow-up: move the file out of `pending/` byte-identically, re-pin the runner, regenerate types.
4. G3.

**Context snapshot:** the release machinery is ready for review; production is unchanged; G2 and G3 are still gated.

## 2026-10-28 — Google Sheets v2 source-column UI cleanup (approved, PR candidate)

**Status:** Branch-only frontend refactor `refactor/sheets-map-source-labels-20261028` from `c707bd7cc3e6800ceb82840889f5f62bb9e37a3a`; not merged to `main`, not released to production. Chris explicitly approved removing column letters and sample captions on the mapping screen, retaining the full source header, New indicators and all mapping/Preview behavior.

**What changed:** The source side of each mapping row is now a single ellipsized, full-header-tooltip label vertically aligned with its 36px target dropdown. The source-letter and `e.g.` captions are no longer shown in the mapping step. The Preview step and its server-provided values remain unchanged, as do field options, mapping targets, duplicate confirmation, ignored-column acknowledgments and access checks.

**Files touched:**
- `src/components/settings/google-sheets/MappingColumnRow.tsx`
- `src/components/settings/google-sheets/MappingStepV2.tsx`
- `src/components/settings/google-sheets/__tests__/googleSheetsV2Ui.test.tsx`
- `scripts/tests/google-sheets-ui/verify.mjs`
- `docs/plans/2026-10-28-sheets-map-source-labels/implementation_plan.md`
- `WORK_LOG.md`

**Migrations/deploys:** None; no Supabase queries or mutations; no Edge, Twilio, Google Sheets source or Vercel production changes.

**Verification:** Focused Vitest, ESLint, `npx tsc --noEmit`, meaningful app typecheck against the exact PR base, Vite build, SQL/Edge and 1440px/390px browser CI are **pending on the PR head**. Browser fake provider now supplies a nonempty sample row to verify the mapping step does not display that sample, while Preview values remain intact. Confirm CI results before requesting release.

**Blockers / next:** Open a review PR; obtain Chris's separate explicit merge approval. Teo's mapping correction and Alexa's intentionally retained v1 mapping remain out of scope.

**Context snapshot:** The change only touches frontend presentation and regression tests plus its plan/log; no tenant-data writes, schema changes, new integrations, or backend deployments. Existing imports and mappings remain governed by the original v2 preview/save validation.
## 2026-10-28 — Google Sheets mapping v2 production release closeout and picker polish (PR #499 CI verified; awaiting merge approval)

**Status:** Production R2–R7 live/verified, R8 owner opt-in 3/4; documentation + frontend polish prepared **only on `chore/sheets-v2-closeout-picker-20261028`**, [PR #499](https://github.com/cgarness/agentflow-life-insure/pull/499). **Google Sheets CI passed all 5 jobs** on tested code SHA `9d30a8c2`; merge still needs separate Chris approval. Do **not** describe the new A–Z dropdown as live until the PR is merged and production deployment verified.

**Production history (prior approved actions, not actions of this branch):**
- PR #498 merged to main at `f870755586a94f16caf1af631391de0237d82f31`. Vercel v2 deployment `dpl_ApDSmKFJtJTnfNy4mwdzqLsQk58X` READY, flag `VITE_GOOGLE_SHEETS_MAPPING_V2=true` in production.
- M1 actual version `20261028034425_google_sheets_context_field_types`; M2 actual version `20261028040215_standard_lead_fields`; both bytes matched the exact production statements (MD5 `e93a8f1e3904fa5c6da6cf3843fe2ad4`, `d8a405763974cdccd616b800e4314883` respectively).
- Sheets API v12, Push v6, Worker v11 ACTIVE with `verify_jwt=false`. R7 conversion approved exact Address, City, Zip Code IDs in Chris's organization; 3 audits, no existing lead-value changes, provisioning complete.
- 4 connected sources healthy: 3 v2 (Chris Pilot B, Alexa FEX Real Time, Teo Goat Leads), 1 retained v1 (Alexa FEX Aged). Big Test automatic v2 import succeeded with one receipt and no duplicate. Latest audit had 2,046 leads and 15 import receipts (a snapshot, not a permanent target).

**This branch changes (no Supabase/Vercel data or deployment writes):**
- Renames the two forward migration files from `pending/` to `supabase/migrations/` with their actual history versions, **without changing any as-applied SQL byte**; renames the two never-applied rollback files. Updates runner, CI path filters, and unit test's migration path.
- Updates historical release runbook, `AGENT_RULES.md` mapping v2 status, adds `docs/plans/2026-10-28-sheets-v2-closeout/implementation_plan.md`.
- UI-only: `MappingFieldPicker.tsx` now displays fields A–Z in one searchable list, with no group headings; missing standard field choices are sorted in, and compact In use/Unavailable labels retain tooltips, screen-reader reasons, disabled states and Move confirmation. Updates focused UI tests.

**Files touched:** `AGENT_RULES.md`, `WORK_LOG.md`, `docs/plans/2026-10-27-sheets-mapping-reliability/release.md`, `docs/plans/2026-10-28-sheets-v2-closeout/implementation_plan.md`, `scripts/run_google_sheets_tests.sh`, `.github/workflows/google-sheets.yml`, `src/lib/google-sheets/__tests__/mappingV2.test.ts`, `src/components/settings/google-sheets/MappingFieldPicker.tsx`, `src/components/settings/google-sheets/__tests__/googleSheetsV2Ui.test.tsx`, the two renamed forward SQL files and two renamed rollback SQL files.

**Verification:** Re-read production migration history and original GitHub source checksums; source SQL matched production bytes at reconciliation. Google Sheets CI [run 40751281029](https://github.com/cgarness/agentflow-life-insure/actions/runs/40751281029) completed **SUCCESS (5/5 jobs)** on code SHA `9d30a8c2`: SQL/PostgREST/e2e, Deno Edge, real isolated pg_cron/pg_net, frontend focused Vitest (190 passing tests), ESLint, `npx tsc --noEmit`, app type-check against exact PR base, Vite build, and desktop/mobile (1440/390 px) browser flow. Vercel preview checks passed; no production deployment. Root `npx tsc --noEmit` is vacuous by itself, while the app type baseline check was meaningful. The final commit only updates plan/log test evidence, not tested application code.

**Risks and follow-ups:** Teo owner to fix Beneficiary Name → Full Name and review ignored address fields; Alexa FEX Aged remains v1 by choice; Alexa FEX Real Time ignores Trusted Form URL/OTP/IP (review consent-evidence implications separately). Nine historical Pilot B receipts point to absent leads; no deletion, repair or inferred cause. Do not change mapping JSON or release backend. Review PR CI, obtain Chris's distinct approval for merge and automatic Vercel production build, then verify deployment and signed-in desktop/mobile picker behavior.

**Context snapshot:** No new migrations applied, Edge deployed, Vercel config changed, or production data mutated in this task. Changes are branch-only; next action is CI review and separate merge approval.
