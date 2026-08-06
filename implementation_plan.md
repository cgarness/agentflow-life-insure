# Implementation Plan — Calendar List tab: exclude dialer-generated callback records

**Status:** **IMPLEMENTED LOCALLY on branch `bugfix/calendar-list-exclude-dialer-callbacks`** (worktree `/Users/chrisgarness/Projects/agentflow-calendar-list-fix`) — Chris approved this plan on 2026-08-06; implemented exactly as documented using only the listed files. NOT committed, NOT pushed, NOT merged, NOT deployed. Fail-first proven: the page test's List-exclusion assertion failed against the unmodified `CalendarPage` at exactly the defect (callback row present in the List table) while the Day-view and no-mutation tests passed; after the fix 15/15 focused · full Vitest **959/959 in 72 files** (944 baseline + 15 new, zero regressions) · `tsc --noEmit` 0 · ESLint clean on all new files (one PRE-EXISTING baseline warning on `CalendarPage.tsx` documented, not introduced) · `npm run build` OK · `git diff --check` clean. As-built delta from plan: post-implementation adversarial review strengthened the tests only (a `Cancelled` runtime fixture for proof 7, and the Day-view test now asserts each title appears exactly twice — Day + Agenda — instead of an unscoped presence check the Agenda alone could satisfy). See the 2026-08-06 `WORK_LOG.md` entry for the full record. Frontend-only; no migration, Edge Function, production SQL, Supabase change, or deployment.
**Date:** 2026-08-06
**Baseline:** `origin/main` = **`4d54d01`** ("fix: smooth leaderboard metric switching (#348)"). Work happens in the dedicated clean worktree **`/Users/chrisgarness/Projects/agentflow-calendar-list-fix`** on new branch **`bugfix/calendar-list-exclude-dialer-callbacks`** (cut from `origin/main`). The in-progress leaderboard worktree (`agentflow-life-insure`, branch `bugfix/leaderboard-metric-switch-rerank`, dirty `deno.lock` + untracked files) is untouched — verified the five Calendar-relevant files are byte-identical between that branch's HEAD and `origin/main`, so inspection findings transfer exactly.
**Conflict check:** newest `WORK_LOG.md` entries (2026-08-05/06) are all leaderboard work — merged to main as #348. Most recent Calendar work is May 2026 (Pass 1a–3). The 2026-08-03 Dashboard dual-source callback contract (AGENT_RULES invariant #22, `src/lib/dashboard-callbacks.ts`) is adjacent but read-path-separate; it is explicitly out of scope and untouched.

> Supersedes the leaderboard metric-switch plan (shipped; durable record in the 2026-08-06 `WORK_LOG.md` entry and git history).

---

## 1. Confirmed root cause

The Calendar page List tab renders **every** row the shared `CalendarContext` fetched from `public.appointments` — and the dialer writes its callback reminders into that same table.

- **Fetch:** [CalendarContext.tsx:121-127](src/contexts/CalendarContext.tsx:121) — `CalendarProvider.fetchAppointments()` selects `*` from `appointments` scoped only by `organization_id` and a ±180-day `start_time` window. No title/notes/type discrimination (correct for a shared provider — Month/Week/Day/Agenda/todayCount all feed from it).
- **Render:** [CalendarPage.tsx:533-575](src/pages/CalendarPage.tsx:533) — the **active inline `renderListView()`** maps the entire `appointments` array ([CalendarPage.tsx:546](src/pages/CalendarPage.tsx:546) `{appointments.map(appt => …)}`) with zero filtering. Mounted at [CalendarPage.tsx:674](src/pages/CalendarPage.tsx:674) (`{currentView === "List" && renderListView()}`).
- **Callback writers into `appointments` (verified, not to be changed):**
  - Main Dialer: [DialerPage.tsx:3457](src/pages/DialerPage.tsx:3457) and [DialerPage.tsx:4031](src/pages/DialerPage.tsx:4031) call `saveAppointment(…)` ([dialer-api.ts:584-620](src/lib/dialer-api.ts:584)) with literal **`title: "Callback"`**.
  - FloatingDialer quick-call: [FloatingDialer.tsx:775-785](src/components/layout/FloatingDialer.tsx:775) inserts **`` title: `Callback: ${first} ${last}` ``**, `type: 'Follow Up'`, `status: 'Scheduled'`, and **`` notes: `Callback scheduled from dialer. Disposition: ${disp.name}` ``**.
- **Unused component confirmed:** `src/components/calendar/ListView.tsx` (181 lines) has **zero importers** (repo-wide grep; the only "ListView" import anywhere is `TemplatesListView` in Settings). It is dead code and will NOT be modified.
- **Production shape (read-only aggregate, previously gathered):** 12 rows in Chris's org within the ±180-day window — 7 appointment-like, 5 callback-like. Matches the reported symptom (List tab ~40% callback noise).

Month/Week/Day/Agenda are day-scoped so callback rows appear there too, but per the approved scope **only the List tab** changes — the other views' behavior is deliberately preserved.

## 2. Exact classification contract

New pure module **`src/lib/calendar/appointmentFilters.ts`** (joins the existing `src/lib/calendar/appointmentTypes.ts`):

