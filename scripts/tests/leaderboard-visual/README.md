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
