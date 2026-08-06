# Implementation Plan — Remove individual lead raw-Score exposure from user-facing surfaces

**Status:** **IMPLEMENTED LOCALLY on branch `bugfix/hide-lead-score-ui`** (cut from `origin/main` = `2ca129b`, re-verified at cut time). Chris approved this plan on 2026-08-06 with decisions (1) branch from `origin/main`, (2) remove the whole dead `QueuePreviewField` type from `QueuePanel.tsx`, (3) leave the `KanbanCard` `"leadScore" in c` discriminator. NOT committed, NOT pushed, NOT merged, NOT deployed. Fail-first proven; final gates: `tsc` 0 · full vitest **991/991 in 76 files** (959 baseline + 32 new, zero regressions) · TZ=UTC **979 passed / 12 known skips** · TZ=America/Los_Angeles **991/991** · ESLint clean (no new findings) · build OK · `git diff --check` clean.
**Date:** 2026-08-06
**Type:** Frontend-only bugfix (data exposure). **No migration. No Supabase / RLS / Edge Function / Vercel / production-data change.**

### As-built delta from plan

1. **One test file added beyond the planned three** — `src/components/contacts/__tests__/fullScreenContactViewScore.test.tsx` (3 tests). Lead Details is the primary surface in the requirement and the environment has no authenticated session, so a mocked render of the real component proves "no Score in read mode **and** edit mode" with the verbatim migration-default agency layout as the fixture. Fail-first: **2/3 failed** against unmodified source (a `<label>Score</label>` rendered in both modes); the third is a preservation pin that passed pre-fix. No new dependency (`fireEvent`, not `user-event`, which is not installed).
2. Everything else shipped exactly as planned.

