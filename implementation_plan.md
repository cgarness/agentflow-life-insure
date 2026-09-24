# Implementation Plan — BUGFIX: Missing lead details in Team / Open Pool dialer (rev 2 — D-7 DONE; BACKEND DECISION PENDING)

> **STATUS (rev 2, 2026-09-24).**
> - Rev 1 (the Phase 1 inspection plan) was approved by Chris with the recommended choices for D-1 to D-7,
>   and D-7 was moved ahead of any implementation.
> - **D-7 (read-only production inspection) is DONE.** It confirms that a **backend authorization change is
>   required** for the reported symptom (§2).
> - Per Chris's instruction, implementation is **STOPPED** until he approves the exact backend change in §4.
>   No application code has been changed.
> - **No migration, RPC, RLS, grant, Edge Function or data change has been made anywhere.**
>   **NOT merged, NOT deployed, no PR.**
>
> **Repository:** `cgarness/agentflow-life-insure` · branch `claude/lead-details-team-open-pool-03hfuh`
> · base `main` @ **`f78140d`**. The previous plan (Dashboard Leaderboard widget) is preserved in git
> history at `f78140d`.

---

## §0. TL;DR

Team/Open dialer cards lose lead details for two independent reasons:

1. **Authorization (backend, confirmed live).** A plain Agent — and a Team Leader, for leads they did not
   import — **cannot SELECT the master `leads` row** of a typical Team/Open lead. Queue leads are unassigned
   or assigned to the caller, and neither `contacts.leads.view_unassigned` nor `contacts.leads.view_all` is an
   Agent default. The dialer's enrichment embed `lead:leads(*)` therefore returns `null`. The card falls
   back to the `campaign_leads` snapshot: first/last name, phone, email, state, age and source. DOB, best
   time, spouse, notes, `lead_source` and **all custom fields** are gone. **This cannot be fixed in the
   frontend.**
2. **Rendering (frontend, confirmed in code).**
   - `LeadCard` reads `lead[f.key]` for every descriptor, so custom fields, whose values live in
     `custom_fields[name]`, always render `—` outside edit mode.
   - The layout is treated as the complete inventory of fields.
   - Source reads the snapshot `campaign_leads.source` rather than `leads.lead_source`.
   - The inline save path has several corruption hazards (§1.3).

The frontend fix (rev 1, §5) is still required and still approved, but it would only help users who can
already read the master row: Admins, owners, Team Leader downline, and any lead after a hard claim. It
needs the §4 backend read path to fix the reported case.

---

## §1. Phase 1 findings (code, base `f78140d`)

### §1.1 Data flow — Team/Open

`get_next_queue_lead` (SECURITY DEFINER, `RETURNS SETOF campaign_leads`) returns the locked
`campaign_leads` row. `loadLockModeLead` (`DialerPage.tsx:1415-1500`) then runs
`campaign_leads.select("*, lead:leads(*)").eq("id", lock.id).maybeSingle()`, **ignoring its error**, and
merges `{ ...lead, ...campaignLead, state, id: campaignLead.id, lead_id }`.

- `setLeadQueue([merged])` and `setConfirmedLockLeadId(lock.id)` are set together.
- `callStatus` (`DialerPage.tsx:889-900`) reveals the card:
  - `idle` → skeleton;
  - `ringing` → `LeadCardBlurred`;
  - `connected` → full grid. This requires the confirmed lock AND `twilioCallState` active/ended OR wrap-up.
- `LeadCard` renders `fieldDescriptors` (user layout → agency layout → default), or a fixed fallback list.

### §1.2 Rendering defects (`LeadCard.tsx`, `contactFieldLayout.ts`)

- `LeadCard.tsx:197` `lead[f.key]`, where a custom descriptor's key is the bare name (`contactFieldLayout.ts:131`).
  The value is in `custom_fields[name]`.
- Edit mode shows custom values (because `startEditing` spreads `custom_fields` into the form,
  `DialerPage.tsx:4054`), but view mode does not.
- The layout is the inventory: populated fields missing from an older layout are never shown.
- `leadSource` → key `source` reads `campaign_leads.source`. The attach RPC never writes that column
  (`20260811200920…:346-358`). The master column is `leads.lead_source`.
