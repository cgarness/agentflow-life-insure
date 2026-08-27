# Implementation Plan — Conversations scope + call-ranking correction, and Contacts → Import History scoping

**Date:** 2026-08-27
**Status:** 🟡 **DIAGNOSIS COMPLETE — PLAN AWAITING CHRIS'S EXPLICIT APPROVAL. NO SOURCE CHANGED.**
**Branch:** `claude/agentflow-conversations-imports-smwadt`
**Base:** `origin/main`
**Production project:** `jncvvsvckxhqgqvkppmj` (AGENTFLOW CRM)
**Supersedes:** the 2026-08-26 system-email logo cache-bust plan (implemented in repo on branch
`claude/agentflow-logo-cache-bust-5zpme5` / PR #369; its §6 rollout remains separately gated and is
untouched by this work).

> **What has been done so far: reading only.** Repo greps, file reads, and SQL text inspection of
> `supabase/migrations/`. **Zero writes to source, tests, migrations, `supabase/**`, Supabase,
> Vercel, or GitHub. No Supabase MCP call of any kind was made — the RLS findings in §5 come from
> repo SQL text and from `WORK_LOG.md`, not from a live production read.** Per AGENT_RULES §8 this
> plan is the artifact that gates the code change; nothing in §6–§9 will be written until Chris
> approves.

---

## 1. Objective, and the blocker found on the way

Three reported defects, one authorization theme — plus a **fourth defect discovered during
diagnosis that blocks the "View As" half of the requirements**.

| # | Symptom | Root cause (confirmed, §3–§5) |
|---|---|---|
| 1 | Conversations sidebar shows contacts that are not the viewer's | `getRecentConversations()` applies **no scope filter at all** and leans on RLS — but `messages` RLS is **organization-wide** while `leads`/`clients`/`recruits` are per-agent. The SMS query legitimately returns other agents' rows; the contact lookup then can't resolve them, so they render as fabricated **"Unknown Contact"** entries typed as `lead`. |
| 2 | Calls move contacts to the top of the sidebar | `getRecentConversations()` **queries `calls` and merges them into the same ranking array** as SMS and email; a call can win the newest-event slot and become the preview text. |
| 3 | Contacts → Import History shows other users' imports | `fetchImportHistory()` is `select("*")` with **no `organization_id` and no `agent_id` filter**, and `import_history_select` RLS is **organization-wide**. |
| **4** | 🚨 **"View As" is structurally broken today** — the impersonated profile has **`undefined` `id`, `role` and `organization_id`** | Both entry points pass a camelCase `UserProfile` DTO cast to the snake_case `Profile` row type. **§4 in full.** |

Phase A (this plan) is a **frontend / query-scoping correction**. It is explicitly **not** a claim of
database-level authorization. Phase B (§12) would harden RLS and is **not approved and not started**.

---

## 2. Governing documents read before writing this plan

