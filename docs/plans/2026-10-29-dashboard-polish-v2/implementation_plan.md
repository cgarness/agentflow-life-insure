# Dashboard Polish V2 — Clear / Dismiss, visual polish, Team-mode context — Implementation Plan

**Date:** 2026-10-29 · **Branch:** `claude/upbeat-cannon-uy6fpg` (from `main` `7a03033`) · **Mode:** FEATURE
**Status:** **GATE 1: PLAN ONLY, awaiting Chris's approval.** No source file was edited and no backend write ran.
The only production access was read-only catalog/metadata queries plus aggregate counts (§1).

| Gate | What it approves | Touches |
|---|---|---|
| **G1** (this) | This plan, the decisions in §11 and the file list in §9 | — |
| **G2** | Frontend + migration package on the feature branch, local tests | Frontend, tests, migration *files* (never applied) |
| **G3** | ⛔ The exact migration bytes and RLS (`#APPROVE_RLS_CHANGE` level), then apply + read-back + advisors + history | Production database |
| **G4** | CI, Vercel preview, visual verification | PR |
| **G5** | Production frontend release (merge) and `VITE_DASHBOARD_ATTENTION_CLEARANCES=true` | Vercel production |

Nothing in this plan is production-live until G3 and G5 are each separately approved and verified.

---

## 1. Preparation (read-only)

- **Read:** `AGENT_RULES.md` §3 tenancy (and the downline query-enforced rule), §5 schema gotchas, §6 Dialer, §7 component
  standards, §8–§10, invariants #8/#9 (duration, Twilio refs), #15/#16 (queue, callback ownership), **#22** (dual-source
  callback contract, error semantics, request lifetime, appointment ownership), #23 rev 1.2/1.3 (section lanes,
  follow-on reads, truthful states), **#30 + D13** (inbound ownership, monotonic `is_missed`, "my missed calls" scope), #31
  (View As), the **Dashboard Client Milestones invariant**; `VISION.md`; `WORK_LOG.md`; the previous plan
  `docs/plans/2026-10-29-dashboard-premium-redesign/implementation_plan.md`.
