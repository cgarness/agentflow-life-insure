# Claims and authentic-media evidence — 2026-10-29

## Claims audit

| Topic | Evidence | V2 decision |
| --- | --- | --- |
| Life-insurance CRM | `VISION.md`, current contact/campaign/dialer pages | Retained |
| Browser-started calling | `AGENT_RULES.md` single-leg WebRTC invariant | Agent starts each call; no predictive, multi-line or unattended-dial claim |
| SMS and email | `VISION.md`, `Conversations.tsx`, shared conversation components | Retained; recording activity is explicitly simulated |
| Annualized premium | AP board and sold-date invariants in `AGENT_RULES.md` | AP is policy production, not take-home commissions; no earnings promise |
| Plans, trial and usage fees | Billing is deferred in `VISION.md`; existing `PricingPage.tsx` promises lack confirmed support | No price, trial duration, unlimited-usage or fee promise; access section explains that terms need confirmation |
| Contact-sales link | `ContactPage.tsx` only sets local success state/toast; no send request | No V2 link to that non-sending form |
| Signup | Existing `/signup`, `PublicRoute`, `SignupPage`, invitation validation and `create-user` flow; signup form inspected in browser | Three Get started links use `/signup`; setup language, no purchase or guaranteed immediate access; normal signed-in redirects preserved |
| Testimonials and customer counts | No verified evidence supplied | Omitted |
| AI agents | `VISION.md` describes mock AI UI | No production AI promise |

The live homepage, pricing and contact pages were inspected and remain unchanged.
No stock photo is presented as an AgentFlow customer. Authorized AgentFlow brand
assets and actual product frames supply the imagery.

## Completed recordings and provenance

Secure browserAuth sign-in succeeded with the user-provided test account.
Rendered UI confirmed Super Admin access to the protected `/homepage-v2` route.
The account's shared dashboard contained real agent names, so it was excluded
from recordings. Credentials, cookies, tokens and browser storage were never
exported into this repository or the media.

All four clips record **unmodified shipped AgentFlow React components** in an
isolated synthetic capture workspace. The capture tool samples their rendered
DOM, text, transforms, numeric animations and glow styles into a native browser
Canvas/MediaRecorder stream. These are genuine component recordings with local
simulated activity, not recordings of live calls, delivered messages or backend
transactions. The footage and captions disclose demo activity.

Component revision: `975cd1544888feec55ed94881092ad3fd10d2353`. CRM components at
this revision are unchanged from production `7a03033492c55fd16ea1bacd049934102fe340e4`
(G3 Dashboard PR #502, production deployment `dpl_EDZ4obVUw3dgB8fwxPi7PnbgkoUq`).
An older historical work-log entry calls G3 pending; the actual deployment and
source establish that the recorded components are shipped.

| Clip | Real components | Synthetic activity | Drawn frames / capture time |
| --- | --- | --- | --- |
| Dashboard | DashboardControls, StatCards, DashboardWidgetFrame, CallbacksWidget, AppointmentsWidget | Day/month totals, invented callback and appointment names | 212 / 6.02 s |
| Dialer | LeadCard, DialerActions, ConversationHistory | Local call state, Interested outcome, note and next sample lead; no connection | 240 / 6.02 s |
| AP leaderboard | LeaderboardPodium, LeaderboardRankingsTable, production ranking/motion utilities | Jordan Demo overtakes Avery Demo; real odometer, rank and recognition animation | 194 / 6.04 s |
| Conversations | ConversationHistory and MessageComposePanel | Synthetic SMS thread, typing and local reply insertion; no send | 291 / 6.02 s |

Only invented Demo identities and reserved `202-555-0142` appear. No prospect,
customer, real phone, email, address, policy identifier, client note or live
financial record is captured. Test-only provider aliases supply fixtures;
Supabase accessors throw, and capture CSP disallows external connections. No
production data, schema, RLS, telephony, messaging or authentication code changed.

## Encoding and review

Capture surface: 1200 × 750, downsampled to 960 × 600. Four approximately
six-second, 30 fps loops, each as fast-start H.264 MP4 and VP9 WebM, with genuine
WebP poster frames. All twelve assets total **656,701 bytes**. The largest video
is 92,815 bytes and the largest poster 24,714 bytes. Every asset is comfortably
below the 1 MB video / 120 KB poster budgets.

`media-manifest.json` records each path, byte count, duration, dimensions, codec,
zero audio streams and SHA-256. `capture/encode.py` strips audio, metadata,
chapters and subtitles; validates duration, stream counts, dimensions and MP4
fast-start placement; and fully decodes every encoded frame in both formats.
Visual contact-sheet and browser playback review checked framing, synthetic-only
content, AP transitions and chronological messaging. No raw recording is committed.

The hero and three feature sections now use only these real posters and loops.
Legacy concepts and illustrative leaderboard/conversation panels were removed.
No capture-only code, fixtures or technical test pattern enters the production
bundle. See `scripts/tests/homepage-v2/capture/README.md` for reproduction.

## Playback, layout and access checks

- Sources attach near the viewport; only an in-view video plays. Initial browser
  observation showed dashboard playing muted at readyState 4, while all three
  offscreen videos had zero attached sources and were paused.
- Real dialer and AP clips loaded and played on entering their sections;
  dashboard/offscreen clips paused. Manual dialer pause survived a mobile resize.
- Desktop 1440 and mobile 390 CSS iframe viewports: content widths 1425/375
  after scrollbars; scrollWidth equals clientWidth, no horizontal overflow.
  Mobile navigation closes after section selection; FAQ state and answer work.
- 22 focused Vitest checks cover viewport/background playback, reduced motion,
  Save-Data/2g, rejected autoplay, source-format fallback, manual pause, ordinary
  user denial, Super Admin allow, valid CTA/anchor targets and metadata cleanup.
- Root TypeScript and scoped ESLint pass. Meaningful app TypeScript against
  exact base `7a03033492c55fd16ea1bacd049934102fe340e4`: 80 preexisting errors,
  zero added. Production Vite build checked separately; no whole-app performance
  score is claimed. The inherited large CRM entry bundle is outside this scope.
- Vercel SSO remains `all_except_custom_domains` on both existing projects.
  The SuperAdminRoute implementation is unchanged. Branch SHA, Ready status,
  authenticated final preview and production comparison are recorded in PR #503.

The technical six-second color-pattern fixture in `scripts/tests/homepage-v2/`
only tests player behavior and is excluded from production. It is not product
footage. No main branch update, merge, production release or protection change
is authorized by this project.
