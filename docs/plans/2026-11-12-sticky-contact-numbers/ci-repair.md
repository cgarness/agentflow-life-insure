# PR #531 — hosted verification repair

Prepared November 15, 2026. Production release remains held.

## Scope and plan

Continue the existing draft PR from hosted head `9e9a80c433c83b12372379c60529cde81494660e`, against main `2129fa8b195cee77ad75f614abe655facfad2725`. No feature redesign, runtime-source change, migration, provider action, main merge or production deployment is included. Root and focused implementation plans were updated before local edits; the complete recovery patch preserves those updates and the newest-first root Work Log entry without deleting older sections.

Exact repair manifest: `.github/workflows/sms-consent.yml`, `.github/workflows/uv-profile-sync.yml`, `.github/workflows/carrier-directory.yml`, `.github/workflows/policy-commission-tracking.yml`, new `scripts/compare-typescript-logs.mjs` and `scripts/tests/compare-typescript-logs.test.mjs`, `scripts/tests/policy_commission/commission_scoped_browser.mjs`, and the const-only change in `supabase/functions/_shared/sms/affinity.test.ts`. This report is the compact repository-side continuation record.

## Original hosted findings

- SMS consent run43591213642, UV profile run43591213650 and carrier directory run43591213641: browser dependency setup rejected Ubuntu26.04 with pinned Playwright1.56.1. Only the three affected browser-bearing jobs are pinned to Ubuntu24.04; versions and assertions stay unchanged.
- Commission run43591213652: raw app-compiler diff rejected diagnostic line movement; full normalized diagnostic content is identical. The new comparator preserves paths, codes, messages, continuation lines, ordering, multiplicity, extra output and exit status. Twelve controls prevent count-only or swallowed-failure passes.
- Reports run43591213654: one new prefer-const diagnostic in the synthetic SMS test. Its existing app build and exact-base regression comparison passed. The correction changes no test behavior.
- Commission browser: one open-selector color-contrast failure, with only three-node count retained by the original harness. It did not reproduce in four isolated runs. The repair waits for roster, completed finite rendering animations and fonts before the same audit, records actual failing nodes, and adds an injected low-contrast negative control. No confirmed historical root cause, ignored accessibility rule or weakened threshold is claimed.

## Executed isolated checks

| Check | Result |
|---|---|
| Comparator node:test | 12 passed |
| Root TypeScript | exit0 |
| Actual application TypeScript | exit2;78 inherited diagnostics; entire position-normalized log matches exact base |
| Scoped lint | exit0 |
| Vite production build using synthetic backend values | exit0; never deployed |
| Commission/contact tests | 849 passed,7 skipped across82 passing/2 skipped files |
| Unchanged browser harness | 49/49 in four runs, three with CPU throttle4 |
| Updated browser harness | 50/50 including injected contrast violation detection |

Environment: ephemeral isolated Amazon Linux2023 Vercel Sandbox; Playwright1.56.1, Chromium141.0.7390.37, axe4.10.2. Loopback-only test application, no production credentials, browser external requests rejected and egress excludes Supabase/Twilio/UV. These runs do not substitute for hosted Ubuntu validation.

Normalized complete app diagnostic log SHA-256: `90e9c7e4308ab5a7d0dbeb51f0d38d3b496c69e0d9537263b4ccfcae8d8e07b4`. Machine-generated local summary SHA-256: `2d0cee782f6ecdc035da23b59ade93d665b23a729dcbdcf042674510f8cb3b38`.

## Preservation and pending gates

All runtime sources and four new migration sources remain unchanged from the reviewed candidate. The frozen 78-file manifest is retained as historical evidence:77 entries still match; its single changed entry is the test-only const fix, separately hashed. Do not describe all78 as unchanged. The five deployable Edge source packages are unaffected.

Hosted follow-up CI is pending at this checkpoint. Preserve original failed runs and inspect any recurrence; do not claim the pipeline is green from local tests. Keep prior preview pauses in place. Secondary Vercel runtime configuration, final drift/security/install-window review and exact production approval remain required. No main merge, production schema/data/Edge/frontend change, seed, activation, enrollment, real communication or preview restoration occurred.