```ts
const DIALER_CALLBACK_NOTE_MARKER = "callback scheduled from dialer";

/** Matches the confirmed dialer-callback signatures — and ONLY those. */
export function isDialerCallbackAppointment(appt: {
  title?: string | null;
  notes?: string | null;
}): boolean {
  const title = (appt.title ?? "").trim().toLowerCase();
  if (title === "callback") return true;          // main Dialer literal title
  if (title.startsWith("callback:")) return true; // FloatingDialer template title
  const notes = (appt.notes ?? "").toLowerCase();
  return notes.includes(DIALER_CALLBACK_NOTE_MARKER); // FloatingDialer note marker
}

export function excludeDialerCallbacks<
  T extends { title?: string | null; notes?: string | null }
>(appointments: readonly T[]): T[] {
  return appointments.filter((a) => !isDialerCallbackAppointment(a));
}
```

Contract guarantees:
- **Exclude** iff: trimmed title equals `"Callback"` (case-insensitive) OR trimmed title begins with `"Callback:"` (case-insensitive) OR notes contain `"Callback scheduled from dialer"` (case-insensitive).
- **Never** reads `type` — a legitimate "Follow Up" appointment is retained (spec requirement; also note FloatingDialer callbacks *do* use `type: 'Follow Up'`, but they're caught by title/notes, never by type).
- **Never** reads `status` — historical Completed/Cancelled real appointments retained.
- `"Callback Review Meeting"` etc.: normalized title neither equals `"callback"` nor starts with `"callback:"` → retained unless the note marker matches.
- `.filter()` returns a new array; input (`readonly T[]`) is never mutated. Accepts nullable fields for reuse-safety even though `CalendarAppointment` maps them to non-null strings.

**CalendarPage wiring** (the only consumer):

```ts
const listAppointments = useMemo(() => excludeDialerCallbacks(appointments), [appointments]);
```

`renderListView()` maps `listAppointments` instead of `appointments` — a one-identifier change at [CalendarPage.tsx:546](src/pages/CalendarPage.tsx:546). No other read of `appointments` in the file changes (`renderMonthView` :409, `renderWeekView` :460, `renderDayView` :486, `agendaAppts` memo :577-585 — including the Agenda sidebar that renders beside the List tab — all untouched).

**Why the filter must live in the page, not the context (sweep-verified):** `useCalendar()` has exactly four hook consumers — CalendarPage (full destructure), **[ReminderPopup.tsx:53](src/components/layout/ReminderPopup.tsx:53) (reads the shared `appointments` array to fire pre-appointment reminders — including callback reminders)**, and FullScreenContactView / DialerPage (`addAppointment` only). Filtering the context array would silently kill dialer-callback reminders; filtering a page-local derived array cannot. `todayCount` currently has zero consumers. Every other appointment surface (AppointmentsWidget, GoalProgressWidget, useDashboardStats, DashboardDetailModal, `dashboard-callbacks.ts`, AgentScorecardModal, supabase-users) issues its own direct Supabase query and never touches CalendarContext.

## 3. Complete file list

| File | Action | Nature |
|------|--------|--------|
| `src/lib/calendar/appointmentFilters.ts` | **NEW** | Pure predicate + array helper (~25 lines, strictly typed, no deps) |
| `src/pages/CalendarPage.tsx` | EDIT | +1 import, +1 `useMemo` derivation, `renderListView` maps the derived array (~4 lines) |
| `src/lib/calendar/appointmentFilters.test.ts` | **NEW** | Unit tests for the predicate/helper (side-by-side `*.test.ts`, matching the dominant `src/lib` pattern) |
| `src/pages/__tests__/calendarPageListFilter.test.tsx` | **NEW** | Focused page test proving List-tab-only application (patterned on existing `src/pages/__tests__/*.test.tsx`) |
| `implementation_plan.md` | EDIT | This plan |
| `WORK_LOG.md` | EDIT | Newest-first entry after implementation + verification |

Nothing else. No styling change (existing Tailwind classes untouched), no Zod needed (no form/modal), no data-layer change, no `.maybeSingle()` sites touched (no new singular lookups; existing CalendarPage lookups already use `.maybeSingle()`).

## 4. Test plan

**Unit — `appointmentFilters.test.ts`** (maps 1:1 to the required proofs):
1. Exact `"Callback"` title → excluded.
2. Case/whitespace variants → excluded: `"callback"`, `"CALLBACK"`, `"  Callback  "`, `" CALLBACK "`.
3. `"Callback: Jane Doe"` → excluded (plus case variant `"callback: jane doe"`, and whitespace-padded `"  Callback: Jane Doe"`).
4. Notes containing `"Callback scheduled from dialer. Disposition: Interested"` → excluded regardless of title; case variant of the marker also excluded.
5. Legitimate Follow Up appointment (`type: "Follow Up"`, title `"Policy review with Marcus"`, no marker) → retained.
6. Ordinary appointment, `status: "Scheduled"` → retained.
7. Historical real appointments with `status: "Completed"` and `"Cancelled"` → retained (status never consulted).
8. `"Callback Review Meeting"` → retained; same title WITH marker notes → excluded (marker still wins). Also `"Callbacks"` / `"Call back"` → retained (near-miss titles).
9. No mutation: input array reference unchanged, same length, same element references and order after calling `excludeDialerCallbacks`; returned array is a new reference. Empty/undefined `title`/`notes` handled without throwing.

**Page — `calendarPageListFilter.test.tsx`** (scope proof): mock `useCalendar` with a fixture of mixed rows (real Scheduled, real Follow Up, real Completed, `"Callback"`, `"Callback: Jane Doe"`, marker-notes row); render `CalendarPage` with `?view=List` → the table shows only the real appointments; render with `?view=Day`/`?view=Month` on the fixture date → callback rows still present (Month/Day behavior unchanged). Contexts (`AuthContext`, `useOrganization`, `useAppointmentTypes`, `BrandingContext`, Supabase client, `PermissionGate`) mocked following existing `src/pages/__tests__` patterns.

**Fail-first:** the page test's List-view exclusion assertions must fail against the unmodified `CalendarPage` before the fix is applied (the unit tests target a new file, so fail-first applies at the page level).

**Gates after implementation:** focused suites → `npx tsc --noEmit` → ESLint zero warnings on touched files → full `npx vitest run` (practical: full suite currently 944 tests / ~70 files) → `npm run build` → `git diff --check` → scope audit (`git status` + `git diff --stat` against `4d54d01` must list exactly the §3 files).

## 5. Explicit out-of-scope boundaries (will NOT be touched)

- **Month, Week, Day, Agenda** rendering and data — unchanged (callback rows intentionally still visible there).
- **`CalendarContext`** — the shared `appointments` query, mapping, realtime subscription, and `todayCount` are unchanged (filtering happens only in the page-level derived array; `todayCount` consumers like the sidebar badge keep current behavior).
- **Callback saving** — `dialer-api.ts` (`saveAppointment`), `DialerPage.tsx`, `FloatingDialer.tsx` untouched.
- **Dashboard callback logic** — `dashboard-callbacks.ts` dual-source contract (invariant #22), `CallbacksWidget`, `DashboardDetailModal` untouched.
- **The approved `campaign_leads`/`appointments` callback union**, RLS, Supabase schema, Edge Functions — untouched; no migration, no production SQL, no deployment.
- **`src/components/calendar/ListView.tsx`** — confirmed unmounted dead code; not modified.
- **Leaderboard worktree/branch** (`bugfix/leaderboard-metric-switch-rerank`) — not modified, stashed, or mixed.
- No commit, push, PR, merge, or deploy without Chris's separate explicit approval.

## 6. Verification sweeps (multi-agent, completed pre-approval)

Three independent read-only sweeps plus three adversarial predicate reviewers ran against the clean worktree:

- **Writers sweep (16 `appointments` writers found across src/, Edge Functions, migrations, scripts):** the only writers that *produce* the exclusion signature are the two confirmed dialer callback paths (DialerPage literal `"Callback"` via `saveAppointment`; FloatingDialer `"Callback: …"` + note marker). The note marker `"Callback scheduled from dialer"` is emitted verbatim **only** by FloatingDialer. No DB trigger/RPC inserts appointments; seeds/tests use non-matching titles; Google-sync metadata updates never touch title/notes.
- **Consumers sweep:** exactly **one** consumer is affected by a List-only derived array — the List table at CalendarPage.tsx:546. All other reads (Month/Week/Day/Agenda, ReminderPopup, every Dashboard surface) are untouched. Side effect, accepted: a filtered-out callback row loses its List-row `openEdit` click target but remains fully visible/editable from Month, Week, Day, and Agenda.
- **Adversarial predicate review (3 lenses — spec-compliance, false-positive hunter, false-negative hunter; ~75 executed edge cases):** all three returned **predicate sound, zero spec-vs-predicate divergences**. Notable confirmations: JS `trim()` strips Unicode whitespace (NBSP/tab/newline-padded dialer titles still excluded); `"Callback :"` (space before colon), `"Callbacks"`, `"CallbackReview"`, `"Pre-callback prep"`, `"Client prefers a callback tomorrow"` all retained per spec; `"Callback:"`/`"Callback: "` empty-name template variants excluded; no mutation.

## 7. Risks / notes

- The exclusion is signature-based, not a schema flag — a user who manually titles a real appointment exactly `"Callback"`/`"Callback: …"` (via AppointmentModal free text, retitling an existing appointment, or a **Google Calendar event imported by `google-calendar-inbound-sync` whose summary is `"Callback"`**) would be hidden from the List tab while remaining visible in all other views. Accepted per the confirmed classification contract; a durable `source`/origin column is a separate future project.
- An agent typing the literal phrase "callback scheduled from dialer" into free-text appointment notes would also match the note marker. Vanishingly unlikely; same accepted-contract reasoning.
- Realtime updates flow through the same derived `useMemo`, so a callback inserted mid-session disappears from List automatically; no extra wiring.
- `excludeDialerCallbacks` is written against a minimal structural type so the Dashboard or other surfaces could reuse it later — but no other call site is added now.
