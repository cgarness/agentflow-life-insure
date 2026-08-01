# Implementation Plan — Onboarding Wizard Redesign ("Focused Console")

**Status:** **AWAITING CHRIS'S APPROVAL — no source file has been modified.** Only this plan file is written.
**Date:** 2026-08-01
**Branch:** `claude/onboarding-focused-console-y3177z` (cut from `origin/main` = `ff8499a`; working tree clean, zero commits ahead at the time of writing).
**Scope:** Frontend-only visual + UX redesign of the `/onboarding` wizard, plus one approved founder-timezone UX correction. **No backend, schema, RLS, migration, Edge Function, environment, or deployment change is required** (see §15).
**Design direction:** Focused Console — solid black page, one centered dark-navy `max-w-3xl` card, AgentFlow platform logo, three-step premium stepper, blue selection/focus accents, restrained blue→violet primary CTA, no decoration or animation beyond spinners.

> Supersedes the previous plan (System Email Audit & Unification), which shipped as PR #338 on 2026-08-01 and is recorded in `WORK_LOG.md`.

---

## 0. How this was inspected

- **Mandatory reads:** `AGENT_RULES.md` (v5.0.0 — all 21 invariants, §5 schema gotchas, §7 component standards, §10 forbidden patterns), `VISION.md`, `WORK_LOG.md` (newest entries in full; the index of the 25 most recent entries scanned).
- **Source read in full:** `src/pages/OnboardingPage.tsx`, `src/hooks/useOnboardingPageFlow.ts`, `src/lib/onboarding-wizard.ts`, the three wizard step components, `src/components/auth/AuthShell.tsx`, `authTheme.ts`, `AuthField.tsx`, `AuthPrimaryButton.tsx`, `AuthAlert.tsx`, `AuthStatusState.tsx`, `src/components/shared/Logo.tsx`, `StateSelector.tsx`, `PhoneInput.tsx`, `src/contexts/AuthContext.tsx` (Profile type, `logout`, `updateProfile`), `src/App.tsx` (route gates), `src/components/settings/user-management/StateMultiSelect.tsx` (existing multi-select precedent), `src/components/ui/{command,popover}.tsx`, `src/constants/us-geo.ts`, `src/utils/phoneUtils.ts`, `src/lib/safe-redirect.ts`, `vitest.config.ts`, `src/test/setup.ts`, `eslint.config.js`.
- **Test inventory:** 51 test files, **532 passing** as of the newest WORK_LOG entry. **There is no onboarding test anywhere today** — a `grep` across `src/**/*.test.*` finds "onboarding" only in `safeRedirect`, `loginPage` and `authCallback`, and only via `resolvePostAuthPath`. Every onboarding test in §13 is net-new.

### WORK_LOG conflict check