- **Main verified:** `origin/main` = `7a03033492c55fd16ea1bacd049934102fe340e4` (PR #502). Vercel project `agentflow`
  production deployment `dpl_EDZ4obVUw3dgB8fwxPi7PnbgkoUq` for that SHA is **READY**.
- **Stale notes (to correct in the G2 doc commit):** the newest `WORK_LOG.md` entry, the AGENT_RULES Client Milestones heading
  ("G3 frontend not deployed") and the premium-redesign plan header still say G3 is branch-only. PR #502 is merged and deployed.
- **Production schema (read-only, `jncvvsvckxhqgqvkppmj`):**
  - Migration history: 351 rows, head `20261029120000` (`dashboard_milestone_reviews`).
  - `dashboard_milestone_reviews` exists (0 rows). Its two SECURITY INVOKER RPCs exist.
  - **No** clear/dismiss table for callbacks or missed calls exists. The only `dashboard*` table is the milestone one.
  - `calls` SELECT RLS: own / Admin org / TL downline (`is_ancestor_of`) / **any org member for `direction='inbound' AND agent_id IS NULL`** /
    **Agency Group peer read** (`is_agency_group_peer_organization`; 0 groups today).
  - `campaign_leads_select`: Admin/TL org-wide; Agents by campaign type (JWT role, #22 known limitation).
    `campaign_leads_update` is org-wide, which is one more reason this feature never writes there.
  - `appointments_select`: org AND (user_id/created_by = me, Admin, Super Admin, TL by `team_id`).
  - `profiles_select_org` lets any same-organization user read profiles (names), so owner names resolve in an
    organization-scoped batch with no RLS change.
  - `get_performance_details` (KPI modals, SECURITY DEFINER) returns `agent_id` only for policies/premium rows. It returns
    **no agent for calls or appointments and no carrier** for policies (§6).
  - Aggregates only (no PII): 112 missed inbound calls in 30 days. **All 112 have `agent_id` NULL**, 54 have
    `missed_for_agent_id`, 112 have a single-recipient snapshot, 0 have multiple recipients, and 51 have no linked contact.
    In-window callbacks: 2 campaign, 0 legacy, 9 appointment.
- **Not verifiable from this session:** Vercel environment variable names (the API returned 403). Chris must confirm whether
  `VITE_DASHBOARD_MILESTONE_REVIEWS=true` is set in production. Milestone **Dismiss** renders only when it is (§3.2).

## 2. Findings that shape the design

1. **Client-side filtering of a limited page would lie.** Widget and modal callback pages are already limited (15 / 20
   per page, fetched to `offset + pageSize` per branch). Dropping cleared rows afterwards would show short pages, wrong
   "View All N" totals and false empty states. The exclusion must be part of the paging math (§3.5).
2. **Callback bucket headers count the loaded page, not the queue.** "Overdue (15)" is shown when there are 40 overdue
   callbacks. This is fixed with exact or lower-bound counts from the existing ordering, with no extra queries (§3.5.4).
3. **Missed Calls has two divergent readers.** The widget (`MissedCallsWidget.loadMissedCalls`) resolves leads/clients
   for Call back. The modal (`useDashboardDetailFeed`) does not, so Call back is disabled on most modal rows. Neither shows a
   total.
4. **Latent cross-tenant exposure in Missed Calls Team mode.** The missed-call reads do not filter `organization_id`, and
   `calls` has an Agency Group peer-read policy. Once a group is active, an Admin's Team list would include peer agencies'
   missed calls, with names and phones. 0 groups exist today. Fix: the shared module adds
   `.eq("organization_id", viewerOrg)`. This only narrows.
5. **Disabled buttons hide their reason from keyboard users.** `disabled` plus `title` cannot be focused or read.
6. **No room left under the 200-line rule.** `CallbacksWidget.tsx` and `MissedCallsWidget.tsx` are at 198 lines, and the
   Callbacks modal is at 179. New behaviour requires extraction (§9).
7. **Status colors are inconsistent with the approved palette.** Due Today is emerald (should be blue), Schedule
   "Scheduled" is neutral (should be purple), "Completed" is blue (blue means calls). The widget says "Due Soon" while the
   modal says "Upcoming".

---

## 3. A — Clear / Dismiss

### 3.1 Vocabulary (enforced by a copy test)

| Surface | Action | History label | Badge | Never |
|---|---|---|---|---|
| Missed Calls | **Clear** | **Cleared** | green "Cleared" | Handled, Done, Complete, Resolve |
| Callbacks | **Clear** | **Cleared** | green "Cleared" | Handled, Completed, Cancel |
| Client Milestones | **Dismiss** | **Dismissed** | green "Dismissed" | Handled, Reviewed (UI), Paid |

Helper text on every Clear/Dismiss: *"Hides this from your Dashboard only. The callback stays scheduled and its due time
doesn't change."* / *"… The call, voicemail and reports aren't changed."* / *"… The client record isn't changed."*

### 3.2 Client Milestones → Dismiss (no schema change)

- Reuses `dashboard_milestone_reviews` and `set_/clear_dashboard_milestone_review` unchanged. **Dismiss = stored
  `state = 'reviewed'`.** Only the UI label changes.
- A **visible "Dismiss" button** on widget and modal rows sits beside the primary Call. It replaces the "Mark reviewed"
  menu item. Remind later ▸ stays in the menu.
- The modal status chips become **Pending · Snoozed · Dismissed**. Dismissed rows show "Dismissed {date}" and **Undo**
  (the existing conditional delete).
- The widget gains a **"View dismissed"** link, which opens the modal on the Dismissed view through a new `initialView`
  passed by `Dashboard.openDetail`.
- These semantics already hold and stay unchanged: annual birthday and anniversary dismissals are per occurrence year, so
  they return next year; first-payment dismissals are one-time; client and policy records are never written.
- Still gated by `VITE_DASHBOARD_MILESTONE_REVIEWS` and hidden under View As, as today.

### 3.3 New storage: `public.dashboard_attention_clearances` (G3-gated migration)

One small polymorphic table for per-viewer **alert state** on Missed Calls and Callbacks. It is never a CRM record.

```sql
CREATE TABLE public.dashboard_attention_clearances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id)          ON DELETE CASCADE,
  source_type     text NOT NULL,   -- 'missed_call' | 'campaign_callback' | 'appointment_callback'
  source_id       uuid NOT NULL,   -- calls.id | campaign_leads.id | appointments.id  (NEVER a contact id)
  occurrence_at   timestamptz NOT NULL,  -- SERVER-derived, see below
  cleared_at      timestamptz NOT NULL DEFAULT now(),  -- stamped clock_timestamp() by the guard
  CONSTRAINT dashboard_attention_clearances_source_type_check
    CHECK (source_type IN ('missed_call','campaign_callback','appointment_callback')),
  CONSTRAINT dashboard_attention_clearances_occurrence_key
    UNIQUE (organization_id, user_id, source_type, source_id, occurrence_at)
);
CREATE INDEX dashboard_attention_clearances_reader_idx
  ON public.dashboard_attention_clearances (user_id, organization_id, source_type, occurrence_at);
```

**Occurrence identity (authoritative, server-derived):**

| `source_type` | `source_id` | `occurrence_at` | Still "pending" means |
|---|---|---|---|
| `missed_call` | `calls.id` (works for Unknown / unlinked callers) | `calls.created_at` | `direction='inbound' AND is_missed IS TRUE` (monotonic, D13) |
| `campaign_callback` | `campaign_leads.id` | `COALESCE(callback_due_at, scheduled_callback_at)` (#22 rule) | not in `DNC/Completed/Removed/Failed` (#15) |
| `appointment_callback` | `appointments.id` | `start_time` | `type IN ('Follow Up','Call Back') AND status='Scheduled'` |

A rescheduled callback has a new `occurrence_at`, so no clearance matches it and **it resurfaces**. The old row
becomes inert. (If a callback is moved back to the *exact* earlier instant, it counts as the same occurrence again; D5.)

**No foreign keys to `calls` / `campaign_leads` / `appointments` (D3).** A foreign key would take a `SHARE ROW EXCLUSIVE`
lock on live telephony and queue tables at apply time. It would also make their deletes cascade into this table. A
clearance whose source is gone simply never matches. Growth is bounded by the retention step (D4).

**Guard trigger** `private.dashboard_attention_clearances_guard()`:
- BEFORE INSERT stamps `cleared_at := clock_timestamp()`.
- BEFORE UPDATE raises an error: rows are immutable, and no UPDATE privilege is granted either.

**RLS (enabled; `(SELECT auth.uid())` initplan form, as in the milestone table):**
- `SELECT` / `DELETE` TO authenticated: `user_id = auth.uid() AND organization_id = get_org_id()`.
- `INSERT` TO authenticated WITH CHECK: the same, **and** the source must be visible to the caller under its own RLS,
  in the same organization, currently pending, with `occurrence_at` equal to its current authoritative value:
  ```sql
  CASE source_type
    WHEN 'missed_call' THEN EXISTS (SELECT 1 FROM public.calls c
      WHERE c.id = source_id AND c.organization_id = dashboard_attention_clearances.organization_id
        AND c.direction = 'inbound' AND c.is_missed IS TRUE AND c.created_at = occurrence_at)
    WHEN 'campaign_callback' THEN EXISTS (SELECT 1 FROM public.campaign_leads cl
      WHERE cl.id = source_id AND cl.organization_id = dashboard_attention_clearances.organization_id
        AND cl.status NOT IN ('DNC','Completed','Removed','Failed')
        AND COALESCE(cl.callback_due_at, cl.scheduled_callback_at) = occurrence_at)
    WHEN 'appointment_callback' THEN EXISTS (SELECT 1 FROM public.appointments a
      WHERE a.id = source_id AND a.organization_id = dashboard_attention_clearances.organization_id
        AND a.type IN ('Follow Up','Call Back') AND a.status = 'Scheduled' AND a.start_time = occurrence_at)
    ELSE false END
  ```
  Requiring the source's organization to equal the row's organization (which equals `get_org_id()`) refuses
  Agency-Group peer calls.
- No UPDATE policy.
- Grants: `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`; then `GRANT SELECT, INSERT, DELETE TO authenticated`
  and `GRANT SELECT TO service_role`.

**RPCs — SECURITY INVOKER**, `search_path = pg_catalog, pg_temp`, schema-qualified, EXECUTE to `authenticated` only:
- `public.clear_dashboard_attention_item(p_source_type text, p_source_id uuid, p_expected_occurrence_at timestamptz)
  RETURNS public.dashboard_attention_clearances`
  - Identity comes from `auth.uid()` / `get_org_id()`, and the caller's own profile must be Active in that same
    organization (42501 otherwise).
  - Validates the input (22023).
  - Reads the source's *current* occurrence under the caller's RLS. Not visible or not pending → **PT404** "no longer
    pending". A value different from `p_expected_occurrence_at` → **PT409** "changed since it was shown"; this prevents
    clearing a reschedule the user never saw.
  - Retention: deletes the caller's own rows with `occurrence_at < clock_timestamp() - interval '90 days'` (D4).
  - `INSERT … ON CONFLICT ON CONSTRAINT …_occurrence_key DO NOTHING`, then returns the existing row. A double click or a
    second tab is therefore idempotent: one row, the same id.
- `public.undo_dashboard_attention_clear(p_id uuid, p_expected_cleared_at timestamptz) RETURNS boolean`
  - Deletes only the caller's own row with that exact `cleared_at`, and returns whether exactly one row went.

**Precision rule:** `calls.created_at` carries microseconds. The browser passes the timestamp **string exactly as PostgREST
returned it** for `p_expected_occurrence_at` and for `p_expected_cleared_at`, never through `new Date().toISOString()`,
which truncates to milliseconds and would cause a false PT409. This is pinned by a test.

**Package files (G2, never applied):** the forward migration in `supabase/migrations/pending/`, a rollback that refuses
while rows exist (same pattern as G2), a harness, the SQL suite, a runner and CI (§9, §10). It is renamed to its recorded
version after an approved apply.

### 3.4 Frontend switch and release order

- `VITE_DASHBOARD_ATTENTION_CLEARANCES === "true"`, fail-closed (`src/lib/dashboard-attention-config.ts`, the same shape
  as the milestone config).
  - **Unset:** no Clear buttons, no clearance read, and **request-for-request identical** callback and missed-call queries
    to today. A test pins this.
  - **Hidden under View As** (`isImpersonating`), as milestones are.
- **Release order:** G3 database, then the G5 frontend merge, then the flag. **Rollback:** unset the flag first.

### 3.5 Exact exclusion — Callbacks (the accuracy requirement)

The protected contract `src/lib/dashboard-callbacks.ts` keeps its sources, branches, filters, ownership predicates,
ordering, window and contact resolution **unchanged** (D2). It gains an optional `exclusions` input. With no
exclusions, every query is exactly what it is today.

**3.5.1 Load sequence (widget page + total, modal page, under one `linkedAbort`; every read settles before the lane is
released, per #22 rev 1.3):**
1. Read the viewer's own clearances for `campaign_callback` and `appointment_callback` whose `occurrence_at` falls in
   **the same window** as the branches. The reference instant is computed once per load and passed to every read.
   - Uses `readAllExact` (keyset + exact count). An incomplete read is a failure; the cap is 2,000.
   - `Kc` = campaign clearances, `Ka` = appointment clearances.
2. Follow-on reads (`assertPageActive()` first) run in parallel:
   - **Rows:** each branch is fetched to `offset + pageSize + K_b`, where `K_b` is `Kc` for both campaign branches and `Ka`
     for appointments.
   - **Counts:** the three existing exact counts.
   - **Match reads:** for each branch, `applyBranchFilters` (the same function) plus `.in("id", chunk)` over the cleared ids,
     in chunks of 100, selecting `id` and the due column. A clearance is *matched* only when the row satisfies every
     branch filter **and** its current due equals `occurrence_at`.
3. Drop matched rows, merge, apply the global order (`dueAt`, source rank, `id`), then slice
   `[offset, offset + pageSize)`.
4. `active = Σ exact counts − Σ matched`; `cleared = Σ matched`.

**3.5.2 Why the page is exact.** Let `A_b` be branch `b`'s filtered rows in branch order, and `X_b ⊆ A_b` the matched rows.
Each clearance identifies at most one row (source id + occurrence), and a campaign row is in exactly one campaign branch,
so `|X_b| ≤ K_b`. Removing elements preserves order. So the first `c + K_b` rows of `A_b` contain the first `min(c, |A_b∖X_b|)`
active rows of `b` in order. The global first `c = offset + pageSize` active rows are a union of per-branch active prefixes
of length ≤ `c`, so the union holds them all. This is the existing "fetch each branch to the ceiling" argument with
`K_b` added. There are **no short pages, gaps or duplicates, and no false empty state**. A property test checks this
against a brute-force oracle over random interleavings and random clearances (§10).

**3.5.3 Scope correctness.** Match reads carry the branch's ownership predicate, so a clearance made in an Admin's Team
view for another agent's callback is not subtracted in My view (that row is not in the set). A rescheduled callback never
matches.

**3.5.4 Bucket headers (finding 2), with no extra queries.** Rows come ordered by due time, so on a full page every bucket
strictly before the last row's bucket is exact. The last row's bucket reads "N+". Later buckets are not shown.

**3.5.5 Modal paging.** Callbacks page by **loaded active count** (`offset = rows loaded`), de-duplicated by the
source-qualified key on append, instead of `page × 20`.
- After a Clear or an Undo, the modal **refreshes in place**: one read of `max(loaded, 20)` rows from offset 0 plus the
  totals, which replaces the list. Scroll position is kept and nothing is hidden locally.
- `hasMore = loaded < active` (the exact total), not "the last page was full".
- The footer reads "Showing X of N active callbacks".

### 3.6 Missed Calls: one shared contract plus the same exclusion

- **New `src/lib/dashboard-missed-calls.ts`.** It is the one reader for the widget and the modal (finding 3), and the
  widget's `loadMissedCalls` moves there verbatim:
  - filters: `direction='inbound'`, `is_missed=true`, `created_at ≥ since` (24 h; one `since` per load);
  - **+ `organization_id = viewer org`** (finding 4);
  - `buildMyMissedCallsOrFilter` unchanged when filtered;
  - order: `created_at DESC, id DESC`;
  - the existing leads/clients lookup with `assertPageActive`, so the modal can Call back linked rows too (D9).
- Exclusion uses the same algorithm with `source_type='missed_call'` and `occurrence_at = created_at`.
  - The widget preview fetches `6 + K` rows and shows 5.
  - It now shows "**View all N missed calls**", where N is the exact active count (`head` count − matched).
- **Telemetry untouched.** The Clear path calls only the RPC. A test asserts that no `update`, `insert`, `delete` or
  `upsert` is issued on `calls`, `voicemails` or `notifications`. The SQL suite proves the source row's `xmin` and
  `md5(row_to_json)` are unchanged.

### 3.7 Cleared / Dismissed history

- **Widgets:** a summary line, for example "12 pending · **3 cleared ›**" (callbacks) or "4 missed · **1 cleared ›**". It
  opens the modal on the Cleared view.
- **Callbacks and Missed Calls modals:** an **Active (N) | Cleared (M)** toggle (`aria-pressed`).
  - The Cleared view is complete: every matched clearance in the window, normalized with the same contact resolution.
  - Rows show the green "Cleared" badge, "Cleared {time}", the original status context ("Overdue · due 2:00 PM"), and
    **Undo**.
  - A header note says cleared items are hidden only for you.
- A clearance whose source is no longer pending, or was rescheduled, is not listed: it no longer hides anything.

### 3.8 Action integrity (shared hook `useAttentionClearActions`)

- **Input:** Zod-validated `{ sourceType, sourceId (uuid), expectedOccurrenceAt (offset datetime string) }`.
- **Writes are awaited.** A row leaves the list only after the server returns the stored row, followed by a section
  reload through its lane (widget) or a refresh in place (modal).
  - No optimistic or local-only hiding, and no browser storage.
- **Per-row in-flight lock**, so a double click sends one request; the server is idempotent as well.
- **Toast:** "Callback cleared — **Undo**" (8 s). Undo is a conditional delete. "Changed since then" is reported, never
  faked.
- **Event `agentflow:dashboard-attention-changed`** keeps the widget and modal consistent, like the milestones event.
- **Errors (user-safe copy; the raw error goes to the console):**
  - PT404: "This callback is no longer pending."
  - PT409: "This callback was rescheduled. Refresh to see it."
  - 42501: "You can't clear this item."
  - offline: "You're offline — nothing was cleared."
  - On any of these, the row stays.
- **Focus:** after a row is removed, focus moves to the next row's primary action, else the previous row's, else the
  list's labelled heading (`tabIndex=-1`). After Undo, focus moves to the restored row only if focus was lost to `<body>`.
  The modal shell keeps returning focus to its opener on close.

---

## 4. B — Visual polish (all widgets and existing modals; KPI cards untouched)

### 4.1 Status badges (added to `dashboardTones.ts`, still the only color source)

Every badge has a text label (and an icon where it helps), `text-xs`, and `*-700` (light) / `*-300` (dark) on a `/10`
tint, so it meets AA contrast and never relies on color alone.

| Status | Style | Icon |
|---|---|---|
| Scheduled | purple (`purple-*`) filled tint | CalendarClock |
| Overdue | red filled tint | AlertCircle |
| Due Today | blue filled tint | Clock |
| Upcoming | violet, outline only (distinct from Scheduled) | CalendarDays |
| Missed | red filled tint | PhoneMissed |
| Voicemail | red tint + "Voicemail" | Voicemail |
| Answered on mobile (after an AgentFlow miss) | rose outline | Smartphone |
| Cleared / Dismissed | green (emerald) | EyeOff, so it doesn't read as "completed" |
| First Payment | pink | Wallet |
| Birthday | rose | Cake |
| Anniversary | purple | CalendarHeart |
| Confirmed / Completed / No Show / Cancelled (Schedule) | green / neutral / red / neutral line-through | — |

The long D13 outcome sentence ("Missed in AgentFlow — forwarded to mobile") stays as row text. The badge is the short
form.

### 4.2 Actions

- **New `DashboardActionButton`**, with three variants:
  - **primary** — solid; **Call / Call back is always Calls-blue** (D8), whatever the widget tone;
  - **secondary** — outline: Clear, Dismiss, Calendar, View, Details. Clear and Dismiss pick up an emerald hover and focus
    ring;
  - **quiet** — ghost: the More menu.
- Tap targets are at least 36 px (40 px on mobile). Focus rings use `focus-visible` in the tone colour. Transitions carry
  `motion-reduce:transition-none`.
- **A blocked action stays focusable** (finding 5): `aria-disabled="true"`, an `sr-only` reason linked by
  `aria-describedby`, and activating it toasts the reason, as `handleCall` already does. A busy action shows a spinner and
  `aria-busy`.
- **Order inside a row:** primary, then Clear/Dismiss, then the More menu (View contact, Remind later, …). Nothing is
  hover-only.

### 4.3 Rows, widgets, modals

- **Rows (`DashboardListRow`):**
  - one consistent rhythm: `py-3`, a 12 px gap and a 40 px leading well;
  - title `text-sm font-semibold`, meta `text-xs text-muted-foreground` with ` · ` separators;
  - phone in tabular figures through `phoneUtils`;
  - badges aligned on the right at ≥ sm and wrapped under the text at 390 px with no horizontal scroll.
- **Widgets:**
  - the existing frame and Details button get hover and focus polish;
  - a summary line (§3.7);
  - bucket headers use status colours (Due Today blue, Upcoming violet). "Due Soon" becomes "Upcoming", matching the modal.
- **Schedule:** the Calendar action becomes a labelled secondary button ("Calendar"; icon-only under `sm` with an
  `aria-label`), plus type and status badges.
- **Goal Progress / Leaderboard:**
  - typography only (no 10 px uppercase labels), track contrast and gold accents;
  - no data, gate or standings change;
  - the "no award decoration" rule in `leaderboardWidget.test.tsx` is kept.
- **Modals (`DashboardModalShell`):**
  - the header gets a summary-chip slot (Active / Cleared counts);
  - the toolbar is ordered view toggle, then status chips, then search;
  - the filter chips become a segmented style with visible focus;
  - the footer reads "Showing X of N".
  - Full-width sheet at 390 px; `max-w-[760px]` at 1440 px.
- **Preserved verbatim:** the loading / failed ("Couldn't load …" + Retry) / valid-empty / incomplete ("N+", milestones
  cap note) / offline / stale ("Couldn't refresh — showing … from h:mm") / pagination ("Load more", "Retry page") states
  and their copy. The empty state is still rendered only after a successful complete read.
- **Reduced motion:** the existing `MotionConfig reducedMotion="user"` and `motion-reduce:` variants. No new motion except
  hover colour transitions.

---

## 5. Engineering invariants (E) — how each is kept

- **Telephony:** no change to `TwilioContext.tsx`, `FloatingDialer`, `DialerPage`, `quick-call.ts`, Edge functions,
  call duration, statuses, dispositions or telemetry. Call buttons still use `dispatchQuickCall`.
- **No source mutation:** the only writes are the two new RPCs and the two existing milestone RPCs. Tests assert that
  no write method is ever called on `calls`, `campaign_leads`, `appointments`, `voicemails`, `notifications`, `clients`
  or `dialer_lead_locks`.
- **Tenancy:** every new read carries `organization_id = viewer org` and own-user filters where they apply. RLS remains
  the authority. No RLS change to any existing table.
- **Data access:** `.maybeSingle()` for any zero-or-one read (none is planned). Zod for every action input, every RPC
  return value and every clearance row. Tailwind only. No mock data in production paths. No service role in the browser.
- **Request discipline (#22/#23):**
  - no bare `Promise.all` inside a lane load;
  - every read carries `abortSignal`;
  - follow-on reads call `assertPageActive()`;
  - a returned error rejects the whole load (never a partial page or count);
  - an incomplete clearance read is a failure.
- **Component size:** components stay under 200 lines; new logic goes into libs and hooks (§9).

## 6. C — Team-mode context

**Scope rule unchanged.** `listScopeIsFiltered` (own items unless Admin + Team) and `kpiScopeIsFiltered` are not
modified. A Team Leader in Team perspective keeps seeing their own list items with the existing disclosure. Owner chips
therefore appear only where the viewer already sees other people's records: an Admin in Team view, and KPI modals whose
scope is resolved server-side. **True downline lists for Team Leaders remain a separate approval item; nothing in this
build widens access.**

**Name resolution:**
- One batched, organization-scoped read per load in the new `src/lib/dashboard-people.ts`:
  `profiles.select("id, first_name, last_name").eq("organization_id", org).in("id", ≤100)`.
- No N+1 reads. No avatars, only initials (D7).
- Presentation-only (D6): a failed lookup shows "Name unavailable" plus one notice, never an invented name, and never
  fails the section. Contact identity keeps its strict failure rules.

| Surface (Team) | Adds | From | Not shown — and why |
|---|---|---|---|
| Callbacks widget + modal (Admin Team) | owner chip; contact phone; source "Campaign · {name}" or "Follow-up"; due + status badge | `campaign_leads.callback_agent_id`, `campaign_id`→`campaigns.name` (batched, org-scoped); `appointments.user_id ?? created_by` (the #22 rule) | — |
| Missed Calls widget + modal (Admin Team) | recipient line; caller phone; voicemail / answered-on-mobile badge | **routing metadata**: `missed_for_agent_id` → "Missed for {name}"; else `missed_recipient_ids` (1 → that name, >1 → "Rang N agents: …"); else legacy `routed_agent_ids` the same way; else "No recipient recorded"; `answered_by_agent_id` → "Answered on mobile by {name}" | **Never `calls.agent_id`** (NULL on all 112 recent missed calls), and never a single "assigned agent" when several were rung |
| Schedule (Admin Team) | "Assigned to {name}"; type + status badges | `appointments.user_id ?? created_by` (the workload rule) | — |
| Client Milestones (Admin Team) | "Agent: {name}" | `clients.assigned_agent_id` (added to the read columns, passed through the engine) | — |
| Policies Sold / Annual Premium modals (Team) | writing-agent chip; AP and monthly premium; policy type; Sold date | `get_performance_details.agent_id` + names | **carrier** is not returned by the RPC |
| Calls Made modal (Team) | status/outcome badge, duration, disposition | RPC row | **agent** is not returned by the RPC |
| Appointments modal (Team) | type + status badges | RPC row | **assignee** is not returned by the RPC |

The missing RPC fields need a reviewed `get_performance_details` change (SECURITY DEFINER, exact-preimage guard). That is
listed as a **follow-up needing its own approval (D10)** and is not part of this build.

---

## 7. Behaviour before G3 (flag unset)

The visual polish, the Team context, milestone **Dismiss** (when the milestone flag is on), the missed-calls shared reader
with its organization fix, and the exact bucket counts all work without the new table. Clear on Callbacks and Missed Calls
is not rendered, and no clearance table is read. G4/G5 can therefore ship the polish safely even if G3 is deferred.

## 8. Rollout notes

- **G3 apply route** (decided at G3; D12). The recommendation is the proven protected-workflow pattern used for G2: a
  separate release-only PR with this migration's pinned checksum. MCP `apply_migration` is the alternative.
- After the apply:
  - read back the catalog (table, 4 policies, grants, 2 RPCs, guard, indexes);
  - run the security and performance advisors against the 256 / 466 baseline;
  - record the history;
  - move the file out of `pending/` without changing a byte;
  - regenerate types and diff them against the surgical types added in G2.
- Supabase "Deploy to production" must stay OFF (#30). `pending/` keeps a merge from applying anything.

## 9. Files

**New — backend package (G2 files only; never applied without G3)**
- `supabase/migrations/pending/20261029200000_dashboard_attention_clearances.sql` (placeholder version)
- `supabase/migrations/rollback/20261029200000_dashboard_attention_clearances.rollback.sql`
- `supabase/tests/dashboard_attention_clearances_harness.sql`
- `supabase/tests/dashboard_attention_clearances.sql`
- `scripts/run_dashboard_attention_tests.sh` (localhost-only guard, as the milestone runner)
- `.github/workflows/dashboard-attention-backend.yml` (PostgreSQL 17.6, disposable)

**New — frontend**
- `src/lib/dashboard-attention-config.ts` — flag, fail-closed
- `src/lib/dashboard-attention.ts` — clearance reads, exclusion sets, `sameInstant`, RPC wrappers + Zod, event
- `src/lib/dashboard-missed-calls.ts` — the one missed-call contract (moved from the widget and the feed)
- `src/lib/dashboard-people.ts` — batched names, initials, recipient description
- `src/hooks/useAttentionClearActions.ts`
- `src/hooks/useRowFocusRecovery.ts`
- `src/components/dashboard/ui/DashboardActionButton.tsx`
- `src/components/dashboard/ui/DashboardPersonChip.tsx`
- `src/components/dashboard/ui/DashboardAttentionSummary.tsx`
- `src/components/dashboard/callbacks/CallbackRow.tsx` (shared by widget and modal)
- `src/components/dashboard/missed-calls/MissedCallRow.tsx` (shared by widget and modal)
- `src/components/dashboard/DashboardMissedCallsModal.tsx` (Missed Calls leaves the generic records modal)

**Modified — frontend**
- `src/lib/dashboard-callbacks.ts` — ⚠ protected contract (D2): optional `exclusions`, over-fetch by `K_b`, match reads,
  `fetchCallbackCounts` / `fetchClearedCallbacks`, plus selected columns `campaign_id`, `callback_agent_id`, `user_id`,
  `created_by` for the owner chip. Sources, filters, ownership, ordering and window are unchanged, and
  `fetchCallbackTotal` keeps its signature.
- `src/lib/dashboard-milestones.ts` and `src/lib/dashboard-milestones-data.ts` — pass `assigned_agent_id` through (read only)
- `src/hooks/useDashboardDetailFeed.ts` — callbacks paged by loaded count with exact totals and refresh-in-place; missed
  calls through the shared module; writing-agent names for policies and premium
- `src/hooks/useMilestoneActions.ts` — Dismiss copy
- `src/components/dashboard/widgets/CallbacksWidget.tsx`, `MissedCallsWidget.tsx`, `AppointmentsWidget.tsx`,
  `ClientMilestonesWidget.tsx`, `GoalProgressWidget.tsx` (visual only), `LeaderboardWidget.tsx` and
  `LeaderboardPreviewRow.tsx` (visual only)
- `src/components/dashboard/DashboardCallbacksModal.tsx`, `DashboardDetailModal.tsx` (missed-calls routing, `initialView`),
  `DashboardRecordsModal.tsx`, `DashboardRecordRow.tsx`, `dashboardRecordText.ts`, `DashboardMilestonesModal.tsx`
- `src/components/dashboard/milestones/MilestoneRow.tsx`, `milestoneCopy.ts`
- `src/components/dashboard/ui/dashboardTones.ts` (status map), `DashboardListRow.tsx`, `DashboardRowActions.tsx`,
  `DashboardModalShell.tsx`, `DashboardFilterChips.tsx`, `DashboardWidgetFrame.tsx` (hover/focus only)
- `src/pages/Dashboard.tsx` — `openDetail(type, origin, initialView?)` only; StatCards usage untouched
- `src/integrations/supabase/types.ts` — surgical: the new table plus 2 RPC signatures, matching the SQL exactly
- `.github/workflows/dashboard-g3-frontend.yml` — new paths and tests, updated browser check count
- `scripts/tests/dashboard-ui/verify.mjs` — new mocked flows and checks

**Tests — new:**
- `src/lib/__tests__/dashboardAttention.test.ts`
- `src/lib/__tests__/dashboardMissedCalls.test.ts`
- `src/lib/__tests__/dashboardPeople.test.ts`
- `src/components/dashboard/__tests__/dashboardCallbacksClearances.test.ts`
- `src/components/dashboard/__tests__/attentionClearActions.test.tsx`
- `src/components/dashboard/__tests__/dashboardMissedCallsModal.test.tsx`
- `src/components/dashboard/__tests__/dashboardTeamContext.test.tsx`
- `src/components/dashboard/__tests__/dashboardStatusBadges.test.tsx`

**Tests — updated** (labels and selectors only; existing contract assertions untouched): `dashboardSections.test.tsx`,
`dashboardCallbacksModal.test.tsx`, `dashboardDetailModalVoicemail.test.tsx`, `clientMilestonesWidget.test.tsx`,
`dashboardMilestonesModal.test.tsx`, `callbacksRequestLifetime.test.tsx`; additions only in `dashboardCallbacks.test.ts`.

**Docs:** this plan; a pointer in root `implementation_plan.md`; a `WORK_LOG.md` entry (newest first, including the
stale-note corrections); `AGENT_RULES.md`:
- a new "Dashboard attention clearances" invariant;
- a #22 amendment (exclusion contract + the approved edit to the protected file);
- the milestone wording (Dismiss = `reviewed`);
- the milestone heading corrected to deployed;
- the Missed Calls org-filter rule.

**Explicitly NOT modified:** `StatCards.tsx`, `useDashboardStats.ts`, `dashboard-scope.ts`,
`dashboard-contact-identity.ts`, `dashboardRefresh.ts`, `useDashboardSection.ts`, `missedCallScope.ts`,
`inbound-call-labels.ts`, `quick-call.ts`, `TwilioContext.tsx`, every Dialer, Contacts or Settings file, every Edge
function, every existing migration, the notification centre.

## 10. F — Test plan

**SQL (disposable local PostgreSQL 17.6, harness with stand-in RLS that mirrors the production predicates):**
- **Isolation:**
  - own-row isolation for SELECT and DELETE;
  - cross-org refusal (JWT org ≠ source org) and Agency-Group peer-visible call refused;
  - inactive or mismatched profile refused;
  - anon denied; no UPDATE/TRUNCATE for authenticated; SELECT only for service_role; no PUBLIC EXECUTE.
- **Visibility:** a source hidden by RLS is refused (Agent vs another agent's Personal campaign lead, appointment
  owned by someone else).
- **Pending state:**
  - answered and outbound calls refused;
  - terminal campaign leads refused;
  - non-callback or non-Scheduled appointments refused.
- **Occurrence:**
  - server-derived; a stale expected value gives PT409;
  - microsecond `created_at` round-trips;
  - a direct INSERT with a forged `occurrence_at` is refused by WITH CHECK.
- **Idempotency and concurrency:** idempotent re-clear returns the same row; two concurrent sessions produce one row.
- **Resurfacing:** a reschedule (changed `callback_due_at`, `start_time`) no longer matches, and a new clear adds a
  second row.
- **Undo:** own row only; a stale `cleared_at` is refused.
- **Retention:** removes only the caller's rows older than 90 days.
- **No source mutation:** `xmin` and `md5(row_to_json)` of the `calls`, `campaign_leads` and `appointments` rows are
  unchanged by clear and undo.
- **Negative controls:** without the privilege reset, and without the visibility WITH CHECK, the suite must fail.
- **Rollback:** a rollback proof plus a replay guard.

**Vitest:**
- **Exclusion property test:** random interleaved campaign/appointment rows and random clearances (including reschedules
  and other-scope rows). Every page across offsets and the totals must equal a brute-force oracle: no gaps, no duplicates,
  no short page, exact "View All N".
- **Flag-off parity:** the query chains (filters, limits, orders) are byte-identical to today and no clearance read is
  sent.
- **Query discipline:**
  - limits are `ceiling + K_b`;
  - match reads are chunked at 100 and reuse `applyBranchFilters`;
  - any failing read rejects the page or total;
  - the incomplete-read cap gives a failure.
- **Missed calls:**
  - shared contract for widget and modal; scope filter unchanged; org filter present;
  - preview 5 of `6 + K`; exact total;
  - recipient labels for one, several and none (never `agent_id`).
- **Telemetry guard:** no write method on source tables, voicemails or notifications.
- **Actions:**
  - the Clear / Dismiss button is visible and keyboard-operable (Tab, Enter, Space);
  - busy lock; awaited success only; toast Undo; the error messages listed in §3.8;
  - focus moves to the next row;
  - View As and flag off hide the actions;
  - widget and modal stay consistent through the event.
- **Milestones:** visible Dismiss; Pending · Snoozed · Dismissed; next-year occurrence returns; first payment stays
  dismissed.
- **Team context:**
  - Admin Team shows owner and recipient chips;
  - a Team Leader in Team view keeps own items and the disclosure, with no widening;
  - a name lookup failure gives "Name unavailable", never an invented name;
  - batched and organization-scoped.
- **States:** error, empty, partial, offline, stale request (generation), and the pagination-lock regressions.
- **Copy guard:** "Handled" (any case) never renders, and no Done / Complete / Resolve on these actions.
- **Badges:** the badge map, with a text label always present.
- **Existing regressions:** the whole `src/components/dashboard` folder, the milestone and refresh suites, the milestone
  engine under three time zones.

**Gates:**
- `npx tsc --noEmit`, and `npx tsc -p tsconfig.app.json --noEmit` compared with the baseline at `7a03033`
  (`scripts/verify-a2p-types.mjs`, no new errors);
- ESLint on every touched file;
- `npm run build`.

**Browser** (`scripts/tests/dashboard-ui/verify.mjs`, mocked Supabase):
- 1440 px and 390 px, light and dark, `prefers-reduced-motion: reduce`;
- Clear, Undo and the Cleared view on Callbacks and Missed Calls; Dismiss and the Dismissed view on milestones;
- a keyboard-only path; focus after removal; modal focus trap and return;
- no horizontal overflow;
- **KPI cards pixel-identical to `main`** (the existing compare step).

**After G3:** read back the catalog, run the advisors, then run an authenticated preview smoke at G4 (clear and undo on
synthetic or own items only, then confirm the source rows are unchanged).

## 11. Decisions for Chris (recommendation first)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Where cleared items are excluded | **Client-side exact exclusion over the existing PostgREST contract (§3.5)**: one callback definition, flag-off is byte-identical, and the page math is proven. Alternative: a SECURITY INVOKER read RPC re-implementing the dual-source union in SQL. That is exact too, but it creates a second callback definition and a bigger contract change. |
| D2 | Editing the protected `dashboard-callbacks.ts` | **Approve a narrow exception:** optional exclusions, counts, the cleared list and four extra selected columns only. Sources, filters, ownership, ordering, window and contact resolution are untouched. |
| D3 | Foreign keys to source tables | **None.** No locks on `calls` / `campaign_leads` / `appointments`, no cascades from telemetry deletes. Orphans are inert. |
| D4 | Retention | **Own-row cleanup older than 90 days inside the clear RPC** (no cron). Alternative: keep everything. |
| D5 | Callback occurrence identity | **Due timestamp only**, as specified. Moving a callback back to the identical earlier instant counts as the same occurrence. Alternative: due + `disposition_version`. |
| D6 | Owner and campaign name lookup failure | **Degrade with a disclosure** ("Name unavailable"); never fail the section, never invent a name. |
| D7 | Agent avatars | **Initials only.** `avatar_url` values can be large image strings, and the Leaderboard needs a dedicated cache for them. |
| D8 | Primary Call colour | **Calls-blue everywhere** (an action takes its category colour); rows keep their own tone. |
| D9 | Missed Calls modal contact resolution | **Yes**, through the shared module, so Call back works for linked rows in the modal. |
| D10 | KPI modal gaps (calls/appointments agent, policy carrier) | **Defer** to a separately approved `get_performance_details` change; the writing agent is shown now for Policies/Premium. |
| D11 | Flag name | `VITE_DASHBOARD_ATTENTION_CLEARANCES` |
| D12 | G3 apply route | **Protected-workflow release-only PR** (the proven G2 pattern); alternative MCP `apply_migration`. |
| D13 | Callback bucket counts | **Exact-or-"N+" from the existing ordering** (no extra queries). |
| D14 | Missed Calls widget total | **Add "View all N missed calls"** (exact active count). |
| D15 | Milestone history entry point | **"View dismissed" link** in the widget → modal on Dismissed. |
| D16 | Team Leader downline lists | **Not in this build** (separate approval, needs the protected-contract and resolver work). |

## 12. Out of scope

KPI cards; Team Leader downline expansion; any change to `get_performance_details`; notifications and the notification
centre; voicemail state (`listened_at`); Dialer, queue, Twilio and FloatingDialer behaviour; Contacts, Settings and other
pages; data backfills; any RLS change to existing tables.

## 13. Context snapshot

- **Changes:** this plan file and the root `implementation_plan.md` pointer only.
- **Production access:** read-only catalog and policy queries plus aggregate counts (no rows, no PII); Vercel deployment
  listing. Environment variable listing was refused (403).
- **Migrations/deploys:** none.
- **Blockers:** G1 approval of this plan and D1–D16. Confirmation of whether `VITE_DASHBOARD_MILESTONE_REVIEWS=true` is
  set in production.
- **Next on approval:** G2 build on `claude/upbeat-cannon-uy6fpg` (frontend + migration package + local tests), then a
  report back with test evidence before any G3 request.
