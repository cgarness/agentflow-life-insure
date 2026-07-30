# Implementation Plan — Restore Centered Auth Card (Abandon Command Deck)

**Status:** AWAITING CHRIS APPROVAL
**Date:** 2026-07-29
**Branch:** `claude/login-design-concept-logintest1` (HEAD `decc0fa`, unpushed)
**Scope:** Frontend-only UI restyle of the 8 public auth routes. No Supabase, no migrations, no RLS, no Edge Functions, no Vercel, no new packages.

---

## 0. Ground truth (verified, not assumed)

- **`d371edf` exists only in the reflog.** It was amended 5× into `decc0fa` (current HEAD); `d371edf^` = `d9829ee` = `origin/main`. `decc0fa` added `/logintest1` only — **it did not touch `src/pages/LoginPage.tsx`** (`git diff --stat d9829ee decc0fa -- src/pages/LoginPage.tsx` is empty).
- **The Command Deck expansion is almost entirely UNCOMMITTED.** The working tree holds a full rewrite of all 8 auth pages onto a new shared `src/components/auth/Auth*` system (7 components + `authTheme.ts` + `safe-redirect.ts` + 10 test files, all untracked), plus edits to `App.tsx`. This work exists in **zero commits anywhere** (no remote, no stash, no branch). A full copy has been snapshotted outside the repo before any edit.
- **The working tree is already ~85% of the new direction.** The theatrical copy ("Establishing Secure Connection…", "Security Protocols"), trust badges (SECURE/ENCRYPTED/AI POWERED, OFFICIAL INVITATION, AGENCY GROUP INVITATION), the 2200 ms artificial invite delay, and the 700 ms fake-step ticker were all **already removed** by the uncommitted work (they live only at HEAD). Six of the eight pages already render centered (no brand panel). What remains Command-Deck-specific: the split-screen shell branch, `AuthBrandPanel` (marketing headline + capability rail + spines, used by Login/Signup only), the navy `bg-slate-900` surface, cyan accents, the entrance animation, and the button hover-lift.
- **Baseline verification of the current tree (run 2026-07-29):** `npx tsc --noEmit` clean · `npx vitest run` **522/522 (50 files)**.
- **`implementation_plan.md` was binary-corrupt** in the working tree (2 stray control bytes, NUL+DEL, on old line 61 made git treat it as binary). This rewrite replaces it with clean UTF-8.
- **Why not `git checkout d9829ee -- src/pages/`:** the original pages are built from things now forbidden — inline `style={{}}` objects (violates AGENT_RULES §7 "Tailwind only"), `<style>` keyframe blocks, `AnimatedBackground`, glow/shimmer/pulse animations, SECURE/ENCRYPTED/AI-POWERED badges — plus real defects (uncleared redirect timers, `/login` had **no working focus ring** due to a malformed `<style>` block, `/forgot-password` and `/reset-password` rendered **white** under the light default theme, login card fixed 440px with no max-width at 320 px). The original's glass card was also visually parasitic on the animated canvas (`rgba(13,25,48,0.38)` + heavy backdrop-blur over moving stars); on solid black it would render as a near-invisible rectangle. **We restore the visual DNA (centered dark glass card, blue/violet accents, centered logo) with a clean Tailwind implementation, not the original bytes.**

## 1. What is being removed (Command Deck)

| Item | Where | Action |
|---|---|---|
| Split-screen 45/55 layout | `AuthShell.tsx` `brandPanel` branch (`lg:grid-cols-[45%_55%]`) | Delete branch + `brandPanel`/`scrollContent` props |
| Marketing panel: "Built for life insurance agencies that move fast.", capability rail ("Dial More. Talk More." / "Every Lead, One Place." / "Know What's Working."), gradient spines, feature tiles | `AuthBrandPanel.tsx` | **Delete file** (only importers: LoginPage, SignupPage) |
| Entrance animation | `AUTH_ENTRANCE_CLASS` in `authTheme.ts` (only consumer: AuthShell) | Delete export + usage |
| Button hover lift + `transition-all` | `AuthPrimaryButton.tsx` (`motion-safe:hover:-translate-y-px`) | Remove; keep `transition-colors` only (allowed for hover/focus) |
| Cyan accent system | `authTheme.ts`, `AuthPrimaryButton`, `AuthAlert` info, `AuthStatusState` info tone, password-toggle hovers | Recolor to blue (`blue-400/500`) |
| Navy `bg-slate-900` page surface | `AuthShell.tsx` root + `document.body` classList | → solid `bg-black` |
| "Command Deck" naming in comments | `LoginPage.tsx:24`, `authTheme.ts:2`, `AuthBrandPanel.tsx:7`, `App.tsx:163` | Reword |
| `/logintest1` comparison page | Already deleted in working tree; route already redirects | Keep `<Navigate to="/login" replace />` (per brief) |
| `AnimatedBackground.tsx` | Tracked file, **zero importers repo-wide** (orphaned by this work) | **`git rm`** — decision D1 below |

