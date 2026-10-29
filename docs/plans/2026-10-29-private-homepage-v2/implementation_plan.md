# Private homepage V2 — PR #503

## Authorization and boundary

Chris explicitly requested completing this branch on 2026-10-29, including edits,
synthetic product capture, desktop/mobile tests and a private Vercel review URL.
This authorizes the following frontend preparation and preview builds. It does
not authorize merging, production release, CRM changes, or backend mutations.
Read AGENT_RULES.md (workflow/component rules and relevant invariants), VISION.md,
the latest WORK_LOG.md, PR #503 and the Vercel project/deployment before edits.
The current Dashboard G3 project is separate and must not enter this branch.

## Intended files

- `src/pages/LandingPageV2.tsx` — preserve layout/brand, compose small components.
- `src/components/marketing-v2/*` — viewport-aware video, navigation, hero,
  feature sections, FAQ/access, synthetic fallback UI and preview metadata.
- `src/App.tsx` — lazy-load only the private V2 page behind the unchanged gate.
- `src/components/marketing-v2/__tests__/*` — media lifecycle, access/CTA and
  metadata regression checks.
- `scripts/tests/homepage-v2/*` — isolated, non-production visual QA harness.
- `docs/plans/2026-10-29-private-homepage-v2/*` — claim/capture evidence.
- `public/marketing-v2/*` — only sanitized, verified product media when captured.
- `WORK_LOG.md` — newest-first status and verification.

## Implementation

1. Retain `/` and `/homepagetest1` byte-for-byte. Preserve SuperAdminRoute and
   Vercel SSO protection (`all_except_custom_domains`), no new public routes.
2. Keep dark navy/sky brand, existing typography and section sequence. Add
   keyboard-friendly navigation, motion preferences and stable image dimensions.
3. Load clip sources only near the viewport; no video transfer on initial page
   load. Pause out of view and in hidden tabs. Respect reduced motion, Save-Data
   and slow networks. Track actual media state; recover from blocked autoplay
   with a working Play button, and keep a poster/fallback on media errors.
4. Audit claims against repo functionality. No predictive/multiline/AI claims,
   invented results, endorsements or unverified fees/trials. Signup is `/signup`;
   creating an account is not a purchase or a promise of CRM access. Do not route
   V2 visitors to unverified pricing or a contact form that does not send.
5. Securely sign into AgentFlow. Capture 5–7-second dashboard, dialer, AP board,
   and messaging recordings using synthetic identities only. No calls, SMS,
   sale records or other production writes; inspect safe existing demo/test
   facilities before capture. If none is safe, document the blocker.
6. Media: crop irrelevant chrome/identifiers, strip audio/metadata, encode
   fast-start H.264 MP4 plus WebM, create WebP posters, record provenance/digests
   and byte budgets. Only mark a recording real after watching every frame.

## Validation and review gate

- Focused Vitest for playback (viewport, background, preferences, rejection,
  errors, manual pause), guarded access, link targets and metadata cleanup.
- `npx tsc --noEmit`, meaningful app typecheck compared with the exact base,
  scoped lint and Vite production build.
- Browser QA at actual 1440/390 CSS viewport widths using an isolated harness;
  then signed-in protected branch preview checks. No synthetic test bypass in
  the production router and no mock values in CRM code.
- Verify all protected previews READY at the pushed branch SHA; recheck SSO,
  route guard, unchanged live homepage and PR unmerged state.
- Keep draft status until media capture and authenticated browser checks pass.
  Deliver the protected `/homepage-v2` URL, with any verification limits stated.

## Current blocker

The secure AgentFlow sign-in submitted through browserAuth returned the visible
error `Invalid login credentials`. Do not retry or handle credentials in chat.
Manual secure sign-in is needed before authenticated capture. No live data has
been accessed and no calls or messages have been initiated.