| Recent entry | Conflict with this task? |
|---|---|
| 2026-08-01 System email unification (PR #338, SHIPPED) | **No.** It mounts `useWelcomeEmailTrigger()` inside `App.tsx`'s onboarding route gate so unfinished-wizard users still get the welcome mail. That call site is preserved verbatim — see D3. |
| 2026-07-31 P0 security / profile authorization (PR #340, SHIPPED) | **No — but it constrains us.** `profiles` now has a column-scoped `UPDATE` grant for `authenticated` plus the `enforce_profile_field_authorization()` guard. The wizard's `updateProfile` patch writes only `first_name`, `last_name`, `phone`, `resident_state`, `licensed_states`, `timezone`, `npn`, `commission_level`, `onboarding_complete` — **none of them protected**. This plan adds no column to that patch. |
| 2026-07-29 Auth visual polish (PR #336) + centered auth redesign (PR #335) | **No conflict — this is the continuation.** Those shipped the exact visual language this task extends into onboarding. Their files are **not touched** (§6.4). |
| Older entries (Contacts, Dialer, Queue builds) | No overlap. |

**No WORK_LOG entry has changed onboarding behavior since the wizard was written.** The only onboarding-adjacent notes are `useOnboardingPageFlow.ts:148–155` (organizations RLS — "No app change required") and the welcome-trigger mount above.

---

## 1. Current founder (self-serve) flow — exactly as it works today

**Entry.** `create-user` (Edge) stamps `user_metadata` with `needs_app_wizard: true` and `signup_source: "self_serve"`, and provisions the organization server-side via `provision_organization()` (founder is `Admin` in that new org only). After email confirmation, `resolvePostAuthPath(user)` → `/onboarding` (`src/lib/onboarding-wizard.ts:15–18`) because `needsAppOnboardingWizard` is true (`email_confirmed_at` present, `needs_app_wizard === true`, `app_wizard_completed !== true`).

**Gate.** `App.tsx:71–85` (local `OnboardingShell`): `isLoading` → unlabeled spinner; unauthenticated → `/login`; `!needsAppOnboardingWizard(user)` → `/dashboard`; otherwise render `OnboardingPage`. `ProtectedRoute` (`App.tsx:107–109`) bounces any authenticated user who still needs the wizard back to `/onboarding`.

**Founder detection.** `isSelfServeSignup(user)` reads `user_metadata.signup_source === "self_serve"` (`onboarding-wizard.ts:10–13`), memoized as `isFounder` (`useOnboardingPageFlow.ts:36`).

**Prefill** (`:58–70`): names, phone, resident state, NPN, `licensed_states` array, `timezone`, commission digits (`digitsFromCommission` strips non-digits). **Founders only:** `agencyTimezone` seeded from `profile.timezone` (`:69`). Org name (`:72–84`) resolves `company_settings.company_name` then `organizations.name` (both `.maybeSingle()`); a resolved name pre-fills `agencyName` for founders. Upline label (`:86–100`) resolves the upline profile's name (`.maybeSingle()`).

**Steps.** `step` 0/1/2 in local state. `next()` (`:231–241`) validates then advances; `back()` (`:243–246`) decrements and clears errors. Form data survives Back/Continue because it lives in the hook, not in the step components.

- **Step 0** — first name, last name, phone (`PhoneInput` → `normalizePhoneNumber`, stored as `1XXXXXXXXXX`), resident state (Radix `Select` over `US_STATE_NAMES`, full names). Validation (`:102–111`): all four required; phone must carry ≥ 10 digits.
- **Step 1** — NPN, licensed states (50 checkboxes in a `max-h-40` scroll box + "Select all"), **personal timezone**, commission level (digits-only). Validation (`:113–116`): always passes and clears errors.
- **Step 2 (founder)** — agency display name (required, `:118–124`), agency default timezone, team-size radio (`solo` / `small` / `large`, displayed today as "Just me" / "2–10 producers" / **"10+ producers"**).

**Completion** (`finish`, `:126–229`), in order:
1. `refreshSessionUntilClaimsReady()` — up to 12 `supabase.auth.refreshSession()` attempts 350 ms apart until `app_metadata.role` **and** `organization_id` are present; otherwise throws a human-readable recovery message.
2. `updateProfile(patch)` → `profiles` UPDATE with `first_name`, `last_name`, `phone`, `resident_state`, `licensed_states`, **`timezone: isFounder ? agencyTimezone : timezone`**, `onboarding_complete: true`, plus `npn` / `commission_level` **only when non-empty**.
3. Founder **and** `organization_id` **and** non-empty agency name → in parallel: `organizations` UPDATE `{name, updated_at}` `.eq("id", orgId)`, and `company_settings` **upsert** `{organization_id, company_name, logo_url:null, logo_name:null, favicon_url:null, favicon_name:null, timezone: agencyTimezone || BRANDING_DEFAULTS.timezone, time_format, company_phone:"", website_url:"", updated_at}` with `onConflict: "organization_id"`. Both failures are **non-fatal** — `console.warn` + a Sonner `toast.message`.
4. `supabase.auth.updateUser({ data: { ...user_metadata, app_wizard_completed: true, team_size_intent: teamSize (founders only) } })` — this one **throws** on error.
5. `supabase.auth.refreshSession()` → `toast.success("Welcome to AgentFlow!")` → `navigate("/dashboard", { replace: true })`.
6. Any throw → `console.error` + `toast.error(<message>)`; `saving` released in `finally`.

## 2. Current invited-agent flow

Identical except: `signup_source: "invite"` (so `isFounder === false`), org/role/upline were server-derived from the `invitations` row at signup (invariant #20), `agencyName` / `agencyTimezone` / `teamSize` are never rendered or sent, `profiles.timezone` comes from the **step-2 personal timezone**, `team_size_intent` is not written, and step index 2 renders a read-only confirmation card with **Agency / Your role / Upline (when present)**. Final-step validation returns `true` immediately (`:119`).

## 3. Confirmed problems this task fixes

1. **The founder's timezone control is dead.** A founder picks "Your timezone" on step 2 and it is silently discarded — `patch.timezone` uses `agencyTimezone` for founders (`:140`). Two visible timezone pickers, one of which does nothing. *(Called out in the brief; fixed in §10 with no storage change.)*
2. **Team-size copy is wrong.** `small` = "2–10 producers" and `large` = "10+ producers" overlap at exactly 10.
3. **Licensed states is a 50-checkbox `max-h-40` scroll box** — unusable on mobile, no search.
4. **The page is not dark.** It renders on `bg-background`, and the app's `defaultTheme` is **light** (`App.tsx:143`), so a freshly-confirmed user goes from a black auth card straight into a white wizard.
5. **Accessibility gaps.** Errors are the bare string "Required"; no `aria-invalid`, no `aria-describedby`, no live region, no focus management, color-only error signalling (`border-destructive`), and the resident-state `Label` has no `htmlFor`.
6. **Unlabeled spinners** in both loading states (`OnboardingPage.tsx:47–53`, `App.tsx:77–81`).
7. **Detached footer**, a generic "Finish" for both audiences, and `min-h-screen` — the exact white-overscroll defect the auth work fixed with `min-h-dvh`.
8. **Completion errors are raw.** `toast.error(err.message)` will surface PostgREST/Supabase text verbatim (§12.4).

---

## 4. Behavior that MUST remain unchanged (and how it is preserved)

| # | Invariant | Where it lives | Preservation |
|---|---|---|---|
| 1 | `needsAppOnboardingWizard` | `onboarding-wizard.ts:4–8` | **File not modified.** |
| 2 | `resolvePostAuthPath` / `resolvePostAuthDestination` | `onboarding-wizard.ts:15`, `safe-redirect.ts:87` | **Files not modified.** |
| 3 | `/onboarding` route gating | `App.tsx:71–85`, `:107–109`, `:165` | Gate order, conditions and `<Navigate>` targets byte-identical; only the `isLoading` **visual** is swapped (D3). |
| 4 | `onboarding_complete: true` in the profile patch | hook `:141` | Unchanged. |
| 5 | `needs_app_wizard` / `app_wizard_completed` metadata | hook `:188–193` | Unchanged, same spread-then-set order. |
| 6 | `signup_source` founder detection | `onboarding-wizard.ts:10–13` | **File not modified**; `isFounder` derivation unchanged. |
| 7 | Founder vs invited-agent branching | hook + `OnboardingPage` step 2 | Same `isFounder` switch, same two sub-views. |
| 8 | `organization_id` scoping / RLS expectations | hook `:148–155` | Same guard (`isFounder && organization_id && agencyName.trim()`), same `.eq("id", orgId)`. |
| 9 | `organizations` UPDATE + `company_settings` upsert | hook `:151–172` | **Payloads byte-identical**, same `onConflict`, same parallel `Promise.all`, same non-fatal warn + toast semantics. |
| 10 | `team_size_intent` values | hook `:190` | Persisted enum stays `solo` / `small` / `large`; only the **display label** for `large` changes to "11+ producers". |
| 11 | Final `navigate("/dashboard", {replace:true})` | hook `:196` | Unchanged. |
| 12 | `refreshSessionUntilClaimsReady` recovery | hook `:16–27` | Unchanged — attempt count, delay, and thrown message all preserved. |
| 13 | `.maybeSingle()` where zero rows are valid | hook `:77`, `:78`, `:96` | Unchanged. |
| 14 | Existing Supabase auth contracts | `AuthContext` | Not modified. Sign out uses the **existing** `useAuth().logout` — no second `supabase.auth.signOut()` in the page. |
| 15 | Sonner for completion-level errors | hook `:178–208` | Retained (message text sanitized — §12.4). |
| 16 | No skip button, no dev bypass | — | None added. `ProtectedRoute`'s pre-existing `?bypass_auth` DEV flag is **not** touched. |
| 17 | Founder / invited eligibility rules | — | Unchanged. |
| 18 | Dialer / telephony | — | Zero files touched. |

**Also unchanged:** stored `resident_state` (full state name), `licensed_states` (`string[]` of full state names), `commission_level` (digit string, written only when non-empty), `npn` (written only when non-empty), and `timezone` (Rails/ActiveSupport label from `US_TIMEZONES` — **not** IANA; per invariant #14 that string must not be reinterpreted).

---

## 5. Approved layout spec

```
┌ page: bg-black · min-h-dvh · .dark · body tinted black · overflow-x-hidden · m-auto centering ┐
│                          [ AgentFlow logo — centered, above the card ]                        │
│  ┌ card: max-w-3xl · rounded-2xl · slate-900 face · slate border · static top hairline ─────┐ │
│  │  "Account setup"                                                         [ Sign out ]   │ │
│  │  ────────────────────────────────────────────────────────────────────────────────────   │ │
│  │  (1) Profile ──── (2) Licensing ──── (3) Agency | Workspace        ← OnboardingStepper   │ │
│  │  Step 2 of 3                                                                            │ │
│  │                                                                                         │ │
│  │  <h1> Step heading </h1>                                                                │ │
│  │  Supporting copy                                                                        │ │
│  │  [ live region — step-level + completion errors ]                                        │ │
│  │  … step content …                                                                       │ │
│  │  ────────────────────────────────────────────────────────────────────────────────────   │ │
│  │  [ Back ]                                              [ Continue / Complete setup ]    │ │
│  └─────────────────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Page:** `dark relative flex min-h-dvh w-full overflow-x-hidden bg-black text-slate-100`; `useEffect` body tint (`bg-black` added on mount, removed on unmount — the same technique `AuthShell` uses, independently implemented in `OnboardingShell` so auth is untouched); `m-auto` card column with `px-4 py-8 sm:px-6 sm:py-10` so short screens scroll naturally. No animated background, no particles, no floating gradients, no marketing statistics, no testimonials, no product claims.
- **Card:** `max-w-3xl rounded-2xl border border-slate-700/60 bg-slate-900 shadow-[0_10px_40px_rgba(0,0,0,0.65)]` plus one static top highlight hairline (`aria-hidden`, `h-px bg-gradient-to-r from-transparent via-blue-500/40 to-transparent`). Restrained — deliberately **not** the auth card's full gradient border, which stays exclusive to auth.
- **Logo:** `<Logo variant="full" themeOverride="dark" />` centered above the card. `themeOverride="dark"` is required because the app theme is light and `Logo` would otherwise pick the light wordmark. **Platform logo only — never `company_settings` agency branding.**
- **Motion:** `transition-colors` on hover/focus, `animate-spin` on active spinners. Nothing else; `document.getAnimations()` at idle must be 0.

---

## 6. Files

### 6.1 New — `src/components/onboarding/`

| File | Purpose | Budget |
|---|---|---|
| `OnboardingShell.tsx` | Black page + body tint + centered card + centered logo + header row (eyebrow left, **Sign out** right) + top hairline; renders `children`; `aria-busy` passthrough. | ~95 lines |
| `OnboardingStepper.tsx` | Semantic `<ol aria-label="Setup progress">`, three items, numbers + labels, `aria-current="step"`, visually-hidden state text, connectors, 320 px-safe. | ~80 |
| `OnboardingNavigation.tsx` | Integrated footer: Back (disabled on step 1 / while saving) + primary CTA (label per step & audience, spinner + descriptive text while saving, full-width on mobile). | ~70 |
| `OnboardingLoadingState.tsx` | Branded loading screen — black page, dark card, logo, spinner, `role="status"` + `aria-live="polite"` "Preparing your workspace…". | ~45 |
| `LicensedStatesMultiSelect.tsx` | Popover + Command searchable multi-select (§9). | ~150 |
| `OnboardingAlert.tsx` | Always-mounted `role="alert" aria-live="polite"` region for step-level and completion errors. | ~35 |
| `onboardingTheme.ts` | Onboarding-only Tailwind class constants (field, label, helper, error, heading, subheading, card, focus ring, primary CTA gradient). **Colocated with onboarding — `authTheme.ts` is neither touched nor generalized.** | ~50 |
| `licensedStates.ts` | Pure helpers `toggleState`, `summarizeLicensedStates`, `filterStates`. A separate module so ESLint's `react-refresh/only-export-components` stays quiet and the logic is unit-testable with no DOM. | ~40 |

### 6.2 New — validation

| File | Purpose |
|---|---|
| `src/lib/onboarding-validation.ts` | Zod schemas (`onboardingProfileSchema`, `onboardingLicensingSchema`, `onboardingFounderAgencySchema`), `zodErrorsToFieldMap()`, `ONBOARDING_FIELD_IDS`, per-step `FIELD_ORDER` for first-invalid-field focus, and `describeCompletionError()` (§12.4). |

### 6.3 Edited

| File | Change |
|---|---|
| `src/pages/OnboardingPage.tsx` | Rewritten as composition over the new shell / stepper / navigation. **No flow logic moves into it** beyond focus management. |
| `src/hooks/useOnboardingPageFlow.ts` | Zod validation swap-in; per-field error clearing; first-invalid-field focus key; `savingRef` double-submit guard; `showsPersonalTimezone` derived flag; sanitized completion error; `orgName` display fallback moved to the view (D5). **Every Supabase call, payload and navigation stays byte-identical.** |
| `src/components/onboarding/wizard/OnboardingStepWho.tsx` | New heading/copy, stacked-on-mobile name grid, a11y wiring, `htmlFor` on the resident-state label, explicit internal-contact clarification for phone. |
| `src/components/onboarding/wizard/OnboardingStepCredentials.tsx` | New heading/copy, `LicensedStatesMultiSelect`, timezone rendered **only for invited users**, commission helper copy, a11y wiring. |
| `src/components/onboarding/wizard/OnboardingStepAgency.tsx` | Founder: new heading/copy, team-size **cards**, corrected ranges. Invited: "You're joining …" heading, subtle `Building2` icon, polished summary. Split into `OnboardingStepAgencyFounder.tsx` + `OnboardingStepWorkspace.tsx` to stay under 200 lines; `OnboardingStepAgency.tsx` keeps the discriminated-union entry point **and the `TeamSizeIntent` export** (imported by the hook). |
| `src/App.tsx` | **Two edits only:** swap the onboarding gate's raw spinner for `<OnboardingLoadingState />`, and rename the local `OnboardingShell` const to `OnboardingRouteGate` so two components don't share a name (D3). Gate logic untouched; `useWelcomeEmailTrigger()` stays exactly where it is. |
| `implementation_plan.md`, `WORK_LOG.md` | This plan; a newest-first work-log entry after implementation. |

### 6.4 Explicitly NOT touched

`src/components/auth/**` (including `AuthShell.tsx`, `authTheme.ts`, `AuthPrimaryButton.tsx`), all auth pages, `src/lib/onboarding-wizard.ts`, `src/lib/safe-redirect.ts`, `src/contexts/AuthContext.tsx`, `src/components/onboarding/ProfileSetupModal.tsx`, `src/components/shared/{Logo,PhoneInput,StateSelector}.tsx`, `src/test/setup.ts`, `supabase/**`, `package.json` / lockfiles, `tailwind.config.ts`, `index.css`.

**The style duplication is deliberate.** The onboarding CTA repeats the `from-blue-600 via-indigo-500 to-violet-500` gradient in `onboardingTheme.ts` instead of importing `AuthPrimaryButton`, so a future onboarding tweak can never regress a shipped auth page. This follows the brief's "create onboarding-specific style constants colocated with onboarding".

---

## 7. Step content spec

### Step 1 — Profile (stepper label `Profile`)
- **h1:** "Tell us about you"
- **Copy:** "We'll use this information for your internal profile, team visibility, and account recovery."
- First/last name: `grid grid-cols-1 sm:grid-cols-2 gap-4` — stacked at 320 / 390.
- Phone: existing `PhoneInput` + `normalizePhoneNumber` (storage unchanged). Label "Phone"; helper **"For internal contact and account recovery. This is not used as your outbound caller ID."**
- Resident state: label bound with `htmlFor` to the Select trigger id. Wording — see **D1**.

### Step 2 — Licensing (`Licensing`)
- **h1:** "Licensing and production details"
- **Copy:** "All optional — add what you have now and update any of it later in Settings."
- **NPN** — optional, storage unchanged, **no external NPN verification**, placeholder `e.g. 12345678`.
- **Licensed states** — `LicensedStatesMultiSelect` (§9); same `string[]` payload.
- **Your timezone** — **invited users only** (§10); same `US_TIMEZONES` options, same `profiles.timezone` write.
- **Commission level** — digits-only `onChange` filter preserved verbatim; helper "Numbers only — do not include the % sign."

### Step 3 — Agency (founder, `Agency`)
- **h1:** "Set up your agency"
- **Copy:** "This creates the workspace your team will use for calling, managing leads, and tracking production."
- Agency display name (required), Agency default timezone, and team-size **cards**:

| Card label | Persisted value |
|---|---|
| Just me | `solo` |
| 2–10 producers | `small` |
| **11+ producers** | `large` |

  Implemented with `RadioGroup` / `RadioGroupItem` inside `<label>` cards with explicit **selected** (blue border + blue-tinted surface + visible radio dot), **hover**, and **focus-visible** ring states. Selection is readable without color (radio dot + a visually-hidden "Selected" cue).
- **CTA:** "Complete setup".

### Step 3 — Workspace (invited, `Workspace`)
- **h1:** "You're joining {Agency Name}"
- **Copy:** "You're joining an existing AgentFlow workspace. Confirm the details below and you're in."
- Summary card with a subtle `Building2` icon (`aria-hidden`): **Agency**, **Role**, **Upline** (rendered only when present). No celebratory animation.
- **CTA:** "Enter AgentFlow".

---

## 8. Stepper spec

- `<ol aria-label="Setup progress">` with three `<li>`; each renders a number badge, a label, and visually-hidden state text.
- **States:** *current* — blue-filled badge, white bold label, `aria-current="step"`, SR text "current step"; *visited* — blue-outlined badge, slate-200 label, SR text "**visited**" (deliberately not "completed", and **no checkmark glyph**, because nothing is persisted until the final submit); *upcoming* — slate-700 badge, slate-500 label, SR text "not started".
- Understandable without color: number + label + weight difference + `aria-current`.
- **Responsive:** connectors collapse below `sm`; labels `text-[11px] sm:text-sm`; the longest labels ("Licensing", "Workspace") fit three-across at 320 px — confirmed in the browser sweep (§14).
- Step 3's label is `Agency` for founders and `Workspace` for invited users, derived from the same `isFounder` flag — no new state.
- **Compact progress line** under the stepper: `Step {n} of 3` (plus the optional time estimate — **D2**). No progress sidebar.

---

## 9. `LicensedStatesMultiSelect` spec

- **No new package.** Uses the repo's existing `Popover` (`@radix-ui/react-popover`) and `Command` (`cmdk`) primitives, mirroring `src/components/shared/StateSelector.tsx`.
- **Trigger:** `<Button variant="outline" role="combobox" aria-expanded aria-haspopup="listbox" id="onboarding-licensed-states">` showing the collapsed summary + `ChevronsUpDown`.
- **Summary** (`summarizeLicensedStates`): `No states selected` · `1 state selected` · `{n} states selected` · `All states selected` (n === 50).
- **Popover:** `align="start"`, `w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0`, `collisionPadding={12}` — stays inside a 320 px viewport.
- **Contents:** `CommandInput` ("Search states…", matches by full state name); a header row with **Select all** and **Clear** (`type="button"`, keyboard reachable; `Clear` disabled at 0, `Select all` disabled at 50); `CommandList` + `CommandEmpty` ("No state found."); one `CommandItem` per state with a check indicator. Selecting **toggles without closing** the popover.
- **Chips:** up to 6 selected states as compact non-interactive chips beneath the trigger, plus a `+{n} more` chip beyond that — bounded vertical height; removal happens inside the popover (**D6**).
- **Keyboard:** cmdk provides arrow/Enter/type-ahead; the trigger is a real button; Radix returns focus to it on close.
- **Storage:** `value` / `onChange` are `string[]` of full state names from `US_STATE_NAMES` — **identical to today's payload**.

---

## 10. Founder timezone UX correction (the one approved behavior change)

| Audience | Step 2 | Step 3 | `profiles.timezone` | `company_settings.timezone` |
|---|---|---|---|---|
| **Invited** | "Your timezone" (shown) | — | step-2 personal timezone | not written |
| **Founder** | **not shown** | "Agency default timezone" | **agency timezone** | **agency timezone** |

- Implementation: the hook exposes `showsPersonalTimezone = !isFounder`; `OnboardingStepCredentials` renders the timezone field only when it is true.
- **Zero storage change.** `patch.timezone = isFounder ? agencyTimezone : timezone` (`hook:140`) stays exactly as written, as does the `company_settings.timezone` value. The `timezone` state and its prefill remain (invited users still need them); founders simply never see a control whose value would be discarded.
- **No second founder timezone is introduced anywhere.**
- Proven by three tests in §13.

---

## 11. Validation (Zod) + accessibility

### Schemas — the required-field set is unchanged

| Step | Rule (identical set to today) | Message |
|---|---|---|
| 1 | `firstName` non-empty after trim | "Enter your first name" |
| 1 | `lastName` non-empty after trim | "Enter your last name" |
| 1 | `phone` non-empty **and** ≥ 10 digits | "Enter your phone number" / "Enter a valid 10-digit phone number" |
| 1 | `residentState` non-empty | "Select your resident state" |
| 2 | *(nothing — every field optional)* | — |
| 3 founder | `agencyName` non-empty after trim | "Enter your agency's display name" |
| 3 invited | *(nothing)* | — |

Only the **message strings** improve. Which fields are required, and the phone's ≥ 10-digit rule, are preserved exactly. Error keys stay `firstName` / `lastName` / `phone` / `residentState` / `agencyName`, so the existing `errors: Record<string,string>` prop contract is unchanged.

### Accessibility

- `aria-invalid="true"` on every invalid control; `aria-describedby` always wires helper text and, when present, the error (`{id}-error`), using **stable ids** from `ONBOARDING_FIELD_IDS` (e.g. `onboarding-first-name-error`).
- Errors carry a text/icon signal in addition to color — never border color alone.
- Every field has a real `<Label htmlFor>`; placeholders are supplementary, never the label.
- One always-mounted `role="alert" aria-live="polite"` region per card (`OnboardingAlert`): announces "Check the highlighted fields below." on a failed Continue, and completion errors when they occur. Mounted empty so the later mutation is observed (the same rationale documented in `AuthAlert`).
- **Focus:** on a failed Continue the hook publishes `{field, nonce}`; the page's effect focuses `document.getElementById(ONBOARDING_FIELD_IDS[field])`. The `nonce` makes repeated failures re-focus. DOM-order `FIELD_ORDER` decides which invalid field is "first".
- **Stale errors:** cleared per field on change (wrapped setters), and on every step change / Back (existing behavior preserved).
- `aria-busy` set on the card while completing.

---

## 12. Navigation, loading, sign out, errors

**12.1 Navigation.** Back disabled on step 1 and while saving; the primary CTA disabled while saving. Both preserve entered data (state lives in the hook — unchanged). The primary action is visually dominant (gradient, `w-full sm:w-auto`); Back is a quiet outline. While saving the CTA shows `Loader2` + "Setting up your workspace…".

**12.2 Double submission.** Button `disabled={saving}` **plus** a new `savingRef` re-entrancy guard at the top of `finish()` (`if (savingRef.current) return;`), released in the same `finally` as `setSaving(false)`. Purely additive.

**12.3 Loading state.** `OnboardingLoadingState` replaces both unlabeled spinners (the page-level `!user || !profile` branch and the route gate's `isLoading` branch): black page, dark card, logo, spinner, and `role="status"` text "Preparing your workspace…".

**12.4 Errors.** Sonner is retained for completion errors (the existing repository pattern), and the same message is mirrored into the card's live region so it survives the toast's timeout. A new `describeCompletionError(err)` maps: our own claims-not-ready message → passed through verbatim (it is our copy and the documented recovery path, now paired with a working **Sign out**); everything else → "We couldn't finish setup. Please check your connection and try again." `console.error(err)` keeps the full detail for debugging. This closes the brief's "do not expose Supabase internals / raw database responses" requirement — today's `toast.error(err.message)` can print PostgREST text verbatim. The non-fatal org/branding `toast.message` copy is unchanged.

**12.5 Sign out.** A ghost button in the card header using `useAuth().logout` **only** (no second `supabase.auth.signOut()` anywhere), `disabled={saving}`, wrapped in try/catch with a generic failure toast. No navigation call is needed — `logout()` clears the session and the existing route gate renders `<Navigate to="/login" replace />`. No token, JWT claim, or technical account detail is displayed.

---

## 13. Test plan

All new files use `fireEvent` (the repo has no `user-event` dependency) and mock `@/contexts/AuthContext`, `@/integrations/supabase/client`, `sonner`, and `react-router-dom`'s `useNavigate` — the pattern already used by `signupPage.test.tsx`. jsdom polyfills (`ResizeObserver`, `scrollIntoView`, pointer capture) live in a shared **non-test** helper `src/pages/__tests__/onboardingTestUtils.tsx`, so `src/test/setup.ts` stays untouched and no other suite is affected.

| File | Coverage |
|---|---|
| `src/pages/__tests__/onboardingFounderFlow.test.tsx` | Founder sees **Agency** as step 3 · CTA reads **"Complete setup"** · **no personal timezone on step 2** · **agency timezone on step 3** · completion sends the **same** agency timezone to both the `profiles` patch and the `company_settings` upsert · agency name required (blocks completion, no Supabase write) · team-size options persist `solo`/`small`/`large` · the `large` card **displays "11+ producers"** · `organizations` UPDATE + `company_settings` upsert payloads match §4 #9 field-for-field · `team_size_intent` written for founders · final `navigate("/dashboard", {replace:true})`. |
| `src/pages/__tests__/onboardingInviteFlow.test.tsx` | Invitee sees **Workspace** as step 3 · CTA reads **"Enter AgentFlow"** · personal timezone **shown** on step 2 · that timezone reaches `profiles.timezone` · agency / role / upline render · upline row absent when `upline_id` is null · **no** `organizations` / `company_settings` write · **no** `team_size_intent`. |
| `src/pages/__tests__/onboardingWizardBehavior.test.tsx` | Step-1 validation blocks Continue (all four fields) · optional step-2 fields never block · Back → Continue preserves entered values · **the first invalid field receives focus** (and re-focuses on a second failed submit) · `aria-invalid` / `aria-describedby` / stable error ids · live-region message on failed Continue · Back disabled on step 1 · saving disables both buttons and a second click cannot submit twice · **Sign out calls `useAuth().logout`** and is disabled while saving · the loading state exposes `role="status"` with visible text · name fields carry the mobile-stacking classes (`grid-cols-1 sm:grid-cols-2`). |
| `src/components/onboarding/__tests__/licensedStatesMultiSelect.test.tsx` | Search filters by state name · **Select all** selects 50 · **Clear** empties · summary strings for 0 / 1 / 5 / all · `onChange` emits a `string[]` of full state names (payload unchanged) · toggling keeps the popover open · trigger is `role="combobox"` with `aria-expanded`. |
| `src/components/onboarding/__tests__/onboardingStepper.test.tsx` | Three steps with numbers **and** labels · `aria-current="step"` on exactly one · visited steps marked "visited" (never "completed", no check glyph) · the third label switches Agency ↔ Workspace. |
| `src/lib/__tests__/onboardingValidation.test.ts` | Schema units: required set per step, phone ≥ 10 digits, trimming, error-key stability, `FIELD_ORDER` first-invalid selection, and `describeCompletionError` (our claims message passes through; Supabase/PostgREST text never reaches the user). |
| `src/lib/__tests__/onboardingGating.test.ts` | Route-gating regression: the `needsAppOnboardingWizard` truth table (unconfirmed email, missing flag, already completed) and `resolvePostAuthPath` → `/onboarding` vs `/dashboard`. Pure functions; asserts the gate contract this redesign must not move. |

**Test hygiene:** no real Supabase call, no credential, no mock data on a production path. Expected total ≈ **532 + ~55 new**, with all 532 existing tests still passing.

---

## 14. Verification (after approval)

1. `npx tsc --noEmit`
2. `npx vitest run src/pages/__tests__/onboarding*.test.tsx src/components/onboarding src/lib/__tests__/onboarding*` (targeted)
3. `npx vitest run` (full suite — ≥ 532 passing, zero regressions)
4. `npx eslint <every touched source and test file>` — 0 errors
5. `git diff --check`
6. Diff audit: no `supabase/`, no `package.json` / lockfile, no `src/components/auth/**`, no inline `style={{…}}`, no CSS-in-JS, no animation utility beyond `animate-spin`.
7. **Browser** on the local Vite dev server with controlled founder and invited auth states at **1440×900, 1280×720, 1024×768, 768×1024, 390×844, 320×568**: no horizontal scroll (`scrollWidth === innerWidth`), black page **and** black body at every viewport, no white overscroll gap, every field and action reachable on short screens, names stacked on mobile, stepper labels readable at 320, the licensed-states popover fully inside the viewport, keyboard-only traversal of all three steps, focus landing on the first invalid field, Back/Continue preserving data, saving unable to submit twice, founders seeing exactly one timezone control (step 3) and invitees exactly one (step 2), completion payloads unchanged, `/login` `/signup` `/forgot-password` `/reset-password` visually and behaviorally unchanged, zero console errors, and `document.getAnimations()` at idle = 0.

---

## 15. Backend / infrastructure confirmation

**Confirmed by inspection — none of the following is required, and none will be performed:**

| Area | Required? | Why |
|---|---|---|
| Supabase migration / schema | **No** | Every field the wizard writes already exists (`profiles.*`, `organizations.name`, `company_settings.*`); no column is added, renamed, or reinterpreted. |
| RLS / policies / RPC | **No** | Same tables, same rows, same org scoping, same authenticated identity. The P0 profile guard (invariant #20) is unaffected — no protected column is in the patch. |
| Edge Function | **No** | The wizard calls none; `create-user` already stamped the metadata this flow reads. |
| Supabase Auth settings / templates / SMTP | **No** | — |
| Environment variables | **No** | — |
| New npm package | **No** | Popover, cmdk, Zod, Radix radio/select and Lucide are all existing dependencies. |
| Vercel / deployment | **No** | Nothing is deployed by this task. |
| Push to `main` | **No** | Work stays on `claude/onboarding-focused-console-y3177z`. |

If implementation surfaces anything that would genuinely need backend work, I will **stop and report the confirmed blocker** rather than expand scope.

---

## 16. Decisions for Chris (defaults noted — say the word to flip any of them)

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Resident-state label: "Resident state" vs "Resident license state". Every other surface in the app (Settings → My Profile, User Management, AgentModal, ProfileSetupModal) says **"Resident State"**, and `profiles.resident_state` is a distinct field from `licensed_states`. | **Keep "Resident state"** for cross-app consistency, with helper copy "Your home state — you can add every state you're licensed in on the next step." |
| **D2** | Time estimate under the stepper. | Show `Step {n} of 3`, appending **"· About 2 minutes"** on step 1 only. Drop the estimate entirely if you'd rather claim nothing. |
| **D3** | `App.tsx` already has a local component literally named `OnboardingShell` (the route gate); the new visual shell wants that name. | Rename the route gate to `OnboardingRouteGate` (2 lines, zero behavior change) and give the visual component the brief's `OnboardingShell` name. Alternative: leave `App.tsx` alone and call the visual one `OnboardingCardShell`. |
| **D4** | Sanitize completion error text (§12.4) — today `toast.error(err.message)` can print raw Supabase/PostgREST text. | **Sanitize.** Required by the brief's "do not expose Supabase internals / raw database responses"; our own claims-not-ready message still passes through verbatim. |
| **D5** | `orgName` fallback: the hook currently stores the literal `"Your agency"`, which would render as "You're joining **Your agency**". | Hook stores the resolved name (possibly `""`); the view applies "your agency" (heading) / "Your agency" (summary row). Display-only, no contract change. |
| **D6** | Selected-state chips under the licensed-states trigger. | Up to 6 chips + `+n more`, non-interactive. Say the word for summary-only. |

---

## 17. Risks & rollback

- **Radix / cmdk in jsdom** is the main test risk (portals + pointer capture). Mitigated by the polyfill helper and by keeping selection/summary logic in the pure `licensedStates.ts` module, which is testable with no DOM. If a popover interaction proves untestable in jsdom, that assertion moves to the pure helper and is covered live in the browser sweep — and the handoff will say so explicitly rather than quietly dropping it.
- **Theme leakage:** shadcn primitives inside the card resolve light tokens unless `.dark` is scoped on the shell. Handled the same way `AuthShell` handles it, and asserted by test.
- **Rollback:** frontend-only, single branch, no migration, no deploy — `git revert` of one commit fully restores the current wizard.

## 18. Out of scope

`ProfileSetupModal` (the separate post-onboarding profile nudge), Settings → My Profile, the welcome-email trigger, `create-user`, invitation acceptance, the auth pages, the dialer/telephony, and the standing infrastructure follow-up on the secondary Vercel project.
