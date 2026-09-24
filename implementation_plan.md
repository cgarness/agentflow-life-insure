# Implementation Plan — BUGFIX: Missing lead details in Team / Open Pool dialer (rev 5 — RELEASE-REVIEW CORRECTIONS IN PROGRESS; MERGE HELD)

> **STATUS (rev 4, 2026-09-24): Option F IMPLEMENTED and TESTED on `claude/lead-details-team-open-pool-03hfuh`.**
> - Frontend only, using existing authorization. §7 is the as-built record. §0–§6 are kept as the decision
>   history (rev 1–3).
> - **No migration, RPC, RLS, grant, Edge Function or production data change.** Production contact was
>   read-only catalog SELECTs under D-7 and D-7b.
> - **NOT merged, NOT deployed, no PR.** Pushing the branch triggers only Vercel's automatic preview builds.
> - Option S (the backend authorization review) is a separate project. Its findings are recorded in
>   `docs/audits/2026-09-24/DIALER_AUTHORIZATION_FINDINGS.md`.
> - **Chris's decisions (2026-09-24):**
>   - Option F approved.
>   - Option S not started; it is to be one coordinated review with `claim_lead` first.
>   - D-8 yes.
>   - D-7b approved (done).
>   - Sold/Convert must fail closed without the master row.
>   - Reveal-state bugs are to be fixed frontend-only.
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
needs a backend read path (§4, Option S) to fix the pre-claim case. That path is only safe after the write-path hardening in §4.4.

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

## §4. Backend options — DECIDED: Option F now, Option S separately (nothing authored or applied)

### §4.1 How this was reviewed

A draft lock-scoped read RPC (`get_locked_lead_details`, "B-1") was sent to an independent adversarial review with four
lenses (security, dialer lifecycle, repo conventions, alternatives). Each high/critical finding was then re-checked by a
separate skeptic told to refute it. **Of eight critical/high findings, seven were confirmed and one was refuted.** The
refuted one said `#APPROVE_RLS_CHANGE` is required for a policy-free SECURITY DEFINER function; repo precedent says it is
not. I re-verified the load-bearing claims myself in the repository.

**Every policy cited in §4.2–§4.3 comes from the REPO BASELINE. The live INSERT/DELETE policies were NOT read, because D-7
covered SELECT/UPDATE policies and grants only.** The live `leads` policies did match the baseline exactly. Confirming the
rest needs D-7b (§4.6).

### §4.2 Why the drafted RPC is NOT safe to propose

B-1 authorized a read through three things: "a live `dialer_lead_locks` row of mine", the `campaign_leads.lead_id` it
points at, and "a `calls` row of mine". **An ordinary Agent can write every one of them:**

| Trust input | Why it is forgeable (repo baseline) |
|---|---|
| Lock row | `dialer_lead_locks_insert` WITH CHECK is only `locked_by = auth.uid() AND organization_id = get_org_id()` (baseline:12075). `locked_at` and `expires_at` are client-settable. **No client code inserts locks**; only the SECURITY DEFINER RPCs should. |
| `campaign_leads.lead_id` | `campaign_leads_insert` is an org check only (:11655). `campaign_leads_update` is org-only with no WITH CHECK (:11669), so `lead_id` can be re-pointed at any org lead. **No client code inserts `campaign_leads` or changes `lead_id`.** |
| The campaign itself | `campaigns_insert` checks only org and `user_id = self` (:11683). `add_leads_to_campaign` lets a campaign's creator administer it (`private.can_administer_campaign`), and for **Open Pool every org lead is "eligible"** (`20260811200920…:322-324`). So a legitimately served lock can still be steered at an arbitrary lead. |
| `calls` "dial-started" gate | "Calls Hierarchical Insert" accepts any row with `agent_id = self` (`20260823203257…:128-139`), including `campaign_lead_id` and `created_at`. It is not a boundary; at most it guards against honest-client mistakes. It also opens at *ringing* rather than at connect, and misses the inbound and Admin DNC-override dial paths. |