- `AGENT_RULES.md` v5.0.0 — §3 Multi-Tenancy Rules (incl. *"Downline profile scoping is
  query-enforced, not RLS-enforced… must **explicitly constrain every query** … and must **fail
  closed** … UI filtering must not be represented as a database authorization boundary"*), §4
  invariants (incl. **#5 file on disk ≠ applied**), §7 Component Standards (React components
  **< 200 lines**; `Contacts.tsx` is **not** a listed exception), §8 Workflow Protocol (plan →
  approval → code), §9 Doc Update Rule, §10 Forbidden Patterns (*"Dropping/bypassing RLS without
  Chris `#APPROVE_RLS_CHANGE`"*).
- `VISION.md` — Conversations is a **unified SMS + email thread UI**, shipped. Roles
  Super Admin → Admin → Team Leader → Agent; multi-tenant by `organization_id`.
- `WORK_LOG.md` newest entries — 2026-08-26 logo cache bust; 2026-08-26 PR #367 Auth template
  rollout; and, materially for §12, the **2026-08-23 RLS Phase 1 program** (`WORK_LOG.md:456`,
  `:471`, `:496`, `:500`, `:508`), which establishes the house process for an approved RLS change.
- `implementation_plan.md` (previous revision) — the plan this file replaces.
- `scripts/verify_s1_reconciliation_plan.py` + `supabase/rollback/20260806_baseline_history_reconciliation_runbook.md`
  — the S1 constraint that forbids a migration in this pass (§11).

---

## 3. Diagnosis — Conversations

Every claim carries a `file:line`. The suspected causes in the request were **verified, not
assumed**: five are confirmed (two worse than stated), one is refuted in its literal form, and one
is corrected.

### 3.1 The whole data layer is `src/lib/supabase-messages.ts` (157 lines)

Two exported functions, two callers: `ConversationsSidebar.tsx:39` → `getRecentConversations()`,
and `ConversationThread.tsx:68` → `getConversationThread(contactId)`.

#### (a) ✅ CONFIRMED — calls are merged into the sidebar ranking

`:31-35` issues a third query against `calls`; `:63-72` pushes every call into the same `items`
array as SMS and email; `:76` sorts all three together; `:78-82` takes the **first** (= newest) item
per `contact_id`.

```ts
// :63-72
(callRes.data || []).forEach(c => {
  if (!c.contact_id) return;
  items.push({ contact_id: c.contact_id, last_message: c.disposition_name || 'Call',
               last_message_at: c.created_at, channel: 'call', direction: c.direction });
});
```

One query causes all three forbidden behaviours: a call **creates** a sidebar row for a contact with
no SMS/email at all, **sets the preview** to a disposition name, and **moves the contact upward**.

*Refuted sub-claim:* a call does **not** trigger a sidebar refresh. `ConversationsSidebar.tsx:25-29`
subscribes to `messages` and `contact_emails` only — `calls` is absent. That requirement is already
met and must simply not regress.

#### (b) ✅ CONFIRMED — grouping happens before visibility is proven

There is **no** ownership, agent, organization, or scope filter anywhere in the file. The only
filters are `.order`, `.limit`, `.in('id', contactIds)` and `.eq('contact_id', …)`.
`getRecentConversations()` takes **no parameters** (`:16`) — it cannot know who is asking.

The mechanism, end to end:

1. `messages_select` RLS is **organization-wide** —
   `supabase/migrations/20260806000000_baseline_production_schema.sql:12336`:
   `USING (("organization_id" = "public"."get_user_org_id"()))`. The unscoped SMS query at `:21-25`
   therefore returns **every SMS in the organization**, including the message **body** (`:44`).
2. `leads` / `clients` / `recruits` RLS *is* per-agent for a rank-and-file Agent — baseline
   `:11312`, `:11304`, `:11338` (`user_id = auth.uid()` / `assigned_agent_id = auth.uid()` plus
   role branches). So the resolution queries at `:92-94` return **nothing** for those foreign
   contacts.
   *(Precision: `leads` actually has **three** permissive SELECT policies that OR together —
   `Leads Hierarchical Access` (`:11312`), `leads_select_unassigned_pool` (`:12302`) and
   `leads_select_view_all_pool` (`:12306`), the last of which **is** fully organization-wide
   whenever `has_contacts_permission('contacts.leads.view_all')` is true. So for a viewer holding
   that permission the asymmetry narrows for leads — but not for `clients` or `recruits`, which
   have a single owner/hierarchy policy each. This is another reason the fix must filter
   **explicitly** rather than infer the boundary from RLS.)*
3. `:106-107` fabricates:
   ```ts
   contact_name: contact?.name || 'Unknown Contact',
   contact_type: contact?.type || 'lead',
   ```

Net effect: the sidebar is padded with rows titled "Unknown Contact", badged `lead`, whose preview
line is **another agent's SMS body** rendered at `ConversationsSidebar.tsx:125`. Those rows also
consume the 50-row budget (§3.1e), pushing the viewer's real conversations out. This is the "wrong
contacts" symptom and a confidentiality problem in one — **every "Unknown Contact" row is, by
construction, a message the viewer is not entitled to read.**

#### (c) ✅ CONFIRMED — fields are read that were never selected

| Read at | Selected at | Result |
|---|---|---|
| `:46` `m.created_at` | `:23` `select('lead_id, contact_id, body, sent_at, direction')` | **always `undefined`** |
| `:98-100` `l.phone`, `l.email`, `c.phone`, `c.email`, `r.phone`, `r.email` | `:92-94` `select('id, first_name, last_name')` | **always `undefined`** |

Consequences:

- **Sending is 100% broken from the Conversations page.** `contact_phone`/`contact_email` are always
  `undefined`, so `Conversations.tsx:45` and `:73` short-circuit into *"This contact has no email
  address."* / *"This contact has no phone number."* for **every** contact. `leads.phone`,
  `leads.email`, `clients.phone`, `clients.email`, `recruits.phone`, `recruits.email` all exist and
  are **NOT NULL** (`types.ts:3516/3526`, `1501/1511`, `4386/4392`) — purely a missing-`select` bug.
- **A crash path.** `messages.sent_at` is nullable (`types.ts:3664`) and `:24`
  `.order('sent_at', { ascending: false })` passes no `nullsFirst` option. Under **Postgres's DESC
  default, NULLS FIRST**, null-`sent_at` rows land at the *top* of the 50-row window. For those rows
  `m.sent_at || m.created_at` is `undefined`, and `ConversationsSidebar.tsx:120`
  `formatDistanceToNow(new Date(undefined))` throws `RangeError: Invalid time value`, taking down
  the **entire list render**, not one row. The two defects select for each other.
  *(Honest scope of the claim: the `undefined` and the `RangeError` are proven from the source above.
  The NULLS-FIRST **ordering** rests on the Postgres default plus the assumption that
  `postgrest-js@2.98.0` omits the `nullsfirst`/`nullslast` modifier when the option is absent —
  which I could not read here, because `node_modules` is not installed in this container. It does
  not change the fix: §6.2 passes `nullsFirst: false` **explicitly**, so the corrected behaviour is
  independent of the default either way.)*

#### (d) ✅ CONFIRMED — email is ranked by sync-insertion time

`:28-29` selects and orders `contact_emails` by `created_at`; `:57` ranks by `e.created_at`.
`received_at` and `sent_at` are **not even selected**. The same file's `getConversationThread` at
`:151` *does* use `received_at || sent_at || created_at` — so the sidebar and the thread disagree
about email ordering. A backfilled inbound email (old `received_at`, new `created_at`) jumps to the
top of the sidebar and sits correctly inside the thread.

`contact_emails.received_at` and `.sent_at` are nullable; `created_at` is **NOT NULL**
(`types.ts:1712/1724/1726`), so `created_at` is a safe last resort and a reliable paging key.
`contact_emails_direction_check` (baseline `:7293`) constrains `direction` to exactly
`inbound | outbound` — so a per-direction split is **total**, with no third value to drop.

#### (e) ✅ CONFIRMED — the activity limit is applied before authorization

`.limit(50)` sits at the **database** level on each of the three queries (`:25`, `:30`, `:35`),
i.e. before grouping (`:78-82`), before contact resolution (`:91-95`), and before the final
`.slice(0, 50)` (`:84`). One chatty thread of 50 SMS collapses to a **single** sidebar row while
consuming the entire messages budget. With org-wide `messages` RLS, other agents' newer activity
crowds the viewer's conversations out of the window entirely. There is no pagination.

#### (f) ✅ CONFIRMED — query failures are invisible

`smsRes.error`, `emailRes.error`, `callRes.error`, `leads.error`, `clients.error`, `recruits.error`
are **never inspected**; every consumer uses `(x.data || [])` (`:40`, `:52`, `:63`, `:98-100`).
The function **resolves successfully** with a silently truncated result — a failed `contact_emails`
query simply removes every email conversation from the inbox. The `catch` at
`ConversationsSidebar.tsx:41` never fires because nothing throws, so the user sees a partial list or
*"No conversations found."* (`:91-92`) and believes it.

#### (g) ⚠️ CORRECTED — the screen uses *neither* the auth user nor the effective profile

The request suspected `Conversations.tsx` uses the authenticated Supabase user instead of
`useAuth().profile`. The truth is stronger: `Conversations.tsx:22` destructures
`const { user } = useAuth();` and **`user` is never referenced again in the file** (grep: line 22 is
the only occurrence). `ConversationsSidebar` receives **no viewer identity at all**
(`Conversations.tsx:113-116` passes only `selectedContactId` and `onSelectContact`).

The *mechanism* the request describes is real and must be designed against — see §4, which is where
it turns out to be worse than suspected.

#### (h) ✅ CONFIRMED — deep links are unvalidated and default the contact type to `lead`

`Conversations.tsx:16-17`:
```ts
const selectedContactId = searchParams.get("contactId") || undefined;
const selectedContactType = searchParams.get("contactType") as 'lead' | 'client' | 'recruit' || 'lead';
```
No validation of either value, no scope check, no UUID check. `contactType` is a bare cast with a
`'lead'` fallback, fed to `ConversationThread` (`:123`) and `ContactBriefView` (`:129`).
`ContactBriefView.tsx:29-30` picks the table **from that value** — so a client deep-linked without
`contactType` is queried against `leads`, `.single()` errors, the `catch` at `:33` swallows it, and
the panel renders blank.

`getConversationThread` also interpolates the raw URL value into a PostgREST filter string
(`supabase-messages.ts:125` — `` .or(`lead_id.eq.${contactId},contact_id.eq.${contactId}`) ``).
RLS still bounds what can come back, but a crafted value rewrites the filter tree. Validating
`contactId` as a UUID closes it and is required by the deep-link requirement anyway.

#### (i) Secondary defects in the same code path

| Ref | Defect |
|---|---|
| `supabase-messages.ts:68` | `calls` uses bare `c.created_at` with no `started_at` fallback, unlike `:139` in the same file. `calls.created_at` is nullable (`types.ts:840`) and `new Date(null)` is epoch — a null-`created_at` call renders as *"56 years ago"*. Moot once calls leave the sidebar. |
| `ConversationsSidebar.tsx:124` | `convo.direction === 'outbound'` is a strict compare, but `calls.direction` also stores `'outgoing'`; the repo has `isCallsRowOutboundDirection` (`src/lib/webrtcInboundCaller.ts:24-27`) and `ConversationThread.tsx:108` uses its sibling. Moot for calls once they leave the sidebar. |
| `supabase-messages.ts:33` | The `calls` query selects `contact_name` and never reads it. |
| `ConversationThread.tsx:43-46` | The realtime subscription filters `lead_id=eq.${contactId}` only, while the fetch matches `lead_id` **or** `contact_id`. `convert_lead_to_client_atomic` re-points `messages.contact_id` to the client id (baseline `:1527-1531`), so a converted client's inbound SMS never refreshes the open thread. |
| `ConversationsSidebar.tsx:27-28, 36-46` | The realtime handler refetches on **every** org SMS with no filter, no debounce, and no request-generation guard; `loadConversations` sets `loading = true` (`:37`), so the skeleton flashes on unrelated org traffic and out-of-order responses can overwrite newer state. |

#### (j) Blast radius — other readers of the same tables

`src/lib/supabase-messages.ts` is the only broken one. The other three sites are already correct and
are the house patterns to copy:

- `src/components/contacts/FullScreenContactView.tsx:531-556` — explicit column list **including**
  `created_at`, an `isCurrent()` stale-response guard (defined `:309`, used `:541`),
  `if (msgsRes.error) throw` (`:542-543`), and a dedicated `convoLoadError` state (`:235`).
- `src/lib/dialer-api.ts:229` — `contact_emails` with `sent_at`/`received_at` selected.
- `src/pages/CampaignDetail.tsx:531-560` — `import_history` with real `importHistoryLoading` /
  `importHistoryError` states (see §5.5).

### 3.2 Contact lineage — verified, and it makes "exclude unresolved" safe

`convert_lead_to_client_atomic` (baseline `:1426`+) re-points **`calls`** (`:1523-1524`),
**`messages`** by `contact_id` (`:1527-1528`) *and* by `lead_id` where `contact_id IS NULL`
(`:1530-1531`), and **`contact_emails`** (`:1534`) to the new client id before
`DELETE FROM public.leads` (`:1543`). So converted leads keep their conversation history under the
client id, and excluding unresolvable contacts does **not** silently drop converted threads.

Two details the fix must preserve:
- the `lead_id` fallback (`supabase-messages.ts:41` `m.contact_id || m.lead_id`) — a never-converted
  lead's SMS may carry only `lead_id`;
- `contact_id` wins over `lead_id`, because conversion sets `contact_id` without clearing `lead_id`.

---

## 4. 🚨 Blocker — "View As" cannot currently supply a viewed profile

**This was not in the brief; it was found while verifying the effective-identity requirement, and it
gates the "View As" acceptance criteria for both features.**

### 4.1 The context is correct

`AuthContext.tsx:283` — `profile: impersonatedUser || profile` — so **`useAuth().profile` is already
the effective profile**, and `realProfile` (`:284`) is the real one. `useAuth().user` and
`session` are only ever fed from `onAuthStateChange` / `getSession` (`:125`, `:149`), so they
**always** hold the real Super Admin identity. Reading `profile` is the right call; reading `user`
for identity is the documented hazard — the repo's own test says so
(`src/lib/__tests__/contactsAgentsScope.test.tsx:397-400`).

### 4.2 The payload handed to it is the wrong type

Both entry points pass a **`UserProfile`** (the camelCase DTO) cast to **`Profile`** (the snake_case
DB row):

```ts
// src/components/layout/ViewAsModal.tsx:49
startImpersonation(user.profile as unknown as Profile);
// src/components/settings/user-management/TeamMembersTable.tsx:200
startImpersonation(u.profile as unknown as Profile);
```

`UserProfile` (`src/lib/types.ts:34-57`) has `userId`, `organizationId`, `isSuperAdmin` — and
**no `id`, no `role`, no `first_name`/`last_name`/`email`, no `organization_id`, no
`is_super_admin`**. It is built by `rowToUser` at `src/lib/supabase-users.ts:20-21`
(`profile: { userId: row.id, … }`). `Profile` (`AuthContext.tsx:6-40`) is the snake_case row every
consumer reads. So during "View As":

- `profile.id` → **`undefined`**
- `profile.role` → **`undefined`**
- `profile.organization_id` → **`undefined`**
- `profile.is_super_admin` → **`undefined`**
- `profile.first_name` → **`undefined`** (hence `TopBar.tsx:310` renders *"Viewing as …"* with a
  blank name — the visible symptom)

### 4.3 The cascade, proven

- `useOrganization.ts:71-77` — under impersonation it returns `orgId: profile.organization_id` and
  `role: profile.role`, i.e. **`undefined` for both**.
- `useOrganization.ts:94` — `isSuperAdmin: isSuperAdmin || isImpersonating` forces **`true` for the
  whole View As session**, whoever is being viewed. Every `role === "Admin" || isSuperAdmin` gate
  *widens* instead of narrowing, and every `role === "Agent" && !isSuperAdmin` narrowing guard is
  dead (e.g. `Contacts.tsx:1022`, `:1028`).
- `usePermissions.ts:145-152` — `organizationId` and `dbRole` are null → `canFetchPermissions` false
  → `waitingForProfile` true → **`isLoading` never clears** (`:167`).
- Independently: `Contacts.tsx:135-136, 248-250, 270` and `useContactScope.ts:83, 111-121, 143`
  derive the viewer id from `useAuth().user.id` (the **real** Super Admin) while taking org/role
  from the impersonation-aware `useOrganization()` — a second widening vector that survives even
  if §4.2 is fixed.

### 4.4 What this means for this task

The requirement *"'View As Agent' must show only that Agent's imports"* and *"use the viewed
profile's ID, role, and organization"* **cannot be satisfied while `profile.id` is `undefined`.**

Two honest options, both offered in §13:

- **A1 — include the payload repair (recommended).** A pure mapper builds a genuine `Profile` from
  the `User & { profile: UserProfile }` the modal already holds (`User` supplies `id`, `role`,
  `email`, `firstName`, `lastName`, `status`, `isSuperAdmin` — `types.ts:11-24`; `UserProfile`
  supplies `organizationId`, `teamId`, `uplineId` and the goal fields). Two call sites plus one new
  pure module. **Blast radius is real and must be acknowledged:** it also un-breaks Contacts,
  Dashboard, Reports and `usePermissions` under View As, which is a behavioural change beyond the
  three reported defects — hence the explicit approval question.
- **A2 — exclude it.** Phase A then **fails closed** under View As: `viewer` is `null`, and
  Conversations / Import History show a loading-then-empty state rather than the viewed Agent's
  data. Nothing widens (the security requirement holds), but the "View As" acceptance criteria
  cannot be demonstrated, and the tests for them would have to be written `.skip`-ped with a
  reason. **I do not recommend shipping A2 silently.**

`useOrganization().isSuperAdmin` is **not** changed under either option — that ripples across the
whole app and belongs in its own pass. §7 avoids it by construction.

---

## 5. Diagnosis — Contacts → Import History

### 5.1 The query (`src/pages/Contacts.tsx:1071-1091`)

```ts
const fetchImportHistory = useCallback(async () => {
  const { data, error } = await supabase
    .from("import_history")
    .select("*")
    .order("created_at", { ascending: false });
  if (!error && data) {
    setImportHistory(data.map((row: any) => ({ … })));
  }
}, []);
```

Four confirmed defects in nineteen lines:

1. **No `organization_id` filter** and **no `agent_id` filter.** Every row RLS allows is rendered.
2. **`import_history_select` RLS is organization-wide** — baseline `:12207`:
   `USING (("organization_id" = "public"."get_user_org_id"()))`. RLS allows the entire organization
   and the query asks for all of it. That is the whole bug.
3. **Errors are swallowed.** `if (!error && data)` leaves `importHistory` at its previous value
   (`[]` on first load) and renders the *"No imports yet"* empty state at `:2789-2795`. An error and
   a legitimately empty history are **indistinguishable**, and there is no retry.
4. **No `.limit()` / pagination**, and **no loading state**. The tab's render gate is
   `!loading && tab === "Import History"` (`:2782`), where `loading` is the *contacts-table* flag —
   and for this tab `fetchData` short-circuits (`:307-326`) and its `finally` sets `loading = false`
   immediately (`:500`), while `fetchImportHistory` is still in flight. So the empty state can paint
   before the data arrives.

The uploader column is **`import_history.agent_id`** (`types.ts:3206`), written as the importing
user's auth id at `src/pages/ImportLeadsPage.tsx:101` (`agent_id: user.id`) and FK'd to
`auth.users(id)` (baseline `:10821-10822`). The org column is `organization_id` (`types.ts:3217`),
written at `ImportLeadsPage.tsx:104`. Both are **nullable** in the schema, so legacy rows may carry
`NULL`; an equality filter correctly excludes them (fail closed) — recorded as a residual in §8.3.

### 5.2 It fetches on mount regardless of the active tab

`src/pages/Contacts.tsx:1115`:
```ts
useEffect(() => { fetchImportHistory(); }, [fetchImportHistory]);
```
`fetchImportHistory` is `useCallback(…, [])` — stable — so this runs **once on mount, on every
Contacts page load**, whichever tab is active. The tab lives in the URL: `:155`
`const tab = (searchParams.get("tab") as …) || "Leads";`, with `"Import History"` as the literal tab
id, and `:2782` gating the panel on `!loading && tab === "Import History"`.

`fetchData` already knows about the tab (`:296` *"Import History has no grid data — avoid loading
every contact list."*) — the page has the gate pattern; the history fetch just doesn't use it.

### 5.3 No viewer-change clearing and no stale-response guard

`fetchImportHistory` has an empty dependency array and no request-generation ref. Under "View As"
the organization and profile change **in place with no remount**, so previously loaded rows stay on
screen and a late response from the prior viewer can repaint. The same file already solves this
correctly for the Agents tab and is the pattern to copy:

- derived identity key: `:249-253` (`agentScopeKey`), read back through a derived value so a viewer
  change invalidates **synchronously on the same render**;
- clear-on-identity-change: `:257-262` bumps `agentsFetchSeqRef` and `setAgents([])`;
- fail-closed traversal: `:270-281` — on error, `ids: []`, with the comment
  *"Fail closed: zero rows. NEVER fall back to an organization-wide query."*

*(Observation, out of scope: that block keys on `user?.id` — the **real** auth id — so under "View
As" the Contacts → **Agents** tab traverses from the Super Admin's id inside the impersonated
organization. Reported, not fixed here; different tab, different query. Listed in §8.3.)*

### 5.4 Behaviour that must be preserved

| Behaviour | Location |
|---|---|
| Drill-in drawer (loads the import's leads via `imported_lead_ids`) | `Contacts.tsx:1096-1113` `openImportDetail`, state `:650-653`, row click `:2817`, Sheet `:3048-3093` |
| Retry campaign attachment | `:1122-1143` `handleRetryImportAttachment` (+ `retryingImportId` `:1119`, button `:2846-2854`) |
| Undo eligibility preview | `:1145-1158` `handleOpenUndoImport` |
| Undo execute + refresh | `:1160-1180` `handleConfirmUndoImport` |
| Post-import refresh | `:1222-1228` on `location.state.importCompleted` |
| Row status / completion pills | `:2803-2815` `importUndoRowStatus`, `describeImportCompletion` |
| Client-side filename search over the fetched array | `:2798-2800` |
| Empty state | `:2789-2795` |

`src/pages/ImportLeadsPage.tsx:177` navigates to **`/contacts?tab=Leads`** with
`state: { importCompleted: true }` — so the post-import refresh currently loads history into a tab
the user is not on. §6.3 replaces it with a *stale-mark* the tab-active gate honours, satisfying both
"only fetch when the tab is active" and "plus any required post-import refresh".

### 5.5 Out of scope — the other `import_history` reader

`src/pages/CampaignDetail.tsx:531-560` runs its own query filtered by `.eq("campaign_id", id)` and
deliberately renders an **"Imported by"** column resolved from `profiles` (`:552-560`). Different
surface, different intent (campaign provenance), and it already has real `importHistoryLoading` /
`importHistoryError` states. **Not touched in Phase A.** Same organization-wide RLS underneath;
listed in §12 as Phase B input.

---

## 6. Proposed changes — files and minimal diffs

`AGENT_RULES.md` §7 caps React components at 200 lines and `Contacts.tsx` is already 3,169 lines and
**not** a listed exception — so the Import History logic moves **out** of the page into a hook rather
than growing it further.

### 6.1 New — the effective-viewer contract

**`src/lib/effectiveViewer.ts` (NEW, pure, no Supabase import)**

```ts
export type EffectiveViewer = {
  viewerId: string;            // profile.id — the EFFECTIVE profile, impersonated when "View As" is on
  role: string;                // profile.role — the EFFECTIVE role
  organizationId: string;      // effective org (impersonated org, else home org)
  isImpersonating: boolean;
};

/** Admin, or a Super Admin who is NOT impersonating. Never derived from useOrganization().isSuperAdmin. */
export function isOrganizationWideViewer(v: EffectiveViewer): boolean;
```

Returns true only for `role === "Admin"`, or `role === "Super Admin" && !isImpersonating`. Under
"View As Agent" the effective role is `Agent`, so it returns **false** — the §4.3 trap is closed by
construction. Pure and unit-testable with no mocks.

**`src/hooks/useEffectiveViewer.ts` (NEW, ~30 lines)**

Composes `useAuth()` (`profile`, `isImpersonating`) and `useOrganization()` (`organizationId`,
`role`) into `{ viewer: EffectiveViewer | null; ready: boolean }` plus a stable identity key
`` `${viewerId}::${organizationId}::${role}` ``. `viewer` is `null` until `profile.id` **and**
`organizationId` are both present — consumers then show loading, never a premature empty state. It
reads `profile.id`, **never** `user.id`. This is the shared accessor the codebase currently lacks
(today `Contacts.tsx:136` uses `user.id` while `FullScreenContactView.tsx:228-229` and
`Reports.tsx:111-114` use `profile?.id`).

**`src/lib/impersonationProfile.ts` (NEW, pure) — only if §13 Q2 = A1**

`toImpersonationProfile(user: User & { profile: UserProfile }): Profile` — maps `id`, `role`,
`email`, `first_name`, `last_name`, `status`, `is_super_admin` from `User` and `organization_id`,
`team_id`, `upline_id` and the goal fields from `UserProfile`. Wired into `ViewAsModal.tsx:49` and
`TeamMembersTable.tsx:200`; `platform_role` is deliberately **not** synthesized (it is read from
`realProfile` — `useIsPlatformAdmin.ts:1-7`).

### 6.2 Conversations

**`src/lib/conversationScope.ts` (NEW, pure)**

- `type ConversationScope = { kind: "org"; organizationId: string } | { kind: "agents"; organizationId: string; agentIds: string[] }`
- `smsEventAt(row)` → `row.sent_at ?? row.created_at ?? null`
- `emailEventAt(row)` → `direction === "inbound" ? (received_at ?? created_at) : (sent_at ?? created_at)`
- `pickNewestPerContact(events)` → one row per `contact_id`, newest first, rows with a
  null/unparseable timestamp **dropped** (never `NaN`-sorted, never handed to `formatDistanceToNow`).

**`src/lib/supabase-messages.ts` (MODIFIED)**

1. **Delete the `calls` query and its mapping** (`:31-35`, `:63-72`). Narrow
   `ConversationPreview.channel` from `'sms' | 'email' | 'call'` to **`'sms' | 'email'`** so a call
   cannot re-enter the sidebar without a compile error. `getConversationThread` is **unchanged** —
   calls stay in the opened thread (`:115-121`, `:136-141`).
2. **`getRecentConversations(scope: ConversationScope, limit = 50)`** — a missing/empty `agentIds`
   for `kind === "agents"` returns `[]` (**fail closed**).
3. **Three candidate queries, each ordered by its own real event timestamp**, paged with `.range()`
   rather than a bare `.limit(50)`:
   - `messages` — `select('contact_id, lead_id, body, sent_at, created_at, direction')`,
     `.order('sent_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false, nullsFirst: false })`.
     Adding `created_at` fixes §3.1(c); `nullsFirst: false` fixes the NULLS-FIRST window poisoning.
   - `contact_emails` **inbound** — `.eq('direction','inbound').order('received_at', …nullsFirst:false).order('created_at', …)`
   - `contact_emails` **outbound** — `.eq('direction','outbound').order('sent_at', …nullsFirst:false).order('created_at', …)`

   Splitting by direction makes each query's **paging key identical to its ranking key**, and
   `contact_emails_direction_check` (baseline `:7293`) makes the split total.
4. **Every `error` is checked and thrown** (mirroring `FullScreenContactView.tsx:542-543`).
5. **Resolve, then authorize, then rank — never the reverse.** Candidate `contact_id`s
   (`contact_id ?? lead_id`, §3.2) are collected newest-first, then batch-resolved (200 ids/batch)
   against the three contact tables with **explicit** filters mirroring the canonical server-side
   predicates:

   | Table | `kind: "org"` | `kind: "agents"` | Canonical predicate mirrored |
   |---|---|---|---|
   | `leads` | `.eq('organization_id', org)` | `+ .in('user_id', ids)` | `_contacts_filtered_leads`, baseline `:416` (`l.user_id = ANY(…)`) |
   | `clients` | `.eq('organization_id', org)` | `+ .in('assigned_agent_id', ids)` | `_contacts_filtered_clients`, baseline `:308` |
   | `recruits` | `.eq('organization_id', org)` | `+ .in('assigned_agent_id', ids)` | `_contacts_filtered_recruits`, baseline `:519` |

   `leads` scopes on **`user_id`**, not `assigned_agent_id`, because that is the column the canonical
   RPC filters; `leadsSupabaseApi` keeps the two in sync (`supabase-contacts.ts:169`, `:319`, `:347`).
   *(Choosing the owner column is an explicit decision: `getAgentScopeIds` returns `profiles.id`
   values and its only existing consumer applies them to `profiles.id`, not to any owner column —
   `supabase-users.ts:284-287`.)*
   The **select lists carry `phone` and `email`**, fixing §3.1(c) and unbreaking both send paths.
6. **A contact that does not resolve is dropped.** No `'Unknown Contact'`, no `|| 'lead'` default.
   `contact_type` comes from the table the row actually resolved in.
7. **Crowd-out defence.** Page each source until either `limit` **authorized** conversations are
   collected or the source is exhausted, bounded by `CONVERSATION_MAX_PAGES` (proposal: page 200,
   max 10 pages = 2,000 rows/source) with the cap **logged**, never silently applied.

**`src/components/conversations/ConversationsSidebar.tsx` (MODIFIED, stays < 200 lines)**

- Accept the viewer via props from the page (keeps the component presentational).
- Identity-keyed: on key change **clear `conversations` immediately**, bump `loadSeqRef`, and commit
  only a response whose sequence is still current (`FullScreenContactView.tsx` `isCurrent()` idiom).
- A real **error state** with a **Retry** button, distinct from *"No conversations found."*
- Keep the realtime subscription on `messages` + `contact_emails` **only** (never `calls`); add the
  identity key to the effect deps so a viewer change resubscribes.

**`src/pages/Conversations.tsx` (MODIFIED)**

- Replace the unused `const { user } = useAuth();` (`:22`) with `useEffectiveViewer()`.
- Resolve the scope: `isOrganizationWideViewer(viewer)` → `{ kind: "org" }`; otherwise
  `usersApi.getAgentScopeIds({ viewerId: viewer.viewerId, organizationId: viewer.organizationId })`
  → `{ kind: "agents", agentIds }`, **failing closed to `agentIds: []`** on any error (matching
  `Contacts.tsx:274-278`).
  `getAgentScopeIds` (`supabase-users.ts:196-252`) is the recursive `upline_id` walk: `visited`
  cycle guard seeded with the viewer (`:201`), org-bounded rounds (`:226`), 50-id frontier batches
  paged 500 at a time (`:214-215`, `:229`), depth cap 100 (`:208-210`), **throws on any query
  error** (`:231`), and returns `[]` with zero queries when either param is blank (`:199`).
  It has **no role branching at all** — for an Admin it would return only that Admin's own subtree,
  which is exactly why Admin/Super Admin take the `kind: "org"` branch instead.
  `hierarchy_path` / `is_ancestor_of` are used nowhere in it (`:175-178` documents why).
- **Deep-link validation.** Reject a non-UUID `contactId` outright (also closing the PostgREST
  `.or()` interpolation at `supabase-messages.ts:125`). Resolve the id through the **same scoped
  resolver** as the sidebar; if it does not resolve, render a "conversation not available" state and
  clear the thread. **`contactType` comes from the resolution, never from the URL** — the
  `|| 'lead'` cast at `:17` is deleted, which also fixes the blank `ContactBriefView` in §3.1(h).

### 6.3 Import History

**`src/lib/supabase-import-history.ts` (NEW)**

```ts
export async function listImportHistory(params: {
  organizationId: string;
  viewerId: string;
  orgWide: boolean;          // isOrganizationWideViewer(viewer)
  limit?: number;
}): Promise<ImportHistoryEntry[]>
```

- **Always** `.eq("organization_id", organizationId)` — org-wide and personal alike.
- `orgWide === false` → **also** `.eq("agent_id", viewerId)`. Team Leaders take this branch: the
  requirement is *"every other role, including Team Leaders: only rows where `agent_id` equals the
  effective profile ID"*, so `getAgentScopeIds` is deliberately **not** consulted here (§13 Q5).
- Missing `organizationId` or `viewerId` → return `[]` without issuing a query (fail closed).
- **Throws** on `error`; selects an explicit column list rather than `*`.

**`src/hooks/useImportHistory.ts` (NEW, ~70 lines)**

Owns fetch + identity key + clear-on-change + sequence guard + `error` + `refresh()` + `markStale()`.
Returns `{ entries, loading, error, refresh, markStale }`. Fetches **only** when `enabled` is
true — the page passes `tab === "Import History"`.

**`src/pages/Contacts.tsx` (MODIFIED — net line reduction)**

- Delete `fetchImportHistory` (`:1071-1091`) and its unconditional effect (`:1115`); replace with
  `useImportHistory({ viewer, enabled: tab === "Import History" })`.
- `handleRetryImportAttachment`, `handleOpenUndoImport`, `handleConfirmUndoImport` call `refresh()`
  instead of `fetchImportHistory()`; signatures and behaviour otherwise unchanged.
- `:1222-1228` (`location.state.importCompleted`) calls `markStale()`; since the import navigates to
  `?tab=Leads` (`ImportLeadsPage.tsx:177`), the refetch happens when the user opens the tab.
- Render an **error + Retry** block above the list, distinct from the `:2789-2795` empty state,
  which is otherwise **unchanged** — a user with no personal imports still sees *"No imports yet"*.
  The visual pattern already exists **in this very file**: the drill-in Sheet's error+Retry at
  `:3059-3063` (with loading `:3057-3058` and a three-way empty message `:3080-3089`). Reuse it so
  the tab and the drawer look the same.
- While here, delete the dead `importHistoryOpen` / `setImportHistoryOpen` state (`:646`) — declared
  and never read or written anywhere in the 3,169-line file (leftover from a modal-era Import
  History). Zero behavioural effect.
- `openImportDetail`, `importUndoRowStatus`, `describeImportCompletion`, the drill-in drawer and the
  undo dialog are **untouched**.

### 6.4 Complete file list

| # | File | Change |
|---|---|---|
| 1 | `src/lib/effectiveViewer.ts` | **NEW** — effective-viewer type + `isOrganizationWideViewer` |
| 2 | `src/hooks/useEffectiveViewer.ts` | **NEW** — composes `useAuth` + `useOrganization`; identity key |
| 3 | `src/lib/conversationScope.ts` | **NEW** — scope type + event-timestamp + newest-per-contact helpers |
| 4 | `src/lib/supabase-import-history.ts` | **NEW** — scoped `import_history` reader |
| 5 | `src/hooks/useImportHistory.ts` | **NEW** — gated fetch, clear-on-viewer-change, seq guard, error/retry |
| 6 | `src/lib/supabase-messages.ts` | **MOD** — drop `calls` from the sidebar; scope; real timestamps; error checks; narrow `channel` |
| 7 | `src/pages/Conversations.tsx` | **MOD** — effective viewer, scope resolution, deep-link validation |
| 8 | `src/components/conversations/ConversationsSidebar.tsx` | **MOD** — viewer prop, clear + seq guard, error/retry |
| 9 | `src/pages/Contacts.tsx` | **MOD** — swap in `useImportHistory`; error/retry block |
| 10–14 | 5 new test files (§9) | **NEW** |
| 15 | `AGENT_RULES.md` | **MOD** — new invariant (§9 Doc Update Rule) |
| 16 | `WORK_LOG.md` | **MOD** — entry prepended, **only after** code is implemented and verified |
| **+3 only if §13 Q2 = A1** | `src/lib/impersonationProfile.ts` **(NEW)** · `ViewAsModal.tsx:49` **(MOD, 1 line)** · `TeamMembersTable.tsx:200` **(MOD, 1 line)** | View As payload repair (§4.4) + 1 more test file |

### 6.5 Explicitly NOT touched

`getConversationThread` behaviour (calls stay in the thread) · `ConversationThread.tsx` ·
`ContactBriefView.tsx` · `useContactScope.ts` / `teamAgentIds` (hierarchy-based, unchanged) ·
`usersApi.getAgentScopeIds` (used as-is) · `useOrganization.ts` (incl. its
`isSuperAdmin || isImpersonating`) · `AuthContext.tsx` · `CampaignDetail.tsx` import history ·
`ImportLeadsPage.tsx` · `ImportLeadsModal.tsx` · undo/retry RPCs · `supabase/**` · every migration ·
every RLS policy · dialer · telephony · `campaign_leads` · workflows.

---

## 7. Role and "View As" scoping — the behaviour contract

| Effective role | Conversations sidebar | Import History |
|---|---|---|
| **Agent** | `{ kind: "agents" }` — see §13 Q3 | `agent_id = viewerId` + org |
| **Team Leader** | `{ kind: "agents" }`, self + **complete recursive downline** via `getAgentScopeIds` | `agent_id = viewerId` + org (**own imports only**, per requirement) |
| **Admin** | `{ kind: "org", organizationId }` | org-wide, `organization_id` explicit |
| **Super Admin, not impersonating** | `{ kind: "org" }` with the **home** organization | org-wide, home organization |
| **"View As" (any target)** | effective profile's **id, role and organization**; the real Super Admin session must not widen anything | same |

Rules that make this hold:

1. Identity comes from **`useAuth().profile`** (`AuthContext.tsx:283` — already impersonation-aware),
   never `useAuth().user`.
2. Organization and role come from **`useOrganization()`** (`:71-77` returns the impersonated
   profile's values under impersonation).
3. The organization-wide branch is decided by `isOrganizationWideViewer` — **never** by
   `useOrganization().isSuperAdmin`, which is `true` while impersonating (`useOrganization.ts:94`).
4. Scope resolution **fails closed**: any error → `agentIds: []` → zero rows. No organization-wide
   fallback, matching `Contacts.tsx:274-278` and the `getAgentScopeIds` contract
   (`supabase-users.ts:184-195`, `:231`).
5. `hierarchy_path` / `is_ancestor_of` are **not** used by the new code.
6. **Contingent on §13 Q2.** Under A2 (no payload repair) rows 1–2 and the "View As" row degrade to
   *zero rows* rather than the viewed Agent's rows, because `profile.id` is `undefined` (§4).

---

## 8. Stale responses, deep links, and the honest limits

### 8.1 Stale-response and viewer-change handling (both features)

Copied from the two patterns already proven in this repo:

1. **Derived identity key** (`Contacts.tsx:249-253`) — not effect-set state, because under "View As"
   the organization changes **in place with no remount** and an effect-based reset would be one
   commit too late.
2. **Clear on key change** — `setConversations([])` / `setEntries([])` in the same commit, so the
   previous viewer's rows never paint.
3. **Sequence guard** — `loadSeqRef.current += 1` on key change; a response commits only if its
   captured sequence is still current (`agentsFetchSeqRef`, `Contacts.tsx:256-262`; `isCurrent()`,
   `FullScreenContactView.tsx:309`, `:541`). This also covers the unfiltered realtime refetch storm
   in §3.1(i).
4. **`null` scope = loading**, never a premature empty state (`Contacts.tsx:246-248`).

### 8.2 Deep-link handling (`?contactId=`)

`contactId` must be a UUID → resolved through the **same scoped resolver** as the sidebar → the
thread renders only on success. On failure: an explicit "conversation not available" panel, no
thread, no `ContactBriefView`, and **no `'lead'` guess**. `contactType` is always derived from the
resolution.

### 8.3 Residual limits — stated, not hidden

- **The `sent_at` fallback is a client-side re-rank inside the fetched window.** PostgREST cannot
  `ORDER BY COALESCE(sent_at, created_at)`, so a legacy SMS with `sent_at IS NULL` is *paged* by the
  secondary `created_at` order and re-ranked in the client. A row far outside the paged window could
  still be mis-placed. The exact fix is a server-side view/RPC — which needs a **migration**, which
  §11 forbids in this phase. Recorded as Phase B input, not silently approximated away.
- **Fail-closed on NULL provenance.** `import_history.agent_id` / `organization_id` and
  `messages.organization_id` are nullable. Explicit equality filters exclude NULL rows — the safe
  direction; the alternative would widen visibility.
- **This is query scoping, not a database authorization boundary.** `messages_select` and
  `import_history_select` remain organization-wide. A user with the network tab still reads them.
  Per AGENT_RULES §3 that must **not** be represented as a security boundary — hence §12.
- **Team Leader downline is broken *at the database level* independently of this fix.**
  `is_ancestor_of` (baseline `:4135-4146`) tests `hierarchy_path <@ hierarchy_path`, and AGENT_RULES
  records those production values as depth-1 self-labels. So `contact_emails_select` and the
  hierarchical `leads`/`clients`/`recruits`/`calls` policies currently resolve **self-only** for a
  Team Leader. Phase A asks correctly for the recursive downline; RLS will still filter the downline
  rows out for email/leads/clients/recruits (SMS is org-wide so it is unaffected). **Phase A cannot
  fix this and does not claim to.** Phase B input.
- **Paging terminator assumption.** `getAgentScopeIds` breaks paging on
  `rows.length < AGENT_SCOPE_PAGE_SIZE` (500) (`supabase-users.ts:243`). If PostgREST's server-side
  `max-rows` were configured below 500, every page would look short and descendants would be
  silently dropped. Pre-existing, unverified from the repo, and it applies equally to today's
  Contacts → Agents tab. Noted, not changed.
- **Out-of-scope View As defects found and reported, not fixed:** `Contacts.tsx:248-250, 270`
  (Agents-tab traversal seeded with the real `user.id`), `Contacts.tsx:1725-1738` (new
  Clients/Recruits assigned to the real Super Admin), `useContactScope.ts:83, 111-121, 143` (Team
  scope + saved preferences on the real user), `useOrganization.ts:94`
  (`isSuperAdmin || isImpersonating`). Each is a separate change with its own blast radius.

---

## 9. Fail-first tests

Five new files (six under §13 Q2 = A1), following the repo's conventions (135 test files under
`src/`, co-located `__tests__` dirs, camelCase `*.test.ts(x)`) and the **projection-faithful**
Supabase mock idiom from `src/pages/__tests__/campaignDetailImportRetry.test.tsx` — the mock records
the `.select()` column list and every `.eq()` / `.in()`, so a test can assert a column was **not**
selected and a filter was **not** applied. Each suite is demonstrated **failing on a pristine
baseline worktree** before the fix lands, with the failure output quoted in `WORK_LOG.md`.

> ⚠️ **Do not copy that harness verbatim.** Its projection is **table-scoped and naive**:
> `campaignDetailImportRetry.test.tsx:81` gates on `if (table === "import_history" && …)`, so every
> *other* table echoes the full fixture row regardless of the select list, and `projectRow` splits
> the select string on bare commas (which mis-tokenizes an embedded select such as
> `campaign:campaigns(id,name)`). A test that copied it and asserted "`phone` was not selected on
> `leads`" would **pass vacuously**. The new harness must apply the projection to **every** table it
> serves — otherwise tests #5 and #13 below are not real proofs. `vitest.config.ts` is jsdom +
> `globals: true` with a single minimal setup file (`src/test/setup.ts` — jest-dom and a
> `matchMedia` stub only), so each suite brings its own mocks; 29 existing files already mock
> `@/contexts/AuthContext` with a `vi.hoisted()` mutable `authState`, which is exactly what tests
> #16 and #18 need to flip identity **without a remount**.

**`src/lib/__tests__/conversationScope.test.ts`** *(pure)*
1. `smsEventAt` prefers `sent_at`; falls back to `created_at`; `null` when both are null.
2. `emailEventAt` uses `received_at` for inbound, `sent_at` for outbound, `created_at` as the
   fallback for each.
3. `pickNewestPerContact` returns **one row per contact**, newest first, and **drops** rows with an
   unparseable timestamp (never emits `NaN`).
4. `isOrganizationWideViewer`: `Admin` → true; `Super Admin` not impersonating → true;
   `Super Admin` **impersonating an Agent** → **false**; `Team Leader` → false; `Agent` → false.

**`src/lib/__tests__/recentConversationsScope.test.ts`** *(projection-faithful Supabase mock)*
5. **A call can neither create nor rank a sidebar conversation** — **no query is ever issued against
   `calls`**, and a contact whose only activity is a call is absent. *(Fails today: `:31-35`.)*
6. **Calls remain in the opened thread** — `getConversationThread` still queries `calls` and returns
   `type: "call"` rows in the merged ascending result.
7. **SMS recency uses `sent_at`, `created_at` only as a legacy fallback** — `created_at` **is** in
   the `messages` select list, order is `sent_at` with `nullsFirst: false`, and a null-`sent_at` row
   ranks by `created_at` instead of producing `undefined`.
8. **Email recency uses the real event time** — inbound ranks by `received_at`, outbound by
   `sent_at`; an email whose `created_at` is much newer than its `received_at` does **not** jump to
   the top.
9. **A user cannot receive another user's resolved contacts** — with
   `{ kind: "agents", agentIds: ["me"] }`, an org-wide `messages` row for a contact owned by
   `"other"` yields **zero** rows; the `leads` query carries `.in("user_id", ["me"])`,
   `clients`/`recruits` carry `.in("assigned_agent_id", ["me"])`, and all three carry
   `.eq("organization_id", …)`.
10. **Team Leader recursive scope** — `agentIds` from a 3-level `upline_id` chain all resolve; a
    sibling branch outside the chain does not.
11. **Unresolved contacts are excluded** — no `'Unknown Contact'` string is ever produced and no row
    has `contact_type` defaulted to `'lead'`.
12. **Unrelated activity cannot crowd out authorized conversations** — a page full of out-of-scope
    org SMS followed by an in-scope one still returns the in-scope conversation (paging continues
    past the first authorization-empty page).
13. **`phone` and `email` are selected** for all three contact tables. *(Fails today: `:92-94`.)*
14. **Query failure surfaces** — an `error` on any query **rejects**; it does not resolve partially.
15. **Fail closed** — `{ kind: "agents", agentIds: [] }` issues no contact query and returns `[]`.

**`src/pages/__tests__/conversationsViewAs.test.tsx`** *(React, mocked `useAuth`)*
16. **"View As" uses the effective profile** — with a real Super Admin session and an impersonated
    Agent, the scope resolves to the **Agent's** id and org and the organization-wide branch is
    **not** taken. *(Pins the `useOrganization().isSuperAdmin === true` trap, §4.3.)*
17. **Deep link is validated against the same scope** — `?contactId=<out-of-scope uuid>` renders the
    unavailable state and not the thread; `?contactId=<not-a-uuid>` is rejected before any query.
18. **Viewer change clears and rejects stale responses** — a slow response for viewer A resolving
    after a switch to viewer B never repaints; the list is empty in between.
19. **Error state offers Retry and is distinct from the empty state.**

**`src/lib/__tests__/importHistoryScope.test.ts`** *(projection-faithful Supabase mock)*
20. **Admin / non-impersonating Super Admin** → exactly one `.eq("organization_id", org)` and **no**
    `agent_id` filter.
21. **Every other role, incl. Team Leader** → **both** `.eq("organization_id", org)` **and**
    `.eq("agent_id", viewerId)`. *(Fails today: `Contacts.tsx:1071-1075` applies neither.)*
22. **"View As Agent"** → filters use the **impersonated** Agent's id and org, and the org-wide
    branch is not taken.
23. **Error rejects** rather than resolving empty. *(Fails today: `if (!error && data)`.)*
24. **Missing org or viewer id issues no query** and returns `[]`.

**`src/pages/__tests__/contactsImportHistoryTab.test.tsx`** *(React)*
25. **An inactive Contacts tab does not fetch Import History** — mounting on `?tab=Leads` issues
    **zero** `import_history` queries; switching to `?tab=Import History` issues exactly one.
    *(Fails today: `Contacts.tsx:1115`.)*
26. **Viewer change clears data and rejects stale responses** — same guarantee as #18.
27. **Error vs. empty** — an error renders the error block **with Retry**; a successful empty
    response renders the existing *"No imports yet"* state (`:2789-2795`).
28. **Post-import refresh still works** — `location.state.importCompleted` marks stale and the tab
    refetches on activation.
29. **Drill-in, retry and undo still work** — `openImportDetail`, `handleRetryImportAttachment` and
    `handleConfirmUndoImport` fire and trigger exactly one refresh each.

**`src/lib/__tests__/impersonationProfile.test.ts`** *(pure — only under §13 Q2 = A1)*
30. `toImpersonationProfile` produces a `Profile` whose `id`, `role`, `organization_id`,
    `is_super_admin`, `first_name`, `last_name` and `email` are all **defined and correct**.
    *(Fails today: `ViewAsModal.tsx:49` yields `undefined` for the first four.)*
31. `platform_role` is **not** synthesized (authority stays on `realProfile`,
    `useIsPlatformAdmin.ts:1-7`).

---

## 10. Verification (run after implementation approval, before handoff)

| # | Command | Gate |
|---|---|---|
| 1 | Focused: `npx vitest run` over the 5–6 new suites | all pass, after being demonstrated failing on a pristine baseline worktree |
| 2 | `npm test` | **no regression** vs. the captured baseline (previous entry: 135 files / 1902 passed / 12 skipped / 0 failed) |
| 3 | `npx tsc --noEmit` | exit 0 |
| 4 | `npm run lint` | no new errors (baseline count captured first — the previous pass recorded 218 problems / 15 errors as pre-existing) |
| 5 | `npm run build` | success |
| 6 | `npm run verify:s1-plan` | exit 0 — unchanged; this pass adds no migration |
| 7 | `git diff --check` | clean |
| 8 | Adversarial diff review | re-read the diff hunting for a widened scope, a lost `.eq`, a swallowed error, a `user.id` that should be `profile.id` |

⚠️ **`npm run verify:s1-plan:selftest` is deliberately NOT in the gate list** — it writes a
`.selftest.tmp` file next to the runbook inside the repo tree. `verify:s1-plan` (gate 6) is
pure-static and safe.

⚠️ **Gates 3 and 4 are weak and must not be mistaken for coverage.** `tsconfig.json` sets
`noImplicitAny: false` and `strictNullChecks: false`, `tsconfig.app.json` sets `strict: false`; and
`eslint.config.js` disables `no-unused-vars`, `no-explicit-any`, `no-unused-expressions`,
`no-constant-condition` and `no-empty`. The narrowed `ConversationPreview['channel']` union (§6.2)
still gives a genuine compile-time guard against calls re-entering the sidebar, but the tests in §9
are the real proof.

Baselines for gates 2–5 will be captured on a **pristine worktree at the merge-base** *before* any
edit, exactly as the previous entry did.

**Environment note, stated up front.** `node_modules` is **not installed** in this diagnosis
container, so gates 1–5 and 7 could not be run during diagnosis and will need `npm ci` first.
The one gate that *was* run read-only, because it needs nothing but Python and the runbook:

```
$ npm run verify:s1-plan
ALL 23 CHECKS PASSED -- revert list is 262 pre-baseline versions, the ten applied
post-baseline versions are protected, final history is 11 rows.       (exit 0)
```

That is the recorded pre-change baseline for gate 6. Consistent with the previous entry, no CI
workflow runs vitest / tsc / lint — the only two GitHub workflows are the S1 plan check and the
manually-dispatched SQL suite — so gates 1–5 and 7 are hand-run.

**Doc updates (AGENT_RULES §8/§9), after the gates pass:**
- `AGENT_RULES.md` — new invariant: *"Conversations sidebar rows and recency come from SMS + email
  only; `calls` never enters `getRecentConversations`. Conversation and Import History queries carry
  the effective `organization_id` plus an explicit uploader/owner filter, resolved from
  `useAuth().profile` (impersonation-aware) — never `useAuth().user`, and never gated on
  `useOrganization().isSuperAdmin`, which is `true` while impersonating. Scope resolution fails
  closed. This is query scoping, not a database authorization boundary: `messages_select` and
  `import_history_select` remain organization-wide."* Plus, under A1, the impersonation-payload
  rule: *"`startImpersonation` must receive a real snake_case `Profile`; the camelCase `UserProfile`
  DTO has no `id`/`role`/`organization_id`."*
- `WORK_LOG.md` — entry prepended (newest first), **only after** the code is implemented and every
  gate has passed.

---

## 11. Phase A exclusions — the hard boundary

**Nothing in this list happens in Phase A, at any point, for any reason.**

- ❌ No migration. No file added to `supabase/migrations/`.
- ❌ No modification anywhere under `supabase/**` — no policy, function, trigger, template or seed.
- ❌ No RLS change. No `#APPROVE_RLS_CHANGE` is claimed or implied.
- ❌ No production data read or write. **No Supabase MCP call at all** — not `execute_sql`, not even
  read-only. The RLS facts here come from repo SQL text; §12 says how to confirm them against
  production when Chris authorizes it.
- ❌ No Edge Function deploy. No Vercel action. No deployment of any kind.
- ❌ No GitHub action — no PR, no comment, no merge.
- ❌ No working around the disabled Supabase production deployment setting.
- ❌ No change to the dialer, telephony, `calls` writes, campaigns, queue locks, or workflows.

**Why no migration, specifically.** The S1 migration-history consolidation is pending.
`scripts/verify_s1_reconciliation_plan.py:35-40` hard-codes the ten post-baseline versions that must
survive (`PRESERVED`) and the ladder `272 → 206 → 140 → 75 → 10 → 11`, measured read-only against
production. An eleventh migration file invalidates the hand-verified inventory the runbook is built
on. Note `npm run verify:s1-plan` reads **only the runbook** — it would *not* catch the drift, which
is precisely why the rule is a human one.

---

## 12. Phase B — RLS hardening (**NOT APPROVED, NOT STARTED, NOT COSTED**)

Recorded so Phase A's boundary is legible. **Nothing here may begin until (a) S1 is complete,
(b) Chris replies with the literal `#APPROVE_RLS_CHANGE`, and (c) remote apply is separately
approved.** Listing it is not proposing it.

| Finding (repo SQL — **not** verified against production in this pass) | Location |
|---|---|
| `messages_select` is organization-wide — every org member reads every SMS body | baseline `:12336` |
| `import_history_select` is organization-wide | baseline `:12207` |
| `is_ancestor_of` uses `hierarchy_path <@`, whose production values AGENT_RULES records as depth-1 self-labels — so Team Leader downline reads resolve **self-only** for `contact_emails`, `leads`, `clients`, `recruits`, `calls` | baseline `:4135-4146`, `:11929`, `:11312`, `:11304`, `:11338` |
| `contact_emails_select` is correctly per-owner and is the shape `messages` should have | baseline `:11929` |
| `calls` SELECT is `Calls Hierarchical Select` (the baseline ALL policy was command-split by RLS Phase 1) — the migration's own header saying it was *"NOT been applied remotely"* is **stale**; `WORK_LOG.md:456` and `:471` record the production apply on 2026-08-23, and the version is in the S1 `PRESERVED` set | `supabase/migrations/20260823203257_rls_phase1_calls_command_split.sql:111-126` |
| `CampaignDetail.tsx` reads `import_history` org-wide with an explicit "Imported by" column — deliberate provenance, but re-decide once `import_history` RLS tightens | `CampaignDetail.tsx:531-560` |

Phase B would, if approved, continue the **existing RLS Phase program** rather than invent a new one
— the 2026-08-23 pass established the house shape: policy DDL only, fail-closed pre- **and**
postconditions, exact rollback SQL under `supabase/migrations/rollback/`, and a committed local SQL
suite (`scripts/run_rls_phase1_tests.sh`, run via the dispatch-only `sql-tests.yml`). Candidate work:
tighten `messages_select` to owner/hierarchy (mirroring `contact_emails_select`), tighten
`import_history_select` to uploader-or-Admin, and repair the hierarchy model so Team Leader downline
works at the database level. Each needs its own plan, its own fail-first SQL suite, and its own
approval.

**Before Phase B is even planned**, these must be confirmed **read-only against production**
(Supabase MCP `list_migrations` + a read-only `execute_sql` over `pg_policies`) — AGENT_RULES
invariant #5: *file on disk ≠ applied*. `supabase/migrations/` holds 11 `.sql` files while
`supabase/migrations_archive/` holds ~266, so repo text is a strong hint, **not** production truth.

---

## 13. Approval checklist

| # | Question | Recommendation | Status |
|---|---|---|---|
| 1 | Proceed with the Phase A change in §6, as scoped? | — | ⏳ **Awaiting Chris** |
| 2 | **§4 blocker.** Include the View As payload repair (**A1** — new pure mapper + 2 one-line call-site changes + 1 test file), or exclude it (**A2** — Phase A fails closed under View As and the "View As" acceptance criteria cannot be met)? | **A1.** Without it `profile.id` is `undefined` and "View As Agent shows only that Agent's imports" is unachievable. A1 also un-breaks Contacts / Dashboard / Reports / permissions under View As — a real behavioural change beyond the three reported defects, which is why it needs your call. | ⏳ **Awaiting Chris — blocking** |
| 3 | **Agent with a downline.** `getAgentScopeIds` returns self + every recursive descendant regardless of role. The requirement says *"Agent: own contacts/conversations."* Restrict `role === "Agent"` to `[viewerId]`, or use the uniform helper path? | **Restrict to `[viewerId]`** — honours the requirement literally; for a normal Agent (no downline) both options return exactly `[viewerId]`, so it only bites a mis-configured hierarchy. | ⏳ **Awaiting Chris** |
| 4 | **Post-import refresh.** Mark-stale + fetch on tab activation, or keep the eager refetch into an inactive tab? | **Mark-stale** — satisfies both "only fetch when the tab is active" and "plus any required post-import refresh"; the import lands on `?tab=Leads` anyway. | ⏳ **Awaiting Chris** |
| 5 | **Team Leader Import History = own imports only** (as the requirement states), not the downline's? | Confirming your stated requirement. | ⏳ **Confirm** |
| 6 | Phase B RLS hardening | Requires `#APPROVE_RLS_CHANGE` **and** separate remote-apply approval, **after** S1. | ⛔ **Not requested, not approved** |

**⛔ No source file, test, migration, policy, or deployment will be touched until #1 and #2 are
answered.**
