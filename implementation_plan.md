# Implementation Plan — Auth Visual Polish Pass (color, depth, divider, badges)

**Status:** AWAITING CHRIS APPROVAL
**Date:** 2026-07-29
**Branch:** `claude/auth-visual-polish` (created off fresh `origin/main` = `1ef7485`, the PR #335 merge — local `main` is stale and was not used)
**Scope:** Visual-only polish of the shared centered auth system. No behavior, routing, backend, env, or dependency change. No push/PR/deploy without approval.

---

## 0. Current state (verified)

- PR #335 merged (`1ef7485`); the new centered system is live and healthy on `www.fflagent.com` (verified last session: all 8 routes, real Supabase round-trip). Known open infra item, untouched by this task: the `agentflow-life-insure` Vercel project's Production env scope lacks the two `VITE_SUPABASE_*` vars, so its `agentflow-life-insure.vercel.app` alias white-screens (user-facing domain unaffected).
- `WORK_LOG.md` newest entry still reads `[PR OPEN — draft PR #335]` — the SHIPPED status was held pending the env decision. **This task's WORK_LOG update will also flip that entry to SHIPPED** (merge `1ef7485`, prod deploy `dpl_9m8La4tXLmBGCK6ynwLA147GAb5Z` READY on fflagent.com, env issue noted as open).
- Unrelated dirty files (excluded from every commit, unchanged): `scripts/seed-test-leads.mjs`, `services/hypercheap-voice-bridge/*`, `.cursor/settings.json`, `.claude/`, `tsconfig*.tsbuildinfo`.

## 1. Visual problems being addressed

1. Card reads flat: `border-slate-700/60` is nearly invisible against black; depth is a plain black shadow.
2. The top accent hairline (`AuthShell.tsx` — `inset-x-6 top-0 h-px` gradient div) reads as a progress bar and sits in the wrong place.
3. No visual separation between the header block (logo/heading/copy) and the form.
4. Login card bottom feels empty; no brand/product energy.
5. Inputs are flat gray-on-dark; placeholder contrast weak.
6. Button gradient is serviceable but thin (blue→blue→violet).

## 2. Exact visual changes

### 2.1 Card border + depth (`AuthShell.tsx`)
Replace the flat-bordered card with a 1px **static gradient-border wrapper** (Tailwind-only, no pseudo-elements, no animation):

```tsx
<main className={cn("relative m-auto w-full px-5 py-10 sm:px-8", WIDTHS[contentWidth])}>
  {/* 1px static gradient border: cobalt top-left → slate mid → restrained violet bottom-right */}
  <div className="rounded-2xl bg-gradient-to-br from-blue-500/50 via-slate-600/30 to-violet-500/45 p-px
                  shadow-[0_10px_40px_rgba(0,0,0,0.65),0_0_60px_-20px_rgba(59,130,246,0.28)]">
    <div className="rounded-[15px] bg-[#0c1222] p-6 sm:p-8">{children}</div>
  </div>
</main>
```

- **Top accent line: DELETED** (the `aria-hidden` hairline div and its `overflow-hidden` requirement). Nothing replaces it at the top edge.
- Depth = one static arbitrary-value shadow: deep black drop + a very restrained blue glow (`60px`, negative spread, 0.28 alpha). No pulse, no animation.
- Inner face `bg-[#0c1222]` = the exact composite shade users see today (`slate-900/80` over black), now opaque so the gradient wrapper cannot bleed through. `rounded-[15px]` = outer 16px − 1px border.
- Solid black page, `min-h-dvh`, body tint, `m-auto` safe centering, `contentWidth` widths — all unchanged.

### 2.2 Header-to-form divider (new `AuthDivider.tsx`, ~15 lines)
```tsx
<div aria-hidden="true" className={cn(
  "mx-auto h-px w-3/5 bg-[linear-gradient(90deg,transparent,rgba(59,130,246,0.55),rgba(34,211,238,0.35),rgba(139,92,246,0.55),transparent)]",
  className)} />
```
Thin, static, centered, 60% width, blue → faint cyan → violet with transparent ends. Used with `className="my-6"`.
**Placement:** after the header block (logo → h1 → supporting copy) and before alert/form on the four form pages: `/login`, `/signup`, `/forgot-password`, `/reset-password` (form branch). **Status pages and status branches don't get it** (kept simpler, per brief). Alert spacing changes from `mt-6 empty:mt-0` to `mb-5 empty:mb-0`; form drops its `mt-6` (divider owns the rhythm — net slightly tighter).

### 2.3 Login badge row (new `AuthBadgeRow.tsx`, ~30 lines) — `/login` only
Exact copy and order: **CRM · Dialer · Agency Ops**. Rendered below the "Don't have an account? Sign up" line (`<AuthBadgeRow className="mt-7" />`), last element in the card.

```tsx
const BADGES = [
  { label: "CRM",        Icon: Users,     cls: "border-blue-500/30 bg-blue-500/10 text-blue-300" },
  { label: "Dialer",     Icon: PhoneCall, cls: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300" },
  { label: "Agency Ops", Icon: Building2, cls: "border-violet-500/30 bg-violet-500/10 text-violet-300" },
];
// <ul className="flex flex-wrap items-center justify-center gap-2"> …
// <li className={cn("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-medium tracking-wide", cls)}>
//   <Icon className="h-3 w-3" aria-hidden="true" /> {label}
```
Display-only `<ul>/<li>` — no buttons, no links, not focusable, no hover styles, no animation. Icons are existing Lucide (`Users`, `PhoneCall`, `Building2`), 12px, `aria-hidden`. `whitespace-nowrap` keeps each label on one line; the row wraps as a whole at 320px if needed. **Default: login-only.** Recommendation: keep it off `/signup` — the signup card is already the tallest and the row would crowd the confirmation hand-off; can be added later with one line if Chris wants it.

### 2.4 Logo & header (`authTheme.ts` + pages + `AuthStatusState.tsx`)
- Logo icon `h-9 w-9` → `h-10 w-10` everywhere (4 form pages + `AuthStatusState`); wordmark stays `h-5`. No glow, no halo, same asset.
- `AUTH_HEADING_CLASS`: `font-semibold` → `font-bold` (stronger presence, same size).
- `AUTH_SUBHEADING_CLASS`: `text-slate-400` → `text-slate-300` (legibility).

### 2.5 Inputs (`authTheme.ts` + per-page icons)
- `AUTH_FIELD_CLASS` → `"h-12 rounded-xl border-slate-600/60 bg-slate-950/80 text-slate-100 ring-offset-slate-900 placeholder:text-slate-400/90 focus-visible:border-blue-400/70 focus-visible:ring-blue-500/70 disabled:opacity-60"`
  (darker blue-cast surface — `slate-950` is already blue-toned; more visible border; stronger placeholder; stronger blue focus border+ring; height stays 48px.)
- **Input icons** (existing Lucide, decorative): `Mail` on every email field (login, signup, forgot), `Lock` on every password field (login, signup, reset ×2). Name fields stay plain. Pattern inside `AuthField`'s existing `relative` slot:
  `<Mail aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-400/70" />` + input `pl-11` (password fields `pl-11 pr-12` — toggle position untouched).
- No change to ids, names, labels, autocomplete, validation, `aria-*`, or submission.

### 2.6 Button (`AuthPrimaryButton.tsx`)
Gradient → `from-blue-600 via-indigo-500 to-violet-500` (indigo center per brief), hover `hover:from-blue-500 hover:via-indigo-400 hover:to-violet-400`, shadow `shadow-lg shadow-blue-950/60`. Still static: `transition-colors` only, no lift, no shimmer; success/loading/disabled/`asChild` contract untouched.

## 3. Files to create or modify

| File | Change |
|---|---|
| `src/components/auth/AuthShell.tsx` | EDIT — remove top line, gradient-border wrapper + depth |
| `src/components/auth/AuthDivider.tsx` | **NEW** (~15 lines) |
| `src/components/auth/AuthBadgeRow.tsx` | **NEW** (~30 lines) |
| `src/components/auth/authTheme.ts` | EDIT — field/heading/subheading tokens |
| `src/components/auth/AuthPrimaryButton.tsx` | EDIT — gradient/shadow only |
| `src/components/auth/AuthStatusState.tsx` | EDIT — logo `h-10 w-10` (1 line) |
| `src/pages/LoginPage.tsx` | EDIT — divider, Mail/Lock icons, logo size, badge row |
| `src/pages/SignupPage.tsx` | EDIT — divider, Mail/Lock icons, logo size |
| `src/pages/ForgotPassword.tsx` | EDIT — divider, Mail icon, logo size |
| `src/pages/ResetPassword.tsx` | EDIT — divider, Lock icons, logo size |
| `src/components/auth/__tests__/authShell.test.tsx` | EDIT — card assertions → gradient wrapper + inner face; assert no top-edge hairline |
| `src/pages/__tests__/loginPage.test.tsx` | EDIT — assert exact badges (CRM/Dialer/Agency Ops), non-interactive, after the signup link; divider present |
| `implementation_plan.md` | this rewrite |
| `WORK_LOG.md` | after implementation — polish entry + flip #335 entry to SHIPPED |

**Untouched:** `AuthField.tsx`, `AuthAlert.tsx`, `ConfirmationPage`, `AcceptInvitePage`, `AcceptGroupInvite`, `AuthCallback` (all inherit shell/theme/button changes), `App.tsx`, `safe-redirect.ts`, all other tests, everything outside `src/components/auth` + the four form pages.

## 4. Behavior that will remain unchanged (regression contract)

Everything. Specifically: login flow (Zod gate, `resolvePostAuthDestination`, 1200 ms beat, timer cleanup, double-submit guard), signup (10-arg call, both invite prefill paths, `/confirmation` hand-off, password policy + checklist), forgot (non-disclosure, sent state), reset (hash/`PASSWORD_RECOVERY`, 6-char min, 3000 ms redirect, unsubscribe), invites (all states, branch order, encoded return path), callback (code exchange, opaque catch, 3000 ms beat), routing, AuthContext/Supabase contracts, timeouts, no token/password logging. Icons and badges are decorative DOM only.

## 5. Verification plan

- **Gates:** `npx tsc --noEmit` · `npx vitest run` (baseline 523/523) · ESLint on every touched file · `git diff --check` · diff audit (no `supabase/`, no deps/lockfile, no `AnimatedBackground`, no `<style>`, no animation utilities beyond `animate-spin` on active spinners).
- **Browser:** all 8 routes × 1440×900 / 1280×720 / 1024×768 / 768×1024 / 390×844 / 320×568 — solid black, no h-scroll, no white gaps, card border subtle at mobile, divider centered, badge row fits/wraps with each label on one line, password toggle aligned, signup scrolls.
- **Interaction smoke:** empty login submit, invalid credentials (real round-trip), password toggle, forgot/signup navigation, badge rendering, keyboard focus visibility, reduced-motion parity (zero animations at idle either way).
- **A11y:** decorative icons/divider `aria-hidden`; badges non-focusable; labels/alerts/live regions unchanged; contrast spot-checks (slate-300 copy and text-*-300 badge labels on `#0c1222` all ≥ 7:1).

## 6. Rollback

Branch-local until approved: `git checkout main` / delete branch restores production state. All changes are tracked-file edits + two new small components — no data, no infra. After any future merge, revert = `git revert` of the single squashed commit.

## 7. Open recommendations (approve/adjust)

- **R1 — Badges on signup:** default **NO** (login-only) to avoid crowding the tallest card.
- **R2 — Status pages:** inherit new card/border/button/typography but **no divider, no badges** — keeps them quiet.
- **R3 — WORK_LOG:** this task's entry also flips the stale `[PR OPEN]` #335 heading to `[SHIPPED …]` with merge SHA + prod deploy ID and notes the open `agentflow-life-insure` Vercel env item.