B-1 also skipped the ownership guards `get_next_queue_lead` applies (another agent's hard claim or callback, terminal
status, licensed state), and it copied the campaign-membership rule instead of using `public.can_dial_campaign` /
`private.campaign_actor`. **Net effect:** any Agent could quietly read DOB, spouse, notes and custom fields of leads that
RLS hides from them today. That is the opposite of "don't weaken the protection", so **B-1 is withdrawn.**

### §4.3 Pre-existing security findings (NOT introduced by this work; reported, not fixed)

Each needs its own approval and plan. All are repo-baseline analysis; **live definitions are UNVERIFIED** (see D-7b).

1. **`claim_lead` lead takeover (critical).** `claim_lead(p_campaign_lead_id, p_lead_id, p_campaign_id)` checks only that
   the campaign and campaign lead are in the caller's org. It then runs
   `UPDATE leads SET assigned_agent_id = auth.uid() WHERE id = p_lead_id AND org`. **`p_lead_id` is never tied to the
   campaign lead**, and there is no lock, campaign-type, membership or "already assigned" check (baseline:1319-1350; granted
   to `anon`/`authenticated`). `sync_leads_user_id` then gives full RLS read/write. **Any Agent who knows a lead's UUID can
   take ownership of any lead in the organization.** The self-assignment notification is skipped, so the only trace is the
   ownership change.
2. **`get_enterprise_queue_leads` cross-tenant read (high).** It is SECURITY DEFINER and `GRANT ALL … TO anon`
   (baseline:13493). It reads the campaign by id with **no org or `auth.uid()` check**, and returns that campaign's
   `campaign_leads` rows (name, phone, email, state). **No `src/` caller** uses it.
3. **Open Pool attach exposure (medium).** Any user can create an Open Pool campaign they administer, and
   `add_leads_to_campaign` treats every org lead as eligible for it. The attach copies first/last name, phone, email, state
   and age into `campaign_leads`, which the creator can then SELECT, including for leads owned by other agents.
