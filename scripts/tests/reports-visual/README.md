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

The workflow pins Playwright 1.56.1, agent-browser 0.38.2 and axe-core 4.10.2, installed into one prefix (`npm install --prefix <dir> --no-save playwright@1.56.1 agent-browser@0.38.2 axe-core@4.10.2`). The verifier finds axe-core beside Playwright; `AXE_CORE_PATH` may name `axe.min.js` instead. Without axe-core the run stops with "axe precondition". Optional `CHROMIUM_PATH` selects an installed Chromium. `REPORTS_VISUAL_OUTPUT` selects the evidence directory. The verifier blocks external HTTP data requests and records screenshots, actual CSV downloads and RPC request arguments. The preference stub accepts only the synthetic owner, stores a personal v4 layout in this isolated origin's local storage, and can explicitly fail a save. It does not replace the real layout hook or UI.

## Font

The layout budgets and one-line checks below are measured in Inter, the font production loads from Google Fonts (`index.html`). The verifier blocks external requests, so the fixture serves its own copy: `fonts/` holds a Latin subset of Inter 4.0 (Regular, Medium, SemiBold, Bold; WOFF2, SIL OFL 1.1, see `fonts/OFL.txt`), declared in `fonts/inter.css` and imported by `entry.tsx`. A web font declared under a family name shadows any installed font of that name, so results do not depend on the fonts installed on the machine or CI runner. The budgets are not valid in a fallback font: in DejaVu Sans or Liberation Sans, amounts can wrap mid-number and the 390×844 budgets are missed.

`verify.mjs` therefore checks a font precondition first: all four Inter faces are `loaded`, and a test string's width differs between `Inter, monospace` and `monospace` (`document.fonts.check()` is not used, because it returns true for fonts it cannot match). If the precondition fails, the run stops with "Font precondition: the fixture's Inter web font did not render" instead of reporting a budget miss.

## Layout frame

The entry renders the page inside geometry-only stand-ins for the app chrome: a fixed 64px top bar, a 240px sidebar from `md` up, and the layout's `p-4 lg:p-6` padding. They carry no text and no heading, and they ignore the pointer. First-screen budgets and table widths are therefore measured in the production frame.

## Checks

Checks cover:

- **Viewports.** 1440×900, 1024×768, 768×1024 and 390×844: no page overflow (light and dark), settled nonblank charts (two single-axis panels per trend card, a positive bar in each), the ranked disposition share list, and the executive order: production overview, metric strip, Trends, Period totals, performance, diagnostics.
- **First-screen budgets.** At 390×844, measured below the 64px top bar after subtracting the fixture's Custom date row (one row, at most 56px):
  - the filter block is at most 216px, on the default preset as well;
  - both `data-report-value="hero"` values end by y380;
  - the six strip tiles end within 844px;
  - header targets are at least 40px (tabs: 32px triggers in a 40px list).

  At 390×664 only the first-screen check runs: both production values stay on the first screen. At 1440×900 the header is at most 150px, and the strip and the Trends heading are on the first screen. Hero values never wrap.
- **Money.** Every leaf money node is measured on its nearest block-level box for clipped cents, and on its rendered lines so that no amount wraps mid-number. A minimum number of nodes must be checked.
- **Tables.** Every overflowing table is a named, focusable (`tabIndex` 0) region with the table as its direct child and an opaque sticky first column. At every width the right-edge fade is shown exactly while columns remain to the right: it leaves when the table is scrolled to its end and returns at the start. Every non-empty heatmap cell shows its number on screen at every width, phones included. From 1024px, "Policies (current assignment)", "Policies (campaign-attributed)" and "Known annual premium" are fully visible without scrolling. Below that, arrow keys scroll the focused table and each of those columns can be brought into view beside the pinned label.
- **Report content.** Exact values, wording and data-quality disclosure:
  - production band: exact cents, "3 of 8 premiums known · 5 unknown excluded", a Partial chip only when the premium is partly known, no percentage, and the "Most policies — current assignments" row per scope (none in Personal);
  - strip tiles, with one exact duration format and their cautions in place;
  - Period totals `dt`/`dd`;
  - campaign and lead-source disclosures, found in `tfoot` rows, including unlinked calls when there are no sources;
  - unknown premiums never shown as $0.00;
  - interval-matched efficiency.
