# Implementation Plan — AgentFlow Global Brand Refresh

**Task branch:** `feature/agentflow-logo-refresh` — created from `main` @ `98eb9150d9b6e40cd48cc3f4d5a633b6005d0bbd`.
**Date:** 2026-08-26
**Status:** APPROVED BY CHRIS — IMPLEMENTATION IN PROGRESS

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

- `src/components/shared/Logo.tsx` is the shared AgentFlow platform-brand component. It currently renders both the icon and wordmark for `variant="full"`, causing the redundant icon + A behavior.
- `src/components/layout/Sidebar.tsx` already switches between `variant="full"` and `variant="icon"` based on collapsed state, so the sidebar architecture can remain intact.
- Marketing surfaces directly reference stable `/agentflow-logo-full*.png` paths.
- `index.html` references stable favicon, Apple touch icon, and OG/Twitter image paths.
- `supabase/functions/_shared/systemEmail.ts` resolves `/agentflow-logo-full.png`; the backend does not need to change if the asset URL remains stable.
- Public assets contain several historical aliases. Existing paths remain stable and their contents are made visually consistent rather than deleted.

## 3. Implementation Scope

### Shared React logo
- `full` => wordmark only
- `text` => wordmark only
- `icon` => standalone A only
- Preserve `themeOverride`.
- Prefer the vector masters for React rendering.

### Vector masters
- `public/agentflow-wordmark.svg`
- `public/agentflow-wordmark-on-dark.svg`
- `public/agentflow-icon.svg`

### Stable raster aliases
Update the existing public files from the same master artwork:
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

The full-logo aliases become wordmark-only assets. Icon aliases use the standalone transparent blue A.

### Tests
Add a focused shared-logo test proving:
- full renders wordmark only
- text renders wordmark only
- icon renders standalone mark only
- dark theme override selects the dark wordmark

## 4. Explicit Exclusions / Safety

Do NOT modify:
- `BrandingContext` customer/agency behavior
- `company_settings` branding
- organization-specific uploaded logos/colors
- branding upload hooks/forms
- carrier logos
- Supabase schema, migrations, RLS, policies, data, or Edge deployments
- Vercel settings or manual deployments
- unrelated UI styling/behavior

No migration or production backend mutation is expected.

## 5. Files Intended to Touch

Code/docs:
- `implementation_plan.md`
- `src/components/shared/Logo.tsx`
- `src/components/shared/Logo.test.tsx`
- `WORK_LOG.md` after implementation verification

Assets:
- the three SVG masters
- the existing AgentFlow logo/icon/favicon aliases listed above

No other React consumer requires modification because existing consumers either use the shared `Logo` component or stable public asset paths.

## 6. Verification

Before handoff:
- Visually inspect vector/raster masters and representative light/dark treatments.
- Confirm full wordmark contains no redundant standalone icon.
- Confirm icon-only A has transparent background and no blue box.
- Verify shared component semantics through focused tests.
- Search repo for stale AgentFlow logo paths and document intentional stable aliases.
- Run `npx tsc --noEmit` if an executable checkout is available; otherwise rely on available repository checks and state the environment limitation.
- Run relevant tests and production build if an executable checkout is available.
- Review final diff.
- Append a newest-first `WORK_LOG.md` entry with files/assets touched, verification, and migrations/deploys = none.

## 7. Release Boundary

Implementation occurs only on `feature/agentflow-logo-refresh`.
- Do not push directly to `main`.
- Do not merge.
- Do not manually deploy.
- Open a PR for Chris to review after verification.
