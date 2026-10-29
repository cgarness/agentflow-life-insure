# Private homepage V2 — PR #503

## Authorization and boundaries

Chris requested completing `feat/private-homepage-v2-20261029`, synthetic demos,
desktop/mobile testing and a protected review URL. This authorizes frontend work,
isolated capture and the existing Git-linked preview builds. It does not
authorize merge, production release, CRM changes or backend mutations.
`AGENT_RULES.md`, `VISION.md`, `WORK_LOG.md`, PR #503 and deployed source were
reviewed before implementation. Current production already contains Dashboard
G3 at `7a03033492c55fd16ea1bacd049934102fe340e4`; no separate G3 branch is imported.

## Completed implementation

1. Preserve `/`, `/homepagetest1`, SuperAdminRoute, CRM implementations, Vercel
   settings and production. Only private `/homepage-v2` is lazy-loaded.
2. Retain approved dark navy/sky direction, typography and section sequence.
   Split small components, improve focus/contrast, mobile navigation, FAQ,
   motion preferences, layout stability and private metadata restoration.
3. Defer video sources until near the viewport; play only visible clips in an
   active tab. Honor reduced motion, Save-Data/slow networks and manual pause.
   Recover from rejected autoplay and format failures with real posters/controls.
4. Audit claims against source. No unsupported AI, predictive/multi-line dialing,
   pricing, trial, earnings, endorsements or usage promises. Get started uses
   actual `/signup`; omit the existing non-sending contact form destination.
5. Sign in securely via browserAuth and verify Super Admin access. Exclude shared
   agency data. Record actual shipped components with synthetic prop/provider
   fixtures, blocked backend access and local simulated activity. No real call,
   SMS, sale, new account, server write or credential export.
6. Record four six-second scenes in the cloud browser. Encode audio-free H.264
   MP4/VP9 WebM and WebP posters; decode every output frame, review visuals and
   record provenance/hashes. Replace all V2 illustrative product panels.

## Files

- `src/pages/LandingPageV2.tsx`, `src/components/marketing-v2/*`, V2-only lazy
  route wrapper in `src/App.tsx` and focused tests.
- `public/marketing-v2/*`: sanitized product clips/posters only.
- `scripts/tests/homepage-v2/*`: isolated non-production visual/playback/capture
  tools; no production router bypass, fixture providers or extra dependency.
- This plan, `claims-and-capture.md`, `media-manifest.json`, `WORK_LOG.md`.

## Validation and review gate

- 22 focused playback/access/page tests; root TypeScript; scoped ESLint;
  meaningful app types versus exact base (80 existing errors, zero added).
- Vite production build and exclusion of capture harness/fixtures/test pattern.
- Actual clips in desktop 1440/mobile 390 browser viewports: no overflow,
  mobile navigation/FAQ, muted inline playback, source deferral, offscreen and
  manual pause. Authenticated hosted preview checked after preview deployment.
- Verify both preview projects Ready at the pushed SHA, protection unchanged,
  production unchanged and PR unmerged. Deployment results belong in the PR.
- Deliver protected `/homepage-v2` URL. User approval remains required for merge
  or production release. No release workflow is dispatched by this plan.