- **Data basis.** It opens from the context line (Enter) and the band (Space). Focus moves in, and the sheet is a bottom sheet of at most 85% height below 768px and a right sheet of at most 28rem from 768px. Escape or Close returns focus to the trigger that opened it. The sheet shows the summary CSV's own Note sentences and the current summary's as-of. After a failed summary it says so in words, with no stale digits and no as-of.
- **Period select.** One "Report period" select with the options, in order: Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, Custom range. The default is Last 30 days. Custom range reveals the date pickers. Keyboard selection (Enter, Home, ArrowDown) works, focus returns to the select, and the date pickers leave.
- **CSV.** All 13 exports are downloaded with at least 400 ms between clicks, because back-to-back downloads stall in Chromium. Filenames are pinned, and `csv/manifest.json` records each file's sha256 with the client-clock "Generated" row removed. The hash equals `grep -v '^"Generated",' file | sha256sum`, so a golden set made that way compares directly. Export buttons use sentence-case names ("Export Campaign performance CSV"). The summary, agent and campaign rows and the formula protection (a separate, explicitly synthetic export example) are checked exactly.
- **Accessibility (axe).** At 390×844 and 1440×900, with every collapsed section expanded, axe-core runs on `[data-reports-workspace]` in light and dark after colour transitions finish (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice`). Any violation fails the run unless `AXE_BASELINE` lists it with a reason; the list is empty. Results, including the "needs review" (incomplete) counts, are written to `reports-<width>-axe.json`.
- **Charts.** Each chart card has one keyboard tab stop, its main panel (`role="application"`), and it is named ("Policies sold by day", "Outbound calls by day", "Calls made by agency hour"); every trend panel is named. Focusing the Production panel and pressing ArrowRight puts the period's values in its polite live readout.
- **Customizer.** Production anchors cannot be hidden: an anchored, case-insensitive name check and a label-independent `data-customizer-section` check, with positive controls ("Show Calls made" and the `stat_total_dials` item). "Show Dials per booking" is present and "Dials per appointment" is absent. Customize is disabled while a Custom range is incomplete (U-6). Scope tabs carry `aria-controls` only once the panel exists (U-8). Focus stays on a moved item at the group edge (U-9). Move targets are at least 40px and the mobile Save bar stays reachable. Save/remount persistence, cancel, reset and failed-save recovery are also covered.
- **Scopes and freshness.** Genuine Personal / Team / Agency transitions, agent-filter clearing, and an intentionally held request that proves stale exports and the as-of stamp are withheld.
- **Refresh (R-4).** A MutationObserver with the summary held proves Refresh never re-paints the previous summary.
- **Failures.** One-panel failure ("This is not a zero") and retry, and stale-window export withholding on an unsupported window.

The real calendar is navigated to October 2026; browser time and SQL payload metadata remain untouched.

For a local environment without native PostgreSQL, `scripts/tests/reports-integrity-embedded.mjs` can export the same SQL fixture format through `REPORTS_SQL_PAYLOADS`. Evidence from that path must be labeled **embedded SQL + real browser**, not native PostgreSQL. CI continues to generate these bundles with the disposable native PostgreSQL runner.

This is a real-browser synthetic integration gate. It does not establish hosted login, PostgREST transport, production data accuracy, role authorization in a signed-in browser, native browser zoom, or multi-user concurrency. Native SQL role/ACL evidence is produced separately by the same workflow. Review screenshots before release. Execution status belongs in the release verification record; this README does not claim an unexecuted gate passed.
