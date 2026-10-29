# Claims and authentic-media status — 2026-10-29

## Claims audit

| Topic | Evidence | V2 decision |
| --- | --- | --- |
| Life-insurance-specific CRM | `VISION.md`, current contact/campaign/dialer pages | Retained |
| Browser-started calling | `AGENT_RULES.md` single-leg WebRTC invariant | Agent starts each call; no predictive, multi-line or unattended-dial claims |
| SMS and email conversations | `VISION.md`, `Conversations.tsx` | Retained; recordings must not send to real recipients |
| Annualized premium | AP board and sold-date invariants in `AGENT_RULES.md` | AP is production, not commissions; no promised earnings |
| Plans, trial and usage fees | `VISION.md`: billing deferred; `PricingPage.tsx` contains unsupported billing/trial promises | No advertised prices, trial duration, unlimited-usage or fee promises; V2 points to its access section |
| Contact-sales destination | `ContactPage.tsx` `handleSubmit` only sets local success state and shows a toast; no send request | No V2 links to this non-sending form |
| Signup | `/signup` → `PublicRoute` → `SignupPage`, validated invitation token and `create-user` flow | Get started → `/signup`; says begin setup, not purchase or guaranteed CRM access; existing signed-in users keep their normal redirect |
| Testimonials / customer totals | No verified supporting evidence supplied | Omitted |
| AI agents | `VISION.md`: mock dashboard, not production AI | Omitted |

The live pricing/contact/homepage were inspected but **not changed**. Their
existing unsupported content requires a separately scoped future correction.

## Media status: NOT COMPLETE

Secure sign-in through browserAuth submitted, but the AgentFlow login page
displayed **Invalid login credentials**. No authenticated product capture has
been made. Do not describe this task as complete or the placeholders as real
footage. `media.ts` has no recording sources and every asset is unverified.

| Clip | Required capture | Current status |
| --- | --- | --- |
| Dashboard | 5–7 s, actual shipped dashboard, period/widget interaction | Pending secure login and a safe synthetic workspace |
| Dialer | 5–7 s, real lead preview/outcome workflow, no real call | Pending; never click a live call control to make footage |
| AP leaderboard | 5–7 s, shipped AP/rank/recognition animations | Pending; do not insert production wins to trigger an animation |
| Conversations | 5–7 s, synthetic thread/follow-up interaction | Pending; no real SMS/email send |

The existing dashboard and dialer PNGs are legacy **concept/reference** images.
The empty dashboard reference is not a finished product hero. Both must be
replaced. The AP board and thread fallbacks are explicitly illustrative. No
stock agency/team photo is used as though it depicted an AgentFlow customer.

## Safe capture and encoding procedure

1. Complete secure AgentFlow authentication. Verify the signed-in identity and
   Super Admin role from rendered UI. Never inspect cookies, tokens or storage.
2. Inspect existing demo/test facilities read-only before using them. Do not run
   the `leaderboard-demo:*` seed/simulate/reset scripts against production.
3. Prefer an isolated synthetic workspace or a test-only render of the shipped
   components with synthetic fixtures and network actions blocked. Document
   this provenance accurately; do not present an illustration as a live feature.
   Use the dashboard from verified production main `7a03033492c55fd16ea1bacd049934102fe340e4`
   (Vercel production `dpl_EDZ4obVUw3dgB8fwxPi7PnbgkoUq`, READY; G3 PR #502).
   The inherited work log still calls G3 pending, but the live deployment proves
   it is now shipped. Do not import a different/unmerged dashboard branch.
4. Use invented names and reserved 555-01xx numbers, no real client names,
   addresses, phone numbers, policy identifiers, notes or financial records.
   No real calls, messages, sales or backend writes are authorized by this plan.
5. Capture 5–7 seconds of meaningful interaction per workflow. Check every frame
   and crop unrelated chrome; remove all audio, browser URLs and metadata. Never
   commit raw private captures or authentication state.
6. Encode a fast-start H.264 MP4 and VP9 WebM, max 1280 px wide, 24–30 fps,
   yuv420p, `-an -map_metadata -1 -map_chapters -1`. Aim for at most 1 MB per
   desktop loop per format; review any exception. Create WebP posters under
   120 KB. Use a tighter mobile crop if full desktop UI is unreadable at 390 px.
7. Add sanitized media under `public/marketing-v2/`, record path, duration,
   dimensions, source/component revision, synthetic scenario and SHA-256 in
   this document, then set `verifiedRecording: true` and both source paths.
8. Watch the encoded loops on desktop/mobile and verify error fallback,
   viewport playback, muted inline looping, pause, reduced motion and Save-Data.

## Technical playback fixture

`scripts/tests/homepage-v2/playback-test.mp4` is a six-second FFmpeg color test
pattern, 320×200 at 24 fps, with no audio or user content. It exists only in the
isolated development QA harness and is excluded from the Vite production build.
It validates the player; it is **not** one of the four requested recordings.

Reproduce with:

```sh
ffmpeg -f lavfi -i testsrc2=size=320x200:rate=24 -t 6 -an \
  -c:v libx264 -crf 32 -pix_fmt yuv420p -movflags +faststart \
  -map_metadata -1 scripts/tests/homepage-v2/playback-test.mp4
```

## Verification evidence

- Focused Vitest: 21 checks, media lifecycle, source fallback, reduced motion,
  Save-Data/2g, autoplay rejection, manual pause, hidden/offscreen pause,
  ordinary-user denial, Super Admin allow, navigation and metadata restoration.
- Root `npx tsc --noEmit` passes. Meaningful app check compared to exact base
  `7a03033492c55fd16ea1bacd049934102fe340e4`: 80 preexisting errors, no new errors.
- V2-scoped ESLint and Vite production build; isolated V2 chunk approximately
  28 KB raw / 8.5 KB gzip. The inherited main CRM bundle remains large and is
  outside this preview's scope. No whole-app performance score is claimed.
- Browser: isolated 1440px and 390px iframe viewports (1425/375 content width
  after scrollbar); scrollWidth equals clientWidth at both sizes, no horizontal
  overflow. Mobile menu/section navigation and FAQ toggle verified.
- Browser playback fixture: initially 0 attached sources and paused. On entering
  viewport: 1 source, muted true, readyState 4, currentTime advancing. Manual
  pause survives resizing; moving offscreen pauses playback. Background-tab and
  preference changes covered by unit tests.
- Both Vercel projects inspected: SSO enabled, `all_except_custom_domains`.
  Their protection settings, auth gate and production configuration are unchanged.
- Authenticated branch-preview walkthrough and all real footage are blocked by
  secure sign-in. Preview deployment status is recorded in PR #503 after push.
