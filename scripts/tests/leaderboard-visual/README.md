# Isolated TV verification

This harness loads the real TV components and app CSS with test-only auth/branding/data adapters. It never loads a Supabase URL or authentication token. It is excluded from the production build entry point.

From the repository root:

```bash
npx vite --config scripts/tests/leaderboard-visual/vite.config.ts
```

In another terminal with Playwright available:

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright node scripts/tests/leaderboard-visual/verify.mjs
```

Optional `CHROMIUM_PATH` selects an installed Chromium binary. Screenshots default to the task's `visual-evidence` directory. The 1093×614 CSS viewport approximates 125% browser zoom on a 1366×768 display; it is not proof of native browser zoom. Manually inspect screenshots and run native zoom before release.

The scripted checks measure podium/totals centerlines, avatar intersections, table clipping, source-rank immutability, metric/period switches, 1/2/3/14-agent rosters, entry/exit, and 30-second rotation. Manually verify live podium changes and delayed image loading too.

Status for the October 3 implementation: **not executed in a browser**. The session denied Chromium's required local socket. The Vite fixture and component tests do not replace this gate.


October 4 reporting implementation: the fixture now renders the real normal rankings at desktop/mobile widths and supplies TV's agency timezone/as-of/active-roster/unknown-premium caption. It asserts $701.40, 1m 21s and the undefined ratio, retaining prior TV geometry checks. These expanded checks are **prepared, not run locally**: `agent-browser install` could not download Chromium because certificate validation reported `UnknownIssuer`. Do not bypass TLS validation. Execute the existing `policy-sale-recording.yml` browser job on the review head and inspect its artifacts before release. This fixture does not establish signed-in role authorization, provider behavior or live production accuracy.

October 5 continuation: real Chromium ran in PR #416 CI `37203643810` and caught table-photo clipping at 1366×768 (zero page errors). The TV table now uses intrinsic minimum height to accommodate wrapped column headers and all seven rows. Existing geometry assertions remain; each viewport now also captures the scrolled table. The corrected browser rerun is pending, so this record does not yet claim a passing visual gate.

The corrective browser run `37332194959` passed geometry, transitions, normal/narrow precision, rosters and rotation. Manual artifact inspection found that the harness captured some intermediate animation frames and one blank scrolled narrow table. The next revision therefore waits for actual fixture totals and podium IDs, then stable geometry, and requires every table photo to be inside the main viewport and hit-test visible after scrolling. It also exercises a live policy/rank update. These strengthen the checks; they do not disable animation or replace expected values in production.

October 11, 2026 (UI copy cleanup V2 Part B): the on-screen caption is material-only, so the October 4 description of TV's "agency timezone/as-of/active-roster/unknown-premium caption" no longer applies to the screen; the CSV export is unchanged. The fixture snapshot now produces exactly "Annual premium (1 policies with unknown premium) · Outside active roster: 2 calls, 1 appointments, 0 policies", and verify.mjs asserts that text with no "Active agents · {timezone} · As of {time}" prefix and no stored call-duration provenance. `?routine=1` renders an everyday snapshot (no unknown premium, no estimated or conflicting durations, nothing outside the roster); verify.mjs measures TV at 1366×768 in that variant, asserts the Agency Totals wrapper has no caption line, and reuses the same centerline, overlap and photo checks. These checks are **prepared, not run locally**; run the `policy-sale-recording.yml` browser job on the review head.