- `healthStatus` → `health_status`: that column was dropped (`20260422190000`).
- `truthy || "—"` hides `0`, and objects render as `[object Object]`.

### §1.3 Inline-save hazards (`startEditing` / `saveInlineEdit`, `DialerPage.tsx:4041-4116`) — shared by Personal

- **One flat form mixes standard keys and custom names.** A custom field named like a standard key
  overwrites it.
- **The layout's `notes` / `assigned_agent_id` descriptors are editable text boxes** whose values fall into
  the `...customFields` rest-spread and are saved **inside `custom_fields`**.
- **Every save sends `leadSource: source`** (the usually blank snapshot), which **erases `leads.lead_source`**.
- **No identity guard.** The post-save `setLeadQueue` writes to the *current* index. After a lead change or
  lock loss, lead A's values land on lead B's card. The draft is not cleared on lock loss either
  (`DialerPage.tsx:1484-1490`), so a later Save can write A's draft to B.
- The `campaign_leads` snapshot update error is unchecked, and `age` `0` is dropped.

### §1.4 Other observations (not changed in this build)

- The header shows the full first + last name while `idle`.
- The Full View (Eye) drawer is available in every state.
- View-As already blocks `/dialer` (`viewAsSurfaces`).
- `contacts.leads.edit` is defined but enforced nowhere today.
- `leads.custom_fields` can hold the importer's internal markers `__agentflow` (object) and `tags` (array)
  (`import-contacts/index.ts:264-276`), in addition to reserved `additional_policies`.

---

## §2. D-7 — read-only production inspection (DONE 2026-09-24)

**Scope, exactly as approved:** catalog-only SELECTs against `jncvvsvckxhqgqvkppmj` covering:
- `pg_policies` for `leads` / `campaign_leads`;
- `pg_class` RLS flags and ACLs;
- `information_schema.role_table_grants`;
- definitions of the functions those policies call (`has_contacts_permission`, `_contacts_permission_default`,
  `get_user_role`, `super_admin_own_org`, `sync_leads_user_id`);
- the list of functions that reference `dialer_lead_locks`;
- `list_migrations`.

**No business rows were read**, and neither were `role_permissions` org overrides (outside the approval).
**No write, DDL, RPC invocation or other mutation was made.**

| Check | Live result |
|---|---|
| `leads` RLS | enabled, not forced |
| `leads` policies | **identical to the repo baseline**: `Leads Hierarchical Access` (FOR ALL: owner `user_id = auth.uid()` / super-admin own org / Admin in org / Team Leader ancestor), `leads_select_unassigned_pool` (unassigned AND `view_unassigned` AND (`view_all` OR imported by caller)), `leads_select_view_all_pool` (`view_all`). **No lock-based path.** The only UPDATE path is Hierarchical Access. |
| `campaign_leads` policies | SELECT: Admin/TL in org; Agent → Open Pool rows, Team rows where they are in `assigned_agent_ids`, Personal own rows. UPDATE/DELETE: any org member. INSERT: org check. |
| Permission defaults (`_contacts_permission_default`) | Agent: `view_assigned` ✔, **`view_unassigned` ✘, `view_all` ✘**, `edit` ✔. Team Leader: `view_assigned` ✔, `view_unassigned` ✔, **`view_all` ✘**, `edit` ✔. Admin / super admin: all ✔. Org overrides in `role_permissions` win when present (not read). |
| `sync_leads_user_id` | `user_id := assigned_agent_id` whenever `assigned_agent_id` is set, so a hard claim makes the lead readable by its claimer |
| Grants | `leads` / `campaign_leads`: full table privileges to `anon` / `authenticated` / `service_role`. RLS is the only boundary. |
| Functions touching `dialer_lead_locks` | `get_next_queue_lead`, `get_queue_metrics`, `release_lead_lock`, `release_all_agent_locks`, `renew_lead_lock`, `wipe_organization_operational_data`. **None returns master lead data.** |
| Migrations | Newest live: `20260923224254 emergency_pause_org_leaderboard_20260923`. It is **not in the repository** and is unrelated to leads; noted for reconciliation. |

