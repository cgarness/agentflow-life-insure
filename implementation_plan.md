# Implementation Plan — BUGFIX: Invited-agent Step 3 shows the wrong agency name + incomplete confirmation summary

**Status:** **IMPLEMENTED on branch `bugfix/onboarding-invite-confirmation-summary`** — Chris approved the plan (including the `onboardingWizardBehavior.test.tsx` addition) on 2026-08-04; implemented, verified, and pushed. NOT merged, NOT deployed. As-built note: `onboardingTestUtils.tsx` needed no change (the existing mock already models both name sources). See the matching `WORK_LOG.md` entry for verification figures.
**Date:** 2026-08-04
**Baseline:** `origin/main` = **`cf7ddda08bfc3cf079cda1d6b3c089c4919d0c1b`** (merge of PR #344, the licensed-states hotfix — merged 2026-08-04). Newest `WORK_LOG.md` entry is that hotfix's record; no conflicting in-flight work.
**Branch plan:** cut **`bugfix/onboarding-invite-confirmation-summary`** from `origin/main`. Pre-existing dirty files excluded from every commit, as always: `deno.lock`, `.claude/`, `.cursor/`, `tsconfig*.tsbuildinfo`.

> Supersedes the licensed-states hotfix plan (shipped as PR #344, merged as `cf7ddda`; durable record in `WORK_LOG.md` 2026-08-03 HOTFIX entry and git history).

---

## 1. Root cause (confirmed in code)

1. **Wrong agency name.** The hook's org-name effect resolves `const name = brandRow?.company_name?.trim() || orgRow?.name || ""` (`useOnboardingPageFlow.ts`, organization effect) — the **branding value outranks the organization record** for everyone. Chris's org has `organizations.name = "Family First Life - Chris Garness"` but `company_settings.company_name = "AgentFlow"`, so invited agents see "You're joining AgentFlow". For invited-agent display, `organizations.name` is the authoritative identity; the branding-first order exists only to prefill the **founder's editable** agency-name field.
2. **Stale copy.** `OnboardingStepWorkspace.tsx:26` hardcodes "You're joining an existing AgentFlow workspace. Confirm the details below and you're in." — redundant with the heading and wrong when the heading names a real agency.
3. **Incomplete confirmation.** The invite Step 3 card shows only Agency/Role/Upline (`OnboardingStepWorkspace.tsx:38-53`). Nothing the agent entered on Steps 1–2 is reviewable, although the CTA implies final confirmation. The wizard state lives in `useOnboardingPageFlow` and is **not** persisted until completion, so the summary must read the live local state — `OnboardingPage.tsx:126-133` currently passes none of it into the invite branch.

## 2. Design

### 2.1 Dual name resolution — `src/hooks/useOnboardingPageFlow.ts` (one effect, one fetch, two orders)

```ts
const orgRecordName = (orgRow?.name ?? "").trim();
const brandingName = (brandRow?.company_name ?? "").trim();
// Invited-agent display: the organization record IS the agency's identity.
setOrgName(orgRecordName || brandingName || "");
// Founder prefill keeps its existing branding-first order (editable field).
const founderPrefill = brandingName || orgRecordName || "";
if (isFounder && founderPrefill) setAgencyNameState(founderPrefill);
```

- Invited display order: `organizations.name` → `company_settings.company_name` → `""` (view renders `your agency` / `Your agency`).
- Founder prefill order **unchanged** (`company_name` → `organizations.name`); the only founder-visible delta is trimming `organizations.name` before use (whitespace-only names no longer count as names — strictly better, matches the invited path).
- No new queries, no refetch, no Supabase mutation, `.maybeSingle()` calls untouched.

### 2.2 Copy — `OnboardingStepWorkspace.tsx`

Subheading becomes exactly: **`Review your details before entering AgentFlow.`** ("You're joining …" stays only in the heading.)

### 2.3 Two-section confirmation — `OnboardingStepWorkspace.tsx` + prop plumbing

`OnboardingStepWorkspace` (invite-only component) gains the live wizard values; `OnboardingStepAgency`'s `InviteProps` widens accordingly; `OnboardingPage` passes them from the hook state (`firstName`, `lastName`, `phone`, `residentState`, `npn`, `licensedStates`, `commissionDigits`, `timezone`). No refetch, no save, founder branch untouched.

Layout (existing Focused Console styling, Tailwind only, semantic `<dl>`/`<dt>`/`<dd>`):

- **Agency details** card (existing card + `<h2>` section label): Agency, Your role, Upline (only when present). Building2 icon retained.
- **Your details** card below (same card treatment, `<h2>` label), `<dl>` in a `grid grid-cols-1 sm:grid-cols-2` with the licensed-states item spanning `sm:col-span-2`:
  | Field | Rendering | Empty fallback |
  |---|---|---|
  | Full name | `[first.trim(), last.trim()].filter(Boolean).join(" ")` | `Not provided` |
  | Phone | `formatPhoneNumber(phone)` from `src/utils/phoneUtils.ts` (no duplicated logic; guard empty) | `Not provided` |
  | Resident state | full state name as selected | `Not provided` |
  | NPN | entered text verbatim | `Not provided` |
  | Licensed states | full-name chips (same chip classes as the Step 2 multi-select), `<ul>`/`<li>` inside the `<dd>`, selection order preserved, wrapping | `None selected` |
  | Commission level | `${digits}%` (state is digits-only, so no `%%`) | `Not provided` |
  | Timezone | current personal timezone | `Not provided` |
- Long values wrap (`break-words` / `min-w-0`); no width increase; no horizontal scroll at 320px; Back / Enter AgentFlow navigation untouched; no Edit button.
- `licensedStates` is already the adapter-normalized `string[]` from PR #344 — objects can never reach these chips; persistence behavior untouched.

### 2.4 Deliberately NOT changed

Founder/invite routing, step count/labels, CTA, completion logic (`finish()` untouched end-to-end), the PR #344 adapter/persistence, auth metadata writes, `savingRef` guard, org/company-settings writes, validation, `src/components/auth/**`, Supabase, dependencies.

## 3. Files to touch (complete list)

| File | Action |
|---|---|
| `src/hooks/useOnboardingPageFlow.ts` | EDIT — dual name resolution in the organization effect (§2.1) |
| `src/components/onboarding/wizard/OnboardingStepWorkspace.tsx` | EDIT — copy + two-section summary + new props (§2.2–2.3) |
| `src/components/onboarding/wizard/OnboardingStepAgency.tsx` | EDIT — widen `InviteProps`, pass through |
| `src/pages/OnboardingPage.tsx` | EDIT — pass live wizard state into the invite branch |
| `src/pages/__tests__/onboardingInviteFlow.test.tsx` | EDIT — name-resolution, copy, and summary tests (§4) |
| `src/pages/__tests__/onboardingWizardBehavior.test.tsx` | EDIT — **one added test** pinning founder branding-first prefill (deviation from the "likely files" list, justified: founder behavior lives in this suite) |
| `src/pages/__tests__/onboardingTestUtils.tsx` | EDIT only if a shared fixture helper is needed; otherwise untouched (the mock already models `organizationName` / `companyName`) |
| `implementation_plan.md`, `WORK_LOG.md` | EDIT — this plan; newest-first log entry |

No other file. No migration, Edge Function, RLS, dependency, Vercel, or production-data change. **Not** solving the name by editing production `company_settings.company_name`.

## 4. Test plan (maps to the 12 requirements)

In `onboardingInviteFlow.test.tsx` (invited agent, object licensed-states fixture retained):
1. **Conflict:** `organizationName = "Family First Life - Chris Garness"`, `companyName = "AgentFlow"` → heading `You're joining Family First Life - Chris Garness`, Agency `<dd>` = the org name; heading is NOT `You're joining AgentFlow`.
2. **Fallback:** org blank + company `"Bright Mutual Brand"` → company name used.
3. **Neutral:** both blank → `your agency` / `Your agency` (existing test, kept green).
4/5. **Copy:** `You're joining an existing AgentFlow workspace.` absent; `Review your details before entering AgentFlow.` present.
6. **Summary values:** dt/dd assertions for Full name, Phone (`(512) 555-0123` from `15125550123`), Resident state, NPN, Commission (`80%`), Timezone, Agency, Your role, Upline.
7. **Live state:** edit first name (Step 1) and NPN + commission (Step 2), reach Step 3 → edited values shown, `updateProfile` **not yet called**.
8. **Fallbacks:** empty NPN / commission → `Not provided`; empty licensed states → `None selected` (phone/name/resident state are validation-required and cannot be empty on Step 3).
9. **Chips:** object payload `[{CA},{TX}]` → California + Texas chips, no `[object Object]`.
11. **Completion unchanged:** existing tests (CTA, no org/company writes, metadata, navigation) stay green.

In `onboardingWizardBehavior.test.tsx`: 10. **Founder prefill order pinned** — `companyName = "Branded Name"`, `organizationName = "Org Row Name"` → founder Step 3 agency input prefills `"Branded Name"` (locks that the invited-order change did not leak into the founder path).

12. **PR #344 suites** (`licensedStatesAdapter`, `onboardingLicensedStates`, `licensedStatesMultiSelect`) must remain green untouched.

## 5. Viewport verification

Same scratchpad-only Vite harness as PR #344 (recreated; mocks return the production conflict pair `organizations.name = "Family First Life - Chris Garness"` / `company_name = "AgentFlow"`; deleted before commit). At 1440×900 / 390×844 / 320×568: real agency name in heading + Agency field, both sections readable, long values and chips wrap, no horizontal scroll, Back/Enter AgentFlow usable, zero console errors, no ErrorBoundary.

## 6. Verification gate

`npx tsc --noEmit` · targeted onboarding suites · full `npx vitest run` (host TZ + `TZ=UTC`) · ESLint on every touched file (`--max-warnings 0`) · `git diff --check` · scope audit vs `origin/main` (zero diffs outside §3).

## 7. Work log & release

Newest-first `WORK_LOG.md` BUGFIX entry (symptom, name-resolution orders, copy change, summary fields, files, tests, viewport results, "Migrations/Supabase/Edge/Vercel: none", blockers). Push branch; PR only when Chris asks; no merge, no deploy.

---

**Approval record:** Chris explicitly approved §2 (resolution orders, layout), the §3 file list, and the `onboardingWizardBehavior.test.tsx` addition on 2026-08-04. Implementation, verification, and browser-harness results are recorded in `WORK_LOG.md` (2026-08-04 BUGFIX entry).