4. **Sold conversion drops custom fields (data loss, same root cause).** When the master row was unreadable, the merged
   row has no `custom_fields`. `ConvertLeadModal` → `convertLeadToClient` builds the client's `custom_fields` from that row,
   and `convert_lead_to_client_atomic` then deletes the lead (`DialerPage.tsx:4792`, `supabase-conversion.ts:28-44`,
   `20260812042319…:122-190`). This is protected (invariant #11, dispositions), so it is not changed here.
5. **Staged-reveal gaps in `callStatus` (existing, frontend).**
   - A lock-lost reload during a live call or wrap-up swaps in a new, never-dialed lead while `callStatus` stays
     `connected` (`DialerPage.tsx:1483-1492`, `889-900`).
   - Answering an inbound call reveals the locked outbound lead.
   - An unanswered call flashes `connected` for 200 ms at `ended`.

### §4.4 Options

**Option F — frontend only, no backend change (RECOMMENDED now).**

The approved §5 fix, plus these parts:

- **(F1) Master details come from the existing RLS-governed read only.** That means the loader's embed, or a
  `leads.select(…).eq(id).eq(organization_id).maybeSingle()` read. It is stored in a separate identity-keyed state, never
  written into `leadQueue`, so calling behavior is untouched.
- **(F2) "Details unavailable" is an explicit state, never "empty".** When the master row is unreadable, the card shows the
  snapshot fields plus a notice ("Full contact record not available to you yet"). Edit is disabled.
- **(F3) One event-driven re-read when the hard claim lands.** This fires when `claimedLeadIds` gains this lead:
  `claim_lead` sets `assigned_agent_id`, the sync trigger sets `user_id`, and the row becomes readable under today's RLS.
  An Agent gets complete details and Edit about 46 s into a real conversation, or at a claiming disposition. This
  **widens nothing.**
- **(F4) Edit gating.** Edit requires `contacts.leads.edit` (fail closed), the master row loaded, and a client-side
  predicate mirroring the UPDATE policy: Admin/super admin, owner, or Team Leader. A Team Leader outside their downline
  gets RLS's refusal as a clear message, and the draft is kept.

What F does not fix: before a hard claim, an Agent without view permission still sees only the snapshot fields.

**Option S — server read path (separate backend security project; `#APPROVE_RLS_CHANGE` + exact SQL approval +
separate apply approval).**

A lock-scoped read is only as strong as the rows it trusts, so it **requires these prerequisites**, each touching a
protected area:

| # | Change | Touches |
|---|---|---|
| S1 | Drop `dialer_lead_locks_insert` (locks only via the SECURITY DEFINER RPCs; no client insert exists) | RLS on the queue-lock table |
| S2 | `campaign_leads`: drop the client INSERT policy and add a BEFORE UPDATE trigger making `lead_id` / `campaign_id` / `organization_id` immutable for non-definer callers | RLS + trigger on the queue table |
| S3 | Fix `claim_lead`: bind `p_lead_id` to `campaign_leads.lead_id`, require the caller's live lock and a Team/Open campaign | **hard claim (protected)** |
| S4 | Decide who may create or attach to Open Pool/Team campaigns (e.g., Open Pool attach limited to leads the actor may see, or campaign creation by Admin/TL only) | campaign/attach flows |
| S5 | New RPC `get_locked_lead_details(p_campaign_lead_id uuid, p_call_id uuid)`: SECURITY DEFINER, `search_path = pg_catalog, pg_temp`, actor via `private.campaign_actor()`, `public.can_dial_campaign`, every `get_next_queue_lead` ownership guard, bound to one specific outbound call of this agent (defense in depth only), trimmed columns (no `status`), `COALESCE(can_edit,false)`, REVOKE PUBLIC/anon, GRANT `authenticated, service_role`, optional access-audit + rate cap | new function |

Frontend S-specific parts:
- a dialed-lead binding (`lastDialCampaignLeadIdRef`, outbound only, answered call or wrap-up);
- a client lock epoch;
- a re-fetch on hard claim.

It also needs a full local as-`authenticated` harness with negative tests (forged lock, forged call, self-created
campaign, re-pointed row, another agent's claim, inactive profile, cross-org), a production preflight/post-check, and a
rollback. This is a multi-migration security build. **I recommend it as its own approved project, sequenced after the
`claim_lead` fix (§4.3-1)**, because that hole makes any master-field protection moot anyway.

**Rejected alternatives:**
- A `leads` SELECT policy for lock holders: same forgeable inputs, exposes the row on every surface and Realtime, adds a
  per-row subquery, and cannot trim columns.
- Changing `get_next_queue_lead`: protected.
- Org `role_permissions` overrides granting `view_unassigned` / `view_all`: org-wide widening and a production data
  mutation.
- Calling `claim_lead` at connect: violates the hard-claim rules.

### §4.5 New decision requested

- **D-8 (frontend, with Option F).** The new Team/Open details component additionally requires that the displayed lead
  is the one this agent **dialed**: `lastDialCampaignLeadIdRef.current === currentLead.id`, outbound. Otherwise it shows
  the masked state. This only **tightens** the new master-detail display against the §4.3-5 gaps; `callStatus`,
  `LeadCardBlurred` and the Personal path are unchanged. Recommended: **yes**.

### §4.6 Optional read-only verification (needs approval: D-7b)

Catalog-only SELECTs, no business rows:
- live `pg_policies` for `dialer_lead_locks`, `calls`, `campaign_leads` INSERT/DELETE and `campaigns`;
- `pg_get_functiondef` and ACL for `claim_lead`, `get_enterprise_queue_leads`, `add_leads_to_campaign`,
  `private.can_administer_campaign`.

These would turn §4.2/§4.3 from repo-baseline analysis into live-confirmed facts before any security ticket.

---

## §5. Frontend implementation (approved rev 1 design; as built in §7)

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

---

## §7. As built (2026-09-24)

### §7.1 D-7b — additional read-only production verification (DONE)

**Approved scope:** catalog-only SELECTs of
- the live `pg_policies` for `dialer_lead_locks`, `calls`, `campaign_leads` and `campaigns`;
- `pg_class` RLS, owner and ACL for those tables;
- `pg_get_functiondef`, `proacl` and `has_function_privilege` for `claim_lead`, `get_enterprise_queue_leads`,
  `add_leads_to_campaign` and `private.can_administer_campaign`.

**No business rows. No write.**

Every §4.2/§4.3 finding is **confirmed live**, and two are worse than the repo suggested:
- `claim_lead` is executable by `PUBLIC` and `anon`.
- `private.can_administer_campaign` returns true for **every** same-org actor on **any** Open Pool campaign.

Severity and evidence are recorded in `docs/audits/2026-09-24/DIALER_AUTHORIZATION_FINDINGS.md` (F1–F7). **None
was fixed.**

### §7.2 What changed (Team / Open Pool only; Personal byte-for-byte unchanged)

| File | Change |
|---|---|
| `src/lib/dialerLeadFields.ts` (new) | Typed resolver. Layout (user → agency → default) is ordering; remaining standard fields, then logical custom definitions, then undefined bag keys are appended deterministically. `std:` / `custom:` identities. Custom values come from `custom_fields[<name>]`. Duplicate definitions are collapsed by normalized name (#33). Internal keys are hidden (`isReservedCustomFieldKey`, `__*`, `tags`). Formatting keeps `0` / `false`, hides blanks, and never renders `[object Object]`. Source and Age are read master-first. |
| `src/lib/teamOpenReveal.ts` (new) | Pure reveal gate. The lock is still required. Full reveal only for the campaign lead this agent dialled outbound, once that call is answered. Inbound activity never qualifies. An unanswered `ended` never flashes. A lock change drops the dial session. |
| `src/lib/teamOpenLeadEdit.ts` (new) | Zod per-field validation. The save plan contains changed keys only. Source and Assigned Agent can never be planned. The standard phone is required once set and is normalized. `mergeCustomFieldsBag` applies only the changed keys onto a fresh bag and refuses reserved keys or a non-object bag. |
| `src/lib/teamOpenLeadAccess.ts` (new) | Edit gate: full reveal, `contacts.leads.edit` (fails closed while loading), no View-As, master row loaded, and owner / Admin / super admin / Team Leader. Conversion gate: fails closed without the master row, and refuses a lead not dialled under the current lock. Master-only overlay for ConvertLeadModal. |
| `src/hooks/useTeamOpenMasterLead.ts` (new) | Master row from the loader's RLS-governed embed. At most **one** automatic re-read per identity after the hard claim, then an explicit `unavailable` / `error` state with Retry. Identity-guarded. `adopt()` takes the saved row. |
| `src/hooks/useTeamOpenLeadEdit.ts` (new) | Identity-bound draft. It is discarded on a lead change and on any existing dialer reset. The save does a fresh org-scoped `custom_fields` read and merge, then `leadsSupabaseApi.update`, then a **verified** campaign-copy update (`.select().maybeSingle()`; 0 rows → D-6 partial success). Success only after confirmation. The draft is kept on failure. A late result is reported, never painted onto another lead. |
| `src/components/dialer/TeamOpenLeadDetails.tsx`, `TeamOpenLeadField.tsx` (new, <200 lines each) | Grid, notices (unavailable / loading / error with Retry / definitions unavailable), type-appropriate editors (state select, dropdown incl. legacy value, DateInput with Clear, textarea). Structured values are read-only. |
| `src/components/dialer/LeadCard.tsx` | Optional `teamOpenDetails` slot rendered **only** inside the existing `connected` branch. The idle skeleton and `LeadCardBlurred` are untouched. |
| `src/pages/DialerPage.tsx` | Scoped wiring only:<br>• the loader adds `master_lead: leadData ?? null` (the RLS embed, nothing else);<br>• the dial-session state and its three effects;<br>• Team/Open `callStatus` delegates to the pure gate;<br>• the custom-field definition `useQuery` (org + viewer key, 5 min cache, Team/Open only, last good data kept);<br>• the master and edit hooks;<br>• Edit / Save / Cancel routed by `lockMode`;<br>• header name inputs are Personal-only;<br>• the conversion fail-closed guard;<br>• ConvertLeadModal gets the master overlay;<br>• the DNC-override closure records the dialled lead for the reveal gate;<br>• a 1.5 s grace cancel of the draft after leaving full reveal (survives the existing hang-up → wrap-up gap).<br>The Full View input is unchanged. |

**Unchanged:**
- queue acquisition, release, heartbeat and hard-claim calls;
- dispositions, retry, DNC logic, calling hours, caller ID and auto-dial guards;
- `TwilioContext`, `useLeadLock` and `useHardClaim`;
- telemetry;
- every backend object.

### §7.3 Known limits (documented, accepted)

- **Before a hard claim**, an Agent without view permission sees only the campaign copy and a notice (Option F by design).
  A short Sold call (< 46 s, so not yet claimed) cannot be converted in the dialer: it fails closed with a message.
- **"Answered"** reuses the dialer's existing definition: outbound reached `active`. `TwilioContext` notes that
  `active` can come at browser media-up, before the PSTN answer. The reveal is therefore no earlier than today's.
- **Same-lead lock loss** during a live call masks the card until the next dial of that lead. This fails closed.
- **Pre-existing exposures, not changed:**
  - the header shows the full name while idle;
  - Full View is available in all states;
  - `mapDialerLeadToContactLead` maps `leadSource` from the snapshot `source` (affects Full View and conversion prefill).

### §7.4 Confirmed Personal-campaign bugs — logged for a SEPARATE fix (D-5; not changed here)

`startEditing` / `saveInlineEdit` (`DialerPage.tsx`) still have these bugs:
1. Every save sends `leadSource: source` from the snapshot, which is usually blank, and so **erases `leads.lead_source`**.
2. Custom-field names share one flat form with standard keys, so a custom field named like `phone` overwrites the standard value.
3. The layout's `notes` / `assigned_agent_id` text boxes save **into `custom_fields`**.
4. The post-save queue update is keyed by **index**, not identity, and the draft is not cleared on lock loss.
5. `age` `0` is dropped.
6. The campaign-copy update error is unchecked.
7. `custom_fields` is written as the whole bag from the form.

Each needs its own regression coverage.

### §7.5 Proposed AGENT_RULES invariant (proposal only; not written)

> **38. Team/Open dialer lead details use existing authorization only and never widen access for display.**
> - Custom values resolve from `custom_fields[<canonical name>]`; the saved layout is ordering, not inventory.
> - The master row comes only from the RLS-governed embed, or one post-claim re-read. "Unavailable" is never
>   rendered as empty.
> - Full reveal requires the confirmed lock AND the lead this agent dialled outbound (answered). Inbound activity
>   and lock changes never satisfy it.
> - Inline saves send changed keys only, merge `custom_fields` onto a fresh read, verify the campaign-copy write,
>   and are identity-guarded.
> - Sold/Convert fails closed without the master row.
> - A lock-scoped server read path requires the write-path hardening in
>   `docs/audits/2026-09-24/DIALER_AUTHORIZATION_FINDINGS.md` first.

### §7.6 Verification (see WORK_LOG 2026-09-24)

- `tsc -p tsconfig.app.json`: error set identical to baseline (91).
- Full Vitest: 3235 tests (3220 pass / 1 pre-existing fail / 14 skip) vs baseline 3141 (3126 / 1 / 14). Zero
  status changes on existing tests; 94 new passing tests.
- Mutation proof: 21/21 caught.
- Build passes; ESLint shows no new problems.
- Two independent adversarial reviews: the backend design (§4.1), and the implementation, where every confirmed
  finding was fixed.
- **Authenticated browser / call smoke tests: NOT RUN.**

---

## §8. Rev 5 — release-review corrections (APPROVED by Chris, 2026-09-24; merge HELD)

**Approval boundary.** Approved:
- the §8.1–§8.3 frontend corrections and their tests;
- §8.4 as documentation only;
- two read-only production checks (A: `get_edge_function twilio-voice-webhook`; B: a bounded API-log search for
  `get_enterprise_queue_leads`, request metadata only);
- SC-1 as a design proposal only.

**NOT approved:** migrations, RLS changes, grants or revokes, function replacement, production writes, real calls,
merge or deploy.

**Base recheck:** branch head `df6cd857`; `main` still at `f78140d`; no conflicting dialer/contact work.

### §8.1 Master reads and edit-session identity
- **Full context:** organization + viewer + `campaign_leads.id` + `leads.id`.
- **Visit generation:** increments on every context change (including A → B → A), and on disable and unmount.
- **Request generation:** increments on every read start, `adopt()` and replacement embed.
- **Stale starts are rejected:** retry and save are bound to the visit that issued them.
- **Stale finishes are rejected:** a response applies only if both generations match **and** the returned
  `id` and `organization_id` match.
- **First committed render:** the state for a superseded visit is masked at once, not only after a passive
  effect.
- **Save completion, adopt and queue reconciliation** carry explicit `campaignLeadId` / `leadId` plus the visit
  token; ids are never parsed from a composite key.
- **Context is rechecked** after each awaited prerequisite, before the next write. A write already sent is
  never described as cancelled.
- **Read refreshes do not end the edit session:** request generations are separate from it.
- The bounded post-claim read is kept; there is no polling.

### §8.2 Answered-outbound reveal
- **`useTeamOpenDialSession` (extracted from DialerPage):** each attempt is scoped to the outbound Call instance
  from TwilioContext's `currentCall`.
  - The answered flag never carries across attempts.
  - A calls-row id is used only when it arrives for the same attempt.
  - The hook adds no SDK listeners, so there are none to remove. Answer evidence is the provider's `active`
    state for the same Call instance, which also covers a Call that was already accepted when first observed.
- **Integration test** on the real `TwilioProvider` (fake SDK), plus SDK/TwiML source pins as a supplementary
  check.
- **Documented precondition:** `answerOnBridge` on the outbound TwiML. Refusal-path behaviour remains unresolved.

### §8.3 Sold recovery
- Four distinct messages: loading, error (with Retry), unavailable after claim (with Retry), unavailable before
  claim.
- Retry performs ONE context-bound read and never converts.
- The disposition and notes are kept; there is no save, advance or release.
- There is no persistence promise across refresh.
- Short-Sold completion remains an unresolved release limitation.

### §8.4 Security containment and SC-1
Both are documents only (`docs/audits/2026-09-24/DIALER_AUTHORIZATION_FINDINGS.md`, `SC1_CONVERSION_MERGE_DESIGN.md`).

### Exact files
- **Changed:**
  - `src/hooks/useTeamOpenMasterLead.ts`, `src/hooks/__tests__/useTeamOpenMasterLead.test.tsx`
  - `src/hooks/useTeamOpenLeadEdit.ts`, `src/hooks/__tests__/useTeamOpenLeadEdit.test.tsx` (identity/session
    propagation only)
- **New:**
  - `src/hooks/useTeamOpenDialSession.ts`
  - `src/contexts/__tests__/teamOpenRevealIntegration.test.tsx`
  - `src/lib/__tests__/outboundAnswerSignalPinned.test.ts`
- **Changed:**
  - `src/pages/DialerPage.tsx`
  - `src/lib/teamOpenLeadAccess.ts`, `src/lib/__tests__/teamOpenLeadEdit.test.ts`
  - `src/pages/__tests__/dialerTeamOpenWiring.test.ts`
  - `docs/audits/2026-09-24/DIALER_AUTHORIZATION_FINDINGS.md`
- **New:** `docs/audits/2026-09-24/SC1_CONVERSION_MERGE_DESIGN.md`
- **Changed:** `implementation_plan.md`, `WORK_LOG.md`
- **Not touched:** TwilioContext, the SDK, webhooks, claim timing, re-entrancy guards, telemetry, Personal and the
  backend.
