# Implementation Plan — AgentFlow Global Brand Refresh

**Task branch:** `feature/agentflow-logo-refresh` — created from `main` @ `98eb9150d9b6e40cd48cc3f4d5a633b6005d0bbd`.
**Date:** 2026-08-26
**Status:** IMPLEMENTED + VERIFIED — READY FOR CHRIS REVIEW

## 1. Objective

Replace AgentFlow-owned platform branding with the approved visual system everywhere the platform logo is used, while leaving agency/customer-uploaded branding untouched.

Approved identity:
- Expanded/full wordmark: `AGENTFLOW`, all caps, no standalone icon before it.
- Boxy/geometric modern letterforms matching the approved mockup.
- Light background: `AGENT` deep navy (`#0B1220`), `FLOW` bright blue (`#3B82F6`).
- Dark background: `AGENT` white/near-white (`#F8FAFC`), `FLOW` bright blue (`#3B82F6`).
- Icon-only surfaces: standalone blue geometric `A`, transparent background, no blue box/container.
- Expanded sidebar = wordmark only. Collapsed sidebar = blue `A` only.

## 2. Confirmed Current Architecture

- `src/components/shared/Logo.tsx` is the shared AgentFlow platform-brand component. Its `full` and `text` variants now render only the wordmark; `icon` renders only the standalone A.
- `src/components/layout/Sidebar.tsx` already switches between `variant="full"` and `variant="icon"` based on collapsed state, so the sidebar architecture remains intact.
- Marketing surfaces directly reference stable `/agentflow-logo-full*.png` paths.
- `index.html` references stable favicon, Apple touch icon, and OG/Twitter image paths.
- `supabase/functions/_shared/systemEmail.ts` resolves `/agentflow-logo-full.png`; no backend code change is required because the asset URL remains stable.
- Public assets contain several historical aliases. Existing paths remain stable and their contents are visually consistent rather than deleted.

## 3. Implementation Scope

### Shared React logo
- `full` => wordmark only
- `text` => wordmark only
- `icon` => standalone A only
- Preserve `themeOverride`.
- React rendering uses the vector masters.

### Vector masters
- `public/agentflow-wordmark.svg`
- `public/agentflow-wordmark-on-dark.svg`
- `public/agentflow-icon.svg`

### Stable raster aliases
Updated the existing public files from the same master artwork:
- `agentflow-wordmark.png`
- `agentflow-wordmark-on-dark.png`
- `agentflow-logo-full.png`
- `agentflow-logo-full-on-dark.png`
- `agentflow-icon.png`
- `favicon.png`
- `favicon.ico`
- `apple-touch-icon.png`
- `icon.png`
- `icon-dark.png`
- `icon-white.png`
- `icon-black.png`
- `logo-full.png`
- `logo-full-black.png`
- `logo-full-dark.png`
- `logo-full-white.png`

The full-logo aliases are wordmark-only assets. Icon aliases use the standalone transparent blue A.

### Tests
Added a focused shared-logo test proving:
- full renders wordmark only
- text renders wordmark only
- icon renders standalone mark only
- dark theme override selects the dark wordmark

## 4. Explicit Exclusions / Safety

Not modified:
- `BrandingContext` customer/agency behavior
- `company_settings` branding
- organization-specific uploaded logos/colors
- branding upload hooks/forms
- carrier logos
- Supabase schema, migrations, RLS, policies, data, or Edge deployments
- Vercel settings or manual deployments
- unrelated UI styling/behavior

No migration or production backend mutation was required.

## 5. Files Touched

Code/docs:
- `implementation_plan.md`
- `src/components/shared/Logo.tsx`
- `src/components/shared/Logo.test.tsx`
- `WORK_LOG.md`

Assets:
- the three SVG masters
- the existing AgentFlow logo/icon/favicon aliases listed above

No other React consumer required modification because existing consumers either use the shared `Logo` component or stable public asset paths.

## 6. Verification — COMPLETE

- Vector/raster masters and representative light/dark treatments inspected.
- Full wordmark contains no redundant standalone icon.
- Icon-only A has a transparent background and no blue box/container.
- Focused `src/components/shared/Logo.test.tsx`: **4/4 passing**.
- `npx tsc --noEmit`: **passed** in the Vercel preview verification build.
- Production Vite build: **passed** in the Vercel preview verification build.
- Stable AgentFlow public asset aliases remain intact.
- Final branch diff reviewed; temporary verification workflow and package-script changes were removed before handoff.

Verification build commit: `d79ff7f0c304c7d66b9422d861f5d710a966a40c`.

## 7. Release Boundary

Implementation remains only on `feature/agentflow-logo-refresh`.
- Do not push directly to `main`.
- Do not merge without Chris approval.
- Do not manually deploy.
- Open a PR for Chris to review after verification and Work Log completion.
