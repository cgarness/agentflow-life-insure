# Implementation Plan — Invited Step 3 shows the agency name only (owner suffix stripped, display-only)

**Status:** **IMPLEMENTED on branch `bugfix/onboarding-invite-agency-display-name`** — Chris approved the plan with the ASCII-`" - "`-only refinement on 2026-08-04; implemented, verified, and pushed. NOT merged, NOT deployed. As-built note: the founder regression tests live in `onboardingInviteFlow.test.tsx` (the approved file) — `onboardingWizardBehavior.test.tsx` is untouched and its existing branding-first pin stays green. See the matching `WORK_LOG.md` entry for verification figures.
**Date:** 2026-08-04
**Baseline:** `origin/main` = **`59fb51226ec6fbc0fe9652494b89075641f860ae`** (merge of PR #345, the Step 3 confirmation bugfix — merged 2026-08-04 16:11Z). Newest `WORK_LOG.md` entry is that bugfix's record; no conflicting in-flight work.
**Branch plan:** cut **`bugfix/onboarding-invite-agency-display-name`** from `origin/main`. Pre-existing dirty files excluded from every commit, as always: `deno.lock`, `.claude/`, `.cursor/`, `tsconfig*.tsbuildinfo`.

> Supersedes the Step 3 confirmation plan (shipped as PR #345, merged as `59fb512`; durable record in the 2026-08-04 `WORK_LOG.md` BUGFIX entry and git history).

---

## 1. Current behavior and why a normalization is needed

PR #345 made invited Step 3 display trimmed `organizations.name` first. Chris's org row is literally named **`Family First Life - Chris Garness`**, so the heading reads "You're joining Family First Life - Chris Garness" and the Agency field repeats it. Chris wants the agency-only name: **"Family First Life"**.

**No better existing source exists (checked per the task):** `organizations` has only `name`, `slug` (URL identifier), `logo_url`, and status/Twilio columns — no short/display name field. `company_settings.company_name` is the branding value (`"AgentFlow"` here) that PR #345 deliberately demoted. Conclusion: a **small, explicit, display-only normalization** of the invited display string is the right tool. The DB rows are untouched.

## 2. Design

### 2.1 The helper — pure, exported from `src/hooks/useOnboardingPageFlow.ts`

**Chris's decision (2026-08-04): ASCII `" - "` only — the narrower alternative. En dash, em dash, spaceless hyphens, and every other punctuation form remain UNTOUCHED.**

```ts
/** Owner suffixes like " - Chris Garness" are display noise on the invited
 *  confirmation. Recognizes ONLY the exact ASCII " - " delimiter (space,
 *  hyphen, space), strips ONE trailing segment at its FINAL occurrence, and
 *  never turns a non-empty name into an empty one. Display-only — the stored
 *  organizations.name is never modified. */
export function agencyOnlyDisplayName(raw: string): string {
  const trimmed = raw.trim();
  const cut = trimmed.lastIndexOf(" - ");
  if (cut === -1) return trimmed;
  const agency = trimmed.slice(0, cut).trim();
  return agency || trimmed;
}
```

Behavior (as approved):
- Exact delimiter `" - "` (ASCII hyphen with one space each side). `"A-1 Insurance"`, `"Smith-Jones Agency"`, `"Family First Life–Chris Garness"`, `"Family First Life – Chris Garness"` (en), `"Family First Life — Chris Garness"` (em) are all untouched.
- **Final** occurrence only: `"Family First Life - Chris Garness"` → `"Family First Life"`; `"Agency - Division - Owner"` → `"Agency - Division"`.
- Trims the source and the returned agency portion; blank in → blank out (view's `your agency` fallback preserved); a non-empty source can never normalize to empty (`" - Chris Garness"` → the trimmed original, since post-trim it has no `" - "` match / an empty prefix falls back).

### 2.2 Application point — the hook's invited display value ONLY

In the organization effect, the invited display value gets normalized at the moment it is stored:

```ts
setOrgName(agencyOnlyDisplayName(orgRecordName || brandingName));
```

- `orgName`'s **only** consumer is the invited Step 3 (`OnboardingPage` → `OnboardingStepAgency mode="invite"` → `OnboardingStepWorkspace` heading + Agency `<dd>`), so both required surfaces change together and **no other app surface is affected**.
- The **founder editable prefill keeps the raw value** (`brandingName || orgRecordName`, unchanged) — a founder must see and edit their real stored name.
- The raw resolved string remains available inside the effect (per the task's "raw remains available internally"); nothing persisted changes. The empty→`your agency` fallback still works (helper never manufactures emptiness).
- `OnboardingStepWorkspace.tsx` needs **no edit** (it renders whatever `orgName` it receives) — the helper lives in the hook file rather than the component file to respect the repo's `react-refresh/only-export-components` convention on component modules.

### 2.3 Deliberately NOT changed

Completion logic, founder prefill/behavior, the PR #344 licensed-state adapter/persistence, the PR #345 summary layout and copy, `organizations.name` / `company_settings` rows, Supabase, RLS, migrations, Edge Functions, dependencies, `src/components/auth/**`.

## 3. Files to touch (complete list)

| File | Action |
|---|---|
| `src/hooks/useOnboardingPageFlow.ts` | EDIT — add exported `agencyOnlyDisplayName`, apply to the invited display value only |
| `src/pages/__tests__/onboardingInviteFlow.test.tsx` | EDIT — new production-case tests; update assertions/fixtures that currently pin the owner-suffixed display (§4) |
| `implementation_plan.md`, `WORK_LOG.md` | EDIT — this plan; newest-first log entry |

`OnboardingStepWorkspace.tsx` (listed as "likely"): inspected, **no edit needed**. No new file.

## 4. Test plan (per the approved ASCII-only rule)

New/updated in `onboardingInviteFlow.test.tsx`:
1. **Production case (fail-first):** `organizationName = "Family First Life - Chris Garness"` (branding `"AgentFlow"`) → heading exactly `You're joining Family First Life`, Agency `<dd>` exactly `Family First Life`. Assertions are **scoped to the heading and the Agency dd** — "Chris Garness" may legitimately appear in the Upline row (the complete-summary test proves exactly that combination: stripped Agency + `Upline: Chris Garness`).
2. **Helper unit rows** (imported from the hook file): production case; `"Agency - Division - Owner"` → `"Agency - Division"` (final occurrence); `"A-1 Insurance"` / `"Smith-Jones Agency"` / spaceless `"Family First Life–Chris Garness"` untouched; **en dash and em dash untouched** (explicitly outside the rule); `"Family First Life"` untouched; `""` → `""`; `" - Chris Garness"` → non-empty preserved value.
3. **Updated existing assertions:** "prefers the organization record over branding" and the complete-summary Agency dd now expect the stripped name. The em-dash fixtures (`"Family First Life — Garness"`) are **kept verbatim and keep asserting the full em-dash string renders** — they now double as UI-level em-dash-preservation coverage. Branding-fallback keeps `"Agency Branding Name"` pass-through; a new case proves a suffixed **company-name fallback** (`org = ""`, company = `"Family First Life - Chris Garness"`) also displays stripped, since the helper applies to the final invited display value.
4. **Founder regression (added in this file — `onboardingWizardBehavior.test.tsx` is outside the approved scope and stays untouched/green):** branding `"Founder Branding Name"` + suffixed org → founder input prefills `"Founder Branding Name"`; branding `""` + suffixed org → founder input prefills the **raw** `"Family First Life - Chris Garness"` (owner suffix NOT stripped from founder data).
5. **Preservation:** copy, role, upline, Your-details values, chips, Back/Enter AgentFlow, completion tests, and all PR #344 licensed-state suites stay green.

## 5. Verification

`npx tsc --noEmit` · targeted onboarding suites · full `npx vitest run` (host TZ + `TZ=UTC`) · ESLint `--max-warnings 0` on touched files · `git diff --check` · scope audit vs `origin/main` · scratchpad browser harness (same mock pattern, production name pair) at **1440×900 / 390×844 / 320×568**: heading + Agency field show `Family First Life`, no overflow, no console errors, no ErrorBoundary. Work log entry + push; PR only when Chris asks.

---

**Approval record:** Chris explicitly approved this plan on 2026-08-04, narrowing D2 to the exact ASCII `" - "` delimiter only (en dash, em dash, spaceless hyphens, and all other punctuation remain untouched). Implementation, verification, and browser-harness results are in `WORK_LOG.md` (2026-08-04 agency-display BUGFIX entry).