**Conclusion.** `get_next_queue_lead` serves leads where `assigned_agent_id IS NULL OR = caller`. For an
unassigned lead, `user_id` is NULL or the importer. So an Agent with default permissions **cannot read the
master row of any unassigned Team/Open lead**, and a Team Leader can read one only if they imported it. The
enrichment embed returns `lead: null`, and the error is swallowed, which is exactly the reported symptom.
The same Agent **cannot UPDATE** that row either. **A backend read path is required. Per Chris's
instruction, implementation stops here for approval of §4.**

---

## §3. Decisions (approved 2026-09-24)

| # | Decision |
|---|---|
| D-1 | Custom values with no visible definition: **shown read-only**. |
| D-2 | Team/Open **Edit disabled until full reveal** (`callStatus === "connected"`). The header-name / Full View exposures are logged as follow-ups, not changed. |
| D-3 | Team/Open Edit **gated on `hasContactsPermission("contacts.leads.edit")`**, failing closed while permissions load. |
| D-4 | **Source is read-only** in Team/Open edit. |
| D-5 | **Personal unchanged** in this build. The confirmed Personal bugs (§1.3) are logged separately for their own fix and regression coverage. |
| D-6 | Master saved but campaign snapshot failed → **report partial success clearly**. Never imply a total failure, and never blindly retry the master write. |
| D-7 | **Read-only production inspection — DONE (§2).** Backend change required → §4 awaits approval. |

---

## §4. Proposed backend change — AWAITING CHRIS'S EXACT APPROVAL

_(Finalized after independent adversarial review; see the chat summary. Nothing here has been applied.)_

PLACEHOLDER — replaced below once the review synthesis is complete.

---

## §5. Frontend implementation (approved in rev 1; begins only after §4 is decided)

Team/Open only, through an explicit `LeadCard` prop passed when `lockMode`. Personal keeps its current code
path byte-for-byte. Staged reveal (`callStatus`, `confirmedLockLeadId`, `LeadCardBlurred`) is untouched.

- **`src/lib/dialerLeadFields.ts`** (pure, typed resolver):
  - **Ordering:** user → agency → default layout, then the remaining supported standard fields, then the
    remaining custom definitions (active, applying to Leads, by name then id), then undefined bag keys
    sorted by key.
  - **Separate identities:** `std:<id>` / `custom:<name>`. A "(custom)" label is added on collision, in the
    UI only.
  - **Values:** standard fields from their approved mapping (Source → `lead_source`); custom fields from
    `custom_fields[name]`.
  - **Always hidden:** `leadScore`, `healthStatus`, IDs, lock metadata, `isReservedCustomFieldKey` keys,
    `__*` keys and `tags`.
  - **View mode:** hides blank values but keeps `0` / `false`; dates, booleans and lists are formatted;
    objects are never rendered.
  - **Edit mode:** every supported editable field, including empty agency fields.
- **`src/hooks/useTeamOpenLeadEdit.ts`:**
  - The session is bound to `campaign_leads.id` + `leads.id`, and the draft is discarded on lead change,
    lock loss or leaving full reveal.
  - Zod validation.
  - Only changed standard keys are sent, through `leadsSupabaseApi.update`.
  - `custom_fields` edits merge only the changed keys onto a freshly read bag
    (`.eq(id).eq(organization_id).maybeSingle()`, refused on failure/null). Reserved, internal and unrelated
    keys are preserved.
  - The snapshot update is checked (D-6), the returned row is adopted under the identity/newest-token
    guard, and success is shown only after the save is confirmed. On failure the draft is kept.
- **`src/components/dialer/TeamOpenLeadDetails.tsx` + `TeamOpenLeadField.tsx`** (each under 200 lines,
  Tailwind only).
- **Custom field definitions:** one cached `useQuery` (`customFieldsSupabaseApi.getAll`, keyed by org +
  user, `staleTime` 5 min, Team/Open only). A failed read shows saved values read-only with a notice; it is
  never treated as "no fields".
- **`DialerPage.tsx`:** only the scoped wiring, as described above.

## §6. Verification plan

- Regression tests as listed in the brief, plus SQL tests for §4 if approved.
- **Checks, compared against the clean base:**
  - `npx tsc --noEmit` (vacuous, reported only);
  - `npx tsc -p tsconfig.app.json --noEmit` (91-error baseline);
  - focused and full Vitest;
  - `npm run build`;
  - ESLint on the touched files.
- **Smoke checks are NOT RUN unless authorized:** Team/Open details, call record creation/status, Save /
  Save & Next, logs.
