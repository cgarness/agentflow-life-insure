# Reports Phase 1 integrity verification

Status: published for verification in draft [PR #418](https://github.com/cgarness/agentflow-life-insure/pull/418) after approval on October 5, 2026; **not merged or deployed**. Branch `codex/reports-integrity-phase1-20261005`, base `b90e12d3bdcfb188ca0fbc6f25e971aaf77ddbf1`. Fresh GitHub main still matches that base. The six currently open PRs have no Reports-owned source overlap. All three project source-of-truth documents were read fully before application edits.

## Evidence

| Check | Result | Limit |
| --- | --- | --- |
| Targeted Reports, hook, page, normalization tests | 145 passed in 9 files, no skips | Rendered component tests, not an authenticated browser session |
| SQL response → Zod contract | All six actual synthetic SQL RPC responses accepted | Embedded database; no fabricated replacement for a hosted response |
| Embedded PostgreSQL | 28 passed steps, including original Reports, policy and campaign privacy suites | PGlite 0.3.14; not native PostgreSQL or independent-session concurrency |
| Assertion sensitivity | Six intentional defects rejected: uncapped sessions, duplicate inclusion, closed endpoint, legacy zero, wrong average denominator, widened personal scope | Every mutation rolls back |
| Migration/recovery | Wrong order, authorization drift and replay refused; disabled deployment stays disabled; old enable refuses; new enable rejects drift and inherited legacy grants | Native execution remains a CI gate |
| Source immutability | Full synthetic row fingerprints unchanged across migrations and recovery | No production mutation or fabricated production record |
| Synthetic scale | 50,000 calls, 2,000 overlapping sessions → 50,000 matched calls, 600,300 union seconds; observed summary 1,149 ms | Embedded timing, not hosted latency or capacity |
| Existing index | Selective organization/date predicate uses `idx_calls_org_created_at` with ordinary planner settings | One selective call plan; not a claim about every panel/query plan |
| Actual app TypeScript | Same 87 file/code/message diagnostics as base; zero additions | Existing repository diagnostics remain |
| Root TypeScript | Pass | Root project alone does not typecheck the application |
| Lint | Full output identical to base: 11 errors, 184 warnings; changed Reports files pass scoped lint | Existing unrelated errors remain |
| Production build | Pass | Existing large-chunk warning remains |
| Real Chromium Reports page | Desktop 1440px and mobile 390px, six real hooks/SQL payloads, exact/unknown values, CSV downloads, partial failure/retry, stale-window withholding | Isolated synthetic transport; local SQL payloads from embedded PostgreSQL, native SQL payloads required in CI |
| Browser geometry and screenshots | No page overflow or clipped currency; complete amounts/coverage visible after fixing two cramped premium areas | Preserves existing Reports sections; not a production hosted login |

The broad base suite has 4,187 passing tests and ten failed files: nine collection/import failures and one existing recording-retention byte assertion. The final candidate has **4,199 passing tests**, the same ten failed file identities and same one failed assertion, with no unhandled errors in the runtime reporter. Its 33 skips include the optional SQL-payload test, which was separately run successfully in the 145-test targeted suite with actual SQL output. Evidence and final counts are recorded in `verification.json`; failures are compared by identity, not just their total.

Independent SQL and frontend review found and resolved three gaps: old exports after A→B→A/same-key refresh, unavailable campaign premium absent from the screen, and inherited EXECUTE grants during recovery. Export eligibility now requires the currently ready payload and is invalidated on scope changes, retry, refresh and unmount. Explicit requested-scope mismatches also fail closed. A second review found no further concrete regressions.

## Reproduce

Native, disposable local PostgreSQL only:

```bash
PGURL=postgresql://postgres:LOCAL_TEST_PASSWORD@127.0.0.1:55433 bash scripts/run_reports_integrity_tests.sh
```

The runner refuses non-loopback hosts, query/fragment/database-path overrides and clusters with Supabase platform roles. Three unsafe URL forms were confirmed rejected before any connection. It creates and drops only its own uniquely named synthetic database. It retains `reports-integrity-payloads.json` for runtime schema verification. Existing native Reports and profile suites remain in CI alongside the new gate.

Embedded alternative, with PGlite installed outside the application dependencies:

```bash
PGLITE_PACKAGE=/absolute/path/to/node_modules/@electric-sql/pglite \
REPORTS_SQL_PAYLOADS=/absolute/path/to/reports-integrity-payloads.json \
node scripts/tests/reports-integrity-embedded.mjs
```

Run the focused frontend suite with `REPORTS_SQL_PAYLOADS` set to that synthetic output to include the SQL round trip. Without it, that one test explicitly skips. No package or lockfile changed. CI's existing exact-base frontend comparator and native PostgreSQL jobs remain mandatory after publication.

## Limits and outstanding release gates

Native PostgreSQL startup was blocked by this environment's inability to switch process groups (`runuser: cannot set groups: Operation not permitted`). It was not bypassed. No authenticated hosted-browser, PostgREST latency or independent-session concurrency result is claimed. Public publication and the draft PR are approved and complete. No production migration, repair, RLS change, Edge deployment, production Vercel release or merge occurred.

Historical duplicate candidates remain included unless an exact reviewed mapping already exists. Legacy duration provenance is still unknown where recorded that way. This build makes those limits visible; it does not certify all historical call or booking data. Reports retains stored-policy sold-date/current-owner/current-premium semantics, separately from Leaderboard's original sale events.

## Publication and browser continuation

Rechecked all 43 previously recorded source hashes and all 15 local evidence hashes after interruption: no mismatch or missing file. Initial GitHub publication commit `450fdc28c724e8e158476dd3769d895a48f1497d` has the exact tree `b48a9577ad6c5cefab04ef9c679b2ec00ecd2ac0` of local reviewed commit `a1701836504b6645f8af29c4378d2181d79ffaf7`; only commit metadata differs. The browser continuation is a follow-up on the same draft PR.

The browser fixture imports the real Reports page, components, hooks, query adapters, runtime schemas and CSV exporter. Only auth, layout persistence and database transport are replaced. Responses retain their original SQL dates, scope, amounts and as-of; the browser uses the real date picker to select that window. Unsupported windows fail explicitly. Browser traffic is restricted to its loopback fixture, with no customer data or hosted credentials.

Screenshot inspection found clipped premium cents in Call Summary and crowding in the Agent Performance card. The correction widens those monetary cells within their existing grids and permits wrapping. New DOM checks reject clipped currency at both viewport sizes. Scoped lint and independent frontend review passed. The local agent-browser CLI could not start its daemon, so the actual local browser evidence comes from pinned Playwright/Chromium. CI retains both the agent-browser initial page check and the full Playwright flow against native SQL output.

Initial native CI runs were queued with no runner or steps assigned; no deployment approval, conflicting concurrency group or repository-running job explained the delay. Their state is pending, never counted as a pass. Supabase's separate Preview integration reported its concurrent branch limit; production access was not used to work around it. Exact final PR head and remote gate outcomes are recorded in the PR and saved review packet, avoiding a self-invalidating evidence-only commit after CI.

Raw test logs are scratch evidence; reproducible assertions, summarized results, hashes and the exact source manifest are committed. The user-facing review packet is saved separately. Follow `release_packet.md` for the proposed approval boundary and safe activation order.
