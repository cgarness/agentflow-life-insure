# Implementation Plan — Appointment ownership + reminders BUGFIX, and a compact contact Follow-ups card (rev 1 — PLAN ONLY)

> **STATUS (rev 1, 2026-09-28): PLAN ONLY — awaiting Chris's explicit approval.**
> - **No application file has been edited.** No migration, RPC, RLS, grant, Edge Function, deploy, merge, push to `main`,
>   or production write has happened or is proposed. The only production access was **read-only**: catalog queries
>   (`pg_policies`, `pg_publication_tables`, `TimeZone`) and **aggregate counts** on `appointments` / `tasks` /
>   `campaign_leads` / `calendar_integrations` (no row data, no PII) — see §2.4.
> - Needs Chris's approval of this plan **and** of decisions **D-1 … D-23** (§10) before any `src/` edit.
> - Reports / Analytics is being changed by another session. **No Reports/Analytics file is touched** (§1.3).
>
> **Repository:** `cgarness/agentflow-life-insure` · branch **`claude/contact-followups-appointment-fix-rruo7i`**
> (session-mandated; see D-14 for the proposed `fix/contact-followups-reminders-20260927` name) · base `origin/main`
> @ **`5d37e5f`** (2026-09-26, PR #392).
> - **Plan location:** this file, `docs/plans/2026-09-28-contact-followups/implementation_plan.md`. The root
>   `implementation_plan.md` keeps its existing content byte-for-byte and gains only a short **§17 pointer** appended
>   at the end. This follows the Reports session's pattern (its §16 pointer + `docs/plans/2026-09-28-reports-analytics/`),
>   so neither session overwrites the other's record or the leaderboard history.

---

## §0. TL;DR

**Bug 1 — an explicitly chosen appointment assignee is silently overwritten. Confirmed, and worse than reported.**
It happens on **three** save paths, not two, and editing is affected as well as creating:

| # | Where (current `main`) | What it does |
|---|---|---|
| B | `src/pages/CalendarPage.tsx:254-267` | Builds one payload with `user_id: user.id` **and** `created_by: user.id`, ignoring the modal's `data.user_id`, and sends it to **both** insert (`:295`) and update (`:272`). Every edit therefore reassigns the appointment to the editor **and** rewrites `created_by` to the editor. |
| C | `src/contexts/CalendarContext.tsx:170` | `insert([{ ...a, user_id: user.id, organization_id }])` — `user_id` written after the spread overrides any caller value. |
| C′ | `src/components/contacts/FullScreenContactView.tsx:1469-1484` (**not in the brief**) | The contact page's **Schedule** button inserts directly with `user_id: user.id, created_by: user.id` (ignoring the picked assignee and status), then calls un-awaited `addAppointment(data)` with the modal's camelCase object — a second insert that fails at PostgREST (unhandled rejection, documented in `WORK_LOG.md:3791`). |

`AppointmentModal` itself is correct (`user_id: assignedAgentId || user?.id`, `:345`). This exact bug was fixed on
2026-04-28 (`WORK_LOG.md:11368`) and **regressed** on 2026-05-24 (Calendar Pass 1b, `WORK_LOG.md:8136`), because no
test pinned the payload. Production today has **0** rows where `user_id ≠ created_by`: no cross-assignment has ever
persisted.

**Reminders.** `ReminderPopup` is the only reminder in the system. Its recipient rule
`appt.user_id === user.id` (`ReminderPopup.tsx:99`) is already the right rule for rows whose `user_id` is set.
D-1 extends it with invariant #22's fallback for NULL-`user_id` rows. But:
- it has **no status filter**, so Cancelled, Completed and No Show appointments still pop up;
- rows the FloatingDialer quick-call writes (`user_id` NULL, `created_by` set) never remind;
- `appointments` is **not** in the `supabase_realtime` publication (verified live), so an assignee only sees an
  appointment someone else booked for them after a refetch. A reload or a visit to `/calendar` triggers one; nothing
  else does.

**Fix (frontend only, no DB/RLS change needed — verified live).**
1. One small pure ownership module is used by every writer. On insert: `user_id` = the explicit assignee, else the
   current user, and `created_by` = the authenticated creator. On edit, `created_by` and `organization_id` are never
   rewritten.
2. A pure reminder-eligibility function: the responsible user only, and only while the appointment is Scheduled or
   Confirmed.
3. A bounded, visible-tab-only refresh so assignees actually receive reminders for appointments booked by someone else
   (D-3).
4. A guard so CalendarPage never pushes someone else's appointment into the creator's Google Calendar. Without it,
   the scheduled inbound Google sync would re-import that event as a duplicate owned by the creator, which would then
   remind the creator (§2.3, D-4).

**Follow-ups card.** One compact card is stacked above the existing right-hand panel of `FullScreenContactView`. It
shows the next open follow-up, "N other follow-ups · M overdue", and a **View all** dialog grouped into Overdue and
Upcoming. A typed normalization layer merges three sources for **this contact only**:
- `appointments` (callback-type rows are shown as **Callback**);
- `campaign_leads` callbacks (leads only; `callback_due_at` wins; terminal statuses excluded);
- open `tasks`.

It reuses the exported callback-contract constants with **zero edits** to `dashboard-callbacks.ts`. It fails closed:
if any source fails, it shows "Couldn't load follow-ups", never a partial list.

**Behaviour changes to existing surfaces (all tied to decisions in §10).** No contact-page section moves or is
restyled. With the recommended options, these existing behaviours change:
- **AppointmentModal** (D-16): it closes and toasts only after the parent's save succeeds. The assignee display is
  truthful, and editing a quick-call row keeps its owner.
- **AddTaskModal** (D-15): the picked date is treated as the local calendar date. US users can pick "today", and
  Tasks-tab overdue/today labels become correct for new tasks.
- **CalendarContext.updateAppointment**: an update that RLS silently blocked (0 rows) now shows "Failed to update
  appointment" instead of a false success.
  - Because edits stop rewriting `created_by`, a Team Leader (or an Admin without a role claim) can no longer hand
    off an appointment assigned to them that they did not create. That edit now fails loudly (D-22).
- **ReminderPopup**:
  - Cancelled, Completed and No Show stop reminding (D-2);
  - quick-call callbacks start reminding their creator (D-1);
  - a scheduler stops getting reminders for rows assigned to others;
  - a 5-minute visible-tab refresh is added (D-3).
- **CalendarPage**: a cross-assigned create is not pushed to the creator's Google Calendar (D-4).
- **Card behaviour:**
  - a past non-callback appointment leaves the card once it ends (D-17);
  - the card refetches every 2 minutes while a contact is open and visible (D-18);
  - Group-leaderboard and goal credit follow the assignee for cross-assigned bookings (D-19).

---

## §1. Inputs, isolation, conflicting work

### 1.1 Read before planning
`AGENT_RULES.md` (v5.0.0) — §3 multi-tenancy; invariants **#15** (terminal `campaign_leads` statuses),
**#16** (canonical callback fields), **#19** (JWT-only `get_user_role`), **#22** (dual-source callback contract and the
appointment ownership predicate `(user_id = uid) OR (user_id IS NULL AND created_by = uid)`), **#23** (leaderboard
attribution `COALESCE(created_by, user_id)`), **#25/#28** (migrations immutable; production read-only by default),
**#31** (View-As identity rules, providers pinned to `realProfile`); §7 component standards; §8 workflow; §9 doc rule.
`VISION.md`. `WORK_LOG.md` (latest entry 2026-09-26 leaderboard payload release; history entries cited above).

### 1.2 Isolation
- This session runs in its **own cloud container with its own clone**, on its own branch. It shares no working
  directory with the Reports session. A nested `git worktree` would add nothing here. If Chris wants one literally,
  it is one command and changes nothing in this plan.
- Base = latest `origin/main` `5d37e5f` (fetched 2026-09-28). The branch carries only local, unpushed plan-document
  commits on top of it.

### 1.3 Parallel Reports / Analytics work
- **No file under Reports/Analytics is modified.** Candidate files were checked for import
  coupling; see the §9 file list, which contains no `Reports*`, `reports/**`, `report-*.ts` or `reports-queries.ts`
  path.
- Metric semantics that Reports may read are **not changed**:
  - leaderboard "Appointments Set" is still attributed by `COALESCE(created_by, user_id)`;
  - Dashboard widgets still read `user_id`.
  After the fix they receive correct values. Cross-assigned bookings then credit the assignee in `user_id`-keyed
  readers and the scheduler in the org leaderboard (§2.5, D-19).
- **Verified state of the Reports session (read-only, 2026-09-28):**
  - It is branch `claude/reports-analytics-overnight-c69826` @ `7434dd59`, one plan-only commit on `5d37e5f`, no
    PR.
  - Its planned file list shares **no** file with this plan. There is **no import edge** in either direction between
    Reports code and any file here.
  - Reports treats `usePermissions`, `permissionDefaults`, `types.ts`, `report-utils.ts` and the Dashboard as frozen.
    This plan imports shared infrastructure (`useOrganization`, `AuthContext`, `BrandingContext`) but modifies none of
    it.
- **No other open PR touches a §9 *code* file:** checked #383, #382, #381, #378 and #294. The shared **docs** rows are
  different: #381 and #383 edit `WORK_LOG.md`, and #378 edits `WORK_LOG.md`, `AGENT_RULES.md` and the root
  `implementation_plan.md`. They are handled under "Shared docs" below.
