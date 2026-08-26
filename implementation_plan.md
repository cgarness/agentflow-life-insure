# Implementation Plan — AgentFlow Logo HOTFIX (correct the wordmark geometry)

**Task branch:** `claude/agentflow-logo-hotfix-ebvauh` — created from `origin/main` @ `503affa` (which already contains the merged PR #366 brand refresh).
**Date:** 2026-08-26
**Status:** APPROVED BY CHRIS 2026-08-26 → IMPLEMENTED + VERIFIED — awaiting review. Not merged, not deployed.

---

## 1. Why this hotfix exists

PR #366 (`feat(brand): refresh AgentFlow platform logo`, merged to `main` as `503affa`) shipped the
right *structure* — wordmark-only full variant, standalone blue `A` for icon surfaces, correct colour
split — but the wrong *artwork*. The vector masters it committed are narrow, conventional letterforms
that do not match the approved reference:

| Reference (approved) | What shipped in #366 |
|---|---|
| Wordmark ink box **775 × 60** → aspect **12.93 : 1** | viewBox `0 0 1503 232` → aspect **6.48 : 1** (half as wide) |
| Flat-apex triangular `A`, 2:1 diagonals, low crossbar detached from the left leg | Conventional pointed `A` |
| Heavy boxy geometric caps: 15.5u stems, 13u arms on a 60u cap | Light/narrow generic techno letterforms |
| `E`/`F` carry a **detached** full-width top arm | Attached arms |
| `G` rounded on three corners, square top-right, open upper right | Generic `G` |
| `W` = two square bowls sharing a middle stem, V-notch at the foot | Generic `W` |
| `O` = rounded rectangle, 12u outer radius | Generic `O` |

This plan replaces the artwork only. Nothing about the component API, the asset paths, the colour
tokens, or customer/agency branding changes.

---

## 2. Source of truth and method

Chris's reference mockup is the only visual authority. The wordmark was measured **directly out of the
reference bitmap**, glyph by glyph (per-row ink spans at the reference's native cap height of 60px),
then rebuilt as clean parametric vector geometry — not traced wobble, and not a substituted font.

Verification of the rebuild against the reference bitmap (ink-mask IoU, 775 × 60):

```
overall IoU 0.9654      (0.9824 ignoring the cap/baseline rows the reference itself
                         loses to antialiasing on the blue glyphs)
A 0.9826   G 0.9844   E 0.9914   N 0.9593   T 0.9696
F 0.9590   L 0.9210   O 0.9538   W 0.9478
standalone icon A: 0.9763
```

Residual error is sub-pixel edge noise in the reference raster. Geometry is expressed on a
2× grid (cap height 120 SVG units) so every metric lands on a clean coordinate.

Measured system, reference units (cap height = 60):

| Metric | Value |
|---|---|
| Cap height | 60 |
| Vertical stem | 15.5 (N: 16) |
| Top / bottom arm | 13 |
| Middle arm | 12 |
| Outer corner radius (G, O, W) | 12 |
| Detached arm gap (E, F) | y 13 → 24 |
| `A` diagonals | dx/dy = 0.50, leg weight 17, crossbar y 35 → 48, slot 9.5 |
| Icon `A` diagonals | dx/dy = 0.545, leg weight 19, crossbar y 54 → 70, slot 14.4 |
| Letter spacing | 10–14 (measured per pair, preserved exactly) |

Colours are the approved hexes, flat — no gradients:

| Surface | AGENT | FLOW |
|---|---|---|
| Light | `#0B1220` | `#3B82F6` |
| Dark | `#F8FAFC` | `#3B82F6` |
| Icon | — | `#3B82F6` on transparent, no container |

---

## 3. Files to touch

### 3a. Vector masters (rewritten from the corrected geometry)
- `public/agentflow-wordmark.svg` — light, viewBox `0 0 1551.25 120`
- `public/agentflow-wordmark-on-dark.svg` — dark, same box
- `public/agentflow-icon.svg` — standalone blue `A`, square `0 0 512 512`, transparent, no box

### 3b. Stable raster aliases (paths unchanged, contents re-rendered from the masters)
Light wordmark → `agentflow-wordmark.png`, `agentflow-logo-full.png`, `logo-full.png`,
`logo-full-black.png`, `logo-text.png`, `logo-text-black.png` — all 1551 × 120 RGBA.

Dark wordmark → `agentflow-wordmark-on-dark.png`, `agentflow-logo-full-on-dark.png`,
`logo-full-dark.png`, `logo-full-white.png`, `logo-text-dark.png`, `logo-text-white.png` — same size.

Blue `A`, transparent → `agentflow-icon.png`, `icon.png`, `icon-dark.png`, `icon-white.png`,
`icon-black.png` (512²), `apple-touch-icon.png` (180²), `favicon.png` (32²),
`favicon.ico` (16/32/48, each size rendered natively rather than downsampled).

No public path is added, renamed, or deleted. `logo-text*.png` are the four pre-#366 stragglers that
still carried the old brand; they are refreshed too (decision **D3**, approved).

### 3c. Code (surgical, proportion-only)
- `src/components/shared/Logo.tsx` — the wordmark `<img>` currently carries `max-w-[200px]`. At the
  corrected 12.93:1 aspect, `h-5` wants 258px, so that cap silently shrinks the logo to 15.5px tall.
  Change to `max-w-full` so `object-contain` scales gracefully inside narrow parents instead of
  capping it. **No change to variants, `src` paths, `alt`, or `themeOverride`.**
- `src/components/layout/Sidebar.tsx` — expanded-sidebar `textClassName` is
  `"text-slate-100 font-semibold text-base max-w-[160px]"`: three dead text classes left over from the
  pre-#366 text logo, plus a 160px cap that would render the corrected wordmark 12px tall in a 240px
  (`w-60`) sidebar. Replace with `"h-4"` → ~207px wide, matching the reference's sidebar proportion.
  Collapsed `iconClassName="h-8 w-8"` is unchanged.
- `src/components/marketing/MarketingNav.tsx` — direct `<img className="h-9 w-auto max-w-[280px]">`.
  At the corrected aspect `h-9` is 465px wide and would be clamped by the 280px cap. Change to
  `h-5 w-auto max-w-[260px]` — 258.5px at `h-5`, so the cap never clamps it on desktop while
  still protecting narrow viewports (same visual footprint as today's nav logo).
- `src/components/shared/Logo.test.tsx` — extend the existing focused suite (still asserting
  wordmark-only / icon-only / dark override) with guards that the full variant renders **no** second
  image and that the width cap can no longer distort the aspect.

### 3d. Docs
- `implementation_plan.md` (this file)
- `WORK_LOG.md` — newest-first entry

### 3e. Not touched
`BrandingContext`, `company_settings`, uploaded organisation logos, agency colours, any white-label
flow, carrier logos, Supabase schema/migrations/RLS/policies/data, Edge Function deploys, Twilio /
telephony, workflows, dialer, and every unrelated UI surface.

---

## 4. Decisions — resolved by Chris 2026-08-26

**D1 — System email logo height → APPROVED (change).** Implemented as `height="24"` +
`max-width: 100%` in `supabase/functions/_shared/systemEmail.ts` and all five
`supabase/templates/auth/*.html`. **Nothing was deployed**: the shared module takes effect on Chris's
next Edge Function deploy, and the five templates take effect when Chris re-pastes them into the
Supabase dashboard. The asset swap is independent and is live the moment the PR merges.

**D2 — Icon colour aliases → all five stay the blue `A`,** per the brief.

**D3 — `logo-text*.png` → APPROVED (refresh).** All four re-rendered from the corrected masters, so
nothing under `public/` serves pre-#366 branding any more.

Original wording of each decision, for the record:

**D1 — System email logo height (recommended: change).**
`supabase/functions/_shared/systemEmail.ts` and the five `supabase/templates/auth/*.html` render the
logo as `height="36"` with no `max-width`. At the corrected aspect that is 465px wide inside a 480px
content column — it fits desktop but **overflows the ~303px column on a phone**. Recommended fix is one
attribute per file: `height="24"` + `max-width: 100%`, giving a 310px logo. Note this only takes effect
when Chris redeploys the Edge Functions (shared module) and re-pastes the five templates into the
Supabase dashboard; **this task deploys nothing.** The asset swap itself is live the moment the PR
merges, independent of D1. Alternative: leave the email markup alone and accept the mobile overflow.

**D2 — Icon colour aliases.** `icon-white.png` / `icon-black.png` / `icon-dark.png` are unconsumed and
today (post-#366) all hold the blue `A`. The hotfix brief says "standalone icon is the blue A only", so
the plan keeps all five icon aliases blue. Say the word if you'd rather they became true white/navy
variants.

**D3 — `logo-text*.png`.** Four pre-#366 files that still carry the *old* brand and have zero
consumers. Plan is to refresh them so nothing in `public/` serves stale branding. Easy to drop from the
change if you'd rather leave them frozen.

---

## 5. Verification — COMPLETE

| Gate | Baseline (`503affa`, pristine worktree) | After | Delta |
|---|---|---|---|
| `npx tsc --noEmit` | exit 0 | **exit 0** | — |
| `npm test` (dummy `VITE_SUPABASE_*`) | 134 files · 1875 passed · 12 skipped · **0 failed** | 134 files · **1879 passed** · 12 skipped · **0 failed** | +4 tests, 0 regressions |
| `npx vitest run src/components/shared/Logo.test.tsx` | 4/4 | **8/8** | +4 |
| `npm run lint` | 218 problems (15 errors, 203 warnings) | **218 problems (15 errors, 203 warnings)** | **zero delta** |
| `npm run build` | success | **success** | — |

Geometry accuracy vs. the approved reference bitmap (ink-mask IoU): **0.9654 overall**, 0.9824
ignoring the cap/baseline rows the reference itself loses to antialiasing; standalone icon 0.9763.

Rendered-in-the-real-app measurements (production build served locally, Chromium at DPR 2):

| Surface | Asset | Rendered box |
|---|---|---|
| `/login`, `/signup`, `/forgot-password` (desktop **and** 375px mobile) | `agentflow-wordmark-on-dark.svg` | 258.5 × 20 — exact aspect, no clamping |
| Marketing nav `/` (desktop + 375px mobile) | `agentflow-logo-full.png` | 258.5 × 20, clears the mobile menu button |
| Marketing footer | `agentflow-wordmark.svg` | 181 × 14 |
| Sidebar expanded (`w-60`, `px-4` → 208px usable) | `agentflow-wordmark-on-dark.svg` | 206.8 × 16 — fills the sidebar, no overflow |
| Sidebar collapsed (`w-16`) | `agentflow-icon.svg` | 32 × 32, transparent, no container |
| System email header, 560px card | `agentflow-logo-full.png` @ 24px | 310 × 24 |
| System email header, 343px phone column | same | 301 × 24 — `max-width:100%` holds it inside |
| `favicon.ico` | — | 16/32/48 all present, each rendered natively |

Confirmed: full wordmark renders **one** image and no leading icon; icon variant is the standalone
blue `A` on transparency with no box; `BrandingContext`, `company_settings`, uploaded organisation
logos and agency colours are untouched; no public asset path was added, renamed or deleted.

---

## 6. Release boundary

- Migrations: **none**. Production Supabase schema/data/RLS/Edge (`jncvvsvckxhqgqvkppmj`): **untouched,
  nothing deployed to production.** Note the repo's own integrations do their standard per-PR work on #367:
  Vercel builds previews, and Supabase branching created the ephemeral preview project `pycjkkjrnnfddtlbznhk`
  (`persistent: false`, `with_data: false`) and deployed Edge Functions **there**. That is the integration's
  behaviour on every PR, not an action of this task, and it does not touch production.
- Commit and push to `claude/agentflow-logo-hotfix-ebvauh` only. **Never to `main`.**
- Open a PR referencing #366 and stop. No merge, no production deploy, without Chris's approval.