Already removed by the uncommitted work and staying removed: `LoginPageTest1.tsx`, `LoginBrandPanel.tsx`, `LoginField.tsx`, `loginPageTest1.test.tsx`, all theatrical loading copy, all trust badges, the 2200 ms decorative delay (documented behavior change: the invite lookup now fires immediately — regression-guarded by `acceptInvitePage.test.tsx` "no cosmetic delay").

## 2. Restore target — the centered card system

Original visual DNA being restored (from `d9829ee:LoginPage.tsx`): centered dark navy translucent card (~440 px, 20 px radius, fine blue border `rgba(99,155,255,0.3)`, top highlight hairline, centered AgentFlow logo, "Welcome Back", blue #3B82F6 → violet #A855F7 accent range). Explicitly **not** restored: AnimatedBackground, glowPulse/shimmer/underlineGrow/badgePulse/cardEntrance keyframes, SECURE/ENCRYPTED/AI-POWERED badges, `🔓 Access Granted` banner, `#020408` background, inline styles.

New shared visual spec (Tailwind only, static, both `prefers-reduced-motion` states identical except spinners):

- **Page:** `bg-black`, `min-h-dvh`, `overflow-x-hidden`, `.dark` scope kept (shadcn tokens); body tinted `bg-black` for overscroll (existing add/remove effect pattern kept).
- **Safe centering:** flex container + `m-auto` on the card column — centers when space allows, tops out with `py-10` padding and scrolls naturally when content is tall (replaces the `scrollContent` prop; works for signup at 320×568).
- **Card (new — the current system has no card):** `relative overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/80 p-6 shadow-2xl shadow-black/60 sm:p-8` + static top highlight line `absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/50 to-transparent` (`aria-hidden`). Status pages (confirmation/callback/invites) render inside the same card.
- **Logo:** `<Logo variant="full" themeOverride="dark" …/>` centered above the heading on **all** pages (drop the `md:hidden` mobile-only wrapper on Login/Signup — the brand panel that carried the desktop logo is gone).
- **Widths:** login/forgot/reset/status `max-w-md` (448 px ≈ brief's 420–460); signup `max-w-lg` (512 px ≈ brief's 500–560). Existing `contentWidth` prop kept.
- **Inputs:** `h-12 rounded-xl border-slate-700 bg-slate-950/60`, blue focus ring (`focus-visible:border-blue-500/60 focus-visible:ring-blue-500/60`), `ring-offset-slate-900` (matches card surface).
- **Primary button:** keep the static `bg-gradient-to-r from-blue-600 via-blue-500 to-violet-500` (matches brief exactly); hover `hover:from-blue-500 hover:via-blue-400 hover:to-violet-400` (cyan removed); `focus-visible:ring-blue-400`; `transition-colors`; no movement.
- **Status colors:** success emerald, error rose, warning amber (all as today); info recolored cyan → blue.
- **Motion after this change:** `animate-spin` on active async spinners only (essential status feedback, WCAG 2.3.3 exemption, always paired with status text) + `transition-colors` on hover/focus. Nothing else animates.
- **Copy (per brief):** "Welcome Back" (recapitalized), "Create Your Account" / `Join ${organizationName}`, "Reset Your Password". Status-page headings stay sentence-case (they are sentences). "Password requirements" header already correct.

## 3. Shared component architecture (final roster)

| File | Fate | Notes |
|---|---|---|
| `AuthShell.tsx` | EDIT | Centered-only; bg-black; owns the new card; drops `brandPanel`/`scrollContent` |
| `authTheme.ts` | EDIT | Single palette chokepoint: cyan→blue sweep, field/link/focus classes, delete `AUTH_ENTRANCE_CLASS` |
| `AuthPrimaryButton.tsx` | EDIT | Recolor hover/focus, drop lift + `transition-all` |
| `AuthAlert.tsx` | EDIT (1 line) | `info` variant cyan→blue; keep always-mounted `role="alert"` live region |
| `AuthStatusState.tsx` | EDIT (1 line) | `info` tone cyan→blue; keep Logo/h1/live-region contract |
| `AuthField.tsx` | KEEP AS-IS | Design-neutral label/error/a11y wiring |
| `AuthBrandPanel.tsx` | DELETE | 100% Command-Deck |
| `src/lib/safe-redirect.ts` | KEEP AS-IS | Allowlist open-redirect defense, already wired into LoginPage + PublicRoute; brief says preserve internal-redirect handling "if already implemented" — it is |
| `src/components/shared/Logo.tsx` | KEEP AS-IS | Shared with Sidebar/Marketing — untouched |
| `src/components/AnimatedBackground.tsx` | DELETE (D1) | Zero importers repo-wide |

No new components beyond the card markup inside `AuthShell` (small enough not to warrant a separate `AuthCard`, keeping AuthShell < 200 lines per §7 of AGENT_RULES).

## 4. Routes — must remain exactly as the working tree has them

`/login`, `/signup`, `/forgot-password`, `/confirmation`, `/accept-invite` wrapped in `PublicRoute`; `/reset-password`, `/accept-group-invite`, `/auth/callback` deliberately unwrapped; `/logintest1` → `<Navigate to="/login" replace />`; `PublicRoute` redirects authed users via `resolvePostAuthDestination(user, ?redirect)`. Only `App.tsx` change: reword the "Command Deck" route comment.

## 5. Functional behavior preserved per page (regression contract)

- **Login:** `useAuth().login(parsed.email, parsed.password)`; Zod gates submit only; `resolvePostAuthDestination(user, searchParams.get("redirect"))`; 1200 ms success beat, timer in `useRef`, cleared on unmount; `loading || accessGranted` double-submit guard; `err.message || "Invalid credentials"`; password toggle with `aria-pressed`/`aria-controls`; links `/forgot-password`, `/signup`.
- **Signup:** 10-arg positional `signup(email, password, firstName, lastName, organizationId, uplineId, role, licensedStates, commissionLevel, inviteToken)`; `?token=` invite prefill via `usersApi.getInvitationByToken` (`.maybeSingle()` RPC) and legacy `?invite=` base64 path; 8-char/upper/number/special policy + live checklist; `navigate("/confirmation", { state: { email } })` leaving `loading` true; `mapAuthError`; submit disabled rule `loading || (password.length > 0 && !isPasswordStrong)`.
- **Forgot:** `resetPassword(email)`; sent state echoes raw email; no account-existence disclosure; fallback "Could not send the reset link."; `/login` links in both branches.
- **Reset:** recovery via hash `type=recovery` OR `PASSWORD_RECOVERY` event; subscription unsubscribed on unmount; `supabase.auth.updateUser`; **6-char minimum (intentionally ≠ signup's 8 — unchanged)**; mismatch via Zod refine; 3000 ms redirect timer cleared on unmount; invalid-link gate `!isRecovery && !success`.
- **Confirmation:** `location.state.email || "your email"`; spam guidance; back-to-login is a real `<Link>` (`asChild`); zero form controls.
- **Accept invite:** all 8 states (loading/missing/invalid/revoked/expired/already-used/failed/valid) with exact branch order (Revoked beats expired date; status "Expired" short-circuits date math); immediate lookup (no cosmetic delay); `cancelled` unmount guard; org-name fallback chain; accept navigates to `/signup?token=<token>` with exact token forwarding.
- **Group invite:** `agencyGroupApi.preview/accept/decline` Edge Function contract (single endpoint, `action` discriminator); authed vs unauthed CTA split; Decline hidden when unauthed; unauth CTA → `/login?redirect=` + encoded `/accept-group-invite?token=…` (exact encoding is a cross-file contract with the `safe-redirect.ts` allowlist); accept → `/settings?section=agency-group`, decline → `/dashboard`, both immediate; expiry display-only (server enforces); data-separation copy retained verbatim (factual disclosure, not marketing); `authLoading` folded into the loading gate.
- **Auth callback:** `?code` → `exchangeCodeForSession`, else `getSession` fallback (never exchanges without a code); second `getSession` for routing; `resolvePostAuthPath` (deliberately ignores `?redirect=`); 3000 ms success beat, timer cleared on unmount via separate `[]`-deps effect; opaque `catch` (no raw error text, no logging).

Cross-cutting: no password/token/session logging; `.maybeSingle()` audit clean (no zero-row `.single()` in scope); body-class add/remove pairing; `.dark` scope retained; `AuthPrimaryButton` `asChild` guard (`type`/`disabled` undefined on anchors).

## 6. Exact file list

**Edit — components (5):** `src/components/auth/AuthShell.tsx`, `authTheme.ts`, `AuthPrimaryButton.tsx`, `AuthAlert.tsx`, `AuthStatusState.tsx`
**Edit — pages (4 + comment-only):** `src/pages/LoginPage.tsx` (drop brand panel, always-visible logo, "Welcome Back", reword comment), `src/pages/SignupPage.tsx` (drop brand panel + `scrollContent`, logo, "Create Your Account", `contentWidth="lg"`), `src/pages/ForgotPassword.tsx` ("Reset Your Password"), `src/pages/AcceptGroupInvite.tsx` (only if D2 approved), `src/App.tsx` (comment reword only)
**Edit — tests (4):** `src/pages/__tests__/loginPage.test.tsx` (replace brand-panel test with centered-design invariants + no-marketing-copy negatives), `src/components/auth/__tests__/authShell.test.tsx` (drop `brandPanel`/`scrollContent` cases; `bg-slate-900`→`bg-black`; add card/no-aside assertions), `src/pages/__tests__/signupPage.test.tsx` + `forgotPassword.test.tsx` (heading-casing assertions; + group-invite test if D2)
**Delete (2):** `src/components/auth/AuthBrandPanel.tsx` (untracked), `src/components/AnimatedBackground.tsx` (`git rm`, D1)
**Docs (2):** `implementation_plan.md` (this rewrite — also fixes the binary corruption), `WORK_LOG.md` (new newest-first entry at line 8, after implementation)
**Unchanged but carried in the same commit (already-uncommitted auth work):** the 8 rewritten pages' existing diffs, `AuthField.tsx`, `safe-redirect.ts` + its tests, the remaining page test files, deletions of `LoginPageTest1.tsx` / `LoginBrandPanel.tsx` / `LoginField.tsx` / `loginPageTest1.test.tsx`.

**Explicitly excluded (pre-existing unrelated dirty files — never staged, never touched):** `scripts/seed-test-leads.mjs`, `services/hypercheap-voice-bridge/app/main.py`, `services/hypercheap-voice-bridge/app/pipeline_bridge.py`, `.cursor/settings.json`, `.claude/`, `tsconfig.app.tsbuildinfo`, `tsconfig.node.tsbuildinfo`. Staging will be explicit path-by-path — no `git add -A`.

## 7. Git strategy (no blind resets)

1. Immediately after approval: WIP snapshot commit of the current in-scope working tree on this branch (`wip:` prefix) so the 2,638 currently-unrecoverable untracked lines gain a git object. (Scratchpad tarball already taken pre-approval.)
2. Implement the restyle as edits on top.
3. Final single commit amends/squashes the WIP (branch is unpushed; history stays clean). Commit message documents the Command Deck abandonment.
4. No push, no PR, no merge, no deploy without explicit approval.

**Rollback:** before the final commit, `git reset --hard decc0fa` + restore tarball reproduces today's exact state; after it, revert is `git revert <sha>` or re-checkout of `decc0fa` paths. `main`/`origin` are untouched throughout.

## 8. Testing plan

- Keep all pure-behavior tests verbatim (safeRedirect 33, resetPassword 24, authCallback 6, acceptInvite 15, acceptGroupInvite 11, confirmation 10, forgot 14, signup 16 — casing tweaks only).
- Rewrite the 3 design-coupled cases (loginPage #1, authShell #5/#6) into centered-design invariants: solid `bg-black` root, card surface present, **no** `<aside>`/marketing copy ("Built for life insurance agencies", "Dial More. Talk More.", etc. as negative assertions), logo visible at all widths.
- Full gates: `npx tsc --noEmit` · `npx vitest run` (baseline to beat: **522/522**) · `npm run lint` on touched files · `git diff --check`.
- Browser smoke via local Vite dev server at 1440×900, 1280×720, 1024×768, 768×1024, 390×844, 320×568: black background fills viewport, no horizontal scroll, no white gaps, card not clipped, signup scrolls, fields stack, focus rings visible, reduced-motion parity.
- **Human-required:** real-credential successful login → post-auth redirect (agent has no production login; covered by unit tests for both `/dashboard` and `/onboarding` branches).

## 9. Decisions for Chris

- **D1 — Delete `AnimatedBackground.tsx`?** Tracked file, zero importers anywhere after this work. Recommend **delete** ("do not leave dead components"). Alternative: leave orphaned.
- **D2 — Fix the `/accept-group-invite` stuck-spinner defect?** The preview `fetch` has no `.catch()` and no unmount guard (pre-existing, also in the original): a network failure leaves the page on "Verifying invitation…" forever. Small documented fix (+ `.catch` → error state, + cancelled flag, + 1 test). Recommend **fix**; skip if you want zero behavior deltas.
- **D3 — Heading casing:** brief's exact titles ("Welcome Back", "Create Your Account", "Reset Your Password") applied; status headings stay sentence-case. Say the word for a different scheme.
