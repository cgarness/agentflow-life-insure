# Isolated Reports browser gate

This fixture loads the real Reports page, components, hooks, query adapters, Zod contracts, formatting and CSV exporter. Only auth, layout persistence and the Supabase transport are replaced. No auth token, hosted endpoint or customer records are used. Every fixture file is outside the production entry graph.

Run `scripts/run_reports_integrity_tests.sh` against a disposable loopback PostgreSQL service first. Its `reports-integrity-payloads.json` contains all six real v2 SQL responses for the synthetic administrator and October 1, 2026. The original top-level agency bundle is preserved; `scopes.personal` and `scopes.team` hold independently queried responses for the same actor. This administrator has no downline, so its team and personal numbers legitimately match while their scope metadata differ. The fixture copies responses without changing dates, scope, amounts or as-of metadata. Unsupported windows/agent filters return unavailable. The browser drives the real custom date picker to the exact SQL window.

From the repository root:

```bash
REPORTS_SQL_PAYLOADS=/absolute/path/to/reports-integrity-payloads.json npx vite --config scripts/tests/reports-visual/vite.config.ts
```

Use the agent-browser dev-server verification flow, then run in another terminal:

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright node scripts/tests/reports-visual/verify.mjs
```

The workflow pins Playwright 1.56.1 and agent-browser 0.38.2. Optional `CHROMIUM_PATH` selects an installed Chromium. `REPORTS_VISUAL_OUTPUT` selects the evidence directory. The verifier blocks external HTTP data requests and records screenshots, actual CSV downloads and RPC request arguments. The preference stub accepts only the synthetic owner, stores a personal v4 layout in this isolated origin's local storage, and can explicitly fail a save. It does not replace the real layout hook or UI.

Checks cover desktop (1440px), mobile (390px), page overflow, fixed executive hierarchy, premium coverage and unknown values, exact seconds, labels and data-quality disclosure, unavailable campaign/source attribution, interval-matched efficiency, summary/agent/campaign CSV downloads, formula protection using a separate explicitly synthetic export example, one-panel failure/retry, and stale-window export withholding. Phase 2 adds mobile and keyboard visibility/reordering, save/remount persistence, cancel, reset and failed-save recovery; genuine Personal / Team / Agency transitions, agent-filter clearing, and an intentionally held request that proves stale exports remain withheld. The real calendar is navigated to October 2026; browser time and SQL payload metadata remain untouched.

For a local environment without native PostgreSQL, `scripts/tests/reports-integrity-embedded.mjs` can export the same SQL fixture format through `REPORTS_SQL_PAYLOADS`. Evidence from that path must be labeled **embedded SQL + real browser**, not native PostgreSQL. CI continues to generate these bundles with the disposable native PostgreSQL runner.

This is a real-browser synthetic integration gate. It does not establish hosted login, PostgREST transport, production data accuracy, role authorization in a signed-in browser, native browser zoom, or multi-user concurrency. Native SQL role/ACL evidence is produced separately by the same workflow. Review screenshots before release. Execution status belongs in the release verification record; this README does not claim an unexecuted gate passed.