> Supersedes the leaderboard metric-switch plan (shipped as PR #348, squash-merged to `origin/main` as `4d54d01`; durable record in the 2026-08-06 `WORK_LOG.md` entry and git history).

---

## 0. Baseline, branch, and conflict check (done first, per AGENT_RULES §8)

| Item | Finding |
|---|---|
| `origin/main` | **`2ca129b`** — `fix(calendar): exclude dialer callbacks from list view (#349)`, on top of `4d54d01` (#348) and `a411892` (#347) |
| Current local branch | `bugfix/leaderboard-metric-switch-rerank` @ `99b2a0f` — **already merged upstream as #348**; the branch is now **stale/behind** `origin/main` by 2 commits |
| Working tree | Clean except pre-existing noise: `deno.lock` (M), `.claude/`, `.cursor/settings.json`, `tsconfig*.tsbuildinfo` (untracked) — excluded from commits as always |
| **Branch plan (needs approval)** | Cut **`bugfix/hide-lead-score-ui`** from **`origin/main` (`2ca129b`)**. Do **not** build on the stale merged branch. |
| WORK_LOG conflict scan (newest 5 entries: 2026-08-06 leaderboard metric switch, 2026-08-05 ×3 leaderboard RPC, 2026-08-04 onboarding) | **No conflict.** Those touch `useLeaderboardData.ts`, `Leaderboard.tsx`, `LeaderboardWidget.tsx`, onboarding hooks/wizard, and `supabase/**`. **Zero** overlap with the contacts/dialer files below. Only shared files are `implementation_plan.md` (superseded, above) and `WORK_LOG.md` (append-only, newest-first). |
| `docs/plan-remove-score-aging-ui.md` (2026-05-16, prior partial cleanup) | Removed Score/Aging from **`Contacts.tsx`** (table columns/sort/cells) and Score+Age from **`ContactManagement.tsx` `STANDARD_FIELDS_LEAD`** — both verified still clean today. It **explicitly deferred** `FullScreenContactView.tsx`, `KanbanCard.tsx`, `contactFieldLayout.ts` as "not in scope", and explicitly left the stale `fieldOrderLead` default keys in place ("harmless stale keys"). **That deferral is exactly the remaining exposure this task closes** — and those stale keys are *not* harmless: they are what still re-exposes Score. |

**Why saved layouts must be sanitized (evidence).** Migration `supabase/migrations/20260326220000_add_field_order_to_settings.sql` sets the column default:
`field_order_lead JSONB DEFAULT '["firstName","lastName","phone","email","state","leadSource","leadScore","age","dateOfBirth","spouseInfo","assignedAgentId","notes"]'`
so **live agency rows and any user layout cloned from them contain `"leadScore"`**. Removing the constant from source is not enough — a stale saved layout would re-render the Score field in Lead Details and in the Dialer lead card. **No migration is permitted here (and none is wanted)**, so the sanitization is a frontend read-path filter.

---

## 1. Full audit of `leadScore` / `lead_score` / raw "Score" in the frontend

### 1a. PRESERVE — data layer, types, imports, queue controls (touch nothing)

| Ref | Why preserved |
|---|---|
| `src/lib/types.ts:92` `Lead.leadScore: number` | Type/data contract |
| `src/lib/supabase-contacts.ts:162,283,395,448` | Row↔model mapping, create/update payloads |
| `src/lib/supabase-leads.ts:42` | Insert default `lead_score: row.leadScore ?? 5` |
| `src/pages/Contacts.tsx:1315` | Create-lead default `?? 5` |
| `src/components/contacts/ImportLeadsModal.tsx:834` | Import default `leadScore: 5` |
| `src/integrations/supabase/types.ts:3507,3531,3555` | Generated DB types |
| `src/hooks/useLeadLock.ts:18-19` `min_score`/`max_score` | Manager queue filters → canonical `get_next_queue_lead` claim RPC (invariant #15) |
| `src/lib/dialer-queue.ts:96,106-107` | Queue filter shape (dead code, deprecation-commented — left alone) |
| `src/components/dialer/QueuePanelLocked.tsx:38-48,100-101,171-172,290-291` | **Manager queue config "Min Score" / "Max Score"** — explicitly out of scope, untouched (incl. its Zod schema) |
| `src/components/dialer/QueuePanel.tsx:15,120` `score_high` / **"Highest Score"** sort option | **Operational queue sort** — explicitly out of scope, untouched |
| `src/pages/DialerPage.tsx:209` `leadScore: row.lead_score ?? 5` | Lead mapping |
| `src/pages/DialerPage.tsx:817,825-826,839-840,1654-1656,1693-1694,4584-4585` | `QueueSortKey.score_high` + the whole `minScore`/`maxScore` **queue filtering**, the `score_high` **sort**, its localStorage persistence, clear-filters, and filter summary |
| `NumberReputation.tsx`, `CarrierReputationPanel.tsx`, `NumberManagementSection.tsx` (`spam_score`, "Score factors") | **Phone/carrier reputation — unrelated system** |
| Leaderboard / `AgentScorecardModal` / `agent_scorecards` | **Agent scorecards — unrelated system** |

Also untouched by design: `FullScreenContactView.handleSave` still round-trips the whole `editForm` (seeded from the contact) to `onUpdate`, so the **existing `lead_score` value is preserved unchanged** on save — the user simply has no control to change it. No queue/telemetry impact.

### 1b. REMOVE — individual raw-score presentation / edit controls

| # | Location | Removal |
|---|---|---|
| 1 | `FullScreenContactView.tsx:1029` | `case 'leadScore': … renderField("Score","leadScore","number")` — the single render/edit site (one `renderField` serves both read and edit mode, so deleting the case removes Score from **both**) |
| 2 | `contactFieldLayout.ts:35` | `"leadScore"` in `getDefaultFieldOrder("lead")` |
| 3 | `contactFieldLayout.ts:89` | `leadScore: { label:"Score", key:"lead_score" }` in the dialer descriptor registry `LEAD_STANDARD` |
| 4 | `contactFieldLayout.ts` `resolveFieldOrder` | **NEW** sanitization of saved user/agency layouts |
| 5 | `KanbanCard.tsx:68-77` | The `Score: {contact.leadScore}` badge |
| 6 | `LeadCardBlurred.tsx:123` (+ doc comment :39) | `<BlurField label="Score" />` placeholder |
| 7 | `DialerPage.tsx:818` | `'score'` in the `QueuePreviewField` union (individual queue-preview field option) |
| 8 | `DialerPage.tsx:1721` | `case 'score': … \`Score ${lead.lead_score}\`` raw formatting |
| 9 | `DialerPage.tsx:1731` | `score: 'Score'` preview label |
| 10 | `DialerPage.tsx:842-847` | Persisted preview prefs read raw from `localStorage` with `JSON.parse` and **no validation** — normalize so a stored `"score"` (or any junk) falls back safely |
| 11 | `QueuePanel.tsx:18-25` | Local `QueuePreviewField` union containing `"score"` — see §2.6 |

---

## 2. Detailed changes

### 2.1 `src/lib/contactFieldLayout.ts` — the single sanitization point

Every layout consumer funnels through this module (`FullScreenContactView` :228/:287/:441, `ContactManagement` FieldLayoutTab :1610-1611, `DialerPage` :700-701), so one filter here covers all three surfaces.

- Delete `"leadScore"` from the `t === "lead"` array in `getDefaultFieldOrder`. **`"age"` and every other lead field stay exactly as-is** (order otherwise byte-identical).
- Delete the `leadScore` entry from `LEAD_STANDARD`. `leadLayoutIdsToDialerDescriptors` already skips ids absent from the registry, so a stale `"leadScore"` id can no longer produce a descriptor — the Dialer lead card cannot render Score. (`LeadCard.fallbackConnectedFields` has no Score either — verified.)
- Add an exported, documented constant and filter:
  ```ts
  /** Internal queue metadata — never rendered as an individual contact field. */
  export const HIDDEN_CONTACT_FIELD_IDS: readonly string[] = ["leadScore"];
  ```
  `resolveFieldOrder` sanitizes **both** the user layout and the agency layout before returning, and a layout that sanitizes to empty falls through to the next source (user → agency → system default) instead of rendering an empty field list. Relative order of surviving ids is preserved. No other behavior changes.

**Not needed (verified):** `ContactManagement.tsx` needs no edit — its `STANDARD_FIELDS_LEAD` already has no `leadScore` (2026-05-16 cleanup) and `FieldLayoutTab` intersects the resolved order with that list, so the Field Layout tab already cannot list or re-save Score; with §2.1 it also stops receiving it. `ContactFieldLayoutSchema` (Zod) is unchanged — it validates shape, and sanitization is a read-path concern.

### 2.2 `src/components/contacts/FullScreenContactView.tsx`

Delete the one `case 'leadScore'` line. Nothing else: no import becomes unused (`renderField` and every other case remain). Read mode and edit mode both lose Score because both are rendered by `renderField`.

### 2.3 `src/components/contacts/KanbanCard.tsx`

Delete the `isLead(contact) && (<span … >Score: {contact.leadScore}</span>)` block (lines 68-77).
Cleanup audit: `cn` stays used (line 204), `isLead` stays used (line 129, lead-source footer branch). **Decision:** keep the `isLead` guard's structural discriminator `"leadScore" in c` unchanged — it is a type-narrowing shape check, not a score display, and swapping the discriminator would be a gratuitous behavior risk on the kanban's lead/recruit branch. Documented so a future audit doesn't read it as leftover exposure.

### 2.4 `src/components/dialer/LeadCardBlurred.tsx`

Delete `<BlurField label="Score" />` and drop "score" from the component doc comment's sensitive-field list. The remaining six blur placeholders and every visible field are unchanged.

### 2.5 `src/pages/DialerPage.tsx` + NEW `src/lib/dialer-queue-preview.ts`

`DialerPage.tsx` is a documented >200-line exception (AGENT_RULES §7: "Do not add features inline"), and the persisted-preference normalizer must be unit-testable, so the preview-field vocabulary moves to a tiny pure module:

**NEW `src/lib/dialer-queue-preview.ts`** (no `any`, no React, no I/O):
- `export type QueuePreviewField = 'age' | 'state' | 'source' | 'attempts' | 'status' | 'best_time'` — **`'score'` removed**
- `QUEUE_PREVIEW_FIELDS` (allowed list), `DEFAULT_QUEUE_PREVIEW_FIELDS = ['state','attempts']`, `QUEUE_PREVIEW_FIELD_LABELS` (no `score` entry)
- `normalizeQueuePreviewFields(raw: unknown): [QueuePreviewField, QueuePreviewField]` — **per-slot** validation: a slot holding `"score"`, an unknown string, a non-string, or a missing entry falls back to that slot's default; a non-array input returns the default pair. So `["score","status"] → ["state","status"]` (the user's other choice is kept) and `["score","score"] → ["state","attempts"]`.

**`DialerPage.tsx`:**
- import the type + `normalizeQueuePreviewFields`; delete the local `QueuePreviewField` alias (line 818) and the local `PREVIEW_FIELD_LABELS` const (1730-1733), importing `QUEUE_PREVIEW_FIELD_LABELS` instead.
- the `queuePreviewFields` initializer runs the parsed value through `normalizeQueuePreviewFields` inside the existing try/catch (a corrupt/absent key still yields the default).
- delete `case 'score'` from `renderQueuePreviewValue` (its `default: return '—'` already covers any unknown key belt-and-braces).
- **`QueueSortKey` keeps `score_high`; the `score_high` sort branch, the `minScore`/`maxScore` filter, its persistence, clear-filters and filter summary are untouched.**

Honest note carried into the WORK_LOG: `renderQueuePreviewValue`, `PREVIEW_FIELD_LABELS`, `setQueuePreviewFields` and `showQueueFieldPicker` are **currently unreferenced by the rendered `queuePanelProps`** (the field-picker UI is not wired up today). The removals above are still required — the persisted preference and the option vocabulary are live — but no visible Dialer control changes. This is reported, not silently assumed.

### 2.6 `src/components/dialer/QueuePanel.tsx`

Its local `QueuePreviewField` union (lines 18-25) lists `"score"` and is **confirmed dead** (not exported, zero references — grep-verified). Removing the dead declaration eliminates the last stale "score" preview-option reference. **`QueueSortKey.score_high` and the `{ value: "score_high", label: "Highest Score" }` sort option are explicitly preserved.**
*If you prefer zero dead-code churn, say so and I will instead delete only the `"score"` member and leave the dead type in place.*

---

## 3. Tests (targeted, added/updated)

| File | Pins |
|---|---|
| **NEW** `src/lib/__tests__/contactFieldLayout.test.ts` | (a) `getDefaultFieldOrder("lead")` **excludes** `leadScore` and **still includes** `age` + all other lead fields in order; client/recruit defaults unchanged. (b) **Saved-layout sanitization**: a user layout and an agency layout containing `leadScore` — including the **verbatim `20260326220000` JSONB default array** — resolve without it, with the remaining order preserved. (c) A layout that is only `["leadScore"]` falls through user → agency → system default (never an empty field list). (d) **Dialer descriptors cannot expose leadScore**: `leadLayoutIdsToDialerDescriptors` given ids containing `leadScore` (and the raw migration default) emits **no** descriptor with label `"Score"` or key `"lead_score"`, while `age`/`firstName`/`custom:` ids still map. |
| **NEW** `src/lib/__tests__/dialerQueuePreview.test.ts` | `'score'` is absent from `QUEUE_PREVIEW_FIELDS` and the label map; `normalizeQueuePreviewFields` maps `["score","attempts"] → ["state","attempts"]`, `["state","score"] → ["state","attempts"]`, `["score","score"] → ["state","attempts"]`, `["score","status"] → ["state","status"]`; valid pairs pass through unchanged; `null` / `undefined` / `{}` / `[]` / `["bogus",42]` → the default pair. |
| **NEW** `src/components/contacts/__tests__/kanbanCardScore.test.tsx` | Renders `KanbanCardBody` (the sortable-free presentational export — no DnD context needed) with a lead whose `leadScore` is `9`: **no `/score/i` text and no `9` badge**, while name, state, email, phone, lead-source and the assigned-agent initials still render. Also asserts a recruit renders unchanged. |
| Existing suites | `ContactKanbanBoard.test.tsx`, `ContactKanbanBoardConvert.test.tsx`, `contactsKanban`, `contactsRender`, `contactsDisplay`, `contactsFilterContract`, `contactsSort` must stay green **unchanged**. Grep confirms **no existing test asserts a visible Score**, so nothing needs weakening. |

Fail-first discipline: each new assertion is run against unmodified source first and the failures recorded in the WORK_LOG.

---

## 4. Complete list of files I intend to modify

| # | File | Action |
|---|---|---|
| 1 | `src/lib/contactFieldLayout.ts` | EDIT — drop `leadScore` from default lead order + `LEAD_STANDARD`; add `HIDDEN_CONTACT_FIELD_IDS` + sanitization in `resolveFieldOrder` |
| 2 | `src/components/contacts/FullScreenContactView.tsx` | EDIT — delete `case 'leadScore'` (read **and** edit mode) |
| 3 | `src/components/contacts/KanbanCard.tsx` | EDIT — delete the `Score: N` badge |
| 4 | `src/components/dialer/LeadCardBlurred.tsx` | EDIT — delete the Score blur placeholder + doc-comment mention |
| 5 | `src/pages/DialerPage.tsx` | EDIT — drop `'score'` preview option / `case 'score'` formatter / `score` label; normalize persisted preview prefs |
| 6 | `src/lib/dialer-queue-preview.ts` | **NEW** — preview-field vocabulary + `normalizeQueuePreviewFields` |
| 7 | `src/components/dialer/QueuePanel.tsx` | EDIT — remove the dead `QueuePreviewField` union (`score_high` / "Highest Score" preserved) |
| 8 | `src/lib/__tests__/contactFieldLayout.test.ts` | **NEW** |
| 9 | `src/lib/__tests__/dialerQueuePreview.test.ts` | **NEW** |
| 10 | `src/components/contacts/__tests__/kanbanCardScore.test.tsx` | **NEW** |
| 11 | `implementation_plan.md` | EDIT — this plan (+ as-built delta at handoff) |
| 12 | `WORK_LOG.md` | EDIT — newest-first entry |

**Nothing else.** No `supabase/**` file, **no migration**, no RPC/RLS/grant, no Edge Function, no `types.ts`, no `AGENT_RULES.md` change (no new invariant discovered), no dependency, no telephony/telemetry/queue-claim code, no mock data, Tailwind only, no new `any`.

---

## 5. Verification gates

1. `npx tsc --noEmit` (exit 0).
2. Targeted: `npx vitest run` on the 3 new suites + the contacts kanban/render/display/filter/sort suites.
3. Full `npx vitest run` (host TZ) — expect the current baseline **944** + the new tests, **zero regressions**; plus `TZ=UTC` (known `laOnly` DST skips) and `TZ=America/Los_Angeles`.
4. ESLint `--max-warnings 0` on every touched file; `npm run build`; `git diff --check`; scope audit vs `origin/main`.
5. **Manual UI:** Lead Details **read** mode and **edit** mode (no Score anywhere), Contacts **Kanban** cards, Dialer lead display (ringing blurred view + connected view), and — as the preservation check — **QueuePanelLocked Min/Max Score**, the **"Highest Score"** sort, queue claiming, and queue ordering all still present and functional. *Known standing limitation (recorded in prior entries): this environment has no authenticated production session (placeholder credentials land on `/login`). I will drive what I can via the local dev server and, where auth blocks a surface, use a scratchpad-only render harness (deleted before handoff) exactly as in the 2026-08-03/04 builds — and I will state plainly which surfaces were verified live vs. by harness vs. by test/code only.*
6. `WORK_LOG.md` entry (changes, files, verification, migrations/deploys, blockers, next steps) + a closing context snapshot.

**Not doing without separate approval:** commit, push, PR, merge, deploy, any Supabase/MCP write, any `main` push.

---

## 6. Risks / decisions for Chris

1. **Branch:** current branch is stale (its commit is already merged as #348). I plan to cut `bugfix/hide-lead-score-ui` from `origin/main` (`2ca129b`). Confirm.
2. **Sanitization is read-path only** (no migration). The DB default and existing rows keep the stale `"leadScore"` key; it is filtered on read everywhere. A future cleanup migration would be a separate, approved task.
3. **`QueuePanel.tsx` dead-type removal** (§2.6) is the only change slightly beyond the five named files — say the word and I will trim it to the `"score"` member only, or skip it.
4. **`"leadScore" in c`** stays as KanbanCard's structural type guard (§2.3) — intentional, documented.