- `origin/claude/agentflow-leaderboard-recovery-uney6j` shows `dashboard-callbacks.ts` in its diff, but that content is
  byte-identical to `main` (squash-merged as #386), so it is no conflict.
  - Draft PR **#378** rewrites `supabase/functions/google-calendar-*`, `CalendarSettings.tsx`, `AGENT_RULES.md` and
    `WORK_LOG.md`. This plan touches none of its code files, and Google Edge Function work is deferred behind it
    (§14).
- **Shared docs.** These are the only real conflict surface.
  - `implementation_plan.md`: this plan adds a pointer only. It is additive at EOF, so a conflict with Reports' §16
    resolves as "keep both".
  - `WORK_LOG.md`: every branch prepends at line 8. Our entry is written **last**, in its own docs-only commit,
    immediately after `git fetch && git rebase origin/main`, and verified additions-only with
    `git diff origin/main -- WORK_LOG.md | grep -c '^-[^-]'` == 0.
  - `AGENT_RULES.md`: Reports reserves invariant **#38**. Our rule goes in as an **amendment bullet inside #22**,
    where the ownership predicate already lives, so no new invariant number is claimed.
- **Metric effects to tell the Reports session and Chris:**
  - Scheduler-credited counts (org leaderboard, Reports `appointments_set` = `COALESCE(created_by, user_id)`) become
    *more* stable, because edits stop rewriting `created_by`.
  - `user_id`-keyed Dashboard widgets and the Group leaderboard follow the assignee for cross-assigned rows.
  - No Reports file needs to change.

---

## §2. Evidence (current `main` @ `5d37e5f`)

### 2.1 Appointment writers
| Writer | `user_id` | `created_by` | Honors picked assignee? |
|---|---|---|---|
| `AppointmentModal.tsx:338-346` (emits) | `assignedAgentId \|\| user?.id` | — (not emitted) | ✅ emits it |
| `CalendarPage.handleSave` `:254-267` (insert `:295`, update `:272`) | `user.id` | `user.id` (also on **update**) | ❌ |
| `CalendarContext.addAppointment` `:170` | forced `user.id` | not set | ❌ |
| `FullScreenContactView` Schedule `:1469-1481` (+ failing `addAppointment(data)` `:1484`) | `user.id` | `user.id` | ❌ (also ignores `data.status`) |
| `FloatingDialer` quick-call `:730-740` | **NULL** | `user?.id` | n/a (no picker) |
| `dialer-api.saveAppointment` `:606-615` (DialerPage `:3601`, `:3664`) | `agent_id` | **NULL** | n/a (no picker) |
| `DialerPage` `<AppointmentModal>` `:4908-4939` | — | — | **unreachable**: `setShowAppointmentModal(true)` is never called |
| `google-calendar-inbound-sync` (service role) `:316-344` | integration owner | NULL | n/a |

Only `AppointmentModal` offers an assignee picker. Its **live** mount sites are CalendarPage and
FullScreenContactView, so exactly those two save paths plus the context need fixing.

**Modal details:**
- On edit, `assignedAgentId` initialises to `editing.user_id || user?.id` (`:253`). A NULL-`user_id` row (a quick-call
  callback owned via `created_by`) would therefore be silently reassigned to the editor once the save path honors
  the modal.
- The picker lists Active org profiles for Admins, "self + direct reports (`upline_id`)" for Team Leaders, and nothing
  for Agents (read-only own name).
- If the current assignee is not in the list, the `<select>` **displays** the first option while its state keeps the
  real id, so what the user sees is not what gets saved.

### 2.2 Reminders
- The only reminder is the browser-side `ReminderPopup`. There is no server path: `appointment_reminder` is only a
  notification type with no producer, and no Edge Function, email or SMS sends reminders.
  - Live `cron.job` has 9 jobs, and none is a reminder. One is `google-calendar-inbound-sync-every-5m`.
  - The `notifications` table is realtime-published and already allows `appointment_reminder`. A future server-side
    or cross-device reminder would need no schema change.
- **Data source:** `useCalendar().appointments` (`:53`). The CalendarContext fetch is org-scoped over ±180 days
  (`:143-149`), so an Admin's session holds every org row. The `user_id` check at `:99` is the only thing stopping
  org-wide reminders.
- **No status filter anywhere in `:95-120`.** Google's cancelled events (`status: "Cancelled"`) would also pop.
- **Timing:** fires from `start − leadTime` (default 10 min, `user_preferences.settings.agent_reminder_time`) until
  `start + 30 min`. Snooze is 5 minutes. State is an in-memory `useRef` keyed by appointment id.
- **Identity:** uses the real `useAuth().user`. `AppLayout.tsx:65` unmounts it under View As (pinned by
  `viewAsRouteAllowlist.test.tsx`).
- `checkReminders` deps omit `user?.id` (`:128`).
- **Freshness:** `appointments` is **not** in `supabase_realtime` (verified live 2026-09-28). The CalendarContext
  channel filtered `user_id=eq.<me>` (`:227-264`) therefore never fires. The context refreshes only on:
  - provider mount or user/org change;
  - CalendarPage mount, Sync Now, and contact update/delete;
  - its own optimistic writes.

### 2.3 Side effects that shape the fix
1. **Google Calendar duplicate risk (would be introduced by the fix).**
   - Outbound `google-calendar-sync-appointment` always uses the **caller's** integration (`:116-121`).
   - The scheduled inbound sync (pg_cron every 5 min, `two_way` only) looks rows up with
     `.eq("user_id", integration.user_id).eq("external_event_id", …)` (`:278-284`) and otherwise **inserts** a new
     row owned by the integration owner (`:316-344`).
   - Once `user_id` = the assignee, an appointment Chris books for Alexa from CalendarPage would be pushed to
     **Chris's** Google Calendar. Chris's next inbound sync would miss the row and import a duplicate owned by Chris,
     and Chris's ReminderPopup would fire for it. That violates "only Alexa gets the reminder".
   - Production has **0** calendar integrations and **0** Google-linked appointments today, so this is latent, but
     the fix must not arm it.
   - Edits never reach Google today: CalendarPage's `appointmentMetaById` setter is never called (`:86`), so update
     and delete send no event id. This plan therefore guards the **create** path.
   - One latent path remains: **reassigning a row that is already Google-linked**, i.e. self-created and pushed, or
     imported from Google.
     - Its `user_id` stops matching the integration owner. The next inbound pull of that event (the event changes in
       Google, or a full resync after a 410) would re-import a duplicate owned by the integration owner.
     - Today's cross-user edits already break that linkage by rewriting `user_id`, so the fix moves the risk rather
       than creating it.
     - With 0 integrations it is latent. CalendarPage cannot detect a Google-linked row: `mapAppointment` drops the
       `external_*` fields.
     - Recorded in §13 and §14(3), where the real fix is the inbound-sync lookup.
2. **Main-Dialer "Callback" shadow rows.**
   - For a campaign callback, DialerPage writes the canonical `campaign_leads` fields (via `advance_campaign_lead`)
     **and** an `appointments` row titled `"Callback"` with no type, so it gets the DB default `'Sales Call'`.
   - Production: **17** such rows.
   - The Dashboard feed ignores them (its type filter) and the Calendar List view hides them
     (`excludeDialerCallbacks`). A contact card that read every open appointment would show each campaign callback
     twice.
3. **Discovered, not in scope:** `saveAppointment` stores times as UTC wall-clock.
   - It builds `start_time` as `${date}T${HH:MM:00}` with no offset (`dialer-api.ts:601`), and the DB `TimeZone` is
     `UTC` (verified).
   - All **5** production shadow rows that have a matching campaign callback are exactly **−7.00 h** from
     `callback_due_at`.
   - Dialer-booked appointments and callback shadow rows are therefore stored 7 hours early for Pacific-time agents,
     and their ReminderPopup fires about 7 hours early.
   - This plan does not change the Dialer (brief: don't alter telephony or callback writers). It is recorded as a
     follow-up (§14) that needs its own approval, including any data repair.

### 2.4 Live production facts (read-only, 2026-09-28)
- **RLS:** `appointments` and `tasks` policies are byte-for-byte the same as the repo baseline.
- **`appointments_insert` WITH CHECK:** `org = get_org_id() AND (user_id = uid OR created_by = uid OR role IN
  (Admin, Team Leader) OR super_admin)`. So "Admin/TL creates for Agent A with `created_by = self`" passes, and
  `.select().single()` reads the row back through `created_by = uid`.
- **UPDATE:**
  - USING allows the owner, the creator, a JWT Admin, a super-admin, or a TL through the team branch, which is dead
    in live data.
  - WITH CHECK requires the new row to satisfy `user_id = uid OR created_by = uid OR JWT role IN (Admin, TL)`.
  - PostgreSQL also applies the **SELECT** policy to the **new** row, because `updateAppointment` filters by `id`
    and (§4.2) returns `id`.
  - `appointments_select` has no TL role branch; its only TL branch goes through the dead `team_id`.
  - So after the fix a JWT **Admin** or the **creator** can reassign.
  - A **Team Leader** (or an Admin missing the claim) **cannot hand off an appointment assigned to them that they
    did not create**: the new row is neither theirs nor created by them, so the update fails with RLS 42501.
  - A non-creator **Agent** assignee cannot reassign at all, and has no picker anyway.
  - Today these hand-offs "work" only because CalendarPage rewrites `created_by` to the editor, which is the bug.
    See D-22.
  - Today CalendarPage's edit rewrote `created_by = user_id = uid`, which always satisfied WITH CHECK and hid this.
    After the fix, some edits depend on the JWT role claim (#19): a TL, or an Admin missing the claim, editing a row
    they neither own nor created.
  - Those edits now fail **loudly**: an RLS error or 0 rows ⇒ "Failed to update appointment", per §4.2. Previously
    they silently took the row over. No RLS change is needed.
- **SELECT:** the assignee reads the row via `user_id = uid`. ⇒ **No DB/RLS change is required.**
- **JWT role claims:** **3 of 14** live users (1 Admin, 1 Agent, 1 TL) have no `app_metadata.role`, which is all
  `get_user_role()` reads (#19). Their role-based RLS branches fail. Stamping `created_by = auth.uid()` keeps their
  inserts working regardless of the claim. Their empty `campaign_leads` result must read as "none", never an error.
- **Team Leaders:** the TL team branch of `appointments_select`/`_update` keys on `profiles.team_id`, which is NULL
  for all 14 live profiles. TLs therefore see only their own and created appointments. This is not changed here and
  not promised by the card.
- **Agents:** RLS lets an Agent insert `user_id = <other>` with `created_by = self`. The "Agents cannot pick an
  assignee" rule is UI-only (AppointmentModal). `user_id` has no FK, so the assignee comes only from the modal's
  roster or the current user. Optional RLS hardening is listed in §14.
- **Realtime publication:** includes `campaign_leads`, **not** `appointments` or `tasks`. DB `TimeZone` = `UTC`.
- **`appointments`:** 65 rows, 1 org. All 65 are inside the ±180-day window; 11 are in the future.
  - `user_id` NULL: **0**
  - `created_by` NULL: 30 (dialer rows)
  - `user_id ≠ created_by`: **0**
  - callback-type (`Follow Up`/`Call Back`): 4, of which **1 is Confirmed**
  - dialer shadow rows: 17
  - Google-linked: 0
  - past but still Scheduled/Confirmed: 54; excluding shadow rows, **40** over **23** contacts (at most 3 per
    contact), of which 20 are older than 30 days
  - open campaign callbacks: 2 overdue (none older than 30 days), 3 upcoming
- **`tasks`:** 0 rows. **`calendar_integrations`:** 0.
- **`campaign_leads` with a callback:** 5. All 5 have both timestamps set and equal. 0 are in a terminal status.
  0 `campaign_leads` rows have a NULL `organization_id`.

### 2.5 Readers — what the fix changes elsewhere
- **Readers keyed on `user_id`** (responsibility): ReminderPopup, `AppointmentsWidget` (my schedule),
  `useDashboardStats`, `GoalProgressWidget`, `supabase-users.getPerformance`, `DashboardDetailModal`,
  `get_agency_group_leaderboard`.
- **Readers keyed on the scheduler:** `get_org_leaderboard_stats` uses `COALESCE(created_by, user_id)`;
  `AgentScorecardModal` uses `created_by` and is not mounted anywhere.
- After the fix, an appointment Chris books for Alexa counts toward **Alexa's** schedule and goal widgets, and
  toward **Chris's** leaderboard "Appointments Set". Both follow the existing reader semantics; no reader is changed.
- **Attribution divergence Chris should see (D-19).** Three readers count *booked* appointments by `user_id`: the
  Group leaderboard (`get_agency_group_leaderboard`), `GoalProgressWidget`, and
  `supabase-users.getPerformance` → UserGoalsTab.
  - For cross-assigned rows they will credit the **assignee**.
  - The org leaderboard (and the Reports session's *planned* RPC) credit the **scheduler**.
  - Reports on `main` does not read `appointments` at all.
- The pinned tests stay green unchanged: `dashboardCallbacks.test.ts:563-575` (`user_id` wins) and the leaderboard
  SQL test T6 (`created_by` wins).
- **Calendar display:**
  - A creator still sees an appointment they booked for someone else, through the RLS `created_by` branch, with
    nothing showing it belongs to someone else. The calendar's "Agent" label is always blank, because
    `mapAppointment` reads a non-existent `agent_id`.
  - That label is unchanged here (§14).
  - Historical rows remain `user_id = created_by = creator`. The intended assignee was never persisted, so they
    cannot be repaired automatically.
- No row with `user_id ≠ created_by` exists yet, so no historical number moves.
- Workflow triggers on appointments are contact-scoped and never read `user_id` or `created_by`.

---

## §3. Scope

**In scope**
1. Honor the explicit assignee on every **live** appointment save path (CalendarPage, CalendarContext,
   FullScreenContactView Schedule). `created_by` is the creator and stays immutable after insert.
2. AppointmentModal edit initialisation and a truthful display of the current assignee.
3. ReminderPopup: a pure, tested eligibility rule (responsible user; open statuses only), plus a bounded freshness
   refresh (D-3).
4. A Google create-sync guard for appointments assigned to someone else (D-4).
5. A compact Follow-ups card + View all dialog on `FullScreenContactView`, with a typed normalization layer and tests.
6. Regression tests for everything above. After implementation: a WORK_LOG entry and an AGENT_RULES amendment
   bullet inside invariant #22 (no new invariant number).

**Out of scope (unchanged):**
- **Backend and DB:** any migration/RLS/RPC/Edge Function/deploy; the realtime publication; production data repair.
- **Dialer:**
  - `DialerPage`, `FloatingDialer` and `dialer-api.saveAppointment`, including the UTC bug in §2.3(3);
  - the unreachable Dialer modal;
  - canonical callback writers.
- **Other surfaces:**
  - Reports/Analytics and `dashboard-callbacks.ts`;
  - telephony;
  - a contact-page redesign or new tab system;
  - the Team-Leader picker scope (`upline_id` vs RLS `team_id`).

---

## §4. Design A — Appointment ownership

### 4.1 New pure module `src/lib/calendar/appointmentOwnership.ts` (~80 lines, no React, no Supabase)
```ts
export const OPEN_APPOINTMENT_STATUSES = ["Scheduled", "Confirmed"] as const;   // = AppointmentModal's non-terminal set
export function isOpenAppointmentStatus(status: unknown): boolean;
/** Invariant #22: user_id is authoritative whenever populated; created_by only when user_id IS NULL. */
export function appointmentResponsibleUserId(row: { user_id?: string | null; created_by?: string | null }): string | null;
export function isAppointmentResponsibleUser(row, uid: string | null | undefined): boolean;   // false for empty uid
/** Explicit non-empty assignee wins; otherwise the fallback. Never rewrites an explicit value. */
export function resolveAppointmentAssignee(explicit: unknown, fallbackUserId: string): string;
/** Insert-only ownership stamp: { user_id: explicit ?? creator, created_by: creator, organization_id }. */
export function buildAppointmentInsertOwnership(args: { explicitAssigneeId: unknown; creatorUserId: string; organizationId: string }): {...};
```
`created_by` is the authenticated inserting user by definition. RLS already requires either
`created_by = auth.uid()` or an Admin/TL role for inserting on someone else's behalf, so stamping it is what makes
"TL books for a direct report outside their team" still readable back.

### 4.2 `CalendarContext.addAppointment` (`:159-186`)
- Before: `insert([{ ...a, user_id: user.id, organization_id }])`.
- After: `insert([{ ...a, ...buildAppointmentInsertOwnership({ explicitAssigneeId: a?.user_id, creatorUserId: user.id,
  organizationId }) }])`.
- `organization_id` is still forced from `realProfile` (tenant enforcement unchanged, invariant #31). Throw-on-missing
  context is unchanged.
- The `...a` pass-through is **kept exactly**: no camelCase→column mapping is added. DialerPage (out of scope) calls
  `addAppointment` with camelCase objects at `:3619` and `:4917`, right after its own real insert.
  - Those calls keep failing at PostgREST exactly as today, so they can never turn into duplicate rows.
  - A context test pins that unknown keys are passed through untouched.
- `CalendarAppointment` gains optional `created_by?: string | null` and `raw_status?: string` (§5.1), and
  `mapAppointment` copies both. This is additive, and the optimistic `updateAppointment` merge carries them through
  the mapper. The displayed `status` coercion is unchanged.
- The provider's doc comment is updated in the same edit. It currently says "Creation stamps the REAL user.id"
  (`:87-91`) and that "the real-time subscription should pick it up" (`:164-166`); the latter is false, because
  `appointments` is not published.
- `updateAppointment` still injects nothing, and the org filter remains. It gains `.select("id")` and treats **zero
  returned rows as a failure**: it throws, the rollback refetch runs, and CalendarPage toasts "Failed to
  update appointment".
  - Today an RLS-hidden update "succeeds" with 0 rows. Examples: an Admin whose JWT lacks `app_metadata.role` (1 live
    Admin) editing a row they did not create, or a TL on a downline row (the TL `team_id` branch is dead). The UI
    then claims a reassignment that never happened.
  - `updateAppointment`'s only caller is `CalendarPage:272`.
- The rollback refetches in `updateAppointment` and `deleteAppointment` become **silent**, `fetchAppointments({
  silent: true })`.
  - Today they are non-silent, so they flip `loading`.
  - CalendarPage then renders only its full-page spinner, which unmounts AppointmentModal and loses the user's
    unsaved edits.
  - That would defeat D-16's "stay open on failure".

### 4.3 `CalendarPage.handleSave` (`:229-316`)
Split the single payload in two:
- **Create:** `{ ...fields, user_id: resolveAppointmentAssignee(data.user_id, user.id) }` → `addAppointment`, which
  stamps `created_by` and `organization_id`.
- **Update:** `{ ...fields, user_id: resolveAppointmentAssignee(data.user_id,
  appointmentResponsibleUserId(modalEditing) ?? user.id) }`, with **no `created_by` and no `organization_id`**.
  Reassignment happens only when the modal value differs; `created_by` is never rewritten; the tenant column is not
  rewritten from `useOrganization`.
- `fields` = title, contact_name, contact_id, type, start/end ISO, notes, status, `sync_source: "internal"`. These
  are identical to today, including the existing time conversion.
- **Google guard (D-4):** after a successful create, call `syncAppointmentToGoogle({action: "create", …})` **only when
  the assignee is the current user**. Otherwise skip it.
  - The success toast adds "Not added to your Google Calendar — it's assigned to <name>" **only when
    `googleConnected`**, which is already tracked at `:90`/`:130-144`. With 0 integrations today, nobody sees a
    misleading Google message.
  - The update and delete sync calls are unchanged; they are already inert, per §2.3(1).
- `handleSave` returns `true` on success and `false` on **every** failure path, for the modal (§4.4). That includes
  the early returns: missing context, and lead-creation failure.

### 4.4 `AppointmentModal` (small, contained changes)
- On edit: `setAssignedAgentId(editing.user_id || editing.created_by || user?.id || "")`, so a quick-call row keeps
  its #22 owner.
- **Truthful assignee display**, in the extracted `AppointmentAssigneeField.tsx`, so the modal does not grow:
  - In the `<select>` branch, if `assignedAgentId` is non-empty and not in `agents`, render one extra `<option
    value={assignedAgentId}>Current assignee</option>`.
  - In the Agent read-only branch, show the viewer's own name only when `assignedAgentId === user.id`, otherwise
    "Current assignee". An Agent can open a row they created that is now someone else's.
  - The display then always matches the value that will be saved.
- **Never report a save that did not happen (D-16):**
  - `onSave` may now return `Promise<boolean | void>`. `handleSave` awaits it, with a `saving` state that disables
    the confirm button.
  - With a **boolean** result the parent owns every toast; both parents already show success and failure messages.
    The modal only closes on `true`, and on `false` or a throw it stays open.
  - With a **`void`** result it keeps today's "Scheduled"/"Saved" toast and close.
  - There is never a duplicate or premature success toast.
  - Today the modal toasts success and closes **before** the parent's async save settles, so a failure shows
    "Scheduled" and then "Failed …".
  - A `void` return keeps today's behaviour, so DialerPage's unreachable mount is unaffected. CalendarPage and FSCV
    return booleans.
- Nothing else changes: the role gating, the emitted object and the identity sources stay as they are.

### 4.5 `FullScreenContactView` Schedule handler (`:1456-1488`)
- Replace the direct insert and the doomed `addAppointment(data)` with a single awaited `addAppointment(…)` call:
  ```ts
  addAppointment({
    title: data.title,
    contact_name: data.contactName,
    contact_id: contact?.id ?? null,        // exactly as today; the modal emits contactId "" here because FSCV passes
                                            // no prefillContactId, so data.contactId must NOT be used
    type: data.type,
    status: data.status,
    start_time,
    end_time,                               // from the existing parsing lines
    notes: data.notes,
    sync_source: "internal",
    user_id: data.user_id,                  // the picked assignee; the context stamps created_by + organization_id
  })
  ```
  It returns `true` on success and `false` on **every** failure path (D-16). That includes the existing early
  missing-context guard, which today does a bare `return;`, which D-16 would read as success.
- On success, the existing activity log and toast remain, and the Follow-ups card is refreshed by bumping a local
  `followUpsRefreshKey` state passed to the card as a prop. FSCV itself never calls `useQueryClient`: none of the 10
  test files that render the real FSCV provides a QueryClient, so that call would throw there (§11). On failure: toast
  and return, with no double write.
- Side benefits: the picked assignee and status persist, the calendar and reminder state update immediately, and the
  unhandled rejection disappears.
- The time parsing lines stay exactly as they are.

---

## §5. Design B — Reminders

### 5.1 New pure module `src/lib/calendar/reminderEligibility.ts` (~70 lines)
`selectDueReminders(appointments, { userId, now, leadTimeMinutes, state }) → { due, nextState }`. It reproduces
today's timing **exactly**:
- iteration order;
- skip when `start_time` is missing;
- `now >= start − lead`;
- exclude `now > start + 30 min`;
- snooze truthiness;
- marked shown at queue time.

It also applies two rule gates, each tested on its own:
- **recipient:** `isAppointmentResponsibleUser(appt, userId)`. With D-1 = B this is the #22 predicate; with D-1 = A
  it is strict `user_id === uid`. `created_by` **never** rescues a row whose `user_id` is someone else.
- **open status:** `isOpenAppointmentStatus(appt.raw_status)` — Scheduled or Confirmed only (D-2).
  - The check is on the **raw DB status**, trimmed and case-insensitive, against that allow-list.
  - `appointments.status` has no CHECK constraint, and `mapAppointment` coerces any unrecognised value to
    `"Scheduled"` (`CalendarContext.tsx:118`). The workflow trigger already recognises lowercase
    `cancelled`/`canceled`/`no_show`, so a filter on the *mapped* status would still remind for such a cancelled row.
  - `CalendarAppointment` therefore gains an additive `raw_status`, set from the DB value by `mapAppointment` and
    carried through the optimistic merge.
  - Production today has only `Scheduled` (63) and `Confirmed` (2).

`applySnooze(state, id, now)` is also exported.

### 5.2 `ReminderPopup.tsx`
- The inline eligibility block `:91-128` is replaced by `selectDueReminders`, and `user?.id` is added to the deps.
- The dialog, queue, chime, snooze, Call and View contact behaviour are unchanged.
- The identity stays the real `useAuth().user`, and the component remains unmounted under View As.

### 5.3 Freshness (D-3, recommended option C)
**`CalendarContext.fetchAppointments({ silent? })`**

It follows these exact rules:
1. **One generation counter.** Every fetch start bumps it, and so does every local `addAppointment` /
   `updateAppointment` / `deleteAppointment`. A fetch response commits `appointments` only if its generation is
   still current, so a pre-write snapshot can never overwrite a just-added row, bring back a deleted one, or restore
   an old `user_id` or status.
2. **Re-issue on a write race.** When a response is discarded because a local write bumped the generation, one
   silent refetch is issued, so the list converges on the committed state.
3. **`loading`.** A **non-silent** call sets `loading` at its start and clears it in `finally`, **whether or not its
   data was superseded**. A silent call never touches it. `CalendarPage` replaces the whole page with a spinner while
   `loading` (`:596-601`), so a spinner can never be left on.
4. **Single flight.** A context-level in-flight ref makes a *silent* request a no-op while any fetch is in flight.
   Non-silent calls keep today's behaviour.
5. **Failure.** A failed refresh keeps the current list, as today.

**`src/hooks/useAppointmentsFreshness.ts` (new, about 50 lines)**
- ReminderPopup is already 316 lines, above the §7 limit, so the scheduling lives in this small hook rather than
  growing the component.
- It calls `fetchAppointments({ silent: true })`:
  - every **5 minutes** while `document.visibilityState === "visible"` and `navigator.onLine`;
  - on `visibilitychange → visible` when the last refresh is more than 2 minutes old.
- Visibility is re-checked when each timer fires, timers are cleared on unmount, and there is no retry loop.
- ReminderPopup is its only consumer. Because ReminderPopup is unmounted under View As, no refresh query runs while
  impersonating (invariant #31 "NO-QUERY" shell posture).

**Queue revalidation (ReminderPopup)**
- On every `appointments` change, queued reminders that no longer pass the recipient and open-status gates are
  dropped. Examples: reassigned away, cancelled, completed.
- If the reminder currently on screen no longer passes them, it closes.
- Without this, a reminder already queued or shown would survive a refresh, because the queue holds snapshots.

**Cost and effect**
- **Cost today:** one org-scoped read of about 65 rows per visible tab every 5 minutes. For an Agent, RLS limits the
  read to the agent's own and created rows.
- Effect:
  - Chris books Alexa at 2:00 PM for 2:30 PM, and Alexa's popup learns of it within about 5 minutes.
  - After a reassignment away, the old assignee's pending **and** queued reminders stop within about 5 minutes.
  - A cancellation stops the reminder the same way.

---

## §6. Design C — Follow-ups data contract (display only)

### 6.1 New module `src/lib/contactFollowUps.ts` (pure types and normalization, ~190 lines)
```ts
export type FollowUpKind = "appointment" | "callback" | "task";
export type FollowUpSource = "appointment" | "campaign_lead" | "task";
export interface ContactFollowUp {
  key: string;             // `${source}:${sourceRowId}` — stable React key
  source: FollowUpSource;
  sourceRowId: string;
  kind: FollowUpKind;
  title: string;
  dueAt: string;           // absolute ISO instant (timestamptz); never shifted
  assigneeId: string | null;
  statusLabel: string;     // appointment status | "Pending" (campaign callback) | "Open" (task)
  isOverdue: boolean;
  contactId: string;
  contactType: ContactType;
  note: string | null;
}
export interface FollowUpSummary { primary: ContactFollowUp | null; total: number; others: number; overdue: number; truncated: boolean; }
```
- **Appointments** → `normalizeAppointmentFollowUp(row, contact, now)`:
  - `kind` = `"callback"` when `APPOINTMENT_CALLBACK_TYPES` (imported from `dashboard-callbacks.ts`) includes
    `row.type`, else `"appointment"`.
  - **Callback-type rows count only when `status === "Scheduled"`.** This is the Dashboard contract's own literal
    (`dashboard-callbacks.ts:184`); D-8 = parity, and a parity test runs both predicates over the same fixtures.
  - Non-callback appointments count when Scheduled or Confirmed.
  - `assigneeId = appointmentResponsibleUserId(row)` (#22). `dueAt = start_time`. `note = row.notes`.
  - **Overdue / past (D-17):**
    - A callback-type row is overdue when `dueAt < now`, and stays listed until resolved.
    - A **non-callback appointment is never "overdue"**. It is listed until it ends (`end_time`, else
      `start_time + 30 min`, the same +30-minute window ReminderPopup uses), and shows "In progress" once started.
    - After that it is a past appointment, not a pending follow-up, so it leaves the card. It is still on the
      Calendar, where AppointmentModal already flags unresolved past appointments.
    - Production has **40** past appointments still Scheduled/Confirmed, excluding shadow rows, spread over **23**
      contacts, 20 of them older than 30 days. Without this rule most contact cards would show stale "overdue"
      meetings.
  - **Main-Dialer shadow rows are suppressed** (D-7), matching **only** that writer's signature:
    `title.trim().toLowerCase() === "callback" && !APPOINTMENT_CALLBACK_TYPES.includes(type)`.
    - This is narrower than `isDialerCallbackAppointment`. A FloatingDialer "Callback: X" row later re-typed to
      Sales Call, or a manual "Callback: …" appointment, stays visible as an Appointment.
- **Campaign callbacks** → `normalizeCampaignCallbackFollowUp(row, contact, now)`:
  - `dueAt = callback_due_at ?? scheduled_callback_at`, the same rule as `normalizeCampaignRow:361`.
  - `assigneeId = callback_agent_id`. `title` = "Campaign callback · <campaign name>".
  - `note = callback_note`. `statusLabel = "Pending"`.
  - Rows with a terminal status (`TERMINAL_CAMPAIGN_LEAD_STATUSES`, imported) are dropped defensively, in addition to
    the query filter.
  - **One `campaign_leads` row always yields exactly one item**, so coexisting compatibility timestamps can never
    duplicate.
  - A lead can have several `campaign_leads` rows, one per campaign; each yields its own item, titled with its
    campaign name.
- **Tasks** → `normalizeTaskFollowUp(row, contact, now)`:
  - A task is open only when `completed_at` is null (`tasks` has no status or priority column). `assigneeId =
    assigned_to`. `kind` is always `"task"`, even when `task_type` is 'Follow Up'.
  - `dueAt = due_date`, and the card renders it **date-only** (`formatDate`). Tasks are day-granular in the UI, which
    has a date picker.
  - `isOverdue` uses the **same rule as TasksPanel** (D-11): `d < now && !sameLocalDay(d, now)`, so a task due later
    today is "today", not overdue.
    - This is the browser-local-day convention (AGENT_RULES §5 notes user-local-day bounds, never UTC).
    - It is correct for both stored shapes once D-15 = A lands. UI tasks become a local-midnight instant; workflow
      tasks already store real instants.
    - No `00:00:00Z` heuristic is introduced.
  - The rule moves to an exported `getTaskDueStatus(dueDate, completedAt, now)` that TasksPanel then imports,
    behaviour-identical.
  - The assignee name prefers the `assignee` embed that `getTasks` already returns. It names inactive profiles too.
    Only when the embed is null does it fall back to the page's `getAgentDisplayName`.
- **Cross-contact guard:** each normalizer returns `null` for a row whose `contact_id` / `lead_id` ≠ the contact id,
  or (tasks) whose `contact_type` ≠ the contact type. This is in addition to the query filters.
- **`rankAt`**: `dueAt` for appointments and callbacks. For tasks it is the **end of the local due day**, because tasks
  are day-granular. A task due today is therefore "actionable" all day and ranks after today's timed items.
- `sortFollowUps`: `rankAt` ASC, then source rank (campaign_lead 0, appointment 1, task 2 — extending
  `compareCallbackRows`' campaign-before-appointment rule), then `sourceRowId` ASC.
- `summarizeFollowUps` (D-12, matching the brief's mock):
  - `primary` = the **next actionable** item: the earliest non-overdue item by `rankAt`, including "In progress"
    appointments and tasks due today. When nothing is actionable, it is the most recently due overdue item, which
    carries an amber "Overdue" chip.
  - `others = max(0, total − 1)`.
  - `overdue` = overdue items **among the others**, as in "2 other follow-ups · 1 overdue". The View-all dialog lists
    every overdue item first.
  - `truncated` is true when the appointments or campaign read returned its cap. Tasks are uncapped, for TasksPanel
    parity.
- `viewerTimeZoneLabel(date)` returns the viewer zone's short name **at that instant** via
  `Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(date)`, so a follow-up after the DST change
  reads PST, not PDT. It is a label only; nothing is converted.
  - The `"en-US"` locale matches `getContactTimezone`. With the runtime default locale, an en-GB browser would render
    "GMT-7", not "PDT".
  - Non-US zones still read "GMT±N".
  - The existing `getContactTimezone` is not reused: it describes the contact's zone and only for "now".
  - `formatDateTime` already renders in the viewer's browser zone; it never reads `branding.timezone`.

### 6.2 New module `src/lib/contactFollowUpsQueries.ts` (reads, ~110 lines)
`fetchContactFollowUpRows({ contactId, contactType, organizationId, signal })` runs the reads through the existing
`settleAll` + `linkedAbort` (from `requestLifetime.ts`), with `assertNoQueryError` on each. The first failure cancels
its sibling, and the call rejects with `DashboardQueryError` only after every read has settled. It never returns a
partial set.

**Appointments:**
```ts
from("appointments").select("id, title, type, status, start_time, end_time, notes, user_id, created_by, contact_id")
  .eq("organization_id", organizationId).eq("contact_id", contactId)
  .in("status", [...OPEN_APPOINTMENT_STATUSES])
  .order("start_time").order("id").limit(FOLLOW_UP_SOURCE_LIMIT /* 200 */)
```

**Campaign callbacks — `contactType === "lead"` only**, otherwise not queried at all:
```ts
from("campaign_leads").select("id, lead_id, status, callback_due_at, scheduled_callback_at, callback_agent_id, callback_note, campaigns(name)")
  .eq("organization_id", organizationId).eq("lead_id", contactId)
  .not("status", "in", `(${TERMINAL_CAMPAIGN_LEAD_STATUSES.join(",")})`)
  .or("callback_due_at.not.is.null,scheduled_callback_at.not.is.null")   // static string; no id is ever interpolated
  .order("id").limit(FOLLOW_UP_SOURCE_LIMIT)
```
- Per contact the row count is tiny: 5 callback rows exist in all of production. So a single read with the `??` rule
  applied in JS is correct and duplicate-free by construction.
- The Dashboard needs two mutually exclusive branches only because it paginates by the due column; this read does
  not paginate.
- Contact ids travel only through parameterized `.eq()`.
- An empty result means "none", never an error. This matters for the #19 JWT-claim limitation.
- NULL-status `campaign_leads` rows are excluded by `NOT IN`, identically to the Dashboard. There are 0 in
  production.
- A read cancelled by React Query (unmount, contact switch, refetch) is thrown as a plain cancellation **before**
  `assertNoQueryError`, so harmless cancellations do not log "[Dashboard] Query failed". Errors use a `contact-followups:*`
  context label.
- The module imports `dashboard-callbacks.ts`, which creates the Supabase client at import time. Every test that
  imports it mocks `@/integrations/supabase/client`, as the three existing dashboard-callbacks suites do.
  Otherwise it fails collection in an env-less container.

**Tasks:** `useQuery({ queryKey: ["tasks", contactId], queryFn: () => tasksApi.getTasks(contactId, organizationId),
enabled: !!contactId && !!organizationId, select: … })`.
- The key, queryFn, `enabled` and options are **identical to TasksPanel**. Only the per-observer `select`
  (open + `contact_type` guard + normalize) differs, and it never alters the shared cache.
- The two views therefore share one cache entry, and the existing TasksPanel/AddTaskModal invalidations of
  `["tasks", contactId]` refresh the card for free, within this browser.
  - The shared cache gives TasksPanel an instant display. It does **not** remove requests: with the app's bare
    `new QueryClient()` (`staleTime 0`), opening the Tasks tab still refetches on mount, as it does today.
  - Tasks are not realtime-published, and `workflow-executor` inserts tasks with the service role. An
    automation-created task therefore appears on the card only on the next focus, mount or invalidation. The D-18
    interval is deliberately not put on the shared tasks key.
- A different payload shape under that exact key is never introduced, and no divergent `retry` is set on the shared
  key.
- RLS makes the task set viewer-dependent (Agents see assigned or created tasks only), exactly as in the Tasks tab.
- TasksPanel renders "No tasks yet" on a query error, while the card says "Couldn't load follow-ups". This is a
  pre-existing TasksPanel behaviour and is not changed here.

RLS alone decides visibility: an Agent sees their own and created appointments, and campaign rows per campaign type.
No broadening and no owner filter are added. The card shows the responsible person and never implies the row is
"mine".

### 6.3 Hook `src/hooks/useContactFollowUps.ts` (~80 lines)
- Two `useQuery`s: `["contact-followups", organizationId, contactType, contactId]` (appointments + campaign), and the
  shared `["tasks", contactId]`.
- It returns `{ state: "loading" | "error" | "ready", items, summary, refetch }`. `error` is reported if **either**
  query errors, so the card never presents a partial list as authoritative.
- It is disabled until `organizationId` and `contactId` are known. A minute tick keeps `isOverdue` current.
- It takes a `refreshKey` argument; a change triggers `refetch()` of both queries. The key is not part of the query
  key, so cached data stays on screen while refreshing.
- With D-18 = A, the follow-ups query (not the shared tasks key) has `refetchInterval: 120_000` and
  `refetchIntervalInBackground: false`.
- Retry is 1 for the follow-ups query. The shared tasks key keeps React Query's defaults, as TasksPanel does, so a
  failing tasks read can hold the skeleton for up to about 7 s before "Couldn't load follow-ups". That is accepted,
  so the shared key never gets divergent options.
- A **background** refetch that fails while good data is on screen keeps that data, plus a muted "Couldn't refresh ·
  Retry" line. This follows the Dashboard's rev 1.2 same-scope refresh pattern. Only a failure with no data yet shows
  the error panel. Its key includes `contactId`, so a contact switch can never show the previous contact's rows. FSCV can
  re-render with another contact without remounting (seen in `fullScreenContactViewConversation.test.tsx:310-320`).

---

## §7. Design C — UI (no redesign)

### 7.1 Placement (D-6, recommended option A)
The right column (`FullScreenContactView.tsx:1253`, `w-[320px] xl:w-[350px] 2xl:w-[380px] bg-card border
border-border rounded-xl flex flex-col min-h-0 overflow-hidden shrink-0 shadow-sm`) is one card: an `h-14` tab strip
(`:1254-1275`) above one scrolling body (`:1278`).
- **Option A (recommended): a separate compact card above it.**
  - Wrap the column in a same-width `flex flex-col gap-3 min-h-0 shrink-0` div. The width classes move to the wrapper,
    and the existing card keeps every other class plus `flex-1`.
  - The new card has a **single compact header row, about 32 px** ("FOLLOW-UPS" label + "View all"), not `h-14`, so
    it stays small.
  - The existing card follows unchanged inside. It starts about **125 px** lower (card + `gap-3`).
  - **Height budget:** at 1366×768 the tab body shrinks from about 440 px to about 315 px. Option B costs about
    100 px (to about 340 px). See D-6.
  - It is literally "another AgentFlow card at the top of the right-side area".
- **Option B:** a `shrink-0 border-b` section **inside** the existing card, between the tab strip (`:1275`) and the
  scroll body (`:1278`).
  - The tab strip stays exactly where it is.
  - The summary sits under the tabs and is visible on every tab.
  - It can read as part of the active tab.

Either way the card has a **fixed compact height**: three lines, never a growing list. Loading, ready, empty and
error states all use the same body height (a three-row skeleton), so the tab body never jumps when a contact opens. It takes the same fixed
height from the tab bodies. Notes (`flex flex-col h-full`) and Tasks (`h-full overflow-hidden`) keep working because
they size to the scroll body. The left dock, conversation column, header, tabs and every tab's contents are untouched.
```
┌ Left dock ┐ ┌ Conversation ┐ ┌ FOLLOW-UPS                View all ┐  ← NEW compact card (bg-card border rounded-xl shadow-sm)
│ (as today)│ │  (as today)  │ │ 📅 Appointment · 09/28/2026 2:30 PM PDT │
│           │ │              │ │ Final Expense Consultation · Alexa      │
│           │ │              │ │ 2 other follow-ups · 1 overdue          │
│           │ │              │ └─────────────────────────────────────────┘
│           │ │              │ ┌ Activity │ Notes │ Tasks │ Campaigns ┐   ← existing card, unchanged inside
│           │ │              │ │ …                                    │
```

### 7.2 `src/components/contacts/followups/ContactFollowUpsCard.tsx` (~150 lines)
Exported as a **named** export, `export function ContactFollowUpsCard`, with no default export. The one-line mock in
the 10 existing suites relies on this (D-13).
- **Header:** "Follow-ups" styled like the existing `text-xs font-medium text-muted-foreground uppercase` section
  labels.
  - It carries the tooltip "Shows follow-ups you have access to" (D-20).
  - It has a ghost **View all** link that is hidden when the list is empty and disabled while loading or on error.
- **Truncation:** lines 1 and 2 use `truncate`, and the Overdue / In progress chip is `shrink-0`. The right column is
  only about 286 px wide inside `w-[320px]` below `xl`.
- **Primary item** (D-12: the next upcoming item, else the most recently due overdue one):
  - line 1 is `[type icon] <Appointment|Callback|Task> · <formatDateTime(dueAt)> <tz>`. For a task it is
    `formatDate(dueAt)` only, with no time and no tz;
  - line 2 is `<title> · <assignee name>`;
  - when the item is overdue, it gets a subtle amber "Overdue" chip, matching TasksPanel's amber overdue treatment.
- **Footer:** "N other follow-up(s) · M overdue". Each part is omitted when zero. When a source hit its cap, the
  footer says "at least".
- **Empty state:** "No follow-ups scheduled" + a "+ Add follow-up" menu (D-9) with two existing flows:
  - **Appointment** calls the page's existing `setShowAppt(true)`, passed down as `onAddAppointment`;
  - **Task** opens the existing `AddTaskModal`, which is rendered only while open (`{taskOpen && <AddTaskModal …/>}`).
    Its props (`contactId`, `contactType`, `agents`) are the ones FSCV already has.
- **Labels:** the card's own controls avoid names the existing suites query by role or text: "Call", "Save",
  "Edit", "Cancel", "New", "All", and the text "No activity yet".
  - Appointment titles *can* contain the contact's name, e.g. the modal's default subject or FloatingDialer's
    "Callback: First Last".
  - Those suites mock the card anyway (D-13).
- **Loading state:** a three-row skeleton at the fixed body height.
- **Error state:** "Couldn't load follow-ups" + Retry. Neither the loading nor the error state ever shows the empty
  message.
- Assignee names come from the page's existing `getAgentDisplayName` (roster-based, with the "Unavailable"/"Loading…"
  fallbacks), passed as a prop. An unassigned item shows "Unassigned".
  - The roster holds **Active** profiles only, so an inactive appointment or callback owner reads "Unavailable", as
    elsewhere on the page.
  - Task owners use the `getTasks` embed first, which names inactive profiles too.
- The card takes **primitive props** (`contactId`, `contactType`, `organizationId`), and its effects depend only on
  them. DialerPage builds a new `contact` object on every render, so nothing may depend on that object; FSCV's own
  comment at `:288` warns about the same thing.
- Icons (lucide): `Calendar` for appointments, `PhoneCall` for callbacks, `CheckCircle2` for tasks.

### 7.3 `src/components/contacts/followups/ContactFollowUpsDialog.tsx` (~110 lines) + `FollowUpRow.tsx` (~60 lines)
- shadcn `Dialog` with `max-h-[85vh] overflow-y-auto`, like the existing long dialogs (`DispositionsManager.tsx:533`,
  `Carriers.tsx:472`).
- Grouped **Overdue** (oldest first) and **Upcoming** (by `rankAt`). It is read-only.
- Each row shows the type, title, due date/time with the tz label, assignee name and current status, and the note
  when present.

### 7.4 `FullScreenContactView.tsx` edits (surgical; the file is 1523 lines and stays structurally the same)
- import + `<ContactFollowUpsCard contactId={contact.id} contactType={type} organizationId={organizationId}
  agents={agents} resolveAgentName={getAgentDisplayName} refreshKey={followUpsRefreshKey}
  onAddAppointment={() => setShowAppt(true)} />` in the D-6 position (about 8 lines);
- one `useState` for `followUpsRefreshKey`, placed above the `if (!contact) return null` early return (`:577`),
  because hooks must stay above it;
- the §4.5 Schedule-handler rewrite (about −15/+12 lines).

Nothing else moves. FSCV is mounted by Contacts (lead, client, recruit), CalendarPage, DialerPage and
ContactDeepLinkPage, so the card appears on all four with no mount changes. In the Dialer, `contact.id =
lead_id || id`. **Known limitation**, recorded and not fixed here because DialerPage is out of scope: when a Dialer
row's `lead_id` is NULL, `contact.id` is a `campaign_leads.id`.
- Dialer-written appointments for that row do match.
- The row's own campaign callback is not read (the read filters on `lead_id`).
- "Add follow-up → Task" would key a task on a non-contact id. This is the same pre-existing exposure the Tasks tab
  has in the Dialer.
- After lead→client conversion, `campaign_leads.lead_id` is set NULL, so a converted client's campaign callback is
  unreachable from its card. This is the same as the Dashboard.

### 7.5 Timezone
- Timestamps stay absolute instants. The display uses the app's existing `useBranding().formatDateTime`, which
  renders in the viewer's local time with the org's 12/24-hour setting, plus the viewer's short timezone label
  (D-10).
- The contact's local time already appears in the header (`ContactLocalTime`) and is not duplicated.
- The agency reporting timezone is never used.

### 7.6 Security / tenancy
- Every appointment and campaign read filters `organization_id` (0 NULL-org `campaign_leads` rows in production) plus
  the contact id. The tasks read is org-filtered by the existing `tasksApi`.
- RLS is untouched and decides visibility. There is no service role and no mock data.
- `.maybeSingle()` is not needed: every read is a list, and zero rows is legitimate.
- The View-As lock on contact-detail machinery (invariant #31) keeps the card unmounted while impersonating.

---

## §8. (Design review record: see §15.)

## §9. Exact files to touch

**New:**
| File | Purpose | ≈ lines |
|---|---|---|
| `src/lib/calendar/appointmentOwnership.ts` | ownership + open-status helpers (§4.1) | 80 |
| `src/lib/calendar/reminderEligibility.ts` | pure reminder selection (§5.1) | 70 |
| `src/lib/contactFollowUps.ts` | types, normalizers, sort, summary, tz label, task due status (§6.1) | 190 |
| `src/lib/contactFollowUpsQueries.ts` | per-contact reads (§6.2) | 110 |
| `src/hooks/useContactFollowUps.ts` | query composition + refreshKey (§6.3) | 80 |
| `src/hooks/useAppointmentsFreshness.ts` | bounded visible-tab silent refresh (§5.3) | 50 |
| `src/components/calendar/AppointmentAssigneeField.tsx` | the extracted assignee field: `<select>` + "Current assignee" option + Agent read-only display (§4.4) | 60 |
| `src/components/contacts/followups/ContactFollowUpsCard.tsx` | compact card (§7.2) | 150 |
| `src/components/contacts/followups/ContactFollowUpsDialog.tsx` | View all (§7.3) | 110 |
| `src/components/contacts/followups/FollowUpRow.tsx` | shared row (§7.3) | 60 |
| tests — see §11 | | |

**AGENT_RULES §7 compliance:**
- Every new component and hook is under 200 lines and uses Tailwind only.
- No new form is introduced, so there is no new Zod schema. AddTaskModal keeps its Zod schema (D-15 corrects only its
  refine and default), and AppointmentModal keeps its existing hand-written validation.
- Net growth in the already-oversized files (`CalendarPage` 773, `FullScreenContactView` 1,523, `AddTaskModal` 201
  lines) is limited to the edits listed below and is a stated exception.
- `ReminderPopup` (316) and `AppointmentModal` (681) do **not** grow, because their new logic moves into extracted
  modules.

**Modified:**
| File | Change |
|---|---|
| `src/contexts/CalendarContext.tsx` | insert ownership via helper; `created_by` on type + mapper; update 0-row = failure; `fetchAppointments({silent})` + write-aware generation guard |
| `src/pages/CalendarPage.tsx` | split create/update payloads; Google create guard (message only when connected); `handleSave` returns a boolean |
| `src/components/calendar/AppointmentModal.tsx` | edit-init fallback; await `onSave` (D-16); the assignee field moves into the new `AppointmentAssigneeField.tsx`, so the 681-line modal does not grow |
| `src/components/layout/ReminderPopup.tsx` | use `selectDueReminders` (the file gets **shorter**); deps; queue revalidation; `useAppointmentsFreshness()` |
| `src/components/contacts/FullScreenContactView.tsx` | mount card; Schedule handler via context |
| `src/components/contacts/TasksPanel.tsx` | import shared `getTaskDueStatus` (behaviour-identical) |
| `src/components/contacts/AddTaskModal.tsx` | **only if D-15 = A:** local-date parse, validation and default (about 6 lines; Zod schema kept, refine corrected) |
| the **10** existing tests that render the real `FullScreenContactView` | + one line: `vi.mock("@/components/contacts/followups/ContactFollowUpsCard", () => ({ ContactFollowUpsCard: () => null }))`. Use the `@/` alias form: some suites' relative `./TasksPanel` mocks resolve against `__tests__/` and are inert. The files are `src/components/contacts/__tests__/{fullScreenContactViewAdditionalPolicies, fullScreenContactViewConversation, fullScreenContactViewQuickCall, fullScreenContactViewSaveFailure, fullScreenContactViewScore, fullScreenContactViewStatusSave, conversationDispositionColors}.test.tsx` and `src/pages/__tests__/{contactDeepLinkDuplicateParity, contactDeepLinkQuickCall, contactDeepLinkSaveIntegrity}.test.tsx` |
| `docs/plans/2026-09-28-contact-followups/implementation_plan.md` | this plan (new) |
| `implementation_plan.md` (root) | a short §17 pointer appended at EOF only; all existing bytes are preserved |
| `WORK_LOG.md`, `AGENT_RULES.md` | **after** implementation, in the same PR, which is squash-merged so they land in the same commit on `main` as the code (AGENT_RULES §9). The final docs commit comes after rebasing: a newest-first WORK_LOG entry (additions only), plus an **amendment bullet in invariant #22**. The bullet says: appointment `user_id` = responsible person and personal-reminder recipient; `created_by` = scheduler, stamped on insert and never rewritten; the Follow-ups card reuses the #22 predicate and contract constants. It also records the two **out-of-scope writers that still deviate**: `dialer-api.saveAppointment` (no `created_by`) and the FloatingDialer quick-call (no `user_id`, covered by the #22 fallback). No new invariant number (#38 is reserved by Reports). |

**Explicitly NOT touched:**
- `src/lib/dashboard-callbacks.ts` (imported only), `dashboard-contact-identity.ts`, `requestLifetime.ts`,
  `appointmentFilters.ts`, `tasksApi.ts`, and `AddTaskModal.tsx` unless D-15 = A;
- `src/integrations/supabase/types.ts` (`appointments.created_by` is already typed), `usePermissions`,
  `permissionDefaults`, `report-utils.ts`, any Dashboard file;
- `DialerPage.tsx`, `FloatingDialer.tsx`, `dialer-api.ts`, `TwilioContext.tsx`;
- every Reports/Analytics file;
- `supabase/**`, including `supabase/functions/google-calendar-*`, which draft PR #378 rewrites.

---

## §10. Decisions for Chris (recommendation first)

**Product and behaviour decisions**

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D-1** | Reminder recipient for rows with `user_id` NULL | **B:** invariant-#22 fallback — `user_id` wins whenever set; `created_by` only when `user_id IS NULL` · A: strict `user_id === uid` (today) | **B.** One ownership rule shared by the Dashboard, Follow-ups and reminders. It restores reminders for FloatingDialer quick-call callbacks without touching FloatingDialer. Blast radius today: **0** rows (no NULL `user_id` in production). |
| **D-3** | Cross-session freshness | A: document only · B: refetch on tab focus (throttled) · **C: B + 5-minute refresh while visible and online** · D: add `appointments` to the realtime publication (backend; separate approval) | **C** (§5.3). Without it, "Agent A DOES receive the reminder" only holds after A reloads. It is bounded, visible-tab only, and runs no query under View As. D is the zero-polling long-term fix (§14). |
| **D-4** | Google sync for an appointment assigned to someone else | **A: skip the outbound create when assignee ≠ caller** · B: keep pushing to the creator's calendar · C: change the Edge Functions (backend) | **A.** B re-imports a duplicate owned by the creator, which then reminds the creator. C is a follow-up (§14). |
| **D-6** | Card placement and height budget | **A (compact): a separate card above the right panel with a single ~32 px header row** ("FOLLOW-UPS · View all"), not `h-14` · B: a compact section inside the right panel between the tab strip and the tab body | **A-compact.** It is literally "another card at the top of the right-side area", and nothing inside the existing panel changes. **Height cost: A ≈ 125 px (card + `gap-3`); B ≈ 100 px.** At 1366×768 the tab body shrinks from ≈ 440 px to ≈ 315 px (A) or ≈ 340 px (B). Notes keeps its composer; the list shows about 1-2 notes instead of 3-4. Choose B if vertical space matters more than a separate card. |
| **D-7** | Main-Dialer "Callback" shadow rows (17 in production, stored 7 h early) | **suppress only that writer's signature** (title exactly "Callback" + a non-callback type) · show as Callback · show as Appointment | **Suppress.** They are never canonical: the Dashboard and Calendar List already ignore them, and they carry wrong times (§2.3). The rule is narrower than `isDialerCallbackAppointment`, so re-typed FloatingDialer rows and manual "Callback: …" appointments stay visible. |
| **D-8** | Which appointment statuses count as open | **Dashboard parity: callback-type rows only when `Scheduled`; other appointments when Scheduled or Confirmed** · Scheduled + Confirmed for all | **Parity** (revised after review). The brief forbids a conflicting callback definition, and #22 makes `dashboard-callbacks.ts` the one contract. A parity test pins it. The 1 production Confirmed Follow Up is therefore not shown, exactly as on the Dashboard. Changing that belongs in the shared contract, under its own approval. Reminders (D-2) are a separate concept and still fire for Confirmed. |
| **D-9** | "+ Add follow-up" | **menu: Appointment (existing modal) · Task (existing AddTaskModal)** · Appointment only | **Menu.** Campaign callbacks are created only by the Dialer's canonical writer and are not offered. |
| **D-10** | Date display | **existing `formatDateTime` + viewer tz label** (`09/28/2026 2:30 PM PDT`) · a new compact format (`Sep 28, 2:30 PM PDT`) | **Existing formatter + label.** The brief requires existing utilities; the mock's "Sep 28" would need a new format string. |
| **D-12** | Primary item | **the next actionable item**, ranked by `rankAt`: `dueAt` for appointments and callbacks; the **end of the local due day** for tasks, so a task due today is actionable (not overdue) and ranks after today's timed items. When nothing is actionable, use the most recently due overdue item, with an Overdue chip · the earliest item (most overdue first) | **Next actionable.** It matches the brief's mock (an upcoming primary with "2 other follow-ups · 1 overdue"), so a months-old item can never pin the primary line, and a task due today is always shown. |
| **D-15** | `AddTaskModal` date handling. Today its bare `YYYY-MM-DD` value is stored as UTC midnight (DB `TimeZone` = UTC). For US users this means: (1) the Zod rule **rejects today's date**; (2) the UTC-date default fails validation most of the day; (3) the Tasks tab shows a task "Due Today" the day before and "Overdue" on its due date. The card's "Add follow-up → Task" opens this modal. | **A: fix the writer.** Parse the picked date as a **local** calendar date, send that local midnight as an ISO instant, validate against the local date, and default to the local date (about 6 lines). · B: leave it and document it · C: treat stored `00:00:00Z` values as calendar dates in a new display helper | **A.** It fixes the root cause without any display heuristic (C would be "inventing" a conversion). Production has **0** task rows, so nothing historical shifts. The Tasks tab then becomes correct for new tasks with no TasksPanel logic change. Workflow-created tasks already store real instants and are unaffected. |
| **D-16** | AppointmentModal success toast fires before the save settles | **A: the modal awaits `onSave`. With a boolean result the parent owns every toast, and the modal only closes on `true`; with a `void` result it keeps today's toast-and-close** · B: leave it as a known issue | **A.** It is the calendar equivalent of invariant #36, never report a save that did not happen. There is no duplicate success toast. It is about 10 lines. |
| **D-17** | Past non-callback appointments still Scheduled/Confirmed (**40** in production, spread over **23** contacts, 20 of them older than 30 days) | **A: list them only until they end (`end_time`, else start + 30 min); never "overdue"** · B: count them as overdue forever · C: count them as overdue for 30 days (the Dashboard lookback) | **A.** An appointment is an event, not a to-do. Once it has ended it is a past appointment awaiting an outcome, which the Calendar and AppointmentModal already flag, not a pending follow-up. Callbacks and tasks stay overdue until resolved, with no lower bound, so real overdue work is never hidden. B would put stale "overdue" meetings on most contact cards. |
| **D-18** | Card freshness while a contact is open, e.g. a FloatingDialer quick-call callback booked from this contact | **A: refetch on focus (the React Query default), after this page's own Schedule and Task writes, and on a 2-minute interval while visible** · B: the same without the interval (the quick-call gap is documented) | **A.** One tiny per-contact read every 2 minutes, only while the contact view is open and the tab visible (`refetchIntervalInBackground: false`). It is applied to the follow-ups query only, never to the shared tasks key. Nothing else signals the card after a quick-call callback: FloatingDialer emits no "disposition saved" event and is out of scope. |
| **D-19** | Booked-appointment credit in the Group leaderboard, GoalProgressWidget and UserGoalsTab, which count by `user_id` | **A: accept it for this change.** Those readers credit the assignee; the org leaderboard keeps crediting the scheduler. Document it and file a follow-up · B: switch those readers to `COALESCE(created_by, user_id)` now | **A.** Changing readers (one an RPC) widens a surgical bugfix into metric work, and the RPC is a backend change. No cross-assigned row exists yet, so nothing moves until new bookings are made. Decide the canon separately (§14). |
| **D-20** | Empty-state wording, given that visibility is per-viewer under RLS. An Agent sees only their own and created appointments; the 3 users without a JWT role claim see no campaign rows, and neither does the 1 Admin among them. | **A: keep the brief's copy "No follow-ups scheduled" and add a header tooltip: "Shows follow-ups you have access to"** · B: change the copy to "No follow-ups you can see" · C: make the claim repair (§14.5) a prerequisite | **A.** It keeps the approved copy while never implying completeness (#22 neutral-wording rule). The card test pins it. |
| **D-21** | Default assignee when scheduling from the contact page | **A: keep today's default, the scheduler** · B: default to the contact's assigned agent via a small `defaultAssigneeId` prop, used for new appointments only (never on edit) | **A** for this bugfix, because it is least surprising. B is a one-prop enhancement if Chris wants "book for the lead's owner" by default. |
| **D-22** | After the fix, a **Team Leader** (or an Admin whose JWT lacks the role claim) cannot hand off an appointment assigned to them that they did not create. The update's new row fails the SELECT policy, which has no TL role branch (its TL branch keys on `team_id`, NULL for everyone). Today it only "works" by rewriting `created_by`. | **A: accept the loud failure** ("Failed to update appointment"; the creator or an Admin can reassign), and schedule an RLS follow-up · B: keep rewriting `created_by` on TL edits (reintroduces the bug) · C: add a TL-role SELECT branch now (`#APPROVE_RLS_CHANGE`, separate approval) | **A.** No silent ownership rewrite, no RLS change in a frontend bugfix. The follow-up (§14.5) aligns appointments' TL visibility with `tasks` (`hierarchy_path`). |
| **D-23** | What is labelled **Callback**. "Follow Up" is also a normal, user-selectable meeting type (`appointmentTypes.ts:18`). All **4** production Follow Up rows were scheduled manually: none carries the quick-call title or notes signature, and 2 are upcoming. | **A: type-based, exactly as the brief and the Dashboard contract say** (`type ∈ APPOINTMENT_CALLBACK_TYPES` + `Scheduled` ⇒ Callback) · B: signature-based (callback type **and** the FloatingDialer "Callback:" title or notes marker) | **A.** The brief states it explicitly, and the Dashboard callback feed already counts those 4 rows as callbacks, so the card agrees with it. Consequence: a manually booked "Follow Up" meeting reads "Callback" on the card, as it already does on the Dashboard. B is more precise but diverges from the contract, so it would need the shared contract changed under its own approval. |

**Required by the brief (confirm only)**

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D-2** | Remind only for open statuses | **Scheduled + Confirmed** · keep all | **Scheduled + Confirmed.** Cancelled, Completed and No Show never remind (required regression #8). |
| **D-5** | FloatingDialer quick-call writer (`user_id` NULL) | **leave untouched** · add `user_id: user.id` | **Leave.** The brief says not to alter callback writers, and D-1 = B already covers these rows. |

**Engineering choices (recorded for review; no product impact)**

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D-11** | Task overdue rule | **reuse TasksPanel's rule** (past and not on today's local date) via a shared helper · strict `< now` | **Reuse**, so the card and the Tasks tab never disagree. TasksPanel's change is a behaviour-identical import. Correct dates for new tasks depend on D-15. |
| **D-13** | Existing contact-view tests (10 files; none has a QueryClientProvider; their Supabase stubs lack `.abortSignal`/`.lte`) | **add one `vi.mock` line for the card (`@/` alias)** · wrap them in a QueryClientProvider and extend their stubs · write the card without React Query and the abort signal | **`vi.mock`.** It isolates those suites from the new reads, exactly as they already isolate `TasksPanel` and `AppointmentModal`. The card is covered by its own suite. |
| **D-14** | Branch / worktree | **keep `claude/contact-followups-appointment-fix-rruo7i`** (session-mandated) · rename to `fix/contact-followups-reminders-20260927` at PR time | **Keep.** It is an isolated container clone; renaming at PR time costs nothing if preferred. |

---

## §11. Tests (new unless noted; all Vitest + jsdom, existing mock patterns)

**Appointment ownership**
- `src/lib/calendar/__tests__/appointmentOwnership.test.ts`:
  - an explicit assignee wins; empty, `undefined` or non-string falls back;
  - `created_by` is always the creator;
  - the responsible user is `user_id`, else `created_by` (#22), and `created_by` never rescues another user's row;
  - the open-status set.
- `src/contexts/__tests__/calendarAddAppointmentOwnership.test.tsx` (builds on the `calendarViewAsIdentity` builder
  mock), asserting the recorded insert payload:
  - Admin + explicit Agent A → `user_id = A`, `created_by = ADMIN`, `organization_id = REAL_ORG`;
  - no explicit assignee → self;
  - a caller-supplied `organization_id` or `created_by` never wins;
  - `updateAppointment` injects neither field, and a 0-row result throws instead of reporting success. Its rollback
    refetch is silent (`loading` stays false);
  - **mapper:** fetched raw rows keep `created_by` and `raw_status`. A raw lowercase `cancelled` keeps `raw_status` while
    `status` reads "Scheduled", and a NULL-`user_id` row keeps `created_by`. The optimistic update merge and the add
    append carry both fields;
  - **freshness ordering:**
    - a non-silent fetch followed by a silent one that resolves first leaves `loading === false` and keeps the
      newer data;
    - a silent fetch in flight, then `addAppointment` resolves, then the fetch resolves: the added row remains, and
      exactly one follow-up silent refetch is issued;
    - a silent call during an in-flight fetch is a no-op;
  - the `...a` pass-through is unchanged: a camelCase object reaches `insert` with its keys untouched, so DialerPage's
    two out-of-scope calls cannot start creating duplicate rows.
- `src/pages/__tests__/calendarPageAppointmentOwnership.test.tsx`, with its own harness:
  - a mocked `AppointmentModal` records `open`, `editing` and `onSave`;
  - a `useCalendar` mock supplies `appointments`, so clicking a rendered appointment drives `openEdit`;
  - `addAppointment`/`updateAppointment` are `vi.fn` recorders, and `supabase.functions.invoke` is mocked;
  - `calendarContactIdentity` only mocks the modal to `null`, so it is not reused as-is.

  The cases:
  - the selected assignee survives the CalendarPage transformation;
  - the create payload is sent to `addAppointment`;
  - an edit sends the chosen `user_id` with **no** `created_by` or `organization_id`;
  - reassignment A→B persists;
  - an edit of a NULL-`user_id` row keeps `created_by` as the responsible user;
  - the Google create is invoked only for self-assigned appointments;
  - the "Not added to your Google Calendar" note appears only when `googleConnected`;
  - a rejected `updateAppointment` gives the failure toast, and `handleSave` resolves `false`.
- `src/components/calendar/__tests__/appointmentModalAssignee.test.tsx`:
  - edit-init uses `user_id`, then `created_by`, then self;
  - the missing-from-list assignee is rendered as the selected option;
  - in the Agent branch, another user's id shows "Current assignee", not the viewer's name;
  - `onSave` emits it unchanged;
  - D-16: `onSave` resolving `false` keeps the modal open with no success toast, while `true` or `void` toasts and
    closes.
- `src/components/contacts/__tests__/fullScreenContactViewSchedule.test.tsx`:
  - Schedule calls `addAppointment` **once** with the picked `user_id` and `status`, `contact_id = contact.id` (not
    the modal's empty `contactId`) and `contact_name`;
  - there is no direct `appointments` insert;
  - on failure the handler toasts the error and resolves `false`; with missing org or user context it resolves
    `false`; on success it resolves `true`;
  - it uses a props-recording mock of the card (same `@/` path). The mounted card receives `contactId = contact.id`,
    `contactType`, `organizationId`, and a `refreshKey` bumped after success;
  - `refreshKey` is bumped after success.
  - The end-to-end "no success toast" is pinned in the modal suite (D-16).

**Reminders**
- `src/lib/calendar/__tests__/reminderEligibility.test.ts`:
  - fires for the assigned user;
  - not for the creator/Admin when the row is assigned elsewhere;
  - not for an unrelated org-visible row (Admin holds org-wide rows);
  - Cancelled, Completed and No Show never fire; Confirmed does;
  - a raw lowercase `cancelled` / `no_show` / unknown status never fires, even though the mapped status reads
    "Scheduled";
  - NULL `user_id` + `created_by` = viewer fires (D-1 B), with other `created_by` → no;
  - reassignment A→B moves eligibility;
  - characterization of the lead-time boundaries, the +30-minute cutoff, snooze and shown-once.
- `src/components/layout/__tests__/reminderPopupRecipient.test.tsx` (fake timers; mocked `useCalendar`/`useAuth`):
  - an Admin viewer gets no dialog for Agent A's appointment, and does get one for their own;
  - an **Agent A viewer** gets the dialog for a row with `user_id` = A and `created_by` = Admin;
  - one case renders under the **real `CalendarProvider`** with a mocked client, so raw row → mapper → reminder is
    covered end to end;
  - queue revalidation: a queued or showing reminder is dropped or closed once a refresh shows it reassigned away or
    cancelled.
- `src/hooks/__tests__/useAppointmentsFreshness.test.tsx` (fake timers, stubbed `visibilityState`/`onLine`):
  - calls the silent refresh every 5 minutes only while visible and online;
  - on becoming visible, refreshes only when the last refresh is more than 2 minutes old;
  - stops on unmount.

**Contact follow-ups**
- `src/hooks/__tests__/useContactFollowUps.test.tsx` (a real `QueryClientProvider` with retry off; reads mocked). This
  is where "fail safely" across the two queries lives:
  - tasks reject while follow-ups resolve ⇒ `error` with no items, and the reverse ⇒ `error`; both resolve ⇒ `ready`;
  - re-rendering from contact A to contact B never exposes A's items, including during B's loading state;
  - a `refreshKey` bump refetches both queries;
  - the query stays disabled while `organizationId` or `contactId` is missing;
  - `refetchInterval` is set only on the follow-ups observer, never on the shared tasks key;
  - a failed background refetch with data keeps the data and flags "couldn't refresh".
- `src/lib/__tests__/contactFollowUps.test.ts` (mocks `@/integrations/supabase/client`, because the module imports
  `dashboard-callbacks.ts`):
  - an appointment for the matching contact appears;
  - a Follow Up / Call Back appointment appears as a **Callback** only when Scheduled;
  - **parity:** the card's callback-type predicate and the Dashboard contract's (`APPOINTMENT_CALLBACK_TYPES` +
    `Scheduled`) agree over the same fixtures;
  - a shadow row (title exactly "Callback" + Sales Call) is suppressed, but a "Callback: X" row re-typed to Sales
    Call is kept as an Appointment;
  - D-17: a non-callback appointment is listed until `end_time`, or start + 30 min without one. It shows
    "In progress" once started, is never overdue, and drops out after it ends. A callback-type row stays overdue;
  - a campaign callback appears for the matching lead;
  - `callback_due_at` wins over `scheduled_callback_at`;
  - both timestamps set → exactly **one** item;
  - a terminal status is excluded;
  - an open task appears; a completed task is not counted;
  - the overdue calculation holds for callback-type appointments and campaign callbacks (`< now`) and for tasks
    (TasksPanel parity). Non-callback appointments are never overdue (D-17);
  - D-12:
    - a task due today, as the only follow-up, is the primary item and never yields the empty state;
    - a task due today plus an appointment tomorrow makes the task primary;
    - a task due today ranks after today's timed items;
    Day-boundary cases follow the repo's LA-gated pattern (`localCalendar.test.ts`): they run under
    `TZ=America/Los_Angeles` and are skipped, not vacuously passed, elsewhere;
  - a task whose `task_type` is 'Follow Up' stays kind `task`; the task assignee name comes from the embed first;
  - ordering is chronological with a deterministic tie-break;
  - the summary counts are correct:
    - primary = the next upcoming item, else the most recently due overdue item;
    - `others = max(0, total − 1)`; `overdue` counts the others only; `truncated` reflects capped sources;
    - an empty list gives `others = 0`;
  - cross-contact rows (other contact id, and a task with another `contact_type`) never appear;
  - the assignee resolves via #22.
- `src/lib/__tests__/contactFollowUpsQueries.test.ts` (recording builder mock):
  - the `org` and `contact_id` / `lead_id` `.eq()` filters are present;
  - there is no campaign read for a client or recruit;
  - the terminal filter string is exact;
  - an error in any source rejects the whole call only after every read settles, with no partial result;
  - the abort signal cancels the reads, and a cancellation is not logged as a query failure;
  - the appointments select includes `notes` and `end_time`, and the campaign read is ordered by `id`.
- `src/components/contacts/__tests__/addTaskModalDueDate.test.tsx` (only if D-15 = A; LA-gated):
  - picking today's local date passes validation;
  - the submitted `due_date` is that local date's midnight as an ISO instant;
  - the default is the local date;
  - a past local date is still rejected.
- `src/components/contacts/__tests__/contactFollowUpsCard.test.tsx`:
  - the header tooltip text (D-20);
  - View all is hidden when empty;
  - a failed background refetch keeps the shown data with "Couldn't refresh", while a failed first load shows the
    error panel;
  - the four states render at the same height class;
  - the primary line and footer text;
  - the empty state + add menu;
  - the loading and error states never show "No follow-ups";
  - View all groups Overdue and Upcoming.
- **Modified:** the existing tests that render the real `FullScreenContactView` get the one `vi.mock` line (D-13).

**Supabase client in tests.** Every new test file mocks `@/integrations/supabase/client` with the inline
chainable-builder pattern (89 suites do), or is shown not to import it transitively. ReminderPopup, AppointmentModal,
CalendarContext, `tasksApi`/AddTaskModal and `dashboard-callbacks` all create the client at import time.

**Brief → test traceability**

| Brief requirement | Covered by |
|---|---|
| Own-1 Admin creates for Agent A ⇒ `user_id` = A | `calendarAddAppointmentOwnership`, `calendarPageAppointmentOwnership` |
| Own-2 `created_by` stays Admin | same two suites; the update payload has no `created_by` |
| Own-3 Admin gets no reminder for A's appointment | `reminderEligibility`, `reminderPopupRecipient` (Admin viewer) |
| Own-4 Agent A does get it | `reminderEligibility`, `reminderPopupRecipient` (**Agent A viewer**, row `created_by` = Admin), plus the end-to-end case under the real `CalendarProvider` |
| Own-5 Self-assignment still works | `appointmentOwnership`, `calendarAddAppointmentOwnership` (no explicit assignee) |
| Own-6 Editing never silently changes the assignee | `calendarPageAppointmentOwnership` (edit keeps `user_id`; NULL-owner row keeps `created_by`), `appointmentModalAssignee` |
| Own-7 Explicit reassignment moves the recipient | `calendarPageAppointmentOwnership` (A→B), `reminderEligibility` (A→B) |
| Own-8 Cancelled/Completed not reminded | `reminderEligibility` (incl. raw lowercase statuses) |
| CalendarPage transform keeps the assignee | `calendarPageAppointmentOwnership` |
| `addAppointment` keeps the assignee | `calendarAddAppointmentOwnership` |
| Unrelated org-visible row never reminds | `reminderEligibility` |
| FU appointment for the matching contact | `contactFollowUps` |
| FU non-campaign callback shown as Callback | `contactFollowUps` (+ Dashboard parity) |
| FU campaign callback for the matching lead | `contactFollowUps`, `contactFollowUpsQueries` |
| FU `callback_due_at` wins; no duplicate | `contactFollowUps` |
| FU terminal campaign callback excluded | `contactFollowUps`, `contactFollowUpsQueries` (exact filter) |
| FU open task shown; completed task not counted | `contactFollowUps` |
| FU overdue calculation; chronological order; summary count | `contactFollowUps` (LA-gated day cases) |
| FU cross-contact rows never appear | `contactFollowUps` (normalizer guards), `contactFollowUpsQueries` (`.eq` filters), `useContactFollowUps` (A→B switch), `fullScreenContactViewSchedule` (card receives `contactId`/`contactType`) |
| FU fails safely | `contactFollowUpsQueries`, `useContactFollowUps`, `contactFollowUpsCard` |
| Viewer timezone display | `contactFollowUps`: LA-gated `viewerTimeZoneLabel` (after 2026-11-01 ⇒ PST, before ⇒ PDT) |
| Existing Dashboard callback tests stay green | regression gates below |

**Regression gates (must stay green, unchanged):**
- `src/components/dashboard/__tests__/**`: 291 passing and 12 skipped at baseline, including the 4 core callback
  files with 158 tests;
- `appointmentFilters.test.ts`;
- `calendarViewAsIdentity`, `calendarContactIdentity`, `calendarPageListFilter`;
- all `fullScreenContactView*`, `contactsFullScreen*`, `contactDeepLink*` and `viewAsRouteAllowlist` tests, plus
  `conversationDispositionColors.test.tsx`, which also renders the real FSCV;
- **`dialerRenderStability.test.tsx`**. It mounts the **real** AppointmentModal (closed) inside the real DialerPage
  under a Profiler commit budget (`commits <= 30`, `:266`). AppointmentModal's changes therefore add **no**
  unconditional state or effects that run while closed:
  - the new `saving` state only changes during a save;
  - the extracted `AppointmentAssigneeField` renders only inside the open dialog;
  - the existing profiles effect stays exactly where and as it is.
- source-text guards that read touched files:
  - `clientCustomFieldsWriteGuard.test.ts` (`:318-332`) reads `FullScreenContactView.tsx` and requires exactly 5
    `isReservedCustomFieldKey(` matches plus specific literal lines. The FSCV edits leave those untouched.
  - `floatingDialerRecent.test.ts` and `inboundDeviceLifetime.test.ts` read DialerPage/FloatingDialer, which are not
    touched;
- the Dashboard contract's literal `["Follow Up", "Call Back"]` is not pinned by any existing test, so the new parity
  test pins it with a literal `toEqual`.

---

## §12. Verification plan

- **Baseline (recorded 2026-09-28 on `5d37e5f`, before any change):**
  - `npx tsc --noEmit` exits 0, but the root `tsconfig.json` has `files: []` plus references, so it type-checks
    nothing.
  - `npx tsc --noEmit -p tsconfig.app.json` reports **90 pre-existing errors**, including 1 in `AppointmentModal.tsx`
    (`:230`) and 1 in `AddTaskModal.tsx`.
  - **Focused suites** (Dashboard, calendar lib, the calendar/contact-view/deep-link/View-As pages, and
    `src/components/contacts/__tests__`): **35 of 36 files and 571 tests pass, 12 skipped**.
    - The 1 failing file, `addLeadAssignmentGate.test.ts`, fails at collection with "supabaseUrl is required".
    - This is the known environment artifact: the container has no `.env.local`. The Calendar List-filter WORK_LOG
      entry records the same, with suites failing collection without Supabase env. It is not a code failure and not
      in scope.
  - **ESLint** on the six files to be modified (`CalendarContext`, `CalendarPage`, `AppointmentModal`,
    `ReminderPopup`, `FullScreenContactView`, `TasksPanel`): **1 error, 10 warnings**, all pre-existing.
    - The error is `AppointmentModal.tsx:42`, `prefer-const`.
    - The warnings include exhaustive-deps: `ReminderPopup:128` and `CalendarContext:203`/`:220` (missing
      `user?.id`), `AppointmentModal:271`, `FullScreenContactView:286` and `CalendarPage:178`.
  - **Full suite (`npx vitest run`):** 226 files: **214 pass, 12 fail**. 3,448 tests: **3,433 pass, 1 fails,
    14 skipped**.
    - 11 of the failing files fail at collection with "supabaseUrl is required" (no Supabase env in this container).
    - The 1 failing test is `recordingRetentionVoicemail.test.ts` › "byte-identical to deployed v29", an Edge Function
      source-identity check.
    - The run also reports **1 unhandled-rejection Error**.
    - All 12 failures and the 1 Error are pre-existing and unrelated to this scope. The gate is **no new failing
      file and no new Error** relative to this list.
    - An independent re-run matched: the same 12 files and the same 1 Error. It showed 3,435 passed and 12 skipped;
      the 2-test difference in skips comes from environment-dependent skips.
    - With dummy `VITE_SUPABASE_*` env vars the 11 collection failures pass.
  - A narrower "relevant" set (calendar, reminder-adjacent, FSCV/deep-link, Dashboard callback and View-As suites) is
    **22 files and 348 tests, all passing**.
  - The repo has **no typecheck npm script and no CI job running vitest, tsc or eslint**. These gates are enforced
    only by the commands in this section.
- **Handoff gates:**
  1. `npx tsc --noEmit` passes. `npx tsc --noEmit -p tsconfig.app.json` reports at most 90 errors, with **zero** in
     any new file and no new error in a touched file.
  2. `npx vitest run` over every §11 file and the regression gates passes. Any collection failure in a new or §11
     file is a **regression**, never an "environment artifact". The same run also passes as
     `TZ=America/Los_Angeles npx vitest run <the day-boundary suites>`, so the LA-gated cases actually execute.
  3. A full `npx vitest run`, compared with the baseline, shows no new failures. Pre-existing failures are
     distinguished explicitly from regressions.
  4. `npx eslint <new + touched files>` introduces no new errors or warnings compared with the baseline.
  5. An adversarial self-review of the diff.
- **Manual (optional, local dev only):**
  - Admin schedules for Agent A: the Admin gets no popup and A does (within 5 minutes).
  - The contact card shows the appointment with A as the assignee.
  - A Cancelled appointment gives no popup.
- **No production write, deploy, merge or push to `main`.** A push to this branch or a PR happens only when Chris
  asks.

---

## §13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The assignee fix regresses again (it already did once) | Payload-level tests on the context, the page and the contact view (§11) |
| Creators silently lose reminders they used to get for others' rows | Intended by the invariant; stated in the WORK_LOG and the handoff |
| Google duplicate re-import | D-4 guard + test on create. Latent residual: reassigning an already Google-linked row (0 integrations today; the pre-fix edits already broke the linkage) → §14(3) inbound-lookup fix |
| Some edits now need a valid JWT role. This covers a TL or claimless Admin editing rows they neither own nor created, and a TL or claimless Admin **handing off** a row assigned to them that they did not create (the new row fails SELECT) | These edits fail loudly (RLS error or 0 rows ⇒ "Failed to update appointment") instead of silently taking the row over. D-22; the RLS follow-up is §14(5) |
| Calendar spinner stuck / pre-write snapshot overwriting local writes | §5.3 rules 1-4 + provider ordering tests |
| Refresh load | 5-minute, visible-only, single-flight, no query under View As; ~65 rows today |
| Card breaks the existing contact-view suites | D-13 mocks; the card fails closed on its own errors |
| Callback contract drift | Imports the exported constants; a parity test pins the strings; zero edits to `dashboard-callbacks.ts` |
| Overdue mismatch with the Tasks tab | Shared `getTaskDueStatus` |
| `.or()` raw filter string | Static column-only string; ids only via `.eq()` |

**Rollback:** revert the branch commit(s). There is no data or schema state to unwind.

## §14. Discovered follow-ups (NOT in this change; each needs its own approval)
1. **`dialer-api.saveAppointment` UTC wall-clock bug — the NEXT SEPARATE BUGFIX (Chris's redline 3):**
   - Out of scope for this branch: DialerPage, Twilio, queue behaviour and callback writers are untouched.
   - Dialer appointments and callback shadow rows are stored about 7 hours early in Pacific time (5/5 verified), so
     their reminders fire early.
   - Fix the writer to send absolute instants and add `created_by`.
   - Any repair of existing rows is a production mutation.
2. **Realtime:** add `appointments` to `supabase_realtime`, or build a narrow per-user feed, to replace polling (D-3 D).
3. **Google Edge Functions:**
   - inbound should match by `external_event_id` + provider + org, not `user_id`;
   - "Google wins" should not overwrite `user_id`;
   - decide whose calendar receives an appointment created for someone else;
   - this also closes the latent "reassign a Google-linked row" duplicate path;
   - pre-existing, and not changed here, for two-way users:
     - "Google wins" rewrites a matched row's `type` to 'Other'. A self-assigned Follow Up pushed to Google therefore
       stops counting as a callback on the Dashboard and on the card after the next inbound run.
     - A cancellation made in the booker's Google Calendar never reaches a row whose `user_id` is someone else.
     - 0 integrations exist today.
4. **CalendarPage dead code / Google edit path:**
   - `appointmentMetaById` is never set, so update and delete never sync to Google, and the "Managed in Google
     Calendar" guard never fires.
   - Delete also syncs *after* the row is gone, so the Edge Function gets a 404.
   - `syncAppointmentToGoogle` ignores the invoke `error`.
   - Editing an externally-sourced row stamps `sync_source: "internal"`. The update payload keeps that
     today-identical field, because changing it interacts with loop prevention and belongs to the Google follow-up.
5. Team Leader appointments visibility:
   - The picker (`upline_id`) disagrees with the appointments RLS TL branch (`team_id`), and that branch is dead
     (`team_id` NULL for everyone).
   - `tasks` already uses `hierarchy_path`; aligning appointments is its own RLS change.
   - Optional hardening, `#APPROVE_RLS_CHANGE` territory: stop Agents assigning to others at the DB, and
     default/guard `created_by`.
   - Repairing the 3 users missing `app_metadata.role` is a production mutation.
6. `handle_appointment_workflow_events` matches `no_show` spellings, but the app writes `'No Show'`, so the
   no-show workflow never fires.
7. DialerPage's two remaining camelCase `addAppointment` calls:
   - `:3619` (reachable whenever a disposition has `appointmentScheduler`) and `:4917` (the unreachable modal) are
     failing writes that should be **deleted**, just as this plan deletes FSCV's `:1484`. DialerPage is out of scope
     here.
   - The unreachable Dialer modal and callback modal should go with them.
8. If D-15 = B, the `AddTaskModal` date bug remains: date-only `due_date` stored as UTC midnight, today rejected in
   US zones. There are 0 tasks in production today.
9. TasksPanel lets Admins and TLs tick tasks they can see but not update. `tasks_update_own` only allows the assignee
   or creator. The RLS-filtered no-op update returns `null` without an error, so a success toast shows while nothing
   changed. TasksPanel also renders "No tasks yet" on a query error.
10. `CalendarContext.fetchAppointments` has no limit and orders ascending from −180 days.
    - PostgREST `max_rows` (Supabase default 1000) would drop the **newest** rows first, i.e. the future rows
      reminders need, in a large org.
    - Production has 65 rows, so it is not a problem today.
    - The durable fix is a narrow per-user upcoming-reminder feed, or realtime (item 2).
11. The ReminderPopup "Call Now" button looks up the phone in `leads` only. Client and recruit appointments fall back
    to a placeholder number. "View Contact" navigates with no contact type.
12. **Post-Reports reconciliation item (D-19, Chris's redline 1):** unify the attribution of booked appointments. The
    Group leaderboard, GoalProgressWidget and getPerformance count by `user_id` (the assignee), while the org
    leaderboard uses `COALESCE(created_by, user_id)` (the scheduler). No Reports, Analytics, leaderboard, goal-widget
    or reporting-reader file changed in this branch; reconcile after the Reports session lands. Only NEW
    cross-assigned bookings diverge (production had 0 rows with `user_id ≠ created_by` on 2026-09-28).
13. Calendar display: populate the always-blank "Agent" label from `user_id`, so a scheduler can see who is
    responsible.

Found during implementation and testing (2026-09-29; pre-existing unless stated, none fixed here):

14. `AppointmentModal.handleDelete` does not await `onDelete`, toasts "Deleted" and closes before the delete settles,
    and `CalendarContext.deleteAppointment` has no zero-row check (an RLS-hidden delete reports success). CANCEL stays
    enabled while a save is in flight.
15. `updateAppointment`'s optimistic merge re-maps from snake_case keys, so a payload without `contact_name` /
    `contact_id` / `notes` blanks them on screen until the next fetch. Latent: the only caller (CalendarPage) always
    sends them.
16. A CalendarPage-vs-context organization mismatch surfaces as the generic failure toast rather than a specific one.
17. `fullScreenContactViewSaveFailure`'s "falls back to a safe message" case takes ~2.8 s on `main` too and can hit
    the 5 s default timeout under heavy parallel load.
18. The FSCV right-column wrapper repeats the width classes on the inner card (harmless; kept to avoid restructuring).

## §15. Pre-approval review record
This plan was built from a read-only audit and hardened by adversarial review before handoff. Nothing in these
passes wrote to the repo's application code, GitHub or the database.

1. **Audit:** 9 independent read-only auditors, one per area:
   - appointment writers;
   - reminders;
   - contact-view layout;
   - the callback contract;
   - tasks;
   - schema/RLS (including live read-only catalog checks);
   - test baseline;
   - parallel-work conflicts;
   - appointment readers.
2. **Verification:** a separate skeptic per area tried to refute each auditor's plan-critical claims.
   - Every root-cause claim in §0/§2 was **confirmed**.
   - Corrections folded in:
     - the new-row SELECT check that blocks TL hand-offs (D-22);
     - status coercion in `mapAppointment` (the `raw_status` gate);
     - the `en-US` locale for the tz label;
     - the Follow Up-as-meeting labelling trade-off (D-23);
     - the `dialerRenderStability` commit budget and the FSCV source-text guard as regression gates;
     - docs-only conflicts with open PRs.
3. **Design review:** four lens reviewers covered ownership/reminder correctness, the data contract, rules/scope/
   tests, and UX/product fit. Changes that resulted:
   - the §5.3 spinner and write-race rules;
   - the D-16 await/toast semantics, with silent rollback refetches;
   - Dashboard parity for callback statuses (D-8, revised);
   - next-actionable primary item and task-day ranking (D-12, revised);
   - past appointments leave the card (D-17);
   - the fixed-height states, height budget and empty-state wording (D-6, D-20);
   - the local-date task fix (D-15);
   - hook and mapper tests, plus the brief→test traceability table.
4. **Plan location:** after the conflicts audit, the plan moved to `docs/plans/…` with a root §17 pointer, so the
   leaderboard record and the Reports session's §16 stay intact.

Open items needing Chris: decisions D-1 … D-23 (§10). Nothing is blocked on a backend change. Every backend or RLS
improvement found is listed in §14 for separate approval.

## §16. Approval record (2026-09-28)
Chris approved implementation using the recommended options for **D-1 … D-23**, with these redlines:
1. **D-19.** No change to any Reports, Analytics, leaderboard, goal-widget or reporting-reader file in this branch.
   The existing readers stay untouched. The difference between assignee credit and scheduler credit is documented
   as a **post-Reports reconciliation item**; the Reports session remains isolated.
2. **D-22.** Fail closed. A reassignment the current permissions deny must surface an accurate failure. There is no
   RLS weakening, no SECURITY DEFINER workaround, no auth-claim change and no production backend change.
3. The Dialer's 7-hour appointment/callback timestamp bug stays **out of scope**. It is documented as the next
   separate bugfix. DialerPage, Twilio, queue behaviour and callback writers are not touched.
4. The contact UI is the compact Follow-ups card added to the **existing** contact page. The contact card is not
   redesigned or restructured.
5. There is no schema/RLS/migration change without stopping for approval first. No push, merge, deploy or
   production Supabase change is made; work stops after local verification.

## §17. Implementation record (2026-09-29) — implemented and verified locally; NOT pushed

Branch `claude/contact-followups-appointment-fix-rruo7i` (base `main` @ `5d37e5f`). Frontend only: no migration, RLS,
RPC, Edge Function, deploy or production access during implementation. Redlines 1–5 (§16) were honoured.

**Post-implementation review fixes (each with a regression test that fails on the pre-fix code):**
- `CalendarContext`: a fetch that overlaps an in-flight write — started before it settled, or landed while it was
  pending — is discarded and re-issued once no write is pending (`beginWrite` / `endWrite`), so a pre-commit snapshot
  cannot revert an edit, restore a delete or duplicate an insert. The spinner clears only when the last non-silent
  fetch settles.
- `CalendarPage`: the Google sync runs detached after the database write, so a slow sync can never close, or hold
  the saving state of, a modal opened in the meantime. `AppointmentModal` also scopes a pending save to the open
  session that started it.
- `ReminderPopup`: a dismiss only closes the reminder it was aimed at (timer and Call Now), the queue dequeues the
  first still-eligible reminder by id, and a queued reminder dropped by revalidation is forgotten so it fires again
  if the appointment becomes eligible again.
- Follow-ups card: an empty list whose background refresh failed shows "Couldn't refresh · Retry"; a `refreshKey`
  bump while the first read is still pending cancels that pre-write read instead of joining it.

**Verification:** app typecheck 90 → 90 diagnostics against the `main` baseline (only the pre-existing AddTaskModal
TS2345 message is reworded); root `tsc` 0. ESLint: new files clean; touched files 11 → 7 problems, all pre-existing.
Focused suite (52 files) 818 passed / 10 LA-gated skips in UTC and 828 passed in `America/Los_Angeles`; the only
failure is `contactName.test.ts`, a `main` baseline failure (no Supabase environment in this container). Full suite:
240 files, 3,715 passed / 1 failed / 22 skipped, 1 unhandled error — the same 12 failed files, the same failing
test (voicemail v29 byte-identity) and the same unhandled Twilio-mock rejection as `main` (226 files, 3,435 / 1 / 12).
