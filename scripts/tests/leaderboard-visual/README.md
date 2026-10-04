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
