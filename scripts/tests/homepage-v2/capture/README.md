# Synthetic product capture workspace

This non-production tool imports unmodified shipped AgentFlow components and
records their rendered DOM into a Canvas/MediaRecorder stream. Activity is local
and synthetic. It is not a live call, message delivery or backend transaction.
Never seed production data or record a shared live agency dashboard for marketing.

The four scenes use invented Demo identities and reserved `202-555-0142`.
Test-only aliases in `vite.config.ts` provide Auth/Branding/dashboard fixtures
and throw on every Supabase accessor. The capture document CSP blocks external
connections. No credentials or authentication state are required or accepted.
The tool is excluded from the normal Vite production build and router.

## Record

Use an isolated checkout/copy with existing dependencies. In that copy only,
set the root development command to:

```sh
vite --config scripts/tests/homepage-v2/capture/vite.config.ts
```

Start it with `sites-preview start <copy-root>` in the managed preview environment.
Open the reported local preview URL followed by
`/scripts/tests/homepage-v2/capture/index.html` in the cloud browser. Select a
scene and use **Record 6 seconds**. The browser downloads the raw WebM after the
actual components finish their local synthetic sequence. Repeat for all scenes.
Do not change the production Vite configuration or CRM implementations.

Keep raw files in the ignored directory `scratch/homepage-v2-raw/`, named
`dashboard.webm`, `dialer.webm`, `leaderboard.webm`, `conversations.webm`.

## Encode and validate

Requires Python 3, FFmpeg and ffprobe:

```sh
python scripts/tests/homepage-v2/capture/encode.py scratch/homepage-v2-raw
```

This creates MP4/WebM/WebP in `public/marketing-v2/`, updates the checksummed
media manifest and creates contact sheets beside the ignored raw captures.
It validates 5–7 second duration, 960 × 600 size, no audio, byte budgets and MP4
fast-start placement, and decodes every frame in both video formats. Inspect
contact sheets and play all loops in the isolated homepage QA harness at 1440
and 390 CSS widths before marking recordings verified.

`claims-and-capture.md` documents source revision, actual component names,
simulation disclosure and privacy/validation evidence. Final hosted preview
verification and deployment SHA are recorded in PR #503. No production release
or authentication bypass is part of this workflow.
