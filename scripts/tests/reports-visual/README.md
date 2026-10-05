# Isolated Reports browser gate

This fixture loads the real Reports page, components, hooks, query adapters, Zod contracts, formatting and CSV exporter. Only auth, layout persistence and the Supabase transport are replaced. No auth token, hosted endpoint or customer records are used. Every fixture file is outside the production entry graph.

Run `scripts/run_reports_integrity_tests.sh` against a disposable loopback PostgreSQL service first. Its `reports-integrity-payloads.json` contains all six real v2 SQL responses for the synthetic administrator and October 1, 2026. The fixture copies those responses without changing dates, scope, amounts or as-of metadata. Unsupported windows/agent filters return unavailable. The browser drives the real custom date picker to the exact SQL window.

From the repository root:

```bash
REPORTS_SQL_PAYLOADS=/absolute/path/to/reports-integrity-payloads.json npx vite --config scripts/tests/reports-visual/vite.config.ts
```

Use the agent-browser dev-server verification flow, then run in another terminal:

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright node scripts/tests/reports-visual/verify.mjs
```

The workflow pins Playwright 1.56.1 and agent-browser 0.38.2. Optional `CHROMIUM_PATH` selects an installed Chromium. `REPORTS_VISUAL_OUTPUT` selects the evidence directory. The verifier blocks external HTTP data requests and records screenshots, actual CSV downloads and RPC request arguments.

Checks cover desktop (1440px), mobile (390px), page overflow, premium coverage and unknown values, exact seconds, labels and data-quality disclosure, unavailable campaign/source attribution, interval-matched efficiency, summary/agent/campaign CSV downloads, formula protection using a separate explicitly synthetic export example, one-panel failure/retry, and stale-window export withholding. The real calendar is navigated to October 2026; browser time and SQL payload metadata remain untouched.

This is a real-browser synthetic integration gate. It does not establish hosted login, PostgREST transport, production data accuracy, role authorization in a signed-in browser, native browser zoom, or multi-user concurrency. Native SQL role/ACL evidence is produced separately by the same workflow. Review screenshots before release. Execution status belongs in the release verification record; this README does not claim an unexecuted gate passed.
